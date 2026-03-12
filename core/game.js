const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { closest } = require('fastest-levenshtein');
const places = require('../data/places.json');
const countriesData = require('../data/countries.json');
const config = require('../config/gameConfig');

const BLACKLIST_PATH = path.join(__dirname, '..', 'data', 'blacklist.json');

const STATES = {
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  REVEAL: 'REVEAL',
  COOLDOWN: 'COOLDOWN'
};

class Game extends EventEmitter {
  constructor() {
    super();
    this.state = STATES.IDLE;
    this.currentPlace = null;
    this.guesses = [];
    this.answeredUsers = new Set();
    this.roundNumber = 0;
    this.timer = null;
    this.cooldownTimer = null;
    this.secondsLeft = 0;
    this.recentPlaces = [];
    this.blacklist = this.loadBlacklist();
    this.aliasKeys = Object.keys(countriesData.aliases);

    // Sesion de juego
    this.gameActive = false;
    this.maxRounds = config.MAX_ROUNDS;
    this.roundDuration = config.ROUND_DURATION;
    this.cooldownDuration = config.COOLDOWN_DURATION;
    this.scoreboard = {};       // { username: { correct: N, total: N } }
    this.roundHistory = [];     // resultados de cada ronda
  }

  // Configurar partida antes de iniciar
  configure(options) {
    if (this.gameActive) return;
    if (options.maxRounds) this.maxRounds = Math.max(1, Math.min(50, options.maxRounds));
    if (options.roundDuration) this.roundDuration = Math.max(10, Math.min(300, options.roundDuration));
    // cooldownDuration ya no se usa, el streamer avanza manualmente
  }

  startGame() {
    if (this.gameActive) return;

    this.gameActive = true;
    this.roundNumber = 0;
    this.scoreboard = {};
    this.roundHistory = [];

    this.emit('game:started', {
      maxRounds: this.maxRounds,
      roundDuration: this.roundDuration,
      cooldownDuration: this.cooldownDuration
    });

    this.startRound();
  }

  startRound() {
    if (this.state !== STATES.IDLE) return;
    if (!this.gameActive) return;

    // Verificar si ya se jugaron todas las rondas
    if (this.roundNumber >= this.maxRounds) {
      this.endGame();
      return;
    }

    this.roundNumber++;
    this.guesses = [];
    this.answeredUsers.clear();
    this.currentPlace = this.selectRandomPlace();
    this.state = STATES.ACTIVE;
    this.secondsLeft = this.roundDuration;

    this.emit('round:start', {
      lat: this.currentPlace.lat,
      lng: this.currentPlace.lng,
      roundNumber: this.roundNumber,
      maxRounds: this.maxRounds
    });

    this.timer = setInterval(() => {
      this.secondsLeft--;
      this.emit('round:tick', { secondsLeft: this.secondsLeft });

      if (this.secondsLeft <= 0) {
        this.endRound();
      }
    }, 1000);
  }

  selectRandomPlace() {
    const available = places
      .map((place, index) => ({ place, index }))
      .filter(({ index }) => !this.recentPlaces.includes(index) && !this.blacklist.has(index));

    const pool = available.length > 0
      ? available
      : places.map((place, index) => ({ place, index })).filter(({ index }) => !this.blacklist.has(index));

    if (pool.length === 0) return places[0];

    const chosen = pool[Math.floor(Math.random() * pool.length)];

    this.recentPlaces.push(chosen.index);
    if (this.recentPlaces.length > config.RECENT_PLACES_MEMORY) {
      this.recentPlaces.shift();
    }

    return chosen.place;
  }

  skipRound() {
    if (this.state !== STATES.ACTIVE) return;

    const idx = places.findIndex(p =>
      p.lat === this.currentPlace.lat && p.lng === this.currentPlace.lng
    );
    if (idx !== -1) {
      this.blacklist.add(idx);
      this.saveBlacklist();
      console.log(`[Blacklist] Lugar #${idx} marcado sin cobertura (${this.blacklist.size} total)`);
    }

    clearInterval(this.timer);
    this.timer = null;
    this.state = STATES.IDLE;
    this.roundNumber--; // no cuenta

    this.emit('round:skipped');
    this.startRound();
  }

  loadBlacklist() {
    try {
      const data = fs.readFileSync(BLACKLIST_PATH, 'utf-8');
      return new Set(JSON.parse(data));
    } catch {
      return new Set();
    }
  }

