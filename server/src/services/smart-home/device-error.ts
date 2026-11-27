import { AppError, ERROR_MESSAGES } from '../../../shared/errors';

const DEVICE_ERRORS = {
  invalid_hommyn_registration: ERROR_MESSAGES.invalid_hommyn_registration,
  heater_missing: ERROR_MESSAGES.heater_missing,
  hardware_unknown: ERROR_MESSAGES.hardware_unknown,
  unsupported: ERROR_MESSAGES.unsupported,
  not_confirmed: ERROR_MESSAGES.not_confirmed,
  device_rejected_command: ERROR_MESSAGES.device_rejected_command,
  device_unreachable: ERROR_MESSAGES.device_unreachable,
  invalid_device_state: ERROR_MESSAGES.invalid_device_state,
} as const;

export class DeviceCommandError extends AppError {
  constructor(
    readonly code: keyof typeof DEVICE_ERRORS,
    readonly location?: { name: string; room: string },
  ) {
    super(code);
  }
}

export function isDeviceError(body: unknown): body is { error: keyof typeof DEVICE_ERRORS } {
  if (!body || typeof body !== 'object' || !('error' in body)) return false;
  if (typeof body.error !== 'string') return false;
  return Object.hasOwn(DEVICE_ERRORS, body.error);
}
