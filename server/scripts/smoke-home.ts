// Exercises the real Ollama model against an isolated DB and a simulated device driver.
// No physical appliance is read or changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deviceId, userId } from '../src/config/identity.js';
import { llmConfig } from '../src/config/llm.js';
import { createAssistant } from '../src/services/assistant/reply.js';
import { createOllama } from '../src/services/llm/ollama.js';
import { type DeviceCommand, DeviceCommandError } from '../src/services/smartHome/driver.js';
import { createHomeTools } from '../src/services/smartHome/tools.js';
import { createTestDatabase } from '../test/database.js';

const database = await createTestDatabase();
const db = database.db;
const safetyOnly = process.argv.includes('--safety-only');
const balluOnly = process.argv.includes('--ballu-only') || safetyOnly;
const basicOnly = process.argv.includes('--basic-only');
try {
  const types = await db.homeDeviceType.findMany();
  const home = await db.home.create({ data: { displayName: 'Квартирка' } });
  for (const [roomName, models] of [
    ['Родительская', ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']],
    ['Спальня Артема', ['ballu-oneair-asp-100']],
  ] as const) {
    const room = await db.room.create({ data: { homeId: home.id, displayName: roomName } });
    for (const code of models) {
      const type = types.find((item) => item.code === code);
      assert.ok(type, `Missing device type: ${code}`);
      await db.homeDevice.create({
        data: {
          roomId: room.id,
          typeId: type.id,
          displayName: code.includes('humidifier') ? 'Увлажнитель' : 'Бризер',
          registrationData: code.startsWith('ballu')
            ? { shareUrl: 'rusklimat://device-share/rusclimate/69/aabbcc?token=test' }
            : { ip: '192.168.1.2', token: 'a'.repeat(32) },
        },
      });
    }
  }
  const calls: DeviceCommand[] = [];
  let failHumidifier = false;
  const assistant = createAssistant(
    db,
    createOllama({ ...llmConfig, signal: new AbortController().signal }),
    createHomeTools(db, async (command) => {
      calls.push(command);
      if (failHumidifier && command.model === 'xiaomi-smart-humidifier-2')
        throw new DeviceCommandError('device_unreachable');
      return {
        power: command.parameters.power ?? true,
        humidity: 45,
        ...(command.model === 'ballu-oneair-asp-100'
          ? {
              mode: command.parameters.mode ?? 'manual',
              speed: command.parameters.speed ?? 1,
              heaterInstalled: true,
              co2SensorInstalled: false,
              targetTemperature: command.parameters.temperature ?? 25,
              buttonSound: command.operation === 'buttonSound' ? command.parameters.enabled : true,
              backlightAutoOff:
                command.operation === 'backlightAutoOff' ? command.parameters.enabled : false,
              sound: command.parameters.sound ?? 'off',
              filterCounter: command.operation === 'resetFilter' ? 0 : 17,
            }
          : {}),
      };
    }),
  );
  const cases: Array<[string, string | undefined, boolean | undefined]> = [
    ['Включи бризер в родительской', 'smartmi-fresh-air', true],
    ['Выключи бризер в спальне Артёма', 'ballu-oneair-asp-100', false],
    ['Какое состояние увлажнителя в родительской?', 'xiaomi-smart-humidifier-2', undefined],
    ['Включи бризер', undefined, undefined],
    ['Не включай увлажнитель', undefined, undefined],
    ['Поставь скорость бризера в родительской на три', undefined, undefined],
  ];
  for (const [transcript, model, power] of balluOnly ? [] : cases) {
    calls.length = 0;
    const row = await db.interaction.create({
      data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
    });
    const started = performance.now();
    const reply = await assistant(row.id, transcript);
    console.log(
      JSON.stringify({
        transcript,
        reply,
        ms: Math.round(performance.now() - started),
        calls: calls.map((c) => ({
          model: c.model,
          operation: c.operation,
          power: c.parameters.power,
        })),
      }),
    );
    assert.equal(calls.length, model ? 1 : 0);
    if (model) {
      assert.equal(calls[0].model, model);
      assert.equal(calls[0].parameters.power, power);
    }
  }
  if (!balluOnly) {
    for (const [transcript, operation, power] of [
      ['Включи бризер и увлажнитель в родительской', 'power', true],
      ['Выключи бризер и увлажнитель в родительской', 'power', false],
      ['Проверь состояние бризера и увлажнителя в родительской', 'state', undefined],
    ] as const) {
      calls.length = 0;
      const row = await db.interaction.create({
        data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
      });
      const reply = await assistant(row.id, transcript);
      console.log(
        JSON.stringify({
          transcript,
          reply,
          calls: calls.map((c) => ({
            model: c.model,
            operation: c.operation,
            power: c.parameters.power,
          })),
        }),
      );
      assert.deepEqual(calls.map((c) => c.model).sort(), [
        'smartmi-fresh-air',
        'xiaomi-smart-humidifier-2',
      ]);
      assert.ok(calls.every((c) => c.operation === operation && c.parameters.power === power));
    }
    failHumidifier = true;
    calls.length = 0;
    const partial = await db.interaction.create({
      data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
    });
    const partialReply = await assistant(partial.id, 'Включи бризер и увлажнитель в родительской');
    console.log(JSON.stringify({ partialReply }));
    assert.equal(calls.length, 2);
    assert.match(partialReply, /Бризер.*включён/);
    assert.match(partialReply, /Увлажнитель.*Не удалось получить ответ от прибора/);
    failHumidifier = false;
  }
  const balluCases: Array<[string, DeviceCommand['operation'], string, unknown]> = [
    ['Включи ночной режим бризера в спальне Артёма', 'mode', 'mode', 'night'],
    ['Включи турбо на бризере в спальне Артёма', 'mode', 'mode', 'turbo'],
    ['Переключи бризер в спальне Артёма в ручной режим', 'mode', 'mode', 'manual'],
    ['Включи экопроветривание на бризере в спальне Артёма', 'mode', 'mode', 'eco'],
    ['Поставь третью скорость бризера в спальне Артёма', 'speed', 'speed', 3],
    [
      'Поставь температуру подогрева бризера в спальне Артёма на 22 градуса',
      'targetTemperature',
      'temperature',
      22,
    ],
    ['Отключи звуки кнопок бризера в спальне Артёма', 'buttonSound', 'enabled', false],
    [
      'Включи автоматическое гашение подсветки бризера в спальне Артёма',
      'backlightAutoOff',
      'enabled',
      true,
    ],
    ['Включи звук дождя на бризере в спальне Артёма', 'sound', 'sound', 'rain'],
    ['Выключи фоновую мелодию на бризере в спальне Артёма', 'sound', 'sound', 'off'],
    [
      'Я заменил основной фильтр бризера в спальне Артёма. Сбрось его счётчик',
      'resetFilter',
      'operation',
      'resetFilter',
    ],
  ];
  for (const [transcript, operation, field, expected] of basicOnly || safetyOnly
    ? []
    : balluCases) {
    calls.length = 0;
    const row = await db.interaction.create({
      data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
    });
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ transcript, reply, operations: calls.map((c) => c.operation) }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'ballu-oneair-asp-100');
    assert.equal(calls[0].operation, operation);
    assert.equal(field === 'operation' ? calls[0].operation : calls[0].parameters[field], expected);
  }
  for (const transcript of basicOnly
    ? []
    : [
        'Включи автоматический режим по CO2 на бризере в спальне Артёма',
        'Установи температуру бризера в спальне Артёма на 30 градусов',
        'Выключи только подогрев бризера в спальне Артёма, вентиляцию оставь',
        'Поставь вторую скорость ночного режима бризера в спальне Артёма',
      ]) {
    calls.length = 0;
    const row = await db.interaction.create({
      data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
    });
    const reply = await assistant(row.id, transcript);
    console.log(
      JSON.stringify({ unsupported: transcript, reply, operations: calls.map((c) => c.operation) }),
    );
    assert.equal(
      calls.length,
      0,
      'Unsupported request must not be replaced with a different setting',
    );
  }
  for (const transcript of [
    'Поздоровайся со мной одним предложением.',
    'Please answer in English: say hello in one short sentence.',
  ]) {
    calls.length = 0;
    const row = await db.interaction.create({
      data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
    });
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ languageCheck: transcript, reply }));
    assert.equal(calls.length, 0);
    assert.match(
      reply,
      /[А-Яа-яЁё]/,
      'Spoken replies must stay Russian even when the user requests English',
    );
    assert.doesNotMatch(reply, /\b(hello|good morning)\b/i);
  }
  calls.length = 0;
  const question = await db.interaction.create({
    data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
  });
  const questionReply = await assistant(question.id, 'Включи бризер');
  console.log(
    JSON.stringify({
      questionReply,
      calls: calls.map((c) => ({
        model: c.model,
        operation: c.operation,
        power: c.parameters.power,
      })),
    }),
  );
  assert.equal(calls.length, 0);
  assert.match(
    questionReply,
    /комнат|Уточните/,
    'Ambiguous target needs a useful clarification, not an echoed request',
  );
  await db.interaction.update({
    where: { id: question.id },
    data: { status: 'complete', transcript: 'Включи бризер', responseText: questionReply },
  });
  const clarification = await db.interaction.create({
    data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
  });
  const answer = await assistant(clarification.id, 'В спальне Артёма');
  console.log(
    JSON.stringify({
      clarification: answer,
      calls: calls.map((c) => ({ model: c.model, power: c.parameters.power })),
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'ballu-oneair-asp-100');
  assert.equal(calls[0].parameters.power, true);
} finally {
  await database.close();
}
