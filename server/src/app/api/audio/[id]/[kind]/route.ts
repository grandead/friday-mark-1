import { z } from 'zod';
import { errorResponse } from '../../../../../../shared/errors';
import { getAudioKey } from './_data/get-audio-key';
import { isAudioKey } from './_lib/is-audio-key';
import { readAudio } from './_lib/read-audio';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; kind: string }> },
) {
  try {
    const params = await context.params;
    const parsed = PARAMS_SCHEMA.safeParse(params);
    if (!parsed.success) {
      const error = errorResponse('invalid_audio_path');
      return Response.json(error, { status: 400 });
    }
    const key = await getAudioKey(parsed.data.id, parsed.data.kind);
    if (!isAudioKey(key)) {
      const error = errorResponse('audio_not_found');
      return Response.json(error, { status: 404 });
    }
    return await readAudio(request, key);
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}

const PARAMS_FIELDS = { id: z.uuidv7(), kind: z.enum(['input', 'output']) };
const PARAMS_SCHEMA = z.object(PARAMS_FIELDS);
