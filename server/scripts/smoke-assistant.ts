import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestDatabase } from '../test/database.js';
import { buildApp } from '../src/app.js';
import { llmConfig } from '../src/config/llm.js';
import { createOllama } from '../src/services/llm/ollama.js';
import { createAssistant } from '../src/services/assistant/reply.js';
import { createSpeechRecognizer } from '../src/services/stt/index.js';
import { synthesizeReply } from '../src/services/tts/supertonic.js';
import { sendWav } from './send-wav.js';

if (!process.argv[2]) throw new Error('Usage: npm run test:assistant -- /absolute/path/question.wav');
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'friday-assistant-'));
const database = await createTestDatabase();
const shutdown = new AbortController();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const speech = await createSpeechRecognizer(root, shutdown.signal);
  app = await buildApp({
    db: database.db, recordingsDir: folder, ...speech,
    generateReply: createAssistant(database.db, createOllama({ ...llmConfig, signal: shutdown.signal })),
    synthesizeReply: (text, output) => synthesizeReply(text, output, shutdown.signal),
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const started = performance.now();
  const text = await sendWav(process.argv[2], address.replace('http:', 'ws:') + '/audio');
  assert.ok(text.trim(), 'Speech must be recognized');
  const deadline = Date.now() + llmConfig.timeoutMs + 65_000;
  let entry;
  while (Date.now() < deadline) {
    entry = await database.db.interaction.findFirst({ include: { actions: true } });
    if (entry?.finishedAt) break;
    await delay(100);
  }
  assert.ok(entry?.finishedAt, 'Assistant did not finish');
  assert.equal(entry.status, 'complete', entry.error ?? 'Assistant failed');
  assert.equal(entry.responseSource, 'llm');
  assert.ok(entry.responseText?.trim());
  assert.ok(entry.outputAudioKey);
  const wav = await app.inject(`/api/interactions/${entry.id}/audio/output`);
  assert.equal(wav.statusCode, 200);
  assert.equal(wav.rawPayload.toString('ascii', 0, 4), 'RIFF');
  assert.ok(wav.rawPayload.length > 44);
  const journal = (await app.inject('/api/interactions')).json();
  assert.equal(journal.items[0].responseText, entry.responseText);
  assert.equal(journal.items[0].actions[0].service, 'ollama');
  console.log(JSON.stringify({ transcript: text, reply: entry.responseText, audioBytes: wav.rawPayload.length,
    elapsedMs: Math.round(performance.now() - started), llm: entry.actions[0].result }, null, 2));
  console.log('PASS: WAV → STT → Ollama → TTS → journal and playable WAV');
} finally {
  shutdown.abort();
  await app?.close();
  await database.close();
  await rm(folder, { recursive: true, force: true });
}
