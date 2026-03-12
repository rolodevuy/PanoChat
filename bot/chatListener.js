const tmi = require('tmi.js');
const config = require('../config/gameConfig');

class ChatListener {
  constructor(game) {
    this.game = game;
    this.client = null;
  }

  connect() {
    const opts = {
      options: { debug: false },
      channels: [config.TWITCH_CHANNEL]
    };

    // Solo agregar identity si hay token (sino conecta como anonimo)
    if (config.TWITCH_OAUTH_TOKEN) {
      opts.identity = {
        username: config.TWITCH_BOT_USERNAME,
        password: config.TWITCH_OAUTH_TOKEN
      };
    }

    this.client = new tmi.Client(opts);

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      this.handleMessage(tags['display-name'] || tags.username, message);
    });

    this.client.on('connected', () => {
      console.log(`[Bot] Conectado a #${config.TWITCH_CHANNEL}`);
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Bot] Desconectado: ${reason}`);
    });

    return this.client.connect();
  }

  handleMessage(user, message) {
    const trimmed = message.trim();

    // Si usa el comando !pais, extraer lo que viene despues
    const prefix = config.COMMAND_PREFIX.toLowerCase();
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const input = trimmed.slice(prefix.length).trim();
      if (input) this.game.submitGuess(user, input);
      return;
    }

    // Sino, intentar el mensaje completo como nombre de pais
    if (trimmed.length >= 2 && trimmed.length <= 30) {
      this.game.submitGuess(user, trimmed);
    }
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect().catch(() => {});
      this.client = null;
    }
  }
}

module.exports = ChatListener;
