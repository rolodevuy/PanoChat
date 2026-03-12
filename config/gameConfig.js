module.exports = {
  // Duracion de cada ronda en segundos
  ROUND_DURATION: 60,

  // Numero maximo de rondas por partida
  MAX_ROUNDS: 10,

  // Comando que el chat usa para responder
  COMMAND_PREFIX: '!pais',

  // Segundos de pausa entre rondas (para que el streamer comente)
  COOLDOWN_DURATION: 10,

  // Umbral maximo de distancia Levenshtein para fuzzy matching
  FUZZY_THRESHOLD: 2,

  // Cuantos lugares recordar como "usados recientemente" para no repetir
  RECENT_PLACES_MEMORY: 30,

  // Twitch
  TWITCH_CHANNEL: '',
  TWITCH_BOT_USERNAME: '',
  TWITCH_OAUTH_TOKEN: '',

  // Servidor
  PORT: process.env.PORT || 3000
};
