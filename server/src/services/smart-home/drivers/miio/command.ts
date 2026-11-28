import { MiioDeviceError, MiioTimeoutError } from '@martyndevries/xiaomi-miio';
import { AppError } from '../../../../../shared/errors';
import { getShutdownSignal } from '../../../runtime';
import { DeviceCommandError } from '../../utils';
import type { DeviceCredentials } from './device-credentials';
import { exchange, type ModelCode } from './exchange';

const NETWORK_ERRORS = new Set([
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export async function runCommand(
  name: string,
  credentials: DeviceCredentials,
  args: Record<string, unknown>,
): Promise<unknown> {
  const [modelCode, operation] = name.split('.');
  const code = modelCode as ModelCode;
  const shutdown = getShutdownSignal();
  const deadline = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([shutdown, deadline]);
  try {
    return await exchange(code, operation, credentials, args, signal);
  } catch (error) {
    if (shutdown.aborted) throw new AppError('processing_stopped');
    if (error instanceof AppError) throw error;
    if (error instanceof MiioDeviceError) throw new DeviceCommandError('device_rejected_command');
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (
      deadline.aborted ||
      error instanceof MiioTimeoutError ||
      (code && NETWORK_ERRORS.has(code))
    ) {
      throw new DeviceCommandError('device_unreachable');
    }
    throw new AppError('internal_error');
  }
}
