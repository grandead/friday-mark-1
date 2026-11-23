import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { createTranscriber } from '../src/whisper.js';
import { sendWav } from './send-wav.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'friday-whisper-'));
const app = await buildApp({
  recordingsDir: folder,
  transcribe: createTranscriber(join(root, '.tools/whisper.cpp/build/bin/whisper-cli'), join(root, 'models/ggml-small.bin')),
});
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const text = await sendWav(process.argv[2] ?? '/tmp/friday-speech.wav', address.replace('http:', 'ws:') + '/audio');
  assert.match(text.toLowerCase(), /проверка/);
  assert.match(text.toLowerCase(), /русскую речь/);
  console.log('PASS: real 20 kHz stream -> WAV -> local Whisper -> Russian text');
} finally { await app.close(); await rm(folder, { recursive: true, force: true }); }
