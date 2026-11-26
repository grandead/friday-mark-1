import { z } from 'zod';
import { formErrorResponse } from '../_lib/form-error-response';
import { createRoom } from './_data/create-room';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = INPUT_SCHEMA.parse(body);
    const room = await createRoom(input);
    return Response.json(room, { status: 201 });
  } catch (error) {
    return formErrorResponse(error);
  }
}

const INPUT_FIELDS = {
  homeId: z.uuidv7(),
  displayName: z.string().trim().min(1).max(120),
};
const INPUT_SCHEMA = z.strictObject(INPUT_FIELDS);
export type RoomInput = z.infer<typeof INPUT_SCHEMA>;
