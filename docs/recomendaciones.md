# GeoChat — Recomendaciones sobre el plan

Notas recogidas durante la revision del plan inicial del core.

---

## Dataset de lugares

- **Validar cobertura Street View**: muchas coordenadas no tienen panorama. Verificar cada coordenada con la API antes de incluirla en `places.json`.
- **Evitar repeticiones**: 200-500 lugares se agotan rapido en streams largos. Usar un flag `usedRecently` para no repetir lugares cercanos en el tiempo.

## Street View

- **Iframe vs API**: el iframe con `cbll=LAT,LNG` funciona pero es fragil (Google puede cambiar el formato, no hay forma de saber si el panorama existe). La Street View JavaScript API da mas control: verificar cobertura, ocultar elementos de UI, detectar errores. Requiere API key pero el free tier es generoso.

## Chat Listener

- **Libreria**: `tmi.js` es el estandar para Twitch.
- **Rate limiting**: si 500 viewers mandan `!pais` al mismo tiempo hay que manejar la carga.
- **Cambio de respuesta**: el plan dice "si ya respondio, ignore". Considerar permitir que un usuario cambie su respuesta antes del lock — puede ser mas divertido.

## Normalizacion de paises

- **Fuzzy matching**: el diccionario manual no cubre typos comunes del chat ("agrentina", "jaapn", "brsil"). Implementar distancia de Levenshtein con threshold, o al menos mapear los errores mas frecuentes.
- **Multi-idioma desde el inicio**: contemplar respuestas en espanol, ingles y portugues como minimo.

## Arquitectura

- **Comunicacion frontend-backend**: falta definir. WebSocket es la opcion natural para estado en tiempo real (timer, reveal, guesses). Socket.io simplifica esto.
- **Servidor unico**: un solo servidor Express + Socket.io que sirva el frontend, en lugar de separar backend y frontend estatico.

## Flujo de rondas

- **Estado COOLDOWN**: agregar entre REVEAL y el siguiente STARTING, para que el streamer tenga tiempo de comentar el resultado.
- **Simplificar estados**: LOCKED y REVEAL podrian ser un solo estado con un delay interno.

## Configuracion

- **Settings en vivo**: permitir que el streamer cambie configuracion sin reiniciar (ej: `!config timer 90`).

---

## Lo que esta bien como esta

- ISO codes para paises (no strings largos)
- Estructura de archivos clara
- MVP checklist concreto
- Principio de simplicidad: Street View + Timer + Chat Guess
