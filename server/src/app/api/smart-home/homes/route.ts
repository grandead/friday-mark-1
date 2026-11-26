import { z } from 'zod';
import { formErrorResponse } from '../_lib/form-error-response';
import { createHome } from './_data/create-home';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = INPUT_SCHEMA.parse(body);
    const home = await createHome(input);
    return Response.json(home, { status: 201 });
  } catch (error) {
    return formErrorResponse(error);
  }
}

const INPUT_FIELDS = { displayName: z.string().trim().min(1).max(120) };
const INPUT_SCHEMA = z.strictObject(INPUT_FIELDS);

export type HomeInput = z.infer<typeof INPUT_SCHEMA>;
