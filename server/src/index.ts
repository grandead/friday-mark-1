import { serverPort as port } from './config/port.js';
import { connectDatabase } from './services/database/client.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { createSpeechRecognizer } from './services/stt/index.js';
import { synthesizeReply } from './services/tts/supertonic.js';
import { setHumidifierPower } from './services/smartHome/humidifier.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const shutdown = new AbortController();
const speech = await createSpeechRecognizer(root, shutdown.signal);
const db = connectDatabase();
const app = await buildApp({
  db,
  recordingsDir: join(root, 'recordings'),
  webDir: join(root, 'web/dist'),
  ...speech,
  setHumidifierPower: power => setHumidifierPower(power, shutdown.signal),
  synthesizeReply: (text, output) => synthesizeReply(text, output, shutdown.signal),
});
await app.listen({ host: '0.0.0.0', port });
console.log(`Friday готов. WAV и текст: ${join(root, 'recordings')}`);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`Адрес для ESP32: ws://${address.address}:${port}/audio`);
  }
}
console.log('Распознавание:', speech.recognizer);
console.log('Скажи «Пятница» и команду. Полторы секунды тишины завершают запись. Ручная запись — удержанием сенсора.');
const stop = async () => { shutdown.abort(); await app.close(); await db.$disconnect(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
