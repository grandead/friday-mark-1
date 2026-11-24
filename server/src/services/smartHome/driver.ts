import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError, errorMessages } from '../../../shared/errors.js';

export type DeviceCommand = {
  transport: 'miio' | 'syncleo';
  model: string;
  registrationData: unknown;
  operation: string;
  parameters: Record<string, unknown>;
};
export const deviceErrors = {
  heater_missing: errorMessages.heater_missing,
  hardware_unknown: errorMessages.hardware_unknown,
  unsupported: errorMessages.unsupported,
  not_confirmed: errorMessages.not_confirmed,
  device_unreachable: errorMessages.device_unreachable,
  invalid_device_state: errorMessages.invalid_device_state,
} as const;
export class DeviceCommandError extends AppError {
  constructor(readonly code: keyof typeof deviceErrors) {
    super(code);
  }
}
export type DeviceDriver = (command: DeviceCommand) => Promise<unknown>;
const scripts = { miio: 'home-miio.py', syncleo: 'home-syncleo.py' } as const;

// Credentials travel over stdin, never command-line arguments, logs or LLM messages.
export function runDeviceCommand(command: DeviceCommand, signal?: AbortSignal): Promise<unknown> {
  const script = scripts[command.transport];
  return new Promise((resolve, reject) => {
    const child = execFile(
      'uv',
      ['run', '--offline', fileURLToPath(new URL(`../../../scripts/${script}`, import.meta.url))],
      {
        timeout: 30_000,
        signal,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
      },
      (error, stdout) => {
        let body: unknown;
        try {
          body = JSON.parse(stdout);
        } catch {
          /* Use a generic safe error below. */
        }
        if (
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof body.error === 'string' &&
          Object.hasOwn(deviceErrors, body.error)
        ) {
          return reject(new DeviceCommandError(body.error as keyof typeof deviceErrors));
        }
        if (error) return reject(new DeviceCommandError('device_unreachable'));
        if (body === undefined) return reject(new DeviceCommandError('invalid_device_state'));
        resolve(body);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(
      JSON.stringify({
        ...command.parameters,
        model: command.model,
        registrationData: command.registrationData,
        operation: command.operation,
      }),
    );
  });
}
