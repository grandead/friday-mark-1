import type { z } from 'zod';
import { AppError } from '../../../shared/errors';

type DeviceErrorCode =
  | 'heater_missing'
  | 'hardware_unknown'
  | 'unsupported'
  | 'not_confirmed'
  | 'device_rejected_command'
  | 'device_unreachable'
  | 'invalid_device_state';

export class DeviceCommandError extends AppError {
  constructor(readonly code: DeviceErrorCode) {
    super(code);
  }
}

export function parseState<State>(schema: z.ZodType<State>, response: unknown): State {
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new DeviceCommandError('invalid_device_state');
  return parsed.data;
}

export function confirm(confirmed: boolean): asserts confirmed {
  if (!confirmed) throw new DeviceCommandError('not_confirmed');
}
