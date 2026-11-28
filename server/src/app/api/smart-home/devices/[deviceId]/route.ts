import { z } from 'zod';
import { deleteDevice, getDeviceSettings, updateDevice } from './_data/device-settings';
import { settingsErrorResponse } from './_lib/settings-error-response';

type Context = { params: Promise<{ deviceId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const id = DEVICE_ID.parse(params.deviceId);
    const device = await getDeviceSettings(id);
    return Response.json(device, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const params = await context.params;
    const id = DEVICE_ID.parse(params.deviceId);
    const body = await request.json();
    const changes = DEVICE_CHANGES.parse(body);
    const device = await updateDevice(id, changes);
    return Response.json(device);
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const id = DEVICE_ID.parse(params.deviceId);
    await deleteDevice(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

const DEVICE_ID = z.uuidv7();
const PATCH_FIELDS = z.strictObject({
  displayName: z.string().trim().min(1).max(120).optional(),
  ip: z.ipv4().optional(),
  token: z
    .string()
    .regex(/^[a-f0-9]{32}$/i)
    .optional(),
});
const DEVICE_CHANGES = PATCH_FIELDS.refine((fields) => Object.keys(fields).length > 0);

export type DeviceChanges = z.infer<typeof DEVICE_CHANGES>;
