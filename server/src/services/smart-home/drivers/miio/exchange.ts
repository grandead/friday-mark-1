import { setTimeout as delay } from 'node:timers/promises';
import { DeviceModelCode } from '../../../../../shared/device-model-code';
import { DeviceCommandError } from '../../utils';
import type { DeviceCredentials } from './device-credentials';
import { readMiot, writeMiot } from './miot';
import { MiioSession } from './session';
import { readSmartmi, writeSmartmi } from './smartmi';

const MODELS = {
  [DeviceModelCode.XiaomiSmartHumidifier2]: {
    hardware: ['deerma.humidifier.jsq2g'],
    read: readMiot,
    write: writeMiot,
  },
  [DeviceModelCode.SmartmiFreshAir]: {
    hardware: ['zhimi.airfresh.va2', 'zhimi.airfresh.va4'],
    read: readSmartmi,
    write: writeSmartmi,
  },
  [DeviceModelCode.QingpingAirMonitorLite]: {
    hardware: ['cgllc.airm.cgdn1', 'cgllc.airm.cgd1st'],
    read: readMiot,
    write: writeMiot,
  },
};

export type ModelCode = keyof typeof MODELS;

export async function exchange(
  code: ModelCode,
  operation: string,
  { ip, token }: DeviceCredentials,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  const profile = MODELS[code];
  const session = new MiioSession(ip, token, signal);
  const close = () => session.close();
  signal.addEventListener('abort', close, { once: true });
  try {
    const info = await session.read('miIO.info');
    const model = (info as { model?: string } | null)?.model;
    if (!model || !profile.hardware.includes(model)) {
      throw new DeviceCommandError('unsupported');
    }
    const state = await profile.read(session, model);
    if (operation === 'state') return state;
    const change = await profile.write(session, operation, args, state, model);
    if (!change) return state;
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(400, undefined, { signal });
      const updated = await profile.read(session, model);
      if (updated[change.field] === change.wanted) return updated;
    }
    throw new DeviceCommandError('not_confirmed');
  } finally {
    signal.removeEventListener('abort', close);
    session.close();
  }
}
