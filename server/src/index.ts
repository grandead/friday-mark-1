import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from './app.js';
import { createTranscriber } from './whisper.js';
import { setHumidifierPower } from './humidifier.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const shutdown = new AbortController();
const run = promisify(execFile);
const engine = process.env.ASR_ENGINE ?? (process.env.WHISPER_MODEL || process.env.WHISPER_BIN || process.env.WHISPER_LANGUAGE ? 'whisper' : 'vosk');

async function selectTranscriber() {
  if (engine === 'whisper') {
    const binary = process.env.WHISPER_BIN ?? join(root, '.tools/whisper.cpp/build/bin/whisper-cli');
    const model = process.env.WHISPER_MODEL ?? join(root, 'models/ggml-small.bin');
    await access(binary, constants.X_OK);
    await access(model);
    return createTranscriber(binary, model, process.env.WHISPER_LANGUAGE ?? 'ru', shutdown.signal);
  }
  if (engine !== 'vosk') throw new Error('ASR_ENGINE must be vosk or whisper');
  const python = join(root, '.tools/vosk-env/bin/python');
  const model = join(root, 'models/vosk-model-small-ru-0.22');
  await access(python, constants.X_OK);
  await access(join(model, 'am/final.mdl'));
  return async (path: string) => {
    const { stdout } = await run(python, [join(root, 'scripts/transcribe-vosk.py'), model, path], {
      timeout: 300_000, signal: shutdown.signal,
    });
    const text = stdout.trim();
    await writeFile(path.replace(/\.wav$/, '.txt'), text + '\n', 'utf8');
    return text;
  };
}
const app = await buildApp({
  recordingsDir: join(root, 'recordings'),
  transcribe: await selectTranscriber(),
  recognizer: engine === 'vosk' ? 'vosk-model-small-ru-0.22' : 'whisper',
  setHumidifierPower: power => setHumidifierPower(power, shutdown.signal),
  synthesizeReply: async (text, output) => {
    await run(process.execPath, [join(root, 'scripts/synthesize-reply.mjs'), output, text], {
      timeout: 60_000, signal: shutdown.signal,
    });
  },
});
await app.listen({ host: '0.0.0.0', port });
console.log(`Friday готов. WAV и текст: ${join(root, 'recordings')}`);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`Адрес для ESP32: ws://${address.address}:${port}/audio`);
  }
}
console.log('Распознавание:', engine);
console.log('Скажи «Пятница» и команду. Полторы секунды тишины завершают запись. Ручная запись — удержанием сенсора.');
const stop = async () => { shutdown.abort(); await app.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
