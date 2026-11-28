import { z } from 'zod';
import { diagnosticError } from '../../../../shared/errors';
import { USER_ERRORS } from '../../../../shared/user-errors.ru';
import {
  DeviceCommandError,
  type DeviceModelCode,
  type MiioCredentials,
  type SyncleoCredentials,
} from '../../smart-home';
import type { ToolOutcome } from '../registry';
import { BALLU_ASP100 } from './devices/ballu-asp100';
import { QINGPING_AIR_MONITOR_LITE } from './devices/qingping-air-monitor-lite';
import { SMART_HUMIDIFIER_2 } from './devices/smart-humidifier2';
import { SMARTMI_FRESH_AIR } from './devices/smartmi-fresh-air';
import { getDevice } from './get-device';

export const VOICE_MODELS = {
  [SMART_HUMIDIFIER_2.code]: SMART_HUMIDIFIER_2,
  [SMARTMI_FRESH_AIR.code]: SMARTMI_FRESH_AIR,
  [BALLU_ASP100.code]: BALLU_ASP100,
  [QINGPING_AIR_MONITOR_LITE.code]: QINGPING_AIR_MONITOR_LITE,
} satisfies Record<DeviceModelCode, unknown>;
type Value = string | number | boolean;
type DeviceState = Record<string, Value | undefined>;
const TARGET = {
  deviceId: z.uuid().describe('Точный id устройства из каталога. Не придумывай id.'),
};
type BoundTool = {
  name: string;
  description: string;
  invalidReply?: string;
  model: DeviceModelCode;
  schema: z.ZodType<Record<string, Value>>;
  run(
    credentials: MiioCredentials | SyncleoCredentials,
    args: Record<string, unknown>,
  ): Promise<DeviceState>;
  describe(state: DeviceState, args: Record<string, unknown>): string;
};
export const HOME_TOOLS: BoundTool[] = [];

for (const model of Object.values(VOICE_MODELS)) {
  for (const tool of model.tools) {
    const schema = tool.schema.extend(TARGET);
    HOME_TOOLS.push({ ...tool, model: model.code, schema });
  }
}

export async function executeHomeTool(
  name: string,
  parameters: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tool = HOME_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown home tool: ${name}`);
  const { deviceId, ...args } = parameters as { deviceId: string; [key: string]: unknown };
  const data = { deviceId };
  const device = await getDevice(deviceId);
  if (!device) {
    return {
      reply: 'Не нашла устройство с таким id. Уточните выбор по каталогу.',
      status: 'rejected',
    };
  }
  if (device.model !== tool.model) {
    return { reply: USER_ERRORS.device_model_mismatch, data, status: 'rejected' };
  }
  const location = `«${device.name}», комната «${device.room}»`;
  try {
    const state = await tool.run(device.credentials, args);
    const description = tool.describe(state, args);
    const entries = Object.entries(state);
    const defined = entries.filter((entry): entry is [string, Value] => entry[1] !== undefined);
    return {
      reply: `${location}: ${description}`,
      data: { ...data, state: Object.fromEntries(defined) },
      status: 'confirmed',
    };
  } catch (cause) {
    if (!(cause instanceof DeviceCommandError)) throw cause;
    const reply = `${location}: ${USER_ERRORS[cause.code]}`;
    const error = diagnosticError(cause);
    return { reply, data, error, errorCode: cause.code, status: 'failed' };
  }
}
