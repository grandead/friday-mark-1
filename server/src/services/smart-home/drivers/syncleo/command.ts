import { invokeAdapter } from './adapter';
import type { DeviceCredentials } from './device-credentials';

export function runCommand(
  name: string,
  credentials: DeviceCredentials,
  args: Record<string, unknown>,
): Promise<unknown> {
  return invokeAdapter({ operation: name, credentials, args });
}