  saveBlacklist() {
    fs.writeFileSync(BLACKLIST_PATH, JSON.stringify([...this.blacklist]), 'utf-8');
  }

  submitGuess(user, input) {
    if (this.state !== STATES.ACTIVE) return null;
    if (this.answeredUsers.has(user)) return null;

    const countryCode = this.normalizeCountry(input);
    if (!countryCode) return null;

    this.answeredUsers.add(user);

    const correct = countryCode === this.currentPlace.country;
    const points = correct ? this.secondsLeft + 1 : 0;
    const guess = { user, countryCode, correct, points };
    this.guesses.push(guess);

    // Actualizar scoreboard
    if (!this.scoreboard[user]) {
      this.scoreboard[user] = { correct: 0, total: 0, points: 0 };
    }
    this.scoreboard[user].total++;
    if (correct) {
      this.scoreboard[user].correct++;
      this.scoreboard[user].points += points;
    }

    this.emit('round:guess', {
      user,
      country: countriesData.names[countryCode] || countryCode
    });

    return guess;
  }

  normalizeCountry(input) {
    const normalized = input.toLowerCase().trim();

    if (countriesData.aliases[normalized]) {
      return countriesData.aliases[normalized];
    }

    const upperInput = normalized.toUpperCase();
    if (countriesData.names[upperInput]) {
      return upperInput;
    }

    const bestMatch = closest(normalized, this.aliasKeys);
    if (bestMatch) {
      const distance = levenshteinDistance(normalized, bestMatch);
      if (distance <= config.FUZZY_THRESHOLD) {
        return countriesData.aliases[bestMatch];
      }
    }

    return null;
  }

  endRound() {
    if (this.state !== STATES.ACTIVE) return;

    clearInterval(this.timer);
    this.timer = null;
    this.state = STATES.REVEAL;

    const correctCountry = this.currentPlace.country;
    const winners = this.guesses
      .filter(g => g.correct)
      .map(g => ({ user: g.user, points: g.points }));

    const result = {
      correctCountry,
      correctName: countriesData.names[correctCountry] || correctCountry,
      lat: this.currentPlace.lat,
      lng: this.currentPlace.lng,
      winners,
      totalGuesses: this.guesses.length,
      roundNumber: this.roundNumber,
      maxRounds: this.maxRounds,
      isLastRound: this.roundNumber >= this.maxRounds
    };

    this.roundHistory.push(result);
    this.emit('round:end', result);

    // Esperar a que el streamer haga click en "Siguiente ronda"
    this.state = STATES.REVEAL;
  }

  // El streamer avanza manualmente
  nextRound() {
    if (this.state !== STATES.REVEAL) return;
    this.state = STATES.IDLE;

    if (this.roundNumber >= this.maxRounds) {
      this.endGame();
    } else {
      this.startRound();
    }
  }

  endGame() {
    this.gameActive = false;
    this.state = STATES.IDLE;

    // Calcular ranking final
    const ranking = Object.entries(this.scoreboard)
      .map(([user, stats]) => ({ user, ...stats }))
      .sort((a, b) => b.points - a.points || b.correct - a.correct)
      .slice(0, 20);

    this.emit('game:ended', {
      ranking,
      totalRounds: this.roundHistory.length,
      roundHistory: this.roundHistory
    });
  }

  pause() {
    if (this.state !== STATES.ACTIVE) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resume() {
    if (this.state !== STATES.ACTIVE) return;
    if (this.timer) return; // ya corriendo

    this.timer = setInterval(() => {
      this.secondsLeft--;
      this.emit('round:tick', { secondsLeft: this.secondsLeft });
      if (this.secondsLeft <= 0) {
        this.endRound();
      }
    }, 1000);
  }

  forceEnd() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.cooldownTimer) { clearTimeout(this.cooldownTimer); this.cooldownTimer = null; }
    this.gameActive = false;
    this.state = STATES.IDLE;
  }

  getState() {
    return {
      state: this.state,
      gameActive: this.gameActive,
      roundNumber: this.roundNumber,
      maxRounds: this.maxRounds,
      roundDuration: this.roundDuration,
      cooldownDuration: this.cooldownDuration,
      secondsLeft: this.secondsLeft,
      totalGuesses: this.guesses.length,
      scoreboard: this.scoreboard
    };
  }
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

module.exports = { Game, STATES };
