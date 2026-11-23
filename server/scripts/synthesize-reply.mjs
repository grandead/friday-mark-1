import { access, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sherpa from 'sherpa-onnx-node';

const [output, text] = process.argv.slice(2);
if (!output || !text?.trim()) {
  console.error('Использование: npm run voice -- ответ.wav "Текст ответа"');
  process.exit(1);
}

const dir = fileURLToPath(new URL('../models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/', import.meta.url));
const supertonic = {
  durationPredictor: join(dir, 'duration_predictor.int8.onnx'),
  textEncoder: join(dir, 'text_encoder.int8.onnx'),
  vectorEstimator: join(dir, 'vector_estimator.int8.onnx'),
  vocoder: join(dir, 'vocoder.int8.onnx'),
  ttsJson: join(dir, 'tts.json'),
  unicodeIndexer: join(dir, 'unicode_indexer.bin'),
  voiceStyle: join(dir, 'voice.bin'),
};
await Promise.all(Object.values(supertonic).map(path => access(path)));
const engine = new sherpa.OfflineTts({ model: { supertonic, numThreads: 3, provider: 'cpu' } });
const generationConfig = new sherpa.GenerationConfig({
  sid: 1, // F2 in this model release
  numSteps: 8, speed: 1, extra: { lang: 'ru' },
});
const audio = engine.generate({ text, generationConfig });
const temp = output + '.' + randomUUID() + '.tmp';
try {
  if (!audio.samples.length || !sherpa.writeWave(temp, audio)) throw new Error('Не удалось записать речь в WAV');
  await rename(temp, output);
} finally {
  await rm(temp, { force: true });
}
