import type { z } from 'zod';
import { balluAsp100, DeviceModelCode } from '../../../smart-home';

const MODE_NAMES = {
  off: 'выключен',
  manual: 'ручной',
  auto: 'автоматический',
  night: 'ночной',
  turbo: 'турбо',
  eco: 'экопроветривание',
};
const SOUND_NAMES = {
  off: 'выключен',
  rain: 'дождь',
  sea: 'море',
  forest: 'лес',
  birds: 'птицы',
  fireplace: 'камин',
};

export const BALLU_ASP100 = {
  code: DeviceModelCode.BalluAsp100,
  tools: [
    {
      name: 'ballu_get_state',
      description:
        'Прочитать состояние Ballu ASP-100. В этих приборах нет датчиков CO2. Только для вопросов о состоянии, не вместо настройки.',
      schema: balluAsp100.GET_STATE_SCHEMA,
      run: balluAsp100.getState,
      describe: describeState,
    },
    {
      name: 'ballu_set_power',
      description:
        'Включить или выключить Ballu ASP-100 по явной просьбе. Не использовать для отдельного управления нагревателем.',
      schema: balluAsp100.SET_POWER_SCHEMA,
      run: balluAsp100.setPower,
      describe: (state: balluAsp100.BalluState) => (state.power ? 'включён.' : 'выключен.'),
    },
    {
      name: 'ballu_set_mode',
      description:
        'Выбрать режим Ballu ASP-100: manual — ручной, night — ночной, turbo — 15 минут, затем прежний режим, eco — пассивное проветривание без вентилятора и нагрева. Включает прибор. Датчиков CO2 нет, авторежим недоступен. Eco не заменяет отключение только подогрева.',
      schema: balluAsp100.SET_MODE_SCHEMA,
      run: balluAsp100.setMode,
      describe: (
        _state: balluAsp100.BalluState,
        args: z.infer<typeof balluAsp100.SET_MODE_SCHEMA>,
      ) => `режим ${MODE_NAMES[args.mode]}${args.mode === 'turbo' ? ' на 15 минут' : ''}.`,
    },
    {
      name: 'ballu_set_speed',
      description:
        'Установить скорость Ballu ASP-100 от 1 до 7. Включает ручной режим и выходит из ночного/турбо. Не управляет отдельной скоростью ночного режима. При недопустимом числе уточни значение, не округляй и не ограничивай его.',
      schema: balluAsp100.SET_SPEED_SCHEMA,
      run: balluAsp100.setSpeed,
      describe: (state: balluAsp100.BalluState) => `скорость ${state.speed}, ручной режим.`,
      invalidReply: 'Скорость должна быть целым числом от 1 до 7. Какую скорость установить?',
    },
    {
      name: 'ballu_set_temperature',
      description:
        'Задать температуру подогрева ПРИТОЧНОГО воздуха Ballu ASP-100, целое число 5–25. Требуется нагреватель. Это не температура комнаты и не включение/выключение нагрева. При недопустимом числе уточни значение, не подменяй его допустимым.',
      schema: balluAsp100.SET_TEMPERATURE_SCHEMA,
      run: balluAsp100.setTemperature,
      describe: (state: balluAsp100.BalluState) =>
        `задана температура приточного воздуха ${state.targetTemperature} градусов.`,
      invalidReply:
        'Температура приточного воздуха должна быть целым числом от 5 до 25 градусов. Какую температуру задать?',
    },
    {
      name: 'ballu_set_button_sound',
      description:
        'Включить или выключить звуки кнопок Ballu ASP-100. Не относится к фоновым мелодиям.',
      schema: balluAsp100.SET_BUTTON_SOUND_SCHEMA,
      run: balluAsp100.setButtonSound,
      describe: (state: balluAsp100.BalluState) =>
        `звуки кнопок ${state.buttonSound ? 'включены' : 'выключены'}.`,
    },
    {
      name: 'ballu_set_backlight_auto_off',
      description:
        'Включить или выключить АВТОМАТИЧЕСКОЕ гашение подсветки Ballu ASP-100. Это не мгновенное включение/выключение света; при таком запросе уточни, подходит ли автогашение.',
      schema: balluAsp100.SET_BACKLIGHT_AUTO_OFF_SCHEMA,
      run: balluAsp100.setBacklightAutoOff,
      describe: (state: balluAsp100.BalluState) =>
        `автоматическое гашение подсветки ${state.backlightAutoOff ? 'включено' : 'выключено'}.`,
    },
    {
      name: 'ballu_set_sound',
      description:
        'Фоновый звук Ballu ASP-100: off — выключить, rain — дождь, sea — море, forest — лес, birds — птицы, fireplace — камин.',
      schema: balluAsp100.SET_SOUND_SCHEMA,
      run: balluAsp100.setSound,
      describe: (
        _state: balluAsp100.BalluState,
        args: z.infer<typeof balluAsp100.SET_SOUND_SCHEMA>,
      ) =>
        args.sound === 'off'
          ? 'фоновый звук выключен.'
          : `фоновый звук — ${SOUND_NAMES[args.sound]}.`,
    },
    {
      name: 'ballu_reset_filter',
      description:
        'Сбросить счётчик ОСНОВНОГО фильтра Ballu ASP-100 только по явной просьбе после обслуживания. Вопрос о ресурсе фильтра требует чтения состояния. Не сбрасывает префильтр.',
      schema: balluAsp100.RESET_FILTER_SCHEMA,
      run: balluAsp100.resetFilter,
      describe: () => 'счётчик основного фильтра сброшен.',
    },
  ],
} as const;

function describeState(state: balluAsp100.BalluState) {
  // Installed ASP-100 units have no CO2 sensor, including when capability data is absent.
  const parts = [
    state.power ? 'включён.' : 'выключен.',
    !state.mode || state.mode === 'off' ? undefined : `Режим ${MODE_NAMES[state.mode]}.`,
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
    state.sound === undefined ? undefined : `Фоновый звук: ${SOUND_NAMES[state.sound]}.`,
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined
      ? undefined
      : `Температура приточного воздуха ${state.temperature} градусов.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}
