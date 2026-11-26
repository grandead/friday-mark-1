import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { diagnosticError, publicError } from '../../../shared/errors';
import { generateReply } from '../assistant';
import { orm } from '../database';
import { publish } from '../signals';
import { transcribe } from '../stt';
import { synthesizeSpeech } from '../tts';
import type { InteractionAudio, InteractionEvent } from './types';

export async function processInteraction(
  id: string,
  audio: InteractionAudio,
  notify: (event: InteractionEvent) => void,
) {
  const interaction = orm.Interaction.select('id').where({ id });
  let transcribed = false;
  try {
    console.log('Transcribing audio...');
    const text = await transcribe(audio.wav);
    const transcriptPath = audio.path.replace(/\.wav$/, '.txt');
    await writeFile(transcriptPath, `${text}\n`, 'utf8');
    await interaction.update({ transcript: text });
    console.log(`\nTranscript: ${text || '(no speech recognized)'}\n`);
    transcribed = true;
    notify({ type: 'transcript', text });

    let reply: string | undefined;
    let outputAudioKey: string | undefined;
    if (text.trim()) {
      console.log('Generating assistant response...');
      reply = await generateReply(id);
      await interaction.update({
        responseText: reply,
        responseSource: 'llm',
      });
    }
    if (reply) console.log(reply);
    if (reply) {
      const output = audio.path.replace(/\.wav$/, '.reply.wav');
      await synthesizeSpeech(reply, output);
      outputAudioKey = basename(output);
      console.log(`Synthesized speech: ${output}`);
    }
    const finishedAt = new Date();
    await interaction.update({
      status: 'complete',
      finishedAt,
      outputAudioKey,
    });
  } catch (error) {
    const message = diagnosticError(error);
    const finishedAt = new Date();
    await interaction.update({
      status: 'failed',
      error: message,
      finishedAt,
    });
    console.log(`Processing failed: ${message}`);
    const failure = publicError(error);
    notify({
      type: transcribed ? 'processing_error' : 'transcription_error',
      ...failure,
    });
  } finally {
    publish('interaction.updated', { id });
  }
}
