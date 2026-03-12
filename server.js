const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config/gameConfig');
const { Game } = require('./core/game');
const ChatListener = require('./bot/chatListener');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'frontend')));

const game = new Game();
let chatListener = null;

// Eventos del juego -> Socket.io
game.on('game:started', (data) => {
  console.log(`[Game] Partida iniciada — ${data.maxRounds} rondas, ${data.roundDuration}s cada una`);
  io.emit('game:started', data);
});

game.on('round:start', (data) => {
  console.log(`[Ronda ${data.roundNumber}/${data.maxRounds}] Inicio — ${data.lat}, ${data.lng}`);
  io.emit('round:start', data);
});

game.on('round:tick', (data) => {
  io.emit('round:tick', data);
});

game.on('round:guess', (data) => {
  console.log(`[Guess] ${data.user}: ${data.country} ${data.correct ? '+' : '-'}`);
  io.emit('round:guess', data);
});

game.on('round:end', (data) => {
  console.log(`[Resultado] ${data.correctName} — ${data.winners.length} ganadores de ${data.totalGuesses} respuestas`);
  io.emit('round:end', data);
});

game.on('round:cooldown_end', () => {
  io.emit('round:cooldown_end');
});

game.on('round:skipped', () => {
  io.emit('round:skipped');
});

game.on('game:ended', (data) => {
  console.log(`[Game] Partida terminada — ${data.totalRounds} rondas jugadas`);
  if (data.ranking.length > 0) {
    console.log(`[Game] Ganador: ${data.ranking[0].user} (${data.ranking[0].correct} aciertos)`);
  }
  io.emit('game:ended', data);
});

// Socket.io: eventos del streamer
io.on('connection', (socket) => {
  console.log('[Socket] Cliente conectado');
  socket.emit('game:state', game.getState());

  // Conectar a Twitch
  socket.on('twitch:connect', (data) => {
    const channel = (data.channel || '').trim().replace(/^#/, '');
    if (!channel) {
      socket.emit('twitch:error', { message: 'Canal vacio' });
      return;
    }

    // Actualizar config en memoria
    config.TWITCH_CHANNEL = channel;
    config.TWITCH_BOT_USERNAME = channel; // usar el mismo canal como bot anonimo
    config.TWITCH_OAUTH_TOKEN = '';       // tmi.js permite conexion anonima sin token

    // Desconectar listener previo si existe
    if (chatListener) {
      chatListener.disconnect();
    }

    chatListener = new ChatListener(game);
    chatListener.connect()
      .then(() => {
        io.emit('twitch:connected', { channel });
        console.log(`[Twitch] Conectado a #${channel}`);
      })
      .catch((err) => {
        socket.emit('twitch:error', { message: err.message || 'Error al conectar' });
      });
  });

  // Configurar partida
  socket.on('game:configure', (options) => {
    game.configure(options);
    io.emit('game:configured', {
      maxRounds: game.maxRounds,
      roundDuration: game.roundDuration,
      cooldownDuration: game.cooldownDuration
    });
  });

  // Iniciar partida
  socket.on('game:start', () => {
    game.startGame();
  });

  // Siguiente ronda (manual)
  socket.on('game:next', () => {
    game.nextRound();
  });

  // Finalizar ronda antes de tiempo
  socket.on('game:end-round', () => {
    game.endRound();
  });

  // Saltar lugar sin Street View
  socket.on('game:skip', () => {
    game.skipRound();
  });

  // Pausar/resumir timer
  socket.on('game:pause', () => {
    game.pause();
  });

  socket.on('game:resume', () => {
    game.resume();
  });

  // Forzar fin de partida
  socket.on('game:stop', () => {
    game.forceEnd();
    io.emit('game:stopped');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Cliente desconectado');
  });
});

server.listen(config.PORT, () => {
  console.log(`[Server] http://localhost:${config.PORT}`);
});
