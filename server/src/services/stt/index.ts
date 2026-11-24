import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createTranscriber } from './whisper.js';

const run = promisify(execFile);

export async function createSpeechRecognizer(root: string, signal: AbortSignal) {
  const { ASR_ENGINE, WHISPER_BIN, WHISPER_MODEL, WHISPER_LANGUAGE, WHISPER_VAD_MODEL } =
    process.env;
  const engine = ASR_ENGINE ?? 'whisper';
  if (!['vosk', 'whisper'].includes(engine)) throw new Error('ASR_ENGINE must be vosk or whisper');
  if (engine !== 'vosk') {
    const binary = WHISPER_BIN ?? join(root, '.tools/whisper.cpp/build/bin/whisper-cli');
    const model = WHISPER_MODEL ?? join(root, 'models/ggml-small.bin');
    await access(binary, constants.X_OK);
    await access(model);
    const vadModel = WHISPER_VAD_MODEL ?? join(root, 'models/ggml-silero-v5.1.2.bin');
    await access(vadModel);
    const whisper = createTranscriber(binary, model, WHISPER_LANGUAGE ?? 'ru', signal, {
      vadModel,
    });
    return { recognizer: 'whisper', transcribe: whisper };
  }

  const recognizer = 'vosk-model-small-ru-0.22';
  const python = join(root, '.tools/vosk-env/bin/python');
  const model = join(root, 'models', recognizer);
  await access(python, constants.X_OK);
  await access(join(model, 'am/final.mdl'));
  async function transcribe(path: string) {
    const { stdout } = await run(python, [join(root, 'scripts/transcribe-vosk.py'), model, path], {
      timeout: 300_000,
      signal,
    });
    const text = stdout.trim();
    await writeFile(path.replace(/\.wav$/, '.txt'), `${text}\n`, 'utf8');
    return text;
  }
  return { recognizer, transcribe };
}
