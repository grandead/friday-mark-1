import { basename } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { AppError, diagnosticError } from '../../../shared/errors';
import { recordingPath } from '../../config/paths';
import { type Database, db, orm } from '../database';
import {
  enqueueInteraction,
  type InteractionEvent,
  releaseInteraction,
  reserveInteraction,
} from '../interactions';
import { publish } from '../signals';
import type { AudioMessage } from './validation';
import { Recording } from './wav';

export type RecordingEvent =
  | { type: 'started'; id: string }
  | { type: 'saved'; samples: number }
  | { type: 'aborted' }
  | InteractionEvent;

type ActiveRecording = { id: string; wav: Recording };
type InteractionIdentity = {
  id: string;
  userId: string;
  deviceId: string;
  startedAt: Date;
  inputAudioKey: string;
};

export class RecordingSession {
  private active?: ActiveRecording;
  private idle?: NodeJS.Timeout;
  private deadline?: NodeJS.Timeout;

  constructor(
    private readonly notify: (event: RecordingEvent) => void,
    private readonly onTimeout: (reason: string) => void,
  ) {}

  async receive(message: AudioMessage) {
    if (Buffer.isBuffer(message)) {
      if (!this.active) throw new AppError('invalid_audio_message', 'Audio without start');
      this.active.wav.append(message);
      this.resetIdleTimer();
      return;
    }
    switch (message.type) {
      case 'start':
        return this.start(message);
      case 'end':
        return this.finish(message.samples);
      case 'abort':
        await this.abort('ESP32 reported lost samples');
        this.notify({ type: 'aborted' });
    }
  }

  async abort(reason: string) {
    if (!this.active) return;
    const id = this.active.id;
    await this.finalize(false, reason);
    console.log(`Incomplete recording: ${id} (${reason})`);
  }

  private async start({ userId, deviceId, sampleRate }: Extract<AudioMessage, { type: 'start' }>) {
    if (this.active) throw new AppError('invalid_audio_message', 'Duplicate start');
    const id = uuidv7();
    const startedAt = new Date();
    const timestamp = startedAt.toISOString();
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const basePath = recordingPath(`${safeTimestamp}-${id}`);
    const inputAudioKey = `${safeTimestamp}-${id}.partial`;
    const identity = { id, userId, deviceId, startedAt, inputAudioKey };
    const create = createInteraction.bind(null, identity);
    reserveInteraction(id);
    try {
      await db.transaction(create);
    } catch (error) {
      releaseInteraction(id);
      throw error;
    }
    try {
      const wav = new Recording(basePath, sampleRate);
      this.active = { id, wav };
    } catch (error) {
      releaseInteraction(id);
      const message = String(error);
      const finishedAt = new Date();
      await orm.Interaction.select('id').where({ id }).update({
        status: 'failed',
        error: message,
        finishedAt,
      });
      publish('interaction.updated', { id });
      throw error;
    }
    publish('interaction.updated', { id });
    this.resetIdleTimer();
    this.deadline = setTimeout(() => this.onTimeout('Recording time limit'), 125_000);
    console.log(`● RECORD ${id}`);
    this.notify({ type: 'started', id });
  }

  private async finish(samples: number) {
    if (!this.active) throw new AppError('invalid_audio_message', 'End without start');
    const { id, wav } = this.active;
    if (samples !== wav.bytes / 2)
      throw new AppError('invalid_audio_message', 'Audio sample count mismatch');
    if (!wav.bytes) throw new AppError('invalid_audio_message', 'Empty recording');
    const audio = await this.finalize(true);
    const duration = (samples / wav.sampleRate).toFixed(2);
    console.log(`Audio received (${duration} s): ${id}`);
    enqueueInteraction(id, audio, this.notify);
    this.notify({ type: 'saved', samples });
  }

  private async finalize(complete: boolean, reason?: string) {
    const active = this.active;
    if (!active) throw new Error('No active recording');
    const interaction = orm.Interaction.select('id').where({ id: active.id });
    try {
      const audio = active.wav.finish(complete);
      const inputAudioKey = basename(audio.path);
      const finishedAt = complete ? undefined : new Date();
      await interaction.update({
        status: complete ? 'processing' : 'incomplete',
        inputAudioKey,
        error: reason,
        finishedAt,
      });
      if (!complete) releaseInteraction(active.id);
      publish('interaction.updated', { id: active.id });
      return audio;
    } catch (error) {
      releaseInteraction(active.id);
      const message = diagnosticError(error);
      const inputAudioKey = basename(active.wav.path);
      const finishedAt = new Date();
      await interaction.update({ status: 'failed', inputAudioKey, error: message, finishedAt });
      publish('interaction.updated', { id: active.id });
      throw error;
    } finally {
      clearTimeout(this.idle);
      clearTimeout(this.deadline);
      this.active = undefined;
    }
  }

  private resetIdleTimer() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.onTimeout('Audio idle timeout'), 10_000);
  }
}

async function createInteraction(identity: InteractionIdentity, tx: Pick<Database, 'orm'>) {
  const { id, userId, deviceId, startedAt, inputAudioKey } = identity;
  const orm = tx.orm.public;
  const user = await orm.User.select('id').first({ id: userId });
  if (!user) throw new AppError('invalid_audio_message', 'Unregistered deviceId or userId');
  const device = await orm.Device.select('id').where({ id: deviceId }).update({
    lastSeenAt: startedAt,
  });
  if (!device) throw new AppError('invalid_audio_message', 'Unregistered deviceId or userId');
  await orm.Interaction.select('id').create({
    id,
    deviceId,
    userId,
    startedAt,
    inputAudioKey,
    status: 'recording',
  });
}
