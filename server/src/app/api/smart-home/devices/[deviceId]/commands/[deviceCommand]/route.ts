import { z } from 'zod';
import { DeviceCommandError } from '@/services/smart-home';
import { AppError, errorResponse } from '../../../../../../../../shared/errors';
import { getCommandDevice } from './_data/get-command-device';
import { getCommand } from './_lib/commands';

type Context = { params: Promise<{ deviceId: string; deviceCommand: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { deviceId, deviceCommand } = await context.params;
    const id = DEVICE_ID.parse(deviceId);
    const device = await getCommandDevice(id);
    if (!device) {
      const error = errorResponse('device_not_found');
      return Response.json(error, { status: 404 });
    }
    const command = getCommand(device.model, deviceCommand);
    if (!command) {
      const error = errorResponse('unsupported');
      return Response.json(error, { status: 400 });
    }
    const args = await request.json();
    const state = await command.execute(device.credentials, args);
    return Response.json(state);
  } catch (cause) {
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      const error = errorResponse('invalid_device_command');
      return Response.json(error, { status: 400 });
    }
    if (cause instanceof DeviceCommandError) {
      const error = errorResponse(cause.code);
      return Response.json(error, { status: DEVICE_ERROR_STATUS[cause.code] });
    }
    if (cause instanceof AppError && cause.code === 'processing_stopped') {
      const error = errorResponse(cause.code);
      return Response.json(error, { status: 503 });
    }
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}

const DEVICE_ID = z.uuidv7();
const DEVICE_ERROR_STATUS = {
  heater_missing: 409,
  hardware_unknown: 502,
  unsupported: 409,
  not_confirmed: 502,
  device_rejected_command: 409,
  device_unreachable: 502,
  invalid_device_state: 502,
} satisfies Record<DeviceCommandError['code'], number>;
