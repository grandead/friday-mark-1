import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ToolCall, ToolDefinition } from '../llm/types.js';
import { deviceState, DeviceCommandError, type DeviceCommand, type DeviceDriver } from './driver.js';
import { parseDeviceRegistration } from '../validation/homeDevice.js';
import { balluSettings, isBalluTool, confirmBallu, describeBalluSetting, modeNames, soundNames } from './ballu.js';
import { diagnosticError } from '../../../shared/errors.js';
import { userErrors } from '../../../shared/userErrors.ru.js';

const selector = z.strictObject({ device: z.string().trim().min(1).max(120), room: z.string().trim().min(1).max(120).optional(), home: z.string().trim().min(1).max(120).optional() });
const powerInput = selector.extend({ power: z.boolean() });
const supported = new Set(['xiaomi-smart-humidifier-2', 'smartmi-fresh-air', 'ballu-oneair-asp-100']);
const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim().replace(/\s+/gu, ' ');
const properties = {
  device: { type: 'string', description: 'Точное название устройства из каталога, например Бризер.' },
  room: { type: 'string', description: 'Точное название комнаты из каталога, если пользователь её указал. Иначе пропусти параметр: сервер уточнит неоднозначный выбор.' },
  home: { type: 'string', description: 'Точное название дома из каталога, если пользователь его указал. Иначе пропусти параметр.' },
};
export const homeToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'get_device_state', description: 'Прочитать текущее состояние одного прибора по запросу пользователя о состоянии. Не использовать вместо команды настройки или при недоступной функции. Если устройство не определено однозначно, сервер вернёт уточняющий вопрос.', parameters: { type: 'object', properties, required: ['device'], additionalProperties: false } } },
  { type: 'function', function: { name: 'set_device_power', description: 'Включить или выключить один прибор только по просьбе пользователя. Не используй для вопросов о возможности действия, цитат, отрицаний или изменения скорости/влажности.', parameters: { type: 'object', properties: { ...properties, power: { type: 'boolean', description: 'true — включить, false — выключить' } }, required: ['device', 'power'], additionalProperties: false } } },
];
for (const [name, setting] of Object.entries(balluSettings)) {
  // Let the model pass the requested number unchanged. Execution validates bounds
  // and returns a precise clarification instead of relying on model-side clamping.
  const parameters = z.toJSONSchema(selector.extend(setting.schema.shape));
  if (name === 'set_ballu_temperature') parameters.properties!.temperature = { type: 'number' };
  if (name === 'set_ballu_speed') parameters.properties!.speed = { type: 'number' };
  homeToolDefinitions.push({ type: 'function', function: {
    name, description: setting.description,
    parameters,
  } });
}
export type HomeTools = ReturnType<typeof createHomeTools>;

