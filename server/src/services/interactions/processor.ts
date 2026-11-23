import type { PrismaClient } from '@prisma/client';
import { basename } from 'node:path';
import { humidifierCommand } from '../smartHome/humidifier.js';

export type ProcessingOptions = {
  db: PrismaClient;
  transcribe: (path: string) => Promise<string>;
  setHumidifierPower?: (power: 'on' | 'off') => Promise<string>;
  synthesizeReply?: (text: string, output: string) => Promise<void>;
  log?: (message: string) => void;
};

export type RecognitionEvent = { type: 'transcript'; text: string } | { type: 'transcription_error'; message: string };
type Notify = (event: RecognitionEvent) => void;

export class InteractionProcessor {
  private queue = Promise.resolve();
  private jobs = 0;
  private readonly log: (message: string) => void;

  constructor(private readonly options: ProcessingOptions) {
    this.log = options.log ?? console.log;
  }

  get pendingJobs() { return this.jobs; }

  enqueue(id: string, path: string, notify: Notify) {
    this.jobs++;
    this.queue = this.queue
      .then(async () => {
        try {
          await this.process(id, path, notify);
        } catch (error) {
          await this.fail(id, error);
          this.log(`Ошибка обработки (WAV сохранён): ${error}`);
          notify({ type: 'transcription_error', message: String(error) });
        }
      })
      .catch(error => this.log(`Ошибка записи журнала: ${error}`))
      .finally(() => { this.jobs--; });
  }

  drain() { return this.queue; }

  private async process(id: string, path: string, notify: Notify) {
    const { db, transcribe, setHumidifierPower, synthesizeReply } = this.options;
    const where = { id };
    this.log('Распознаю…');
    const text = await transcribe(path);
    await db.interaction.update({ where, data: { transcript: text } });
    this.log(`\nТекст: ${text || '(речь не распознана)'}\n`);
    notify({ type: 'transcript', text });

    const power = humidifierCommand(text);
    if (power && setHumidifierPower) {
      const action = await db.interactionAction.create({ data: {
        interactionId: id, sequence: 1, initiator: 'handler', service: 'miIO',
        operation: 'setHumidifierPower', arguments: { power },
      } });
      let reply: string;
      try {
        reply = await setHumidifierPower(power);
      } catch (error) {
        await db.$transaction([
          db.interactionAction.update({ where: { id: action.id }, data: { error: String(error) } }),
          this.fail(id, error),
        ]);
        this.log(`Ошибка управления увлажнителем: ${error instanceof Error ? error.message : error}`);
        return;
      }
      await db.$transaction([
        db.interactionAction.update({ where: { id: action.id }, data: { result: { reply } } }),
        db.interaction.update({ where, data: { responseText: reply, responseSource: 'handler' } }),
      ]);
      this.log(reply);
      if (synthesizeReply) {
        const output = path.replace(/\.wav$/, '.reply.wav');
        try {
          await synthesizeReply(reply, output);
        } catch (error) {
          await this.fail(id, error);
          this.log(`Ошибка синтеза речи: ${error}`);
          return;
        }
        await db.interaction.update({ where, data: { outputAudioKey: basename(output) } });
        this.log(`Голос Пятницы: ${output}`);
      }
    }
    await db.interaction.update({ where, data: { status: 'complete', finishedAt: new Date() } });
  }

  private fail(id: string, error: unknown) {
    return this.options.db.interaction.update({ where: { id }, data: {
      status: 'failed', error: String(error), finishedAt: new Date(),
    } });
  }
}
