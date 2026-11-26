import { diagnosticError } from '../../../../shared/errors';
import { USER_ERRORS } from '../../../../shared/user-errors.ru';
import { type Models, orm } from '../../database';
import type { ToolOutcome } from '../registry';
import type { DeviceModel, DeviceTool, ToolResult } from './common';
import { BALLU_ASP100 } from './devices/ballu-asp100';
import { QINGPING_AIR_MONITOR_LITE } from './devices/qingping-air-monitor-lite';
import { SMART_HUMIDIFIER_2 } from './devices/smart-humidifier2';
import { SMARTMI_FRESH_AIR } from './devices/smartmi-fresh-air';
import { DeviceCommandError } from './driver';

export const DEVICE_MODELS: readonly DeviceModel[] = [
  SMART_HUMIDIFIER_2,
  SMARTMI_FRESH_AIR,
  BALLU_ASP100,
  QINGPING_AIR_MONITOR_LITE,
];
export const HOME_TOOLS = DEVICE_MODELS.flatMap((model) => model.tools);
const DEVICE_TOOLS = new Map<string, { model: DeviceModel; tool: DeviceTool }>();

for (const model of DEVICE_MODELS) {
  for (const tool of model.tools) {
    DEVICE_TOOLS.set(tool.name, { model, tool });
  }
}

type Device = Pick<Models.public_HomeDevice, 'id' | 'displayName' | 'registrationData'> & {
  type: Pick<Models.public_HomeDeviceType, 'code'>;
  room: Pick<Models.public_Room, 'displayName'>;
};

export async function executeHomeTool(
  name: string,
  parameters: Record<string, unknown>,
): Promise<ToolOutcome> {
  // The shared executor has already validated these arguments with this tool's schema.
  const entry = DEVICE_TOOLS.get(name);
  if (!entry) throw new Error(`Unknown home tool: ${name}`);
  const { model, tool } = entry;
  const args = parameters as { deviceId: string };
  const device = (await orm.HomeDevice.select('id', 'displayName', 'registrationData')
    .include('type', (type) => type.select('code'))
    .include('room', (room) => room.select('displayName'))
    .first({ id: args.deviceId })) as Device | null;
  if (!device)
    return {
      reply: 'Не нашла устройство с таким id. Уточните выбор по каталогу.',
      status: 'rejected',
    };
  if (device.type.code !== model.code) {
    return {
      reply: 'Эта команда недоступна для выбранной модели устройства.',
      data: { deviceId: device.id },
      status: 'rejected',
    };
  }
  const location = `«${device.displayName}», комната «${device.room.displayName}»`;
  const connection = {
    model: model.code,
    transport: model.transport,
    registrationData: device.registrationData,
  };
  let result: ToolResult;
  try {
    result = await tool.execute(args, connection);
  } catch (cause) {
    if (!(cause instanceof DeviceCommandError)) throw cause;
    const error = diagnosticError(cause);
    const message = USER_ERRORS[cause.code];
    return {
      reply: `${location}: ${message}`,
      data: { deviceId: device.id },
      error,
      errorCode: cause.code,
      status: 'failed',
    };
  }
  const entries = Object.entries(result.state);
  const defined = entries.filter(isDefinedState);
  const state = Object.fromEntries(defined);
  return {
    reply: `${location}: ${result.description}`,
    data: { deviceId: device.id, state },
    status: 'confirmed',
  };
}

function isDefinedState(
  entry: [string, string | number | boolean | undefined],
): entry is [string, string | number | boolean] {
  return entry[1] !== undefined;
}
