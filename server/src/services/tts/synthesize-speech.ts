import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getShutdownSignal } from '../runtime';

const WORKER_URL = new URL('./supertonic.mjs', import.meta.url);
const WORKER_PATH = fileURLToPath(WORKER_URL);
const SYNTHESIS_TIMEOUT_MS = 60_000;
const run = promisify(execFile);

export async function synthesizeSpeech(text: string, output: string): Promise<void> {
  if (!text.trim()) throw new Error('Speech text must not be empty');
  if (!output.trim()) throw new Error('Speech output path must not be empty');
  const signal = getShutdownSignal();
  signal.throwIfAborted();
  await run(process.execPath, [WORKER_PATH, output, text], {
    timeout: SYNTHESIS_TIMEOUT_MS,
    signal,
  });
}
