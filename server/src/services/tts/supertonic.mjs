import { randomUUID } from 'node:crypto';
import { access, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sherpa from 'sherpa-onnx-node';

const MODEL_URL = new URL(
  '../../../models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/',
  import.meta.url,
);
const MODEL_DIRECTORY = fileURLToPath(MODEL_URL);
const MODEL_FILES = {
  durationPredictor: join(MODEL_DIRECTORY, 'duration_predictor.int8.onnx'),
  textEncoder: join(MODEL_DIRECTORY, 'text_encoder.int8.onnx'),
  vectorEstimator: join(MODEL_DIRECTORY, 'vector_estimator.int8.onnx'),
  vocoder: join(MODEL_DIRECTORY, 'vocoder.int8.onnx'),
  ttsJson: join(MODEL_DIRECTORY, 'tts.json'),
  unicodeIndexer: join(MODEL_DIRECTORY, 'unicode_indexer.bin'),
  voiceStyle: join(MODEL_DIRECTORY, 'voice.bin'),
};
const GENERATION_CONFIG = {
  sid: 1, // F2 in this model release
  numSteps: 8,
  speed: 1,
  extra: { lang: 'ru' },
};

const [output, text] = process.argv.slice(2);
if (!output?.trim() || !text?.trim()) {
  console.error('Usage: npm run voice -- reply.wav "Reply text"');
  process.exit(1);
}
const modelPaths = Object.values(MODEL_FILES);
for (const path of modelPaths) await access(path);
// Native inference is synchronous; this worker runs outside the server process.
const engine = new sherpa.OfflineTts({
  model: { supertonic: MODEL_FILES, numThreads: 3, provider: 'cpu' },
});
const generationConfig = new sherpa.GenerationConfig(GENERATION_CONFIG);
const audio = engine.generate({ text, generationConfig });
if (!audio.samples.length) throw new Error('Speech synthesis returned no audio');
const temporaryId = randomUUID();
const temp = `${output}.${temporaryId}.tmp`;
try {
  const written = sherpa.writeWave(temp, audio);
  if (!written) throw new Error('Failed to write synthesized speech to WAV');
  await rename(temp, output);
} finally {
  await rm(temp, { force: true });
}
