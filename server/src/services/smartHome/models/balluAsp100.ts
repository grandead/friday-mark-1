import { z } from 'zod';
import { commandsFor, type DeviceModel, invalidCommandReply, selector } from '../model.js';
import {
  basicCommands,
  humidity,
  joinDescription,
  powerDescription,
  temperature,
} from './common.js';

export const balluModes = ['manual', 'night', 'turbo', 'eco'] as const;
export const balluSounds = ['off', 'rain', 'sea', 'forest', 'birds', 'fireplace'] as const;
export const modeNames = {
  off: 'выключен',
  manual: 'ручной',
  auto: 'автоматический',
  night: 'ночной',
  turbo: 'турбо',
  eco: 'экопроветривание',
};
export const soundNames = {
  off: 'выключен',
  rain: 'дождь',
  sea: 'море',
  forest: 'лес',
  birds: 'птицы',
  fireplace: 'камин',
};

export const balluState = z.strictObject({
  power: z.boolean(),
  mode: z.enum(['off', 'auto', ...balluModes]).optional(),
  speed: z.number().int().min(0).max(8).optional(),
  targetTemperature: z.number().min(0).max(25).optional(),
  heaterInstalled: z.boolean().optional(),
  co2SensorInstalled: z.boolean().optional(),
  buttonSound: z.boolean().optional(),
  backlightAutoOff: z.boolean().optional(),
  sound: z.enum(balluSounds).optional(),
  filterCounter: z.number().int().nonnegative().max(65535).optional(),
  errorCode: z.number().int().nonnegative().optional(),
  turboSeconds: z.number().int().nonnegative().optional(),
  humidity,
  temperature,
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
});
export type BalluState = z.infer<typeof balluState>;
export function describeBalluState(state: BalluState) {
  // Installed ASP-100 units have no CO2 sensor, including when capability data is absent.
  return joinDescription([
    powerDescription(state),
    !state.mode || state.mode === 'off' ? undefined : `Режим ${modeNames[state.mode]}.`,
    state.speed === undefined ? undefined : `Скорость ${state.speed}.`,
    state.targetTemperature === undefined
      ? undefined
      : `Задано ${state.targetTemperature} градусов для приточного воздуха.`,
    state.turboSeconds === undefined || state.mode !== 'turbo'
      ? undefined
      : `До конца турборежима ${state.turboSeconds} секунд.`,
    state.filterCounter === undefined
      ? undefined
      : `Показатель счётчика фильтра ${state.filterCounter}.`,
    state.errorCode === undefined
      ? undefined
      : state.errorCode === 0
        ? 'Ошибок нет.'
        : `Код ошибки ${state.errorCode}.`,
    state.buttonSound === undefined
      ? undefined
      : `Звуки кнопок ${state.buttonSound ? 'включены' : 'выключены'}.`,
    state.backlightAutoOff === undefined
      ? undefined
      : `Автогашение подсветки ${state.backlightAutoOff ? 'включено' : 'выключено'}.`,
    state.sound === undefined ? undefined : `Фоновый звук: ${soundNames[state.sound]}.`,
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined
      ? undefined
      : `Температура приточного воздуха ${state.temperature} градусов.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
  ]);
}

const command = commandsFor(balluState);
const unavailableReply =
  'Эта настройка подключена только для Ballu ASP-100. Для выбранной модели она пока недоступна.';
const speedSchema = z.strictObject({ speed: z.number().int().min(1).max(7) });
const temperatureSchema = z.strictObject({ temperature: z.number().int().min(5).max(25) });
// Keep the requested number intact for server-side validation and clarification.
function numericParameters(schema: typeof speedSchema | typeof temperatureSchema, field: string) {
  const parameters = z.toJSONSchema(selector.extend(schema.shape));
  parameters.properties = { ...parameters.properties, [field]: { type: 'number' } };
  return parameters;
}
export const balluAsp100: DeviceModel = {
  code: 'ballu-oneair-asp-100',
  transport: 'syncleo',
  registrationType: 'hommynShareUrl',
  catalogue: { co2Sensor: false },
  commands: [
    ...basicCommands(balluState, describeBalluState),
    command({
      name: 'set_ballu_mode',
      operation: 'mode',
      schema: z.strictObject({ mode: z.enum(balluModes) }),
      description:
        'Только Ballu ASP-100: выбрать режим manual (ручной), night (ночной), turbo (15 минут, затем прежний режим), eco (пассивное проветривание без вентилятора и нагрева). Это включает прибор. Датчиков CO2 у этих Ballu нет, авторежим недоступен. Eco не заменяет отключение только подогрева.',
      unavailableReply,
      confirm: (state, args) => state.mode === args.mode && state.power,
      describe: (_state, args) =>
        `режим ${modeNames[args.mode]}${args.mode === 'turbo' ? ' на 15 минут' : ''}.`,
    }),
    command({
      name: 'set_ballu_speed',
      operation: 'speed',
      schema: speedSchema,
      description:
        'Только Ballu ASP-100: установить скорость 1–7. Включает ручной режим и выходит из ночного/турбо. Не использовать для отдельной настройки скорости ночного режима.',
      unavailableReply,
      parameters: numericParameters(speedSchema, 'speed'),
      invalidReply: (error) =>
        error.issues.some((issue) => issue.path[0] === 'speed')
          ? 'Скорость должна быть целым числом от 1 до 7. Какую скорость установить?'
          : invalidCommandReply,
      confirm: (state, args) =>
        state.speed === args.speed && state.mode === 'manual' && state.power,
      describe: (_state, args) => `скорость ${args.speed}, ручной режим.`,
    }),
    command({
      name: 'set_ballu_temperature',
      operation: 'targetTemperature',
      schema: temperatureSchema,
      description:
        'Только Ballu ASP-100: задать температуру подогрева ПРИТОЧНОГО воздуха, 5–25 градусов, целое число. Это не температура комнаты и не команда включить/выключить нагреватель. Требуется установленный нагреватель.',
      unavailableReply,
      parameters: numericParameters(temperatureSchema, 'temperature'),
      invalidReply: (error) =>
        error.issues.some((issue) => issue.path[0] === 'temperature')
          ? 'Температура приточного воздуха должна быть целым числом от 5 до 25 градусов. Какую температуру задать?'
          : invalidCommandReply,
      confirm: (state, args) =>
        state.targetTemperature === args.temperature && state.heaterInstalled === true,
      describe: (_state, args) =>
        `задана температура приточного воздуха ${args.temperature} градусов.`,
    }),
    command({
      name: 'set_ballu_button_sound',
      operation: 'buttonSound',
      schema: z.strictObject({ enabled: z.boolean() }),
      description:
        'Только Ballu ASP-100: включить или выключить звуки нажатия кнопок. Не относится к фоновым мелодиям.',
      unavailableReply,
      confirm: (state, args) => state.buttonSound === args.enabled,
      describe: (_state, args) => `звуки кнопок ${args.enabled ? 'включены' : 'выключены'}.`,
    }),
    command({
      name: 'set_ballu_backlight_auto_off',
      operation: 'backlightAutoOff',
      schema: z.strictObject({ enabled: z.boolean() }),
      description:
        'Только Ballu ASP-100: включить/выключить АВТОМАТИЧЕСКОЕ гашение подсветки. enabled=true — гасить автоматически, false — не гасить. Это не непосредственное включение/выключение подсветки.',
      unavailableReply,
      confirm: (state, args) => state.backlightAutoOff === args.enabled,
      describe: (_state, args) =>
        `автоматическое гашение подсветки ${args.enabled ? 'включено' : 'выключено'}.`,
    }),
    command({
      name: 'set_ballu_sound',
      operation: 'sound',
      schema: z.strictObject({ sound: z.enum(balluSounds) }),
      description:
        'Только Ballu ASP-100: фоновый звук off (выключить), rain (дождь), sea (море), forest (лес), birds (птицы), fireplace (камин).',
      unavailableReply,
      confirm: (state, args) => state.sound === args.sound,
      describe: (_state, args) =>
        args.sound === 'off'
          ? 'фоновый звук выключен.'
          : `фоновый звук — ${soundNames[args.sound]}.`,
    }),
    command({
      name: 'reset_ballu_filter',
      operation: 'resetFilter',
      schema: z.strictObject({}),
      description:
        'Только Ballu ASP-100: сбросить счётчик ОСНОВНОГО фильтра по явной просьбе после обслуживания/замены. Не вызывай при вопросе о фильтре. Не относится к префильтру.',
      unavailableReply,
      confirm: (state) => state.filterCounter === 0,
      describe: () => 'счётчик основного фильтра сброшен.',
    }),
  ],
};
