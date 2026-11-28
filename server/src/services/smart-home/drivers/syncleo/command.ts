import { AppError } from '../../../../../shared/errors';
import { getShutdownSignal } from '../../../runtime';
import { DeviceCommandError } from '../../utils';
import type { DeviceCredentials } from './device-credentials';
import { type DeviceType, discover } from './discovery';
import { SyncleoSession } from './session';

const shared = globalThis as typeof globalThis & {
  fridaySyncleoQueue?: Map<string, Promise<void>>;
};
shared.fridaySyncleoQueue ??= new Map();
const QUEUE = shared.fridaySyncleoQueue;

// UI polls and voice commands may reach the same appliance from separate server bundles.
export async function runCommand<T>(
  credentials: DeviceCredentials,
  type: DeviceType,
  action: (session: SyncleoSession) => Promise<T>,
): Promise<T> {
  const { ip } = credentials;
  const previous = QUEUE.get(ip) ?? Promise.resolve();
  const current = previous.then(() => execute(credentials, type, action));
  const done = current.then(
    () => {},
    () => {},
  );
  QUEUE.set(ip, done);
  try {
    return await current;
  } finally {
    if (QUEUE.get(ip) === done) QUEUE.delete(ip);
  }
}

async function execute<T>(
  credentials: DeviceCredentials,
  type: DeviceType,
  action: (session: SyncleoSession) => Promise<T>,
) {
  const shutdown = getShutdownSignal();
  const timeout = AbortSignal.timeout(30000);
  const signal = AbortSignal.any([shutdown, timeout]);
  try {
    const endpoint = await discover(credentials.ip, type, signal);
    const session = new SyncleoSession(endpoint, credentials, signal);
    return await session.execute(action);
  } catch (error) {
    if (shutdown.aborted) throw new AppError('processing_stopped');
    if (error instanceof AppError) throw error;
    throw new DeviceCommandError('device_unreachable');
  }
}
