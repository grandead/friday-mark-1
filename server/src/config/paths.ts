import { join } from 'node:path';
export const serverRoot = process.cwd();
export const recordingsDir = join(serverRoot, 'recordings');
export function recordingPath(key: string) {
  return join(recordingsDir, key);
}
