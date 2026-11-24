import { basename } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { AppError, diagnosticError } from '../../../shared/errors.js';

export type ProcessingOptions = {
  db: PrismaClient;
  transcribe: (path: string) => Promise<string>;
  generateReply?: (interactionId: string, transcript: string) => Promise<string>;
  synthesizeReply?: (text: string, output: string) => Promise<void>;
  log?: (message: string) => void;
};

export type RecognitionEvent =
  | { type: 'transcript'; text: string }
  | { type: 'transcription_error' | 'processing_error'; code: string; message: string };
type Notify = (event: RecognitionEvent) => void;

export class InteractionProcessor {
  private queue = Promise.resolve();
  private jobs = 0;
  private readonly log: (message: string) => void;

  constructor(
    private readonly options: ProcessingOptions,
    private readonly interactionUpdated: (id: string) => Promise<void>,
  ) {
    this.log = options.log ?? console.log;
  }

  get pendingJobs() {
    return this.jobs;
  }

  enqueue(id: string, path: string, notify: Notify) {
    this.jobs++;
    this.queue = this.queue
      .then(async () => {
        let transcribed = false;
        try {
          await this.process(id, path, (event) => {
            if (event.type === 'transcript') transcribed = true;
            notify(event);
          });
        } catch (error) {
          await this.fail(id, error);
          this.log(`Processing failed (WAV preserved): ${diagnosticError(error)}`);
          notify({
            type: transcribed ? 'processing_error' : 'transcription_error',
            code: error instanceof AppError ? error.code : 'internal_error',
            message: diagnosticError(error),
          });
        } finally {
          await this.interactionUpdated(id);
        }
      })
      .catch((error) => this.log(`Failed to write journal: ${error}`))
      .finally(() => {
        this.jobs--;
      });
  }

  drain() {
    return this.queue;
  }

  private async process(id: string, path: string, notify: Notify) {
    const { db, transcribe, synthesizeReply, generateReply } = this.options;
    const where = { id };
    this.log('Transcribing audio...');
    const text = await transcribe(path);
    await db.interaction.update({ where, data: { transcript: text } });
    this.log(`\nTranscript: ${text || '(no speech recognized)'}\n`);
    notify({ type: 'transcript', text });

    let reply: string | undefined;
    let outputAudioKey: string | undefined;
    if (text.trim() && generateReply) {
      this.log('Generating assistant response...');
      reply = await generateReply(id, text);
      await db.interaction.update({ where, data: { responseText: reply, responseSource: 'llm' } });
    }
    if (reply) this.log(reply);
    if (reply && synthesizeReply) {
      const output = path.replace(/\.wav$/, '.reply.wav');
      try {
        await synthesizeReply(reply, output);
      } catch (error) {
        await this.fail(id, error);
        this.log(`Speech synthesis failed: ${diagnosticError(error)}`);
        notify({
          type: 'processing_error',
          code: error instanceof AppError ? error.code : 'internal_error',
          message: diagnosticError(error),
        });
        return;
      }
      outputAudioKey = basename(output);
      this.log(`Synthesized speech: ${output}`);
    }
    await db.interaction.update({
      where,
      data: { status: 'complete', finishedAt: new Date(), outputAudioKey },
    });
  }

  private fail(id: string, error: unknown) {
    return this.options.db.interaction.update({
      where: { id },
      data: {
        status: 'failed',
        error: diagnosticError(error),
        finishedAt: new Date(),
      },
    });
  }
}
