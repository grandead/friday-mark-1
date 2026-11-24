import { z } from 'zod';

const controlMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    deviceId: z.uuidv7(),
    userId: z.uuidv7(),
    sampleRate: z.literal([16000, 20000]),
    channels: z.literal(1),
    format: z.literal('s16le'),
  }),
  z.object({ type: z.literal('end'), samples: z.int().nonnegative() }),
  z.object({ type: z.literal('abort') }),
]);

export type AudioMessage = z.infer<typeof controlMessage> | Buffer;

export function parseAudioMessage(data: Buffer, binary: boolean): AudioMessage {
  if (binary) {
    if (!data.length || data.length % 2) throw new Error('Expected aligned s16le samples');
    return data;
  }

  const result = controlMessage.safeParse(JSON.parse(data.toString('utf8')));
  if (result.success) return result.data;

  switch (result.error.issues[0]?.path[0]) {
    case 'deviceId':
    case 'userId':
      throw new Error('Expected deviceId and userId as UUIDv7');
    case 'sampleRate':
    case 'channels':
    case 'format':
      throw new Error('Expected mono s16le at 16000 or 20000 Hz');
    case 'samples':
      throw new Error('Audio sample count mismatch');
    default:
      throw new Error('Unknown message');
  }
}
