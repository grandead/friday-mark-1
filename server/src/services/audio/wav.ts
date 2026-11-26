import { closeSync, openSync, renameSync, writeSync } from 'node:fs';
import { AppError } from '../../../shared/errors';

export function wavHeader(bytes: number, sampleRate: number): Buffer {
  const b = Buffer.alloc(44);
  b.write('RIFF');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}

function writeAll(fd: number, data: Buffer, position: number): void {
  let offset = 0;
  while (offset < data.length) {
    const n = writeSync(fd, data, offset, data.length - offset, position + offset);
    if (n === 0) throw new Error('Disk write made no progress');
    offset += n;
  }
}

export class Recording {
  private fd: number;
  private chunks: Buffer[] = [];
  bytes = 0;
  path: string;

  constructor(
    readonly base: string,
    readonly sampleRate: number,
  ) {
    this.path = `${base}.partial`;
    this.fd = openSync(this.path, 'wx', 0o600);
    try {
      const header = wavHeader(0, sampleRate);
      writeAll(this.fd, header, 0);
    } catch (error) {
      closeSync(this.fd);
      this.fd = -1;
      throw error;
    }
  }

  append(pcm: Buffer): void {
    if (this.fd < 0) throw new Error('Recording already closed');
    if (pcm.length === 0 || pcm.length % 2)
      throw new AppError('invalid_audio_message', 'Expected aligned s16le samples');
    if (this.bytes + pcm.length > this.sampleRate * 2 * 120)
      throw new AppError('invalid_audio_message', 'Maximum recording is 120 seconds');
    writeAll(this.fd, pcm, 44 + this.bytes);
    const chunk = Buffer.from(pcm);
    this.chunks.push(chunk);
    this.bytes += pcm.length;
  }

  finish(complete: boolean): { path: string; wav: Buffer } {
    if (this.fd < 0) throw new Error('Recording already closed');
    const header = wavHeader(this.bytes, this.sampleRate);
    try {
      writeAll(this.fd, header, 0);
    } finally {
      closeSync(this.fd);
      this.fd = -1;
    }
    const path = `${this.base}${complete ? '' : '.incomplete'}.wav`;
    renameSync(this.path, path);
    this.path = path;
    const wav = Buffer.concat([header, ...this.chunks], 44 + this.bytes);
    this.chunks = [];
    return { path, wav };
  }
}
