import { z } from 'zod';
import type { DeviceCommand } from './driver';
import { DeviceCommandError, runDeviceCommand } from './driver';

export type DeviceConnection = Pick<DeviceCommand, 'model' | 'transport' | 'registrationData'>;
type DeviceState = Record<string, string | number | boolean | undefined>;
type CommandResult = { state: DeviceState; description: string };
export type DeviceOperation = {
  schema: z.ZodType<{ deviceId: string }>;
  execute(args: { deviceId: string }, connection: DeviceConnection): Promise<CommandResult>;
};
export type DeviceModel = {
  code: string;
  transport: DeviceCommand['transport'];
  operations: Record<string, DeviceOperation>;
};

export const DEVICE_ID_SCHEMA = z
  .uuid()
  .describe('Точный id устройства из каталога. Не придумывай id.');
export const STATE_ARGUMENTS = z.strictObject({ deviceId: DEVICE_ID_SCHEMA });
const POWER_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  power: z.boolean().describe('true — включить, false — выключить'),
};
export const POWER_ARGUMENTS = z.strictObject(POWER_FIELDS);
export const HUMIDITY = z.number().min(0).max(100).optional();
export const TEMPERATURE = z.number().min(-60).max(100).optional();

export async function runDeviceOperation<S extends DeviceState>(
  connection: DeviceConnection,
  operation: string,
  parameters: Record<string, unknown>,
  schema: z.ZodType<S>,
): Promise<S> {
  const command = { ...connection, operation, parameters };
  const raw = await runDeviceCommand(command);
  const result = schema.safeParse(raw);
  if (!result.success) throw new DeviceCommandError('invalid_device_state');
  return result.data;
}

export function confirm(confirmed: boolean) {
  if (!confirmed) throw new DeviceCommandError('not_confirmed');
}

export function powerDescription(state: { power: boolean }) {
  return `${state.power ? 'включён' : 'выключен'}.`;
}

export function joinDescription(parts: (string | undefined)[]) {
  return parts.filter((part) => part !== undefined).join(' ');
}
