import { serverPort as port } from './config/port.js';
import { llmConfig } from './config/llm.js';
import { createOllama } from './services/llm/ollama.js';
import { createAssistant } from './services/assistant/reply.js';
import { connectDatabase } from './services/database/client.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { createSpeechRecognizer } from './services/stt/index.js';
import { synthesizeReply } from './services/tts/supertonic.js';
import { createHomeTools } from './services/smartHome/tools.js';
import { runDeviceCommand } from './services/smartHome/driver.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const shutdown = new AbortController();
const speech = await createSpeechRecognizer(root, shutdown.signal);
const db = connectDatabase();
const llm = createOllama({ ...llmConfig, signal: shutdown.signal });
const app = await buildApp({
  db,
  recordingsDir: join(root, 'recordings'),
  webDir: join(root, 'web/dist'),
  ...speech,
  generateReply: createAssistant(db, llm, createHomeTools(db, command => runDeviceCommand(command, shutdown.signal))),
  synthesizeReply: (text, output) => synthesizeReply(text, output, shutdown.signal),
});
await app.listen({ host: '0.0.0.0', port });
console.log(`Friday ready. Recordings directory: ${join(root, 'recordings')}`);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`ESP32 endpoint: ws://${address.address}:${port}/audio`);
  }
}
console.log('Speech recognizer:', speech.recognizer);
console.log('LLM:', llm.model, 'via', llmConfig.baseUrl);
console.log('Say the wake word followed by a command. Recording ends after 1.5 seconds of silence. Hold the touch sensor to record manually.');
const stop = async () => { shutdown.abort(); await app.close(); await db.$disconnect(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
