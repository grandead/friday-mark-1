import { z } from 'zod';
import { AppError } from '../../../shared/errors';

const START_FIELDS = {
  type: z.literal('start'),
  deviceId: z.uuidv7(),
  userId: z.uuidv7(),
  sampleRate: z.literal([16000, 20000]),
  channels: z.literal(1),
  format: z.literal('s16le'),
};
const END_FIELDS = { type: z.literal('end'), samples: z.int().nonnegative() };
const ABORT_FIELDS = { type: z.literal('abort') };
const CONTROL_MESSAGES = [
  z.object(START_FIELDS),
  z.object(END_FIELDS),
  z.object(ABORT_FIELDS),
] as const;
const CONTROL_MESSAGE_SCHEMA = z.discriminatedUnion('type', CONTROL_MESSAGES);

export type AudioMessage = z.infer<typeof CONTROL_MESSAGE_SCHEMA> | Buffer;

export function parseAudioMessage(data: Buffer, binary: boolean): AudioMessage {
  if (binary) {
    if (!data.length || data.length % 2)
      throw new AppError('invalid_audio_message', 'Expected aligned s16le samples');
    return data;
  }

  const text = data.toString('utf8');
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    throw new AppError('invalid_audio_message');
  }
  const result = CONTROL_MESSAGE_SCHEMA.safeParse(message);
  if (result.success) return result.data;

  switch (result.error.issues[0]?.path[0]) {
    case 'deviceId':
    case 'userId':
      throw new AppError('invalid_audio_message', 'Expected deviceId and userId as UUIDv7');
    case 'sampleRate':
    case 'channels':
    case 'format':
      throw new AppError('invalid_audio_message', 'Expected mono s16le at 16000 or 20000 Hz');
    case 'samples':
      throw new AppError('invalid_audio_message', 'Audio sample count mismatch');
    default:
      throw new AppError('invalid_audio_message', 'Unknown message');
  }
}
