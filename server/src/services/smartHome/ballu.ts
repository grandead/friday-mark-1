import { z } from 'zod';
import type { DeviceState, DeviceCommand } from './driver.js';

export const balluModes = ['manual', 'night', 'turbo', 'eco'] as const;
export const balluSounds = ['off', 'rain', 'sea', 'forest', 'birds', 'fireplace'] as const;
export const modeNames = { off: 'выключен', manual: 'ручной', auto: 'автоматический', night: 'ночной', turbo: 'турбо', eco: 'экопроветривание' };
export const soundNames = { off: 'выключен', rain: 'дождь', sea: 'море', forest: 'лес', birds: 'птицы', fireplace: 'камин' };

export const balluSettings = {
  set_ballu_mode: { operation: 'mode', schema: z.strictObject({ mode: z.enum(balluModes) }), description: 'Только Ballu ASP-100: выбрать режим manual (ручной), night (ночной), turbo (15 минут, затем прежний режим), eco (пассивное проветривание без вентилятора и нагрева). Это включает прибор. Датчиков CO2 у этих Ballu нет, авторежим недоступен. Eco не заменяет отключение только подогрева.' },
  set_ballu_speed: { operation: 'speed', schema: z.strictObject({ speed: z.number().int().min(1).max(7) }), description: 'Только Ballu ASP-100: установить скорость 1–7. Включает ручной режим и выходит из ночного/турбо. Не использовать для отдельной настройки скорости ночного режима.' },
  set_ballu_temperature: { operation: 'targetTemperature', schema: z.strictObject({ temperature: z.number().int().min(5).max(25) }), description: 'Только Ballu ASP-100: задать температуру подогрева ПРИТОЧНОГО воздуха, 5–25 градусов, целое число. Это не температура комнаты и не команда включить/выключить нагреватель. Требуется установленный нагреватель.' },
  set_ballu_button_sound: { operation: 'buttonSound', schema: z.strictObject({ enabled: z.boolean() }), description: 'Только Ballu ASP-100: включить или выключить звуки нажатия кнопок. Не относится к фоновым мелодиям.' },
  set_ballu_backlight_auto_off: { operation: 'backlightAutoOff', schema: z.strictObject({ enabled: z.boolean() }), description: 'Только Ballu ASP-100: включить/выключить АВТОМАТИЧЕСКОЕ гашение подсветки. enabled=true — гасить автоматически, false — не гасить. Это не непосредственное включение/выключение подсветки.' },
  set_ballu_sound: { operation: 'sound', schema: z.strictObject({ sound: z.enum(balluSounds) }), description: 'Только Ballu ASP-100: фоновый звук off (выключить), rain (дождь), sea (море), forest (лес), birds (птицы), fireplace (камин).' },
  reset_ballu_filter: { operation: 'resetFilter', schema: z.strictObject({}), description: 'Только Ballu ASP-100: сбросить счётчик ОСНОВНОГО фильтра по явной просьбе после обслуживания/замены. Не вызывай при вопросе о фильтре. Не относится к префильтру.' },
} as const;
export type BalluToolName = keyof typeof balluSettings;
export const isBalluTool = (name: string): name is BalluToolName => Object.hasOwn(balluSettings, name);

export function confirmBallu(command: DeviceCommand, state: DeviceState) {
  switch (command.operation) {
    case 'mode': return state.mode === command.mode && state.power;
    case 'speed': return state.speed === command.speed && state.mode === 'manual' && state.power;
    case 'targetTemperature': return state.targetTemperature === command.temperature && state.heaterInstalled === true;
    case 'buttonSound': return state.buttonSound === command.enabled;
    case 'backlightAutoOff': return state.backlightAutoOff === command.enabled;
    case 'sound': return state.sound === command.sound;
    case 'resetFilter': return state.filterCounter === 0;
    default: return false;
  }
}

export function describeBalluSetting(command: DeviceCommand): string {
  switch (command.operation) {
    case 'mode': return `режим ${modeNames[command.mode!]}${command.mode === 'turbo' ? ' на 15 минут' : ''}.`;
    case 'speed': return `скорость ${command.speed}, ручной режим.`;
    case 'targetTemperature': return `задана температура приточного воздуха ${command.temperature} градусов.`;
    case 'buttonSound': return `звуки кнопок ${command.enabled ? 'включены' : 'выключены'}.`;
    case 'backlightAutoOff': return `автоматическое гашение подсветки ${command.enabled ? 'включено' : 'выключено'}.`;
    case 'sound': return command.sound === 'off' ? 'фоновый звук выключен.' : `фоновый звук — ${soundNames[command.sound!]}.`;
    case 'resetFilter': return 'счётчик основного фильтра сброшен.';
    default: throw new Error('Unknown Ballu setting');
  }
}
