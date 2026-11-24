import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './database.js';
import { createHomeTools } from '../src/services/smartHome/tools.js';
import { createAssistant } from '../src/services/assistant/reply.js';
import { userId, deviceId } from '../src/config/identity.js';
import type { ToolCall, ChatMessage, ToolDefinition } from '../src/services/llm/types.js';
import type { DeviceCommand } from '../src/services/smartHome/driver.js';

const secret = 'abcdef0123456789abcdef0123456789';
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ function: { name, arguments: args } });

test('home commands resolve rooms and homes, validate arguments, confirm power and redact failures', async t => {
  const database = await createTestDatabase(); t.after(() => database.close());
  const db = database.db;
  const type = await db.homeDeviceType.findUniqueOrThrow({ where: { code: 'smartmi-fresh-air' } });
  const home = await db.home.create({ data: { displayName: 'Квартира', rooms: { create: [{ displayName: 'Родительская' }, { displayName: 'Спальня Артёма' }] } }, include: { rooms: true } });
  for (const room of home.rooms) await db.homeDevice.create({ data: { roomId: room.id, typeId: type.id, displayName: 'Бризер', registrationData: { ip: '192.168.1.10', token: secret } } });
  const interaction = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
  let requests: DeviceCommand[] = [];
  let fail = false, reportPower = true;
  const tools = createHomeTools(db, async input => { requests.push(input); if (fail) throw new Error(secret); return { power: reportPower, humidity: 42 }; });
  assert.ok(!JSON.stringify(await tools.catalogue()).includes(secret));
  let sequence = 1;
  const run = (name: string, args: Record<string, unknown>) => tools.execute(interaction.id, sequence++, call(name, args));
  assert.match(await run('set_device_power', { device: 'Бризер', power: true }), /Уточните/);
  assert.equal(requests.length, 0);
  assert.match(await run('set_device_power', { device: 'Бризер', room: 'Спальня Артема', power: true }), /включён/);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { model: 'smartmi-fresh-air', registrationData: { ip: '192.168.1.10', token: secret }, operation: 'power', power: true });
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Родительская' }), /Влажность 42/);
  const count = requests.length;
  assert.match(await run('set_device_power', { device: 'Бризер', room: 'Родительская', power: 'true' }), /разобрать/);
  assert.match(await run('set_device_power', { device: 'Бризер', room: 'Родительская', power: true, token: secret }), /разобрать/);
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Несуществующая' }), /Не нашла/);
  assert.match(await run('shell', { command: 'anything' }), /не поддерживается/);
  assert.equal(requests.length, count);
  reportPower = false;
  assert.match(await run('set_device_power', { device: 'Бризер', room: 'Родительская', power: true }), /не подтвердил/);
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Родительская' }), /выключен/);
  fail = true;
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Родительская' }), /Не удалось/);
  const actions = await db.interactionAction.findMany({ where: { interactionId: interaction.id } });
  assert.ok(!JSON.stringify(actions).includes(secret));
  assert.equal(actions.filter(action => action.error).length, 2);
  for (const action of actions.filter(action => action.error)) {
    assert.doesNotMatch(action.error!, /[А-Яа-яЁё]/);
    assert.match((action.result as { reply: string }).reply, /[А-Яа-яЁё]/);
  }
  const other = await db.home.create({ data: { displayName: 'Дача', rooms: { create: { displayName: 'Родительская', devices: { create: { typeId: type.id, displayName: 'Бризер', registrationData: { ip: '192.168.1.20', token: secret } } } } } } });
  assert.ok(other.id);
  fail = false;
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Родительская' }), /Уточните/);
  assert.match(await run('get_device_state', { device: 'Бризер', room: 'Родительская', home: 'Дача' }), /выключен/);
  assert.equal((requests.at(-1)!.registrationData as { ip: string }).ip, '192.168.1.20');
});

