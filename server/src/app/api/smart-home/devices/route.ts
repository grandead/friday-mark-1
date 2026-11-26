import { z } from 'zod';
import { formErrorResponse } from '../_lib/form-error-response';
import { createDevice } from './_data/create-device';
import { getDeviceType } from './_data/get-device-type';
import { parseDeviceRegistration } from './_lib/device-registration';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = INPUT_SCHEMA.parse(body);
    const type = await getDeviceType(input.roomId, input.typeId);
    const registrationData = parseDeviceRegistration(type.registrationType, input.registrationData);
    const device = await createDevice({ ...input, registrationData });
    return Response.json(device, { status: 201 });
  } catch (error) {
    return formErrorResponse(error);
  }
}

const INPUT_FIELDS = {
  roomId: z.uuidv7(),
  typeId: z.uuidv7(),
  displayName: z.string().trim().min(1).max(120),
  registrationData: z.unknown(),
};
const INPUT_SCHEMA = z.strictObject(INPUT_FIELDS);

export type DeviceInput = z.infer<typeof INPUT_SCHEMA>;
