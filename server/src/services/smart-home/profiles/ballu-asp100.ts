import type { BalluState } from '../devices/ballu-asp100';
import { type DeviceCredentials, runCommand, type SyncleoSession } from '../drivers/syncleo';
import { DeviceCommandError } from '../utils';

const DEVICE = { vendor: 'rusclimate', deviceType: 69 };
const MODES = ['off', 'manual', 'auto', 'night', 'turbo', 'eco'] as const;
const SOUNDS = ['off', 'rain', 'sea', 'forest', 'birds', 'fireplace'] as const;
const FIELD = {
  mode: 1,
  targetTemperature: 2,
  turboSeconds: 3,
  errorCode: 7,
  buttonSound: 9,
  sound: 11,
  speed: 15,
  humidity: 19,
  temperature: 20,
  co2: 22,
  backlightAutoOff: 28,
  pm25: 32,
  filterCounter: 34,
  hardware: 66,
} as const;

type Command =
  | { name: 'state' | 'resetFilter' }
  | { name: 'power'; power: boolean }
  | { name: 'mode'; mode: Exclude<(typeof MODES)[number], 'auto' | 'off'> }
  | { name: 'speed'; speed: number }
  | { name: 'targetTemperature'; temperature: number }
  | { name: 'buttonSound' | 'backlightAutoOff'; enabled: boolean }
  | { name: 'sound'; sound: (typeof SOUNDS)[number] };

function readDecimal(data: Buffer) {
  const magnitude = data[0] + (data[1] & 127) / 100;
  return data[1] & 128 ? -magnitude : magnitude;
}

function receive(state: Partial<BalluState>, field: number, data: Buffer): boolean {
  if (!data.length) return false;
  const first = data[0];
  switch (field) {
    case FIELD.mode:
      if (first >= MODES.length) return false;
      state.mode = MODES[first];
      state.power = first !== 0;
      return true;
    case FIELD.speed:
      if (first > 8) return false;
      state.speed = first;
      return true;
    case FIELD.errorCode:
      state.errorCode = first;
      return true;
    case FIELD.buttonSound:
      state.buttonSound = first !== 0;
      return true;
    case FIELD.backlightAutoOff:
      state.backlightAutoOff = first !== 0;
      return true;
    case FIELD.hardware:
      if (first !== 0) return false;
      if (data[1] <= 1) state.heaterInstalled = data[1] === 1;
      if (data[2] <= 1) state.co2SensorInstalled = data[2] === 1;
      return true;
    case FIELD.turboSeconds: {
      if (data.length < 4) return false;
      const seconds = data.readUInt32LE();
      if (seconds > 86400) return false;
      state.turboSeconds = seconds;
      return true;
    }
    default:
      return data.length >= 2 && receiveShort(state, field, data);
  }
}

function receiveShort(state: Partial<BalluState>, field: number, data: Buffer) {
  const value = data.readUInt16LE();
  switch (field) {
    case FIELD.filterCounter:
      state.filterCounter = value;
      return true;
    case FIELD.co2:
      if (!value) return false;
      state.co2 = value;
      return true;
    case FIELD.pm25:
      state.pm25 = value;
      return true;
    case FIELD.sound:
      if (value >= SOUNDS.length) return false;
      state.sound = SOUNDS[value];
      return true;
    case FIELD.targetTemperature: {
      const target = readDecimal(data);
      if (target < 0 || target > 25) return false;
      state.targetTemperature = target;
      return true;
    }
    case FIELD.temperature: {
      const temperature = readDecimal(data);
      if (temperature < -60 || temperature > 100) return false;
      state.temperature = temperature;
      return true;
    }
    case FIELD.humidity: {
      const humidity = readDecimal(data);
      if (humidity < 0 || humidity > 100) return false;
      state.humidity = humidity;
      return true;
    }
    default:
      return false;
  }
}

async function apply(session: SyncleoSession, state: Partial<BalluState>, command: Command) {
  switch (command.name) {
    case 'state':
      return;
    case 'power': {
      if (state.power === command.power) return;
      const mode = command.power ? 1 : 0;
      return session.write(FIELD.mode, [mode], () => state.power === command.power);
    }
    case 'mode': {
      const mode = MODES.indexOf(command.mode);
      return session.write(FIELD.mode, [mode], () => state.mode === command.mode);
    }
    case 'speed':
      if (state.speed === undefined) throw new DeviceCommandError('unsupported');
      await session.write(FIELD.mode, [1], () => state.mode === 'manual');
      return session.write(FIELD.speed, [command.speed], () => state.speed === command.speed);
    case 'targetTemperature': {
      if (state.heaterInstalled === false) throw new DeviceCommandError('heater_missing');
      if (state.heaterInstalled !== true) throw new DeviceCommandError('hardware_unknown');
      if (state.targetTemperature === undefined) throw new DeviceCommandError('unsupported');
      const matches = () => state.targetTemperature === command.temperature;
      return session.write(FIELD.targetTemperature, [command.temperature, 0], matches);
    }
    case 'buttonSound':
    case 'backlightAutoOff': {
      const name = command.name;
      if (state[name] === undefined) throw new DeviceCommandError('unsupported');
      const value = Number(command.enabled);
      return session.write(FIELD[name], [value], () => state[name] === command.enabled);
    }
    case 'sound': {
      if (state.sound === undefined) throw new DeviceCommandError('unsupported');
      const sound = SOUNDS.indexOf(command.sound);
      return session.write(FIELD.sound, [sound, 0], () => state.sound === command.sound);
    }
    case 'resetFilter':
      if (state.filterCounter === undefined) throw new DeviceCommandError('unsupported');
      return session.write(FIELD.filterCounter, [0, 0], () => state.filterCounter === 0, true);
  }
}

async function exchange(session: SyncleoSession, command: Command) {
  const state: Partial<BalluState> = {};
  const update = (field: number, data: Buffer) => receive(state, field, data);
  await session.read(update, () => state.power !== undefined);
  await apply(session, state, command);
  return state;
}

export function exchangeBallu(credentials: DeviceCredentials, command: Command) {
  return runCommand(credentials, DEVICE, (session) => exchange(session, command));
}
