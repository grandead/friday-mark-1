import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { balluModes, balluSounds } from './ballu.js';
import { AppError, errorMessages } from '../../../shared/errors.js';

export type DeviceCommand = {
  model: string; registrationData: unknown;
  operation: 'state' | 'power' | 'mode' | 'speed' | 'targetTemperature' | 'buttonSound' | 'backlightAutoOff' | 'sound' | 'resetFilter';
  power?: boolean; mode?: typeof balluModes[number]; speed?: number; temperature?: number; enabled?: boolean; sound?: typeof balluSounds[number];
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
  constructor(readonly code: keyof typeof deviceErrors) { super(code); }
}
export const deviceState = z.strictObject({
  power: z.boolean(),
  mode: z.enum(['off', 'auto', ...balluModes]).optional(),
  speed: z.number().int().min(0).max(8).optional(),
  targetTemperature: z.number().min(0).max(25).optional(),
  heaterInstalled: z.boolean().optional(),
  co2SensorInstalled: z.boolean().optional(),
  buttonSound: z.boolean().optional(),
  backlightAutoOff: z.boolean().optional(),
  sound: z.enum(balluSounds).optional(),
  filterCounter: z.number().int().nonnegative().max(65535).optional(),
  errorCode: z.number().int().nonnegative().optional(),
  turboSeconds: z.number().int().nonnegative().optional(),
  humidity: z.number().min(0).max(100).optional(),
  temperature: z.number().min(-60).max(100).optional(),
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
});
export type DeviceState = z.infer<typeof deviceState>;
export type DeviceDriver = (command: DeviceCommand) => Promise<DeviceState>;

// Credentials travel over stdin, never command-line arguments, logs or LLM messages.
export function runDeviceCommand(command: DeviceCommand, signal?: AbortSignal): Promise<DeviceState> {
  const script = command.model === 'ballu-oneair-asp-100' ? 'home-syncleo.py' : 'home-miio.py';
  return new Promise((resolve, reject) => {
    const child = execFile('uv', ['run', '--offline', fileURLToPath(new URL(`../../../scripts/${script}`, import.meta.url))], {
      timeout: 30_000, signal, encoding: 'utf8', maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      let body: unknown;
      try { body = JSON.parse(stdout); } catch { /* Use a generic safe error below. */ }
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && Object.hasOwn(deviceErrors, body.error)) {
        return reject(new DeviceCommandError(body.error as keyof typeof deviceErrors));
      }
      if (error) return reject(new DeviceCommandError('device_unreachable'));
      try { resolve(deviceState.parse(body)); }
      catch { reject(new DeviceCommandError('invalid_device_state')); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(command));
  });
}
