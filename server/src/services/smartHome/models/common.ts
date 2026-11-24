import { z } from 'zod';
import { commandsFor } from '../model.js';

export const powerDescription = (state: { power: boolean }) =>
  `${state.power ? 'включён' : 'выключен'}.`;
export const humidity = z.number().min(0).max(100).optional();
export const temperature = z.number().min(-60).max(100).optional();
export const joinDescription = (parts: (string | undefined)[]) =>
  parts.filter((part) => part !== undefined).join(' ');

const selectorProperties = {
  device: {
    type: 'string',
    description: 'Точное название устройства из каталога, например Бризер.',
  },
  room: {
    type: 'string',
    description:
      'Точное название комнаты из каталога, если пользователь её указал. Иначе пропусти параметр: сервер уточнит неоднозначный выбор.',
  },
  home: {
    type: 'string',
    description:
      'Точное название дома из каталога, если пользователь его указал. Иначе пропусти параметр.',
  },
};
export function basicCommands<
  S extends { power: boolean } & Record<string, string | number | boolean | undefined>,
>(schema: z.ZodType<S>, describeState: (state: S) => string) {
  const command = commandsFor(schema);
  return [
    command({
      name: 'get_device_state',
      operation: 'state',
      schema: z.strictObject({}),
      description:
        'Прочитать текущее состояние одного прибора по запросу пользователя о состоянии. Не использовать вместо команды настройки или при недоступной функции. Если устройство не определено однозначно, сервер вернёт уточняющий вопрос.',
      parameters: {
        type: 'object',
        properties: selectorProperties,
        required: ['device'],
        additionalProperties: false,
      },
      describe: describeState,
    }),
    command({
      name: 'set_device_power',
      operation: 'power',
      schema: z.strictObject({ power: z.boolean() }),
      description:
        'Включить или выключить один прибор только по просьбе пользователя. Не используй для вопросов о возможности действия, цитат, отрицаний или изменения скорости/влажности.',
      parameters: {
        type: 'object',
        properties: {
          ...selectorProperties,
          power: { type: 'boolean', description: 'true — включить, false — выключить' },
        },
        required: ['device', 'power'],
        additionalProperties: false,
      },
      confirm: (state, args) => state.power === args.power,
      describe: powerDescription,
    }),
  ];
}
