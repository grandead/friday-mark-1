import { DeviceCommandError } from '../device-error';
import type { DeviceCommand } from '../driver';
import { type Change, decode, type MiioSession, type State } from './session';

type Properties = Record<string, readonly [number, number]>;
type Property = { did: string; siid: number; piid: number };

const HUMIDIFIER: Properties = {
  power: [2, 1],
  fault: [2, 2],
  level: [2, 5],
  targetHumidity: [2, 6],
  status: [2, 7],
  mode: [2, 8],
  humidity: [3, 1],
  temperature: [3, 7],
  buzzer: [5, 1],
  indicator: [6, 1],
  tankLifted: [7, 1],
  waterShortage: [7, 2],
  humiditySensorFault: [7, 3],
  temperatureSensorFault: [7, 4],
  overwetProtectionActive: [7, 5],
  overwetProtection: [7, 6],
  constantProtectionActive: [7, 7],
  constantProtection: [7, 8],
};
const QINGPING: Properties = {
  humidity: [3, 1],
  pm25: [3, 4],
  pm10: [3, 5],
  temperature: [3, 7],
  co2: [3, 8],
  battery: [4, 1],
  chargingState: [4, 2],
  voltage: [4, 3],
  monitoringInterval: [9, 4],
  screenOffDelay: [9, 5],
  powerOffDelay: [9, 6],
  temperatureUnit: [9, 7],
  screensaverDelay: [9, 8],
  autoSlideInterval: [9, 10],
  twelveHourClock: [9, 19],
};
const CGD1ST: Properties = { ...QINGPING, powerOffSeconds: [9, 18], pm25Standard: [9, 20] };
const HUMIDIFIER_MODES = ['manual', 'constantHumidity'];
const PM25_STANDARDS = ['cn', 'us'];
const WRITABLE = new Set([
  'power',
  'level',
  'targetHumidity',
  'mode',
  'buzzer',
  'indicator',
  'overwetProtection',
  'constantProtection',
  'monitoringInterval',
  'screenOffDelay',
  'powerOffDelay',
  'temperatureUnit',
  'screensaverDelay',
  'autoSlideInterval',
  'twelveHourClock',
  'powerOffSeconds',
  'pm25Standard',
]);

function properties(model: string) {
  if (model === 'deerma.humidifier.jsq2g') return HUMIDIFIER;
  return model === 'cgllc.airm.cgd1st' ? CGD1ST : QINGPING;
}

export async function readMiot(session: MiioSession, model: string) {
  const state: State = {};
  const fields = properties(model);
  const entries = Object.entries(fields);
  for (let offset = 0; offset < entries.length; offset += 6) {
    const batch = entries.slice(offset, offset + 6);
    const request = batch.map(([did, [siid, piid]]) => ({ did, siid, piid }));
    const rows = await session.read('get_properties', request);
    collectProperties(state, request, rows);
  }
  if (fields === HUMIDIFIER) {
    if (typeof state.power !== 'boolean') throw new DeviceCommandError('invalid_device_state');
    decode(state, 'mode', HUMIDIFIER_MODES);
    decode(state, 'fault', ['none', 'waterShortage', 'tankSeparated']);
    decode(state, 'status', [undefined, 'idle', 'humidifying']);
  } else {
    for (const name of ['humidity', 'temperature', 'co2', 'pm25', 'pm10']) {
      if (!(name in state)) throw new DeviceCommandError('invalid_device_state');
    }
    decode(state, 'twelveHourClock', [false, true]);
    decode(state, 'pm25Standard', PM25_STANDARDS);
  }
  return state;
}

function collectProperties(state: State, request: Property[], rows: unknown) {
  if (!Array.isArray(rows)) throw new DeviceCommandError('invalid_device_state');
  const seen = new Set<string>();
  for (const row of rows) {
    const match = request.find((p) => p.siid === row?.siid && p.piid === row?.piid);
    if (!match || seen.has(match.did)) throw new DeviceCommandError('invalid_device_state');
    seen.add(match.did);
    if (row.code === 0 && row.value != null) state[match.did] = row.value;
  }
}

export async function writeMiot(
  session: MiioSession,
  command: DeviceCommand,
  state: State,
  model: string,
): Promise<Change | undefined> {
  const field = command.operation;
  const wanted = command.parameters[field];
  if (!WRITABLE.has(field) || !(field in state)) throw new DeviceCommandError('unsupported');
  if (
    model === 'cgllc.airm.cgdn1' &&
    ((field === 'screenOffDelay' && wanted === 600) || (field === 'powerOffDelay' && wanted === 10))
  ) {
    throw new DeviceCommandError('unsupported');
  }
  if (state[field] === wanted) return;
  const fields = properties(model);
  const [siid, piid] = fields[field];
  const value = encodeSetting(field, wanted);
  const rows = await session.write('set_properties', [{ did: field, siid, piid, value }]);
  if (!Array.isArray(rows) || rows.length !== 1) throw new DeviceCommandError('not_confirmed');
  const [ack] = rows;
  if (ack?.siid !== siid || ack.piid !== piid || (ack.code !== 0 && ack.code !== 1)) {
    throw new DeviceCommandError('not_confirmed');
  }
  return { field, wanted };
}

function encodeSetting(field: string, wanted: unknown) {
  if (field === 'mode') return HUMIDIFIER_MODES.indexOf(wanted as string);
  if (field === 'pm25Standard') return PM25_STANDARDS.indexOf(wanted as string);
  if (field === 'twelveHourClock') return Number(wanted);
  return wanted;
}
