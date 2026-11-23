import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

export function createTranscriber(binary: string, model: string, language = 'ru', signal?: AbortSignal) {
  return async (path: string): Promise<string> => {
    signal?.throwIfAborted();
    await access(binary, constants.X_OK); await access(model);
    const output = path.replace(/\.wav$/, '');
    // whisper.cpp v1.8.2 uses miniaudio to resample legacy 20 kHz WAVs to 16 kHz.
    // Both decoding and inference run outside the Node event loop.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['-m', model, '-f', path, '-l', language, '-otxt', '-of', output, '-nt'], {
        stdio: ['ignore', 'ignore', 'pipe'], signal, killSignal: 'SIGKILL',
      });
      let stderr = '';
      const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 300_000);
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(); else reject(new Error(`whisper-cli exited ${code}: ${stderr}`));
      });
    });
    return (await readFile(`${output}.txt`, 'utf8')).trim();
  };
}
