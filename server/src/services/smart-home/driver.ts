import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../../shared/errors';
import { serverRoot } from '../../config/paths';
import { getShutdownSignal } from '../runtime';
import { DeviceCommandError, isDeviceError } from './device-error';
import { runMiioCommand } from './miio';

export { DeviceCommandError } from './device-error';

const EXEC_FILE = promisify(execFile);
const SYNCLEO_SCRIPT = join(serverRoot, 'scripts', 'home_syncleo.py');

export type DeviceCommand = {
  transport: 'miio' | 'syncleo';
  model: string;
  registrationData: unknown;
  operation: string;
  parameters: Record<string, unknown>;
};
export type DeviceDriver = (command: DeviceCommand) => Promise<unknown>;

export async function runDeviceCommand(command: DeviceCommand): Promise<unknown> {
  if (command.transport === 'miio') return runMiioCommand(command);
  const signal = getShutdownSignal();
  const request = JSON.stringify({
    ...command.parameters,
    model: command.model,
    registrationData: command.registrationData,
    operation: command.operation,
  });
  const pending = EXEC_FILE('uv', ['run', '--offline', SYNCLEO_SCRIPT], {
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