export function createHomeTools(db: PrismaClient, driver: DeviceDriver) {
  return {
    definitions: homeToolDefinitions,
    async catalogue() {
      const devices = await db.homeDevice.findMany({ select: { displayName: true, type: { select: { code: true, displayName: true } }, room: { select: { displayName: true, home: { select: { displayName: true } } } } } });
      return devices.map(device => ({ device: device.displayName, room: device.room.displayName, home: device.room.home.displayName, model: device.type.displayName, commands: supported.has(device.type.code) ? ['get_device_state', 'set_device_power', ...(device.type.code === 'ballu-oneair-asp-100' ? Object.keys(balluSettings) : [])] : [], ...(device.type.code === 'ballu-oneair-asp-100' ? { co2Sensor: false } : {}) }));
    },
    async execute(interactionId: string, sequence: number, call: ToolCall): Promise<string> {
      const name = call.function.name;
      const isPower = name === 'set_device_power';
      const setting = isBalluTool(name) ? balluSettings[name] : undefined;
      if (!setting && !isPower && name !== 'get_device_state') return 'Эта команда пока не поддерживается.';
      const schema = setting ? selector.extend(setting.schema.shape) : isPower ? powerInput : selector;
      const parsed = schema.safeParse(call.function.arguments);
      if (!parsed.success) {
        if (name === 'set_ballu_temperature' && parsed.error.issues.some(issue => issue.path[0] === 'temperature')) return 'Температура приточного воздуха должна быть целым числом от 5 до 25 градусов. Какую температуру задать?';
        if (name === 'set_ballu_speed' && parsed.error.issues.some(issue => issue.path[0] === 'speed')) return 'Скорость должна быть целым числом от 1 до 7. Какую скорость установить?';
        return 'Не удалось разобрать команду. Укажите устройство, комнату и нужное действие.';
      }
      const input = parsed.data;
      const action = await db.interactionAction.create({ data: { interactionId, sequence, initiator: 'llm', service: 'smartHome', operation: call.function.name, arguments: input } });
      async function finish(reply: string) {
        await db.interactionAction.update({ where: { id: action.id }, data: { result: { reply, executed: false } } });
        return reply;
      }
      // Match metadata first; load credentials only for the single resolved device.
      const devices = await db.homeDevice.findMany({ select: { id: true, displayName: true, type: { select: { code: true, registrationType: true } }, room: { select: { displayName: true, home: { select: { displayName: true } } } } } });
      const matches = devices.filter(device => normalize(device.displayName) === normalize(input.device)
        && (!input.room || normalize(device.room.displayName) === normalize(input.room))
        && (!input.home || normalize(device.room.home.displayName) === normalize(input.home)));
      if (!matches.length) return finish('Не нашла такое устройство. Назовите его и комнату так, как они записаны в умном доме.');
      if (matches.length > 1) return finish(`Уточните, какое устройство: ${matches.map(device => `${device.displayName}, ${device.room.displayName}, ${device.room.home.displayName}`).join('; ')}?`);
      const device = matches[0];
      if (!supported.has(device.type.code)) return finish('Управление этой моделью пока не подключено.');
      if (setting && device.type.code !== 'ballu-oneair-asp-100') return finish('Эта настройка подключена только для Ballu ASP-100. Для выбранной модели она пока недоступна.');
      try {
        const record = await db.homeDevice.findUniqueOrThrow({ where: { id: device.id }, select: { registrationData: true } });
        const power = 'power' in input && typeof input.power === 'boolean' ? input.power : undefined;
        const parameters = setting ? setting.schema.parse(Object.fromEntries(Object.entries(input).filter(([key]) => !['device', 'room', 'home'].includes(key)))) : isPower ? { power } : {};
        const command: DeviceCommand = { model: device.type.code, registrationData: parseDeviceRegistration(device.type.registrationType, record.registrationData), operation: setting?.operation ?? (isPower ? 'power' : 'state'), ...parameters };
        const state = deviceState.parse(await driver(command));
        if (isPower && state.power !== power) throw new DeviceCommandError('not_confirmed');
        if (setting && !confirmBallu(command, state)) throw new DeviceCommandError('not_confirmed');
        const location = `«${device.displayName}», комната «${device.room.displayName}»`;
        let reply = `${location}: ${setting ? describeBalluSetting(command) : `${state.power ? 'включён' : 'выключен'}.`}`;
        if (!isPower && !setting) {
          if (state.mode && state.mode !== 'off') reply += ` Режим ${modeNames[state.mode]}.`;
          if (state.speed !== undefined) reply += ` Скорость ${state.speed}.`;
          if (state.targetTemperature !== undefined) reply += ` Задано ${state.targetTemperature} градусов для приточного воздуха.`;
          if (state.turboSeconds !== undefined && state.mode === 'turbo') reply += ` До конца турборежима ${state.turboSeconds} секунд.`;
          if (state.filterCounter !== undefined) reply += ` Показатель счётчика фильтра ${state.filterCounter}.`;
          if (state.errorCode !== undefined) reply += state.errorCode === 0 ? ' Ошибок нет.' : ` Код ошибки ${state.errorCode}.`;
          if (state.buttonSound !== undefined) reply += ` Звуки кнопок ${state.buttonSound ? 'включены' : 'выключены'}.`;
          if (state.backlightAutoOff !== undefined) reply += ` Автогашение подсветки ${state.backlightAutoOff ? 'включено' : 'выключено'}.`;
          if (state.sound !== undefined) reply += ` Фоновый звук: ${soundNames[state.sound]}.`;
          if (state.humidity !== undefined) reply += ` Влажность ${state.humidity} процентов.`;
          if (state.temperature !== undefined) reply += ` Температура ${device.type.code === 'ballu-oneair-asp-100' ? 'приточного воздуха ' : ''}${state.temperature} градусов.`;
          if (state.co2 !== undefined && device.type.code !== 'ballu-oneair-asp-100' && state.co2SensorInstalled !== false) reply += ` CO2 ${state.co2} ppm.`;
          if (state.pm25 !== undefined) reply += ` PM2.5 ${state.pm25} микрограммов на кубометр.`;
        }
        await db.interactionAction.update({ where: { id: action.id }, data: { result: { deviceId: device.id, state, reply, executed: true } } });
        return reply;
      } catch (cause) {
        // Third-party errors can include credentials; never persist or speak them.
        const error = cause instanceof DeviceCommandError ? cause : new DeviceCommandError('device_unreachable');
        const reply = cause instanceof DeviceCommandError ? `«${device.displayName}», комната «${device.room.displayName}»: ${userErrors[error.code]}` : `Не удалось получить подтверждение от устройства «${device.displayName}» в комнате «${device.room.displayName}». Проверьте питание, сеть и данные подключения.`;
        await db.interactionAction.update({ where: { id: action.id }, data: {
          error: diagnosticError(error), result: { deviceId: device.id, errorCode: error.code, reply, confirmed: false },
        } });
        return reply;
      }
    },
  };
}
