const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config/gameConfig');
const { Game } = require('./core/game');
const ChatListener = require('./bot/chatListener');
const countriesData = require('./data/countries.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'frontend')));

// Rooms: cada canal de Twitch tiene su propia partida
const rooms = new Map(); // channel -> { game, chatListener, sockets: Set }

function createRoom(channel) {
  const game = new Game();
  const chatListener = new ChatListener(game, channel);
  const room = { game, chatListener, sockets: new Set() };

  // Eventos del juego -> solo al room de Socket.io
  game.on('game:started', (data) => {
    console.log(`[${channel}] Partida iniciada — ${data.maxRounds} rondas, ${data.roundDuration}s`);
    io.to(channel).emit('game:started', data);
  });

  game.on('round:start', (data) => {
    console.log(`[${channel}] Ronda ${data.roundNumber}/${data.maxRounds} — ${data.lat}, ${data.lng}`);
    io.to(channel).emit('round:start', data);
  });

  game.on('round:tick', (data) => {
    io.to(channel).emit('round:tick', data);
  });

  game.on('round:guess', (data) => {
    console.log(`[${channel}] ${data.user}: ${data.country} ${data.correct ? '+' : '-'}`);
    io.to(channel).emit('round:guess', data);
  });

  game.on('round:end', (data) => {
    console.log(`[${channel}] Resultado: ${data.correctName} — ${data.winners.length} ganadores de ${data.totalGuesses}`);
    io.to(channel).emit('round:end', data);
  });

  game.on('round:cooldown_end', () => {
    io.to(channel).emit('round:cooldown_end');
  });

  game.on('round:skipped', () => {
    io.to(channel).emit('round:skipped');
  });

  game.on('game:ended', (data) => {
    console.log(`[${channel}] Partida terminada — ${data.totalRounds} rondas`);
    if (data.ranking.length > 0) {
      console.log(`[${channel}] Ganador: ${data.ranking[0].user} (${data.ranking[0].points} pts)`);
    }
    io.to(channel).emit('game:ended', data);
  });

  rooms.set(channel, room);
  return room;
}

function cleanupRoom(channel) {
  const room = rooms.get(channel);
  if (!room) return;
  if (room.sockets.size > 0) return; // todavia hay gente conectada

  room.chatListener.disconnect();
  room.game.forceEnd();
  rooms.delete(channel);
  console.log(`[${channel}] Room eliminada (sin conexiones)`);
}

// Socket.io
io.on('connection', (socket) => {
  console.log('[Socket] Cliente conectado');

  // Conectar a Twitch
  socket.on('twitch:connect', (data) => {
    const channel = (data.channel || '').trim().toLowerCase().replace(/^#/, '');
    if (!channel) {
      socket.emit('twitch:error', { message: 'Canal vacio' });
      return;
    }

    // Si el socket ya estaba en otra room, salir
    if (socket.channel) {
      const prevRoom = rooms.get(socket.channel);
      if (prevRoom) {
        prevRoom.sockets.delete(socket);
        socket.leave(socket.channel);
        cleanupRoom(socket.channel);
      }
    }

    // Crear o reutilizar room
    let room = rooms.get(channel);
    if (!room) {
      room = createRoom(channel);
    }

    socket.channel = channel;
    socket.join(channel);
    room.sockets.add(socket);

    // Si el chatListener no esta conectado, conectar
    if (!room.chatListener.client) {
      room.chatListener.connect()
        .then(() => {
          io.to(channel).emit('twitch:connected', { channel });
          console.log(`[Twitch] Conectado a #${channel}`);
        })
        .catch((err) => {
          socket.emit('twitch:error', { message: err.message || 'Error al conectar' });
        });
    } else {
      socket.emit('twitch:connected', { channel });
    }
  });

  // Helper: obtener game del socket
  function getGame() {
    if (!socket.channel) return null;
    const room = rooms.get(socket.channel);
    return room ? room.game : null;
  }

  // Configurar partida
  socket.on('game:configure', (options) => {
    const game = getGame();
    if (!game) return;
    game.configure(options);
    io.to(socket.channel).emit('game:configured', {
      maxRounds: game.maxRounds,
      roundDuration: game.roundDuration,
      cooldownDuration: game.cooldownDuration
    });
  });

  // Iniciar partida
  socket.on('game:start', () => {
    const game = getGame();
    if (game) game.startGame();
  });

  // Siguiente ronda (manual)
  socket.on('game:next', () => {
    const game = getGame();
    if (game) game.nextRound();
  });

  // Finalizar ronda antes de tiempo
  socket.on('game:end-round', () => {
    const game = getGame();
    if (game) game.endRound();
  });

  // Saltar lugar sin Street View
  socket.on('game:skip', () => {
    const game = getGame();
    if (game) game.skipRound();
  });

  // Pausar/resumir timer
  socket.on('game:pause', () => {
    const game = getGame();
    if (game) game.pause();
  });

  socket.on('game:resume', () => {
    const game = getGame();
    if (game) game.resume();
  });

  // Respuesta del streamer (no pasa por Twitch)
  socket.on('game:streamer-guess', (data) => {
    const game = getGame();
    if (!game || !socket.channel) return;
    const guess = (data.guess || '').trim();
    if (!guess) return;

    const streamerUser = socket.channel; // el nombre del canal como username
    const result = game.submitGuess(streamerUser, guess);

    if (result === null) {
      // Ya respondio o pais no reconocido
      socket.emit('streamer:feedback', { message: 'No reconocido', correct: false });
    } else if (result.correct) {
      socket.emit('streamer:feedback', { message: `+${result.points} pts`, correct: true });
    } else {
      socket.emit('streamer:feedback', { message: countriesData.names[result.countryCode] || result.countryCode, correct: false });
    }
  });

  // Forzar fin de partida
  socket.on('game:stop', () => {
    const game = getGame();
    if (game) game.forceEnd();
    if (socket.channel) io.to(socket.channel).emit('game:stopped');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Cliente desconectado');
    if (socket.channel) {
      const room = rooms.get(socket.channel);
      if (room) {
        room.sockets.delete(socket);
        cleanupRoom(socket.channel);
      }
    }
  });
});

server.listen(config.PORT, () => {
  console.log(`[Server] http://localhost:${config.PORT}`);
});
