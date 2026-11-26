import { z } from 'zod';
import type { DeviceConnection, DeviceModel } from '../common';
import {
  confirm,
  DEVICE_ID_SCHEMA,
  HUMIDITY,
  joinDescription,
  POWER_ARGUMENTS,
  powerDescription,
  runDeviceOperation,
  STATE_ARGUMENTS,
  TEMPERATURE,
} from '../common';

const MODE_NAMES = {
  auto: 'автоматический',
  silent: 'ночной',
  interval: 'интервальный',
  low: 'низкая скорость',
  middle: 'средняя скорость',
  strong: 'высокая скорость',
};
const BRIGHTNESS_NAMES = { bright: 'яркий', dim: 'тусклый', off: 'выключен' };
const STATE_FIELDS = {
  power: z.boolean(),
  humidity: HUMIDITY,
  temperature: TEMPERATURE,
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
  averagePm25: z.number().nonnegative().optional(),
  mode: z.enum(['auto', 'silent', 'interval', 'low', 'middle', 'strong']).optional(),
  speed: z.number().int().min(1).max(3).optional(),
  brightness: z.enum(['bright', 'dim', 'off']).optional(),
  buzzer: z.boolean().optional(),
  childLock: z.boolean().optional(),
  heater: z.boolean().optional(),
  filterHours: z.number().nonnegative().optional(),
  filterLife: z.number().min(0).max(100).optional(),
  motorRpm: z.number().nonnegative().optional(),
  useSeconds: z.number().nonnegative().optional(),
  heaterTemperature: TEMPERATURE,
};
const STATE_SCHEMA = z.strictObject(STATE_FIELDS);
const MODE_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  mode: z.enum(['auto', 'silent', 'interval', 'low', 'middle', 'strong']),
};
const MODE_ARGUMENTS = z.strictObject(MODE_FIELDS);
const SPEED_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  speed: z.number().int().min(1).max(3),
};
const SPEED_ARGUMENTS = z.strictObject(SPEED_FIELDS);
const BRIGHTNESS_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  brightness: z.enum(['bright', 'dim', 'off']),
};
const BRIGHTNESS_ARGUMENTS = z.strictObject(BRIGHTNESS_FIELDS);
const BUZZER_FIELDS = { deviceId: DEVICE_ID_SCHEMA, buzzer: z.boolean() };
const BUZZER_ARGUMENTS = z.strictObject(BUZZER_FIELDS);
const CHILD_LOCK_FIELDS = { deviceId: DEVICE_ID_SCHEMA, childLock: z.boolean() };
const CHILD_LOCK_ARGUMENTS = z.strictObject(CHILD_LOCK_FIELDS);
const HEATER_FIELDS = { deviceId: DEVICE_ID_SCHEMA, heater: z.boolean() };
const HEATER_ARGUMENTS = z.strictObject(HEATER_FIELDS);
export const SMARTMI_FRESH_AIR = {
  code: 'smartmi-fresh-air',
  transport: 'miio',
  tools: [
    {
      name: 'smartmi_get_state',
      description:
        'Прочитать состояние Smartmi Fresh Air: CO2, PM2.5, влажность, температура, режим, экран, звук, блокировка, подогрев, обороты, фильтр и наработка. Не заменяет настройку.',
      schema: STATE_ARGUMENTS,
      execute: getState,
    },
    {
      name: 'smartmi_set_power',
      description:
        'Включить или выключить Smartmi Fresh Air по явной просьбе. Не использовать для отрицаний, цитат или вопросов о возможности действия.',
      schema: POWER_ARGUMENTS,
      execute: setPower,
    },
    {
      name: 'smartmi_set_mode',
      description:
        'Выбрать режим Smartmi Fresh Air: auto — автоматический, silent — ночной, interval — интервальный, low/middle/strong — ручная скорость 1/2/3. Не задаёт целевую температуру или CO2.',
      schema: MODE_ARGUMENTS,
      execute: setMode,
    },
    {
      name: 'smartmi_set_speed',
      description:
        'Установить ручную скорость Smartmi Fresh Air: 1 — низкая, 2 — средняя, 3 — высокая. Выходит из автоматического, ночного или интервального режима. Не задаёт обороты в минуту.',
      schema: SPEED_ARGUMENTS,
      execute: setSpeed,
    },
    {
      name: 'smartmi_set_brightness',
      description:
        'Яркость экрана Smartmi Fresh Air: bright — ярко, dim — тускло, off — выключить экран. Не выключает вентиляцию.',
      schema: BRIGHTNESS_ARGUMENTS,
      execute: setBrightness,
    },
    {
      name: 'smartmi_set_buzzer',
      description: 'Включить или выключить звуковые сигналы Smartmi Fresh Air.',
      schema: BUZZER_ARGUMENTS,
      execute: setBuzzer,
    },
    {
      name: 'smartmi_set_child_lock',
      description: 'Включить или выключить блокировку кнопок Smartmi Fresh Air.',
      schema: CHILD_LOCK_ARGUMENTS,
      execute: setChildLock,
    },
    {
      name: 'smartmi_set_heater',
      description:
        'Включить или выключить PTC-подогрев Smartmi Fresh Air VA4. Не выключает вентиляцию и не задаёт целевую температуру. У VA2 эта функция недоступна.',
      schema: HEATER_ARGUMENTS,
      execute: setHeater,
    },
    {
      name: 'smartmi_reset_filter',
      description:
        'Сбросить счётчик часов фильтра Smartmi Fresh Air только после его замены и по явной просьбе пользователя. Не очищает фильтр физически.',
      schema: STATE_ARGUMENTS,
      execute: resetFilter,
    },
  ],
} satisfies DeviceModel;

