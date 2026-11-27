import { DeviceCommandError } from '../device-error';
import type { DeviceCommand } from '../driver';
import { type Change, decode, type MiioSession, type State } from './session';

const PROPERTIES = {
  power: 'power',
  mode: 'mode',
  humidity: 'humidity',
  temperature: 'temp_dec',
  co2: 'co2',
  pm25: 'aqi',
  averagePm25: 'average_aqi',
  brightness: 'led_level',
  buzzer: 'buzzer',
  childLock: 'child_lock',
  heater: 'ptc_state',
  filterHours: 'f1_hour_used',
  filterLife: 'filter_life',
  motorRpm: 'motor1_speed',
  useSeconds: 'use_time',
  heaterTemperature: 'ntcT',
};
const METHODS: Record<string, string> = {
  power: 'set_power',
  mode: 'set_mode',
  brightness: 'set_led_level',
  buzzer: 'set_buzzer',
  childLock: 'set_child_lock',
  heater: 'set_ptc_state',
};
const BRIGHTNESS = ['bright', 'dim', 'off'];
const SPEEDS = ['low', 'middle', 'strong'];

export async function readSmartmi(session: MiioSession, model: string) {
  const state: State = {};
  const legacy = model === 'zhimi.airfresh.va2';
  const fields = Object.entries(PROPERTIES).filter(([field]) => !legacy || field !== 'heater');
  for (let offset = 0; offset < fields.length; offset += 6) {
    const batch = fields.slice(offset, offset + 6);
    const names = batch.map(([, name]) => name);
    const rows = await session.read('get_prop', names);
    if (!Array.isArray(rows) || rows.length !== batch.length)
      throw new DeviceCommandError('invalid_device_state');
    for (const [index, [field]] of batch.entries()) {
      if (rows[index] != null) state[field] = rows[index];
    }
  }
  for (const field of ['power', 'buzzer', 'childLock', 'heater']) {
    if (!(field in state)) continue;
    if (state[field] !== 'on' && state[field] !== 'off')
      throw new DeviceCommandError('invalid_device_state');
    state[field] = state[field] === 'on';
  }
  if (typeof state.power !== 'boolean') throw new DeviceCommandError('invalid_device_state');
  decode(state, 'brightness', BRIGHTNESS);
  if (legacy && typeof state.temperature === 'number') state.temperature /= 10;
  const speed = SPEEDS.indexOf(state.mode as string);
  if (speed >= 0) state.speed = speed + 1;
  return state;
}

export async function writeSmartmi(
  session: MiioSession,
  command: DeviceCommand,
  state: State,
): Promise<Change | undefined> {
  const { operation, parameters } = command;
  if (operation === 'resetFilter') {
    if (!('filterHours' in state)) throw new DeviceCommandError('unsupported');
    await writeSetting(session, 'reset_filter1', []);
    return { field: 'filterHours', wanted: 0 };
  }
  const field = operation === 'speed' ? 'mode' : operation;
  if (!Object.hasOwn(METHODS, field) || !(field in state))
    throw new DeviceCommandError('unsupported');
  const wanted =
    operation === 'speed' ? SPEEDS[(parameters.speed as number) - 1] : parameters[field];
  if (state[field] === wanted) return;
  let value = wanted;
  if (typeof wanted === 'boolean') value = wanted ? 'on' : 'off';
  if (field === 'brightness') value = BRIGHTNESS.indexOf(wanted as string);
  await writeSetting(session, METHODS[field], [value]);
  return { field, wanted };
}

async function writeSetting(session: MiioSession, method: string, params: unknown[]) {
  const ack = await session.write(method, params);
  if (!Array.isArray(ack) || ack.length !== 1 || ack[0] !== 'ok')
    throw new DeviceCommandError('not_confirmed');
}
