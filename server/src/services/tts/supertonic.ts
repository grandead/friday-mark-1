import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/synthesize-reply.mjs', import.meta.url));

export async function synthesizeReply(text: string, output: string, signal: AbortSignal) {
  await run(process.execPath, [script, output, text], { timeout: 60_000, signal });
}