test('assistant executes multiple device commands and reports verified partial outcomes', async t => {
  const database = await createTestDatabase(); t.after(() => database.close());
  const db = database.db;
  const type = await db.homeDeviceType.findUniqueOrThrow({ where: { code: 'xiaomi-smart-humidifier-2' } });
  await db.home.create({ data: { displayName: 'Дом', rooms: { create: { displayName: 'Родительская', devices: { create: { typeId: type.id, displayName: 'Увлажнитель', registrationData: { ip: '192.168.1.10', token: secret } } } } } } });
  const room = await db.room.findFirstOrThrow();
  const breezerType = await db.homeDeviceType.findUniqueOrThrow({ where: { code: 'smartmi-fresh-air' } });
  await db.homeDevice.create({ data: { roomId: room.id, typeId: breezerType.id, displayName: 'Бризер', registrationData: { ip: '192.168.1.11', token: secret } } });
  const requests: DeviceCommand[] = [];
  let failedModel: string | undefined;
  const tools = createHomeTools(db, async command => {
    requests.push(command);
    if (command.model === failedModel) throw new Error(secret);
    return { power: command.power ?? false };
  });
  let calls = [call('set_device_power', { device: 'Увлажнитель', power: false })];
  let messages: ChatMessage[] = [], definitions: ToolDefinition[] | undefined;
  const assistant = createAssistant(db, { provider: 'test', model: 'test', generate: async (m, d) => {
    messages = m; definitions = d;
    return { text: 'Непроверенное утверждение', toolCalls: calls, model: 'test', durationMs: 1, inputTokens: 2, outputTokens: 3 };
  } }, tools);
  async function run() {
    const interaction = await db.interaction.create({ data: { userId, deviceId, status: 'processing', inputAudioKey: randomUUID() + '.wav' } });
    return { id: interaction.id, reply: await assistant(interaction.id, 'Выключи увлажнитель') };
  }
  const first = await run();
  assert.match(first.reply, /выключен/);
  assert.ok(!first.reply.includes('Непроверенное'));
  assert.ok(definitions?.some(tool => tool.function.name === 'set_ballu_mode'));
  for (const tool of definitions!) assert.match(tool.function.description, /[А-Яа-яЁё]/);
  assert.match(messages[0].content, /Родительская/);
  assert.ok(!JSON.stringify(messages).includes(secret));
  const actions = await db.interactionAction.findMany({ where: { interactionId: first.id }, orderBy: { sequence: 'asc' } });
  assert.deepEqual(actions.map(a => a.operation), ['chat', 'set_device_power']);
  calls = [call('set_device_power', { device: 'Бризер', power: true }), call('set_device_power', { device: 'Увлажнитель', power: false })];
  requests.length = 0;
  const both = await run();
  assert.deepEqual(requests.map(r => [r.model, r.power]), [['smartmi-fresh-air', true], ['xiaomi-smart-humidifier-2', false]]);
  assert.match(both.reply, /Бризер.*включён.*Увлажнитель.*выключен/);
  const batch = await db.interactionAction.findMany({ where: { interactionId: both.id }, orderBy: { sequence: 'asc' } });
  assert.deepEqual(batch.map(a => a.sequence), [1, 2, 3]);
  assert.deepEqual(batch.map(a => a.operation), ['chat', 'set_device_power', 'set_device_power']);
  for (const failed of ['smartmi-fresh-air', 'xiaomi-smart-humidifier-2']) {
    failedModel = failed;
    requests.length = 0;
    const partial = await run();
    assert.equal(requests.length, 2, 'A device failure must not skip the remaining command');
    assert.match(partial.reply, /Не удалось получить подтверждение/);
    assert.match(partial.reply, failed === 'smartmi-fresh-air' ? /Увлажнитель.*выключен/ : /Бризер.*включён/);
    const recorded = await db.interactionAction.findMany({ where: { interactionId: partial.id, service: 'smartHome' }, orderBy: { sequence: 'asc' } });
    assert.equal(recorded.filter(a => a.error).length, 1);
    assert.equal(recorded.filter(a => a.result && !a.error).length, 1);
    assert.ok(!JSON.stringify(recorded).includes(secret));
    assert.ok(!partial.reply.includes(secret));
  }
  failedModel = undefined;
  calls = [call('get_device_state', { device: 'Бризер' }), call('get_device_state', { device: 'Увлажнитель' })];
  requests.length = 0;
  assert.match((await run()).reply, /Бризер.*выключен.*Увлажнитель.*выключен/);
  assert.deepEqual(requests.map(r => r.operation), ['state', 'state']);
  calls = Array.from({ length: 9 }, () => call('set_device_power', { device: 'Бризер', power: true }));
  requests.length = 0;
  assert.match((await run()).reply, /до восьми/);
  assert.equal(requests.length, 0);

});