async function getState(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const state = await runDeviceOperation(connection, 'state', {}, STATE_SCHEMA);
  const description = describeState(state);
  return { state, description };
}
async function setPower(args: z.infer<typeof POWER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { power: args.power };
  const state = await runDeviceOperation(connection, 'power', parameters, STATE_SCHEMA);
  confirm(state.power === args.power);
  const description = powerDescription(state);
  return { state, description };
}
async function setMode(args: z.infer<typeof MODE_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { mode: args.mode };
  const state = await runDeviceOperation(connection, 'mode', parameters, STATE_SCHEMA);
  confirm(state.mode === args.mode);
  const description = `Режим: ${MODE_NAMES[args.mode]}.`;
  return { state, description };
}
async function setSpeed(args: z.infer<typeof SPEED_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { speed: args.speed };
  const state = await runDeviceOperation(connection, 'speed', parameters, STATE_SCHEMA);
  confirm(state.speed === args.speed);
  const description = `Скорость ${args.speed}.`;
  return { state, description };
}
async function setBrightness(
  args: z.infer<typeof BRIGHTNESS_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { brightness: args.brightness };
  const state = await runDeviceOperation(connection, 'brightness', parameters, STATE_SCHEMA);
  confirm(state.brightness === args.brightness);
  const description = `Экран: ${BRIGHTNESS_NAMES[args.brightness]}.`;
  return { state, description };
}
async function setBuzzer(args: z.infer<typeof BUZZER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { buzzer: args.buzzer };
  const state = await runDeviceOperation(connection, 'buzzer', parameters, STATE_SCHEMA);
  confirm(state.buzzer === args.buzzer);
  const description = `Звуковые сигналы ${args.buzzer ? 'включены' : 'выключены'}.`;
  return { state, description };
}
async function setChildLock(
  args: z.infer<typeof CHILD_LOCK_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { childLock: args.childLock };
  const state = await runDeviceOperation(connection, 'childLock', parameters, STATE_SCHEMA);
  confirm(state.childLock === args.childLock);
  const description = `Блокировка кнопок ${args.childLock ? 'включена' : 'выключена'}.`;
  return { state, description };
}
async function setHeater(args: z.infer<typeof HEATER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { heater: args.heater };
  const state = await runDeviceOperation(connection, 'heater', parameters, STATE_SCHEMA);
  confirm(state.heater === args.heater);
  const description = `Подогрев ${args.heater ? 'включён' : 'выключен'}.`;
  return { state, description };
}
async function resetFilter(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const state = await runDeviceOperation(connection, 'resetFilter', {}, STATE_SCHEMA);
  confirm(state.filterHours === 0);
  return { state, description: 'Счётчик фильтра сброшен.' };
}

function describeState(state: z.infer<typeof STATE_SCHEMA>) {
  const parts = [
    powerDescription(state),
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined ? undefined : `Температура ${state.temperature} градусов.`,
    state.co2 === undefined ? undefined : `CO2 ${state.co2} ppm.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
    state.mode === undefined ? undefined : `Режим: ${MODE_NAMES[state.mode]}.`,
    state.brightness === undefined ? undefined : `Экран: ${BRIGHTNESS_NAMES[state.brightness]}.`,
    state.buzzer === undefined
      ? undefined
      : `Звуковые сигналы ${state.buzzer ? 'включены' : 'выключены'}.`,
    state.childLock === undefined
      ? undefined
      : `Блокировка кнопок ${state.childLock ? 'включена' : 'выключена'}.`,
    state.heater === undefined ? undefined : `Подогрев ${state.heater ? 'включён' : 'выключен'}.`,
    state.filterHours === undefined ? undefined : `Фильтр отработал ${state.filterHours} часов.`,
    state.filterLife === undefined ? undefined : `Ресурс фильтра ${state.filterLife} процентов.`,
    state.motorRpm === undefined ? undefined : `Вентилятор: ${state.motorRpm} оборотов в минуту.`,
    state.heaterTemperature === undefined
      ? undefined
      : `Температура датчика нагревателя ${state.heaterTemperature} градусов.`,
    state.averagePm25 === undefined
      ? undefined
      : `Среднее PM2.5: ${state.averagePm25} микрограммов на кубометр.`,
    state.useSeconds === undefined
      ? undefined
      : `Общая наработка ${Math.round(state.useSeconds / 3600)} часов.`,
  ];
  return joinDescription(parts);
}
