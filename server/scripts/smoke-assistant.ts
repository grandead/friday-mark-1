import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Shape } from '@prisma/orm-postgres/family-contract/types';
import { LLM_CONFIG } from '../src/config/llm';
import type { Models } from '../src/services/database';
import { generateResponse } from '../src/services/llm/generate-response';
import { abortPendingOperations } from '../src/services/runtime';
import { transcribe } from '../src/services/stt/transcribe';
import { synthesizeSpeech } from '../src/services/tts/synthesize-speech';
import { buildApp } from '../test/application';
import { createAssistant } from '../test/assistant';
import { createTestDatabase } from '../test/database';
import { sendWav } from './send-wav';

const TEMP_DIRECTORY = tmpdir();
const TEMP_PREFIX = join(TEMP_DIRECTORY, 'friday-assistant-');

if (!process.argv[2])
  throw new Error('Usage: npm run test:assistant -- /absolute/path/question.wav');
const folder = await mkdtemp(TEMP_PREFIX);
const database = await createTestDatabase();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const generateReply = createAssistant(database.db, generateResponse);
  app = await buildApp({
    db: database.db,
    recordingsDir: folder,
    transcribe,
    generateReply,
    synthesizeSpeech,
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const started = performance.now();
  const websocketAddress = address.replace('http:', 'ws:');
  const text = await sendWav(process.argv[2], `${websocketAddress}/audio`);
  const trimmedText = text.trim();
  assert.ok(trimmedText, 'Speech must be recognized');
  const deadline = Date.now() + LLM_CONFIG.timeoutMs + 65_000;
  let entry: Shape<Models.public_Interaction, { '+': 'actions' }> | null = null;
  while (Date.now() < deadline) {
    entry = await database.db.orm.public.Interaction.include('actions').first();
    if (entry?.finishedAt) break;
    await delay(100);
  }
  assert.ok(entry?.finishedAt, 'Assistant did not finish');
  assert.equal(entry.status, 'complete', entry.error ?? 'Assistant failed');
  assert.equal(entry.responseSource, 'llm');
  const reply = entry.responseText?.trim();
  assert.ok(reply);
  assert.ok(entry.outputAudioKey);
  const wav = await app.inject(`/api/audio/${entry.id}/output`);
  assert.equal(wav.statusCode, 200);
  const header = wav.rawPayload.toString('ascii', 0, 4);
  assert.equal(header, 'RIFF');
  assert.ok(wav.rawPayload.length > 44);
  const response = await app.inject('/api/interactions');
  const journal = response.json();
  assert.equal(journal.items[0].responseText, entry.responseText);
  assert.equal(journal.items[0].actions[0].service, 'ollama');
  const elapsed = performance.now() - started;
  const elapsedMs = Math.round(elapsed);
  const result = JSON.stringify(
    {
      transcript: text,
      reply: entry.responseText,
      audioBytes: wav.rawPayload.length,
      elapsedMs,
      llm: entry.actions[0].result,
    },
    null,
    2,
  );
  console.log(result);
  console.log('PASS: WAV → STT → Ollama → TTS → journal and playable WAV');
} finally {
  abortPendingOperations();
  await app?.close();
  await database.close();
  await rm(folder, { recursive: true, force: true });
}
