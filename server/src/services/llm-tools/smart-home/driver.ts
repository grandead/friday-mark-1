import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AppError, ERROR_MESSAGES } from '../../../../shared/errors';
import { getShutdownSignal } from '../../runtime';

const EXEC_FILE = promisify(execFile);
const SCRIPTS = { miio: 'home_miio.py', syncleo: 'home_syncleo.py' } as const;
const DEVICE_ERRORS = {
  invalid_hommyn_registration: ERROR_MESSAGES.invalid_hommyn_registration,
  heater_missing: ERROR_MESSAGES.heater_missing,
  hardware_unknown: ERROR_MESSAGES.hardware_unknown,
  unsupported: ERROR_MESSAGES.unsupported,
  not_confirmed: ERROR_MESSAGES.not_confirmed,
  device_unreachable: ERROR_MESSAGES.device_unreachable,
  invalid_device_state: ERROR_MESSAGES.invalid_device_state,
} as const;

export type DeviceCommand = {
  transport: 'miio' | 'syncleo';
  model: string;
  registrationData: unknown;
  operation: string;
  parameters: Record<string, unknown>;
};
export type DeviceDriver = (command: DeviceCommand) => Promise<unknown>;

export class DeviceCommandError extends AppError {
  constructor(readonly code: keyof typeof DEVICE_ERRORS) {
    super(code);
  }
}

// Credentials travel over stdin, never command-line arguments, logs or LLM messages.
export async function runDeviceCommand(command: DeviceCommand): Promise<unknown> {
  const signal = getShutdownSignal();
  const script = SCRIPTS[command.transport];
  const url = new URL(`../../../../scripts/${script}`, import.meta.url);
  const path = fileURLToPath(url);
  const request = JSON.stringify({
    ...command.parameters,
    model: command.model,
    registrationData: command.registrationData,
    operation: command.operation,
  });
  const pending = EXEC_FILE('uv', ['run', '--offline', path], {
    timeout: 30_000,
    signal,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
  });
  pending.child.stdin?.on('error', ignoreStdinError);
  pending.child.stdin?.end(request);
  let stdout = '';
  let failed = false;
  try {
    const result = await pending;
    stdout = result.stdout;
  } catch (error) {
    if (signal.aborted) throw new AppError('processing_stopped');
    failed = true;
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    ) {
      stdout = error.stdout;
    }
  }
  const body = parseResponse(stdout);
  if (isDeviceError(body)) throw new DeviceCommandError(body.error);
  if (failed || body === undefined) throw new AppError('internal_error');
  return body;
}

function ignoreStdinError() {
  // Process completion reports a closed pipe or a cancelled child safely.
}

function parseResponse(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function isDeviceError(body: unknown): body is { error: keyof typeof DEVICE_ERRORS } {
  if (!body || typeof body !== 'object' || !('error' in body)) return false;
  if (typeof body.error !== 'string') return false;
  return Object.hasOwn(DEVICE_ERRORS, body.error);
}
