import type { PrismaClient } from '@prisma/client';
import { basename } from 'node:path';

export type ProcessingOptions = {
  db: PrismaClient;
  transcribe: (path: string) => Promise<string>;
  generateReply?: (interactionId: string, transcript: string) => Promise<string>;
  synthesizeReply?: (text: string, output: string) => Promise<void>;
  log?: (message: string) => void;
};

export type RecognitionEvent = { type: 'transcript'; text: string } | { type: 'transcription_error' | 'processing_error'; message: string };
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

  get pendingJobs() { return this.jobs; }

  enqueue(id: string, path: string, notify: Notify) {
    this.jobs++;
    this.queue = this.queue
      .then(async () => {
        let transcribed = false;
        try {
          await this.process(id, path, event => {
            if (event.type === 'transcript') transcribed = true;
            notify(event);
          });
        } catch (error) {
          await this.fail(id, error);
          this.log(`Ошибка обработки (WAV сохранён): ${error}`);
          notify({ type: transcribed ? 'processing_error' : 'transcription_error', message: String(error) });
        } finally {
          await this.interactionUpdated(id);
        }
      })
      .catch(error => this.log(`Ошибка записи журнала: ${error}`))
      .finally(() => { this.jobs--; });
  }

  drain() { return this.queue; }

  private async process(id: string, path: string, notify: Notify) {
    const { db, transcribe, synthesizeReply, generateReply } = this.options;
    const where = { id };
    this.log('Распознаю…');
    const text = await transcribe(path);
    await db.interaction.update({ where, data: { transcript: text } });
    this.log(`\nТекст: ${text || '(речь не распознана)'}\n`);
    notify({ type: 'transcript', text });

    let reply: string | undefined;
    let outputAudioKey: string | undefined;
    if (text.trim() && generateReply) {
      this.log('Пятница думает…');
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
        this.log(`Ошибка синтеза речи: ${error}`);
        notify({ type: 'processing_error', message: String(error) });
        return;
      }
      outputAudioKey = basename(output);
      this.log(`Голос Пятницы: ${output}`);
    }
    await db.interaction.update({
      where, data: { status: 'complete', finishedAt: new Date(), outputAudioKey },
    });
  }

  private fail(id: string, error: unknown) {
    return this.options.db.interaction.update({ where: { id }, data: {
      status: 'failed', error: String(error), finishedAt: new Date(),
    } });
  }
}
