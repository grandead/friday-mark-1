// Exercises the real Ollama model against an isolated DB and a simulated device driver.
// No physical appliance is read or changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '../test/database.js';
import { createAssistant } from '../src/services/assistant/reply.js';
import { createHomeTools } from '../src/services/smartHome/tools.js';
import { createOllama } from '../src/services/llm/ollama.js';
import { llmConfig } from '../src/config/llm.js';
import { userId, deviceId } from '../src/config/identity.js';
import type { DeviceCommand } from '../src/services/smartHome/driver.js';

const database = await createTestDatabase();
const db = database.db;
const balluOnly = process.argv.includes('--ballu-only');
const basicOnly = process.argv.includes('--basic-only');
try {
  const types = await db.homeDeviceType.findMany();
  const home = await db.home.create({ data: { displayName: 'Квартирка' } });
  for (const [roomName, models] of [['Родительская', ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']], ['Спальня Артема', ['ballu-oneair-asp-100']]] as const) {
    const room = await db.room.create({ data: { homeId: home.id, displayName: roomName } });
    for (const code of models) await db.homeDevice.create({ data: { roomId: room.id, typeId: types.find(t => t.code === code)!.id, displayName: code.includes('humidifier') ? 'Увлажнитель' : 'Бризер', registrationData: code.startsWith('ballu') ? { shareUrl: 'rusklimat://device-share/rusclimate/69/aabbcc?token=test' } : { ip: '192.168.1.2', token: 'a'.repeat(32) } } });
  }
  const calls: DeviceCommand[] = [];
  let failHumidifier = false;
  const assistant = createAssistant(db, createOllama({ ...llmConfig, signal: new AbortController().signal }), createHomeTools(db, async command => {
    calls.push(command);
    if (failHumidifier && command.model === 'xiaomi-smart-humidifier-2') throw new Error('Simulated offline device');
    return { power: command.power ?? true, humidity: 45, ...(command.model === 'ballu-oneair-asp-100' ? {
      mode: command.mode ?? 'manual', speed: command.speed ?? 1, heaterInstalled: true, co2SensorInstalled: false,
      targetTemperature: command.temperature ?? 25, buttonSound: command.operation === 'buttonSound' ? command.enabled : true,
      backlightAutoOff: command.operation === 'backlightAutoOff' ? command.enabled : false,
      sound: command.sound ?? 'off', filterCounter: command.operation === 'resetFilter' ? 0 : 17,
    } : {}) };
  }));
  const cases: Array<[string, string | undefined, boolean | undefined]> = [
    ['Включи бризер в родительской', 'smartmi-fresh-air', true],
    ['Выключи бризер в спальне Артёма', 'ballu-oneair-asp-100', false],
    ['Какое состояние увлажнителя в родительской?', 'xiaomi-smart-humidifier-2', undefined],
    ['Включи бризер', undefined, undefined],
    ['Не включай увлажнитель', undefined, undefined],
    ['Поставь скорость бризера в родительской на три', undefined, undefined],
  ];
  for (const [transcript, model, power] of (balluOnly ? [] : cases)) {
    calls.length = 0;
    const row = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
    const started = performance.now();
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ transcript, reply, ms: Math.round(performance.now() - started), calls: calls.map(c => ({ model: c.model, operation: c.operation, power: c.power })) }));
    assert.equal(calls.length, model ? 1 : 0);
    if (model) { assert.equal(calls[0].model, model); assert.equal(calls[0].power, power); }
  }
  if (!balluOnly) {
  for (const [transcript, operation, power] of [
    ['Включи бризер и увлажнитель в родительской', 'power', true],
    ['Выключи бризер и увлажнитель в родительской', 'power', false],
    ['Проверь состояние бризера и увлажнителя в родительской', 'state', undefined],
  ] as const) {
    calls.length = 0;
    const row = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ transcript, reply, calls: calls.map(c => ({ model: c.model, operation: c.operation, power: c.power })) }));
    assert.deepEqual(calls.map(c => c.model).sort(), ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']);
    assert.ok(calls.every(c => c.operation === operation && c.power === power));
  }
  failHumidifier = true;
  calls.length = 0;
  const partial = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
  const partialReply = await assistant(partial.id, 'Включи бризер и увлажнитель в родительской');
  console.log(JSON.stringify({ partialReply }));
  assert.equal(calls.length, 2);
  assert.match(partialReply, /Бризер.*включён/);
  assert.match(partialReply, /Не удалось получить подтверждение.*Увлажнитель/);
  failHumidifier = false;
  }
  const balluCases: Array<[string, DeviceCommand['operation'], string, unknown]> = [
    ['Включи ночной режим бризера в спальне Артёма', 'mode', 'mode', 'night'],
    ['Включи турбо на бризере в спальне Артёма', 'mode', 'mode', 'turbo'],
    ['Переключи бризер в спальне Артёма в ручной режим', 'mode', 'mode', 'manual'],
    ['Включи экопроветривание на бризере в спальне Артёма', 'mode', 'mode', 'eco'],
    ['Поставь третью скорость бризера в спальне Артёма', 'speed', 'speed', 3],
    ['Поставь температуру подогрева бризера в спальне Артёма на 22 градуса', 'targetTemperature', 'temperature', 22],
    ['Отключи звуки кнопок бризера в спальне Артёма', 'buttonSound', 'enabled', false],
    ['Включи автоматическое гашение подсветки бризера в спальне Артёма', 'backlightAutoOff', 'enabled', true],
    ['Включи звук дождя на бризере в спальне Артёма', 'sound', 'sound', 'rain'],
    ['Выключи фоновую мелодию на бризере в спальне Артёма', 'sound', 'sound', 'off'],
    ['Я заменил основной фильтр бризера в спальне Артёма. Сбрось его счётчик', 'resetFilter', 'operation', 'resetFilter'],
  ];
  for (const [transcript, operation, field, expected] of (basicOnly ? [] : balluCases)) {
    calls.length = 0;
    const row = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ transcript, reply, operations: calls.map(c => c.operation) }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'ballu-oneair-asp-100');
    assert.equal(calls[0].operation, operation);
    assert.equal((calls[0] as unknown as Record<string, unknown>)[field], expected);
  }
  for (const transcript of (basicOnly ? [] : [
    'Включи автоматический режим по CO2 на бризере в спальне Артёма',
    'Установи температуру бризера в спальне Артёма на 30 градусов',
    'Выключи только подогрев бризера в спальне Артёма, вентиляцию оставь',
    'Поставь вторую скорость ночного режима бризера в спальне Артёма',
  ])) {
    calls.length = 0;
    const row = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
    const reply = await assistant(row.id, transcript);
    console.log(JSON.stringify({ unsupported: transcript, reply, operations: calls.map(c => c.operation) }));
    assert.equal(calls.length, 0, 'Unsupported request must not be replaced with a different setting');
  }
  calls.length = 0;
  const question = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
  const questionReply = await assistant(question.id, 'Включи бризер');
  console.log(JSON.stringify({ questionReply, calls: calls.map(c => ({ model: c.model, operation: c.operation, power: c.power })) }));
  assert.equal(calls.length, 0);
  assert.match(questionReply, /комнат|Уточните/, 'Ambiguous target needs a useful clarification, not an echoed request');
  await db.interaction.update({ where: { id: question.id }, data: { status: 'complete', transcript: 'Включи бризер', responseText: questionReply } });
  const clarification = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
  const answer = await assistant(clarification.id, 'В спальне Артёма');
  console.log(JSON.stringify({ clarification: answer, calls: calls.map(c => ({ model: c.model, power: c.power })) }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'ballu-oneair-asp-100');
  assert.equal(calls[0].power, true);
} finally { await database.close(); }
