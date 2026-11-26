// Exercises the real Ollama model against an isolated DB and a simulated device driver.
// No physical appliance is read or changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { generateResponse } from '../src/services/llm/generate-response';
import {
  type DeviceCommand,
  DeviceCommandError,
} from '../src/services/llm-tools/smart-home/driver';
import { createAssistant } from '../test/assistant';
import { createTestDatabase } from '../test/database';
import { createHomeTools } from '../test/home-tools';

const database = await createTestDatabase();
const db = database.db;
const safetyOnly = process.argv.includes('--safety-only');
const balluOnly = process.argv.includes('--ballu-only') || safetyOnly;
const basicOnly = process.argv.includes('--basic-only');
try {
  const types = await db.orm.public.HomeDeviceType.select('id', 'code').all();
  const home = await db.orm.public.Home.select('id').create({ displayName: 'Квартирка' });
  for (const [roomName, models] of [
    ['Родительская', ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']],
    ['Спальня Артема', ['ballu-oneair-asp-100']],
  ] as const) {
    const room = await db.orm.public.Room.select('id').create({
      homeId: home.id,
      displayName: roomName,
    });
    for (const code of models) {
      const type = types.find((item) => item.code === code);
      assert.ok(type, `Missing device type: ${code}`);
      const displayName = code.includes('humidifier') ? 'Увлажнитель' : 'Бризер';
      const registrationData: Record<string, string> = code.startsWith('ballu')
        ? {
            shareUrl:
              'rusklimat://device-share/rusclimate/69/aabbccddeeff?token=0123456789abcdef0123456789abcdef',
          }
        : { ip: '192.168.1.2', token: 'a'.repeat(32) };
      await db.orm.public.HomeDevice.select('id').create({
        roomId: room.id,
        typeId: type.id,
        displayName,
        registrationData,
      });
    }
  }
  const calls: DeviceCommand[] = [];
  let failHumidifier = false;
  const homeTools = createHomeTools(db, async (command) => {
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
  });
  const assistant = createAssistant(db, generateResponse, homeTools);
  const cases: Array<[string, string | undefined, boolean | undefined]> = [
    ['Включи бризер в родительской', 'smartmi-fresh-air', true],
    ['Выключи бризер в спальне Артёма', 'ballu-oneair-asp-100', false],
    ['Какое состояние увлажнителя в родительской?', 'xiaomi-smart-humidifier-2', undefined],
    ['Включи бризер', undefined, undefined],
    ['Не включай увлажнитель', undefined, undefined],
    ['Установи целевую температуру бризера в родительской на 23 градуса', undefined, undefined],
  ];
  for (const [transcript, model, power] of balluOnly ? [] : cases) {
    calls.length = 0;
    const row = await createInteraction();
    const started = performance.now();
    const reply = await assistant(row.id, transcript);
    const elapsed = performance.now() - started;
    const ms = Math.round(elapsed);
    const commands = calls.map(describeCall);
    printResult({
      transcript,
      reply,
      ms,
      calls: commands,
    });
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
      const row = await createInteraction();
      const reply = await assistant(row.id, transcript);
      const commands = calls.map(describeCall);
      printResult({
        transcript,
        reply,
        calls: commands,
      });
      const models = calls.map((c) => c.model).sort();
      assert.deepEqual(models, ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']);
      const matched = calls.every((c) => c.operation === operation && c.parameters.power === power);
      assert.ok(matched);
    }
    failHumidifier = true;
    calls.length = 0;
    const partial = await createInteraction();
    const partialReply = await assistant(partial.id, 'Включи бризер и увлажнитель в родительской');
    printResult({ partialReply });
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
    const row = await createInteraction();
    const reply = await assistant(row.id, transcript);
    const operations = calls.map((c) => c.operation);
    printResult({ transcript, reply, operations });
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
    const row = await createInteraction();
    const reply = await assistant(row.id, transcript);
    const operations = calls.map((c) => c.operation);
    printResult({ unsupported: transcript, reply, operations });
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
    const row = await createInteraction();
    const reply = await assistant(row.id, transcript);
    printResult({ languageCheck: transcript, reply });
    assert.equal(calls.length, 0);
    assert.match(
      reply,
      /[А-Яа-яЁё]/,
      'Spoken replies must stay Russian even when the user requests English',
    );
    assert.doesNotMatch(reply, /\b(hello|good morning)\b/i);
  }
  calls.length = 0;
  const question = await createInteraction();
  const questionReply = await assistant(question.id, 'Включи бризер');
  const questionCalls = calls.map(describeCall);
  printResult({
    questionReply,
    calls: questionCalls,
  });
  assert.equal(calls.length, 0);
  assert.match(
    questionReply,
    /комнат|Уточните/,
    'Ambiguous target needs a useful clarification, not an echoed request',
  );
  await db.orm.public.Interaction.select('id').where({ id: question.id }).update({
    status: 'complete',
    transcript: 'Включи бризер',
    responseText: questionReply,
  });
  const clarification = await createInteraction();
  const answer = await assistant(clarification.id, 'В спальне Артёма');
  const answerCalls = calls.map(describeCall);
  printResult({
    clarification: answer,
    calls: answerCalls,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'ballu-oneair-asp-100');
  assert.equal(calls[0].parameters.power, true);
} finally {
  await database.close();
}

function createInteraction() {
  const key = randomUUID();
  return db.orm.public.Interaction.select('id').create({
    deviceId,
    userId,
    status: 'processing',
    inputAudioKey: `${key}.wav`,
  });
}
function printResult(value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  console.log(json);
}
function describeCall(command: DeviceCommand) {
  return { model: command.model, operation: command.operation, power: command.parameters.power };
}
