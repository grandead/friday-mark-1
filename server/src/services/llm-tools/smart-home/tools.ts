import { AppError, diagnosticError } from '../../../../shared/errors';
import { USER_ERRORS } from '../../../../shared/user-errors.ru';
import { DeviceCommandError, getDeviceOperation } from '../../smart-home';
import type { ToolOutcome } from '../registry';
import { BALLU_ASP100 } from './devices/ballu-asp100';
import { QINGPING_AIR_MONITOR_LITE } from './devices/qingping-air-monitor-lite';
import { SMART_HUMIDIFIER_2 } from './devices/smart-humidifier2';
import { SMARTMI_FRESH_AIR } from './devices/smartmi-fresh-air';

export const VOICE_MODELS = [
  SMART_HUMIDIFIER_2,
  SMARTMI_FRESH_AIR,
  BALLU_ASP100,
  QINGPING_AIR_MONITOR_LITE,
];
type Tool = (typeof VOICE_MODELS)[number]['tools'][number];
type BoundTool = Tool & ReturnType<typeof getDeviceOperation>;
export const HOME_TOOLS: BoundTool[] = [];

for (const model of VOICE_MODELS) {
  for (const tool of model.tools) {
    const operation = getDeviceOperation(model.code, tool.operation);
    HOME_TOOLS.push({ ...tool, ...operation });
  }
}

export async function executeHomeTool(
  name: string,
  parameters: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tool = HOME_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown home tool: ${name}`);
  const args = parameters as { deviceId: string };
  const data = { deviceId: args.deviceId };
  try {
    const result = await tool.execute(args);
    return {
      reply: `«${result.name}», комната «${result.room}»: ${result.description}`,
      data: { ...data, state: result.state },
      status: 'confirmed',
    };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'entity_not_found') {
      return {
        reply: 'Не нашла устройство с таким id. Уточните выбор по каталогу.',
        status: 'rejected',
      };
    }
    if (cause instanceof AppError && cause.code === 'device_model_mismatch') {
      return { reply: USER_ERRORS[cause.code], data, status: 'rejected' };
    }
    if (!(cause instanceof DeviceCommandError)) throw cause;
    const message = USER_ERRORS[cause.code];
    const reply = cause.location
      ? `«${cause.location.name}», комната «${cause.location.room}»: ${message}`
      : message;
    const error = diagnosticError(cause);
    return { reply, data, error, errorCode: cause.code, status: 'failed' };
  }
}
