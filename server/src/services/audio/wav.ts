import { closeSync, openSync, renameSync, writeSync } from 'node:fs';

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
  bytes = 0;
  constructor(
    readonly base: string,
    readonly sampleRate: number,
  ) {
    this.fd = openSync(`${base}.partial`, 'wx', 0o600);
    try {
      writeAll(this.fd, wavHeader(0, sampleRate), 0);
    } catch (err) {
      closeSync(this.fd);
      this.fd = -1;
      throw err;
    }
  }
  append(pcm: Buffer): void {
    if (pcm.length === 0 || pcm.length % 2) throw new Error('Expected aligned s16le samples');
    if (this.bytes + pcm.length > this.sampleRate * 2 * 120)
      throw new Error('Maximum recording is 120 seconds');
    writeAll(this.fd, pcm, 44 + this.bytes);
    this.bytes += pcm.length;
  }
  finish(complete: boolean): string {
    if (this.fd < 0) throw new Error('Recording already closed');
    try {
      writeAll(this.fd, wavHeader(this.bytes, this.sampleRate), 0);
    } finally {
      closeSync(this.fd);
      this.fd = -1;
    }
    const path = `${this.base}${complete ? '' : '.incomplete'}.wav`;
    renameSync(`${this.base}.partial`, path);
    return path;
  }
}
