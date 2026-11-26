import { basename } from 'node:path';

export function isAudioKey(key: string | null): key is string {
  if (!key) return false;
  const name = basename(key);
  return name === key && key.endsWith('.wav');
}
