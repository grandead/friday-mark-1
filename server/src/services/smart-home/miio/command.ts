import { setTimeout as delay } from 'node:timers/promises';
import { MiioDeviceError, MiioTimeoutError } from '@martyndevries/xiaomi-miio';
import { AppError } from '../../../../shared/errors';
import { getShutdownSignal } from '../../runtime';
import { DeviceCommandError } from '../device-error';
import type { DeviceCommand } from '../driver';
import { readMiot, writeMiot } from './miot';
import { MiioSession } from './session';
import { readSmartmi, writeSmartmi } from './smartmi';

const HARDWARE_MODELS: Record<string, string[]> = {
  'xiaomi-smart-humidifier-2': ['deerma.humidifier.jsq2g'],
  'smartmi-fresh-air': ['zhimi.airfresh.va2', 'zhimi.airfresh.va4'],
  'qingping-air-monitor-lite': ['cgllc.airm.cgdn1', 'cgllc.airm.cgd1st'],
};
const NETWORK_ERRORS = new Set([
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export async function runMiioCommand(command: DeviceCommand) {
  const shutdown = getShutdownSignal();
  const deadline = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([shutdown, deadline]);
  try {
    return await execute(command, signal);
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

async function execute(command: DeviceCommand, signal: AbortSignal) {
  const { ip, token } = command.registrationData as { ip: string; token: string };
  const session = new MiioSession(ip, token, signal);
  const close = () => session.close();
  signal.addEventListener('abort', close, { once: true });
  try {
    const info = await session.read('miIO.info');
    const model = (info as { model?: string } | null)?.model;
    if (!model || !HARDWARE_MODELS[command.model]?.includes(model)) {
      throw new DeviceCommandError('unsupported');
    }
    const smartmi = command.model === 'smartmi-fresh-air';
    const read = smartmi ? readSmartmi : readMiot;
    const write = smartmi ? writeSmartmi : writeMiot;
    const state = await read(session, model);
    if (command.operation === 'state') return state;
    const change = await write(session, command, state, model);
    if (!change) return state;
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(400, undefined, { signal });
      const updated = await read(session, model);
      if (updated[change.field] === change.wanted) return updated;
    }
    throw new DeviceCommandError('not_confirmed');
  } finally {
    signal.removeEventListener('abort', close);
    session.close();
  }
}
