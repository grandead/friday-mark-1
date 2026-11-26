import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abortPendingOperations } from '../src/services/runtime';
import { transcribe } from '../src/services/stt/transcribe';
import { buildApp } from '../test/application';
import { createTestDatabase } from '../test/database';
import { sendWav } from './send-wav';

const TEMP_DIRECTORY = tmpdir();
const TEMP_PREFIX = join(TEMP_DIRECTORY, 'friday-whisper-');

const folder = await mkdtemp(TEMP_PREFIX);
const database = await createTestDatabase();
const app = await buildApp({
  db: database.db,
  recordingsDir: folder,
  transcribe,
});
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const websocketAddress = address.replace('http:', 'ws:');
  const text = await sendWav(
    process.argv[2] ?? '/tmp/friday-speech.wav',
    `${websocketAddress}/audio`,
  );
  const normalizedText = text.toLowerCase();
  assert.match(normalizedText, /проверка/);
  assert.match(normalizedText, /русскую речь/);
  console.log(
    'PASS: audio socket -> archived WAV + in-memory upload -> whisper-server -> Russian text',
  );
} finally {
  abortPendingOperations();
  await app.close();
  await database.close();
  await rm(folder, { recursive: true, force: true });
}
