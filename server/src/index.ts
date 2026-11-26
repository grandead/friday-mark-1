import { networkInterfaces } from 'node:os';
import { LLM_CONFIG } from './config/llm';
import { recordingsDir } from './config/paths';
import { serverPort as port } from './config/port';
import { getHttpServer } from './http';
import { db } from './services/database';
import { abortPendingOperations } from './services/runtime';

const app = await getHttpServer();
await app.listen({ host: '0.0.0.0', port });
console.log(`Friday ready. Recordings directory: ${recordingsDir}`);
const interfaces = networkInterfaces();
for (const addresses of Object.values(interfaces)) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal)
      console.log(`ESP32 endpoint: ws://${address.address}:${port}/audio`);
  }
}
console.log('Whisper server:', process.env.WHISPER_BASE_URL ?? 'http://127.0.0.1:33001');
console.log('LLM:', LLM_CONFIG.model, 'via', LLM_CONFIG.baseUrl);
console.log(
  'Say the wake word followed by a command. Recording ends after 1.5 seconds of silence. Hold the touch sensor to record manually.',
);
const stop = async () => {
  abortPendingOperations();
  await app.close();
  await db.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
