import type { z } from 'zod';
import { AppError, ERROR_MESSAGES } from '../../../shared/errors';

const DEVICE_ERRORS = {
  heater_missing: ERROR_MESSAGES.heater_missing,
  hardware_unknown: ERROR_MESSAGES.hardware_unknown,
  unsupported: ERROR_MESSAGES.unsupported,
  not_confirmed: ERROR_MESSAGES.not_confirmed,
  device_rejected_command: ERROR_MESSAGES.device_rejected_command,
  device_unreachable: ERROR_MESSAGES.device_unreachable,
  invalid_device_state: ERROR_MESSAGES.invalid_device_state,
} as const;

export class DeviceCommandError extends AppError {
  constructor(readonly code: keyof typeof DEVICE_ERRORS) {
    super(code);
  }
}

export function isDeviceError(body: unknown): body is { error: keyof typeof DEVICE_ERRORS } {
  if (!body || typeof body !== 'object' || !('error' in body)) return false;
  if (typeof body.error !== 'string') return false;
  return Object.hasOwn(DEVICE_ERRORS, body.error);
}

export function parseState<State>(schema: z.ZodType<State>, response: unknown): State {
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new DeviceCommandError('invalid_device_state');
  return parsed.data;
}

export function confirm(confirmed: boolean): asserts confirmed {
  if (!confirmed) throw new DeviceCommandError('not_confirmed');
}
