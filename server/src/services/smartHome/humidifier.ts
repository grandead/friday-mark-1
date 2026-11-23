import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/humidifier-status.py', import.meta.url));

export function humidifierCommand(text: string): 'on' | 'off' | undefined {
  const phrase = text.toLowerCase().trim().replace(/\s+/gu, ' ').replace(/[.!]+$/u, '');
  const match = /^(?:пятница[, ]+)?(включи|выключи) увлажнитель(?: воздуха)?$/u.exec(phrase);
  if (match) return match[1] === 'включи' ? 'on' : 'off';
}

export function setHumidifierPower(power: 'on' | 'off', signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('uv', ['run', '--offline', script, '--power', power], {
      timeout: 20_000, signal, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout.trim());
      const reason = error.killed ? 'Истекло время ожидания ответа.' : stderr.trim() || error.message;
      reject(new Error(reason));
    });
  });
}
