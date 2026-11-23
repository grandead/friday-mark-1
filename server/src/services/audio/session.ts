import type { PrismaClient } from '@prisma/client';
import { basename, join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import type { InteractionProcessor, RecognitionEvent } from '../interactions/processor.js';
import type { AudioMessage } from '../validation/audioMessage.js';
import { Recording } from './wav.js';

export type RecordingEvent =
  | { type: 'started'; id: string }
  | { type: 'saved'; samples: number }
  | { type: 'aborted' }
  | RecognitionEvent;

export type SessionOptions = {
  db: PrismaClient;
  recordingsDir: string;
  processor: InteractionProcessor;
  log: (message: string) => void;
};

export class RecordingSession {
  private active?: { id: string; wav: Recording };
  private idle?: NodeJS.Timeout;
  private deadline?: NodeJS.Timeout;

  constructor(
    private readonly options: SessionOptions,
    private readonly notify: (event: RecordingEvent) => void,
    private readonly onTimeout: (reason: string) => void,
  ) {}

  async receive(message: AudioMessage) {
    if (Buffer.isBuffer(message)) {
      if (!this.active) throw new Error('Audio without start');
      this.active.wav.append(message);
      this.resetIdleTimer();
      return;
    }
    switch (message.type) {
      case 'start': return this.start(message);
      case 'end': return this.finish(message.samples);
      case 'abort':
        await this.abort('ESP32 reported lost samples');
        this.notify({ type: 'aborted' });
    }
  }

  async abort(reason: string) {
    const active = this.takeRecording();
    if (!active) return;
    const path = active.wav.finish(false);
    await this.options.db.interaction.update({ where: { id: active.id }, data: {
      status: 'incomplete', inputAudioKey: basename(path), error: reason, finishedAt: new Date(),
    } });
    this.options.log(`Неполная запись: ${path} (${reason})`);
  }

  private async start({ userId, deviceId, sampleRate }: Extract<AudioMessage, { type: 'start' }>) {
    if (this.active) throw new Error('Duplicate start');
    if (this.options.processor.pendingJobs >= 4) throw new Error('Transcription queue full');
    const { db, recordingsDir, log } = this.options;
    const id = uuidv7();
    const startedAt = new Date();
    const base = startedAt.toISOString().replace(/[:.]/g, '-') + '-' + id;
    try {
      await db.$transaction([
        db.device.update({ where: { id: deviceId }, data: { lastSeenAt: startedAt } }),
        db.interaction.create({ data: {
          id, deviceId, userId, startedAt, status: 'recording', inputAudioKey: base + '.partial',
        } }),
      ]);
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['P2003', 'P2025'].includes(String(error.code))) {
        throw new Error('Unregistered deviceId or userId');
      }
      throw error;
    }
    try {
      this.active = { id, wav: new Recording(join(recordingsDir, base), sampleRate) };
    } catch (error) {
      await db.interaction.update({ where: { id }, data: { status: 'failed', error: String(error), finishedAt: new Date() } });
      throw error;
    }
    this.resetIdleTimer();
    this.deadline = setTimeout(() => this.onTimeout('Recording time limit'), 125_000);
    log(`● RECORD ${id}`);
    this.notify({ type: 'started', id });
  }

  private async finish(samples: number) {
    if (!this.active) throw new Error('End without start');
    const { id, wav } = this.active;
    if (samples !== wav.bytes / 2) throw new Error('Audio sample count mismatch');
    if (!wav.bytes) throw new Error('Empty recording');
    this.takeRecording();
    const path = wav.finish(true);
    await this.options.db.interaction.update({ where: { id }, data: { status: 'processing', inputAudioKey: basename(path) } });
    this.options.log(`■ WAV сохранён (${(samples / wav.sampleRate).toFixed(2)} с): ${path}`);
    this.notify({ type: 'saved', samples });
    this.options.processor.enqueue(id, path, this.notify);
  }

  private takeRecording() {
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    const active = this.active;
    this.active = undefined;
    return active;
  }

  private resetIdleTimer() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.onTimeout('Audio idle timeout'), 10_000);
  }
}
