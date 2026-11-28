import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceModelCode } from '../shared/device-model-code';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import type { ChatMessage, ToolCall, ToolDefinition } from '../src/services/llm';
import { DeviceCommandError } from '../src/services/smart-home/utils';
import { createAssistant } from './assistant';
import { createTestDatabase } from './database';
import { createHomeTools } from './home-tools';
import type { DeviceCommand } from './service-resources';

const secret = 'abcdef0123456789abcdef0123456789';
const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  function: { name, arguments: args },
});

test('assistant executes multiple device commands and reports verified partial outcomes', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const type = await db.orm.public.HomeDeviceType.firstOrThrow({
    code: DeviceModelCode.XiaomiSmartHumidifier2,
  });
  await db.orm.public.Home.create({
    displayName: 'Дом',
    rooms: (r) =>
      r.create({
        displayName: 'Родительская',
        devices: (r) =>
          r.create({
            typeId: type.id,
            displayName: 'Увлажнитель',
            registrationData: { ip: '192.168.1.10', token: secret },
          }),
      }),
  });
  const room = await db.orm.public.Room.firstOrThrow();
  const breezerType = await db.orm.public.HomeDeviceType.firstOrThrow({
    code: DeviceModelCode.SmartmiFreshAir,
  });
  await db.orm.public.HomeDevice.create({
    roomId: room.id,
    typeId: breezerType.id,
    displayName: 'Бризер',
    registrationData: { ip: '192.168.1.11', token: secret },
  });
  const requests: DeviceCommand[] = [];
  let failedModel: string | undefined;
  const tools = createHomeTools(db, async (command) => {
    requests.push(command);
    if (command.model === failedModel) throw new DeviceCommandError('device_unreachable');
    return { power: command.parameters.power ?? false };
  });
  const catalogue = await tools.catalogue();
  const humidifierId = catalogue.find((device) => device.name === 'Увлажнитель')!.id;
  const breezerId = catalogue.find((device) => device.name === 'Бризер')!.id;
  let calls = [call('xiaomi_humidifier_set_power', { deviceId: humidifierId, power: false })];
  let messages: ChatMessage[] = [],
    definitions: ToolDefinition[] | undefined;
  const assistant = createAssistant(
    db,
    async (m, d) => {
      messages = m;
      definitions = d;
      return {
        text: 'Непроверенное утверждение',
        toolCalls: calls,
        model: 'test',
        durationMs: 1,
        inputTokens: 2,
        outputTokens: 3,
      };
    },
    tools,
  );
  async function run() {
    const interaction = await db.orm.public.Interaction.create({
      userId,
      deviceId,
      status: 'processing',
      inputAudioKey: `${randomUUID()}.wav`,
    });
    return { id: interaction.id, reply: await assistant(interaction.id, 'Выключи увлажнитель') };
  }
  const first = await run();
  assert.match(first.reply, /выключен/);
  assert.ok(!first.reply.includes('Непроверенное'));
  assert.ok(definitions?.some((tool) => tool.function.name === 'ballu_set_mode'));
  for (const tool of definitions!) assert.match(tool.function.description, /[А-Яа-яЁё]/);
  assert.match(messages[0].content, /Родительская/);
  assert.ok(!JSON.stringify(messages).includes(secret));
  const actions = await db.orm.public.InteractionAction.where({ interactionId: first.id })
    .orderBy((r) => r.sequence.asc())
    .all();
  assert.deepEqual(
    actions.map((a) => a.operation),
    ['chat', 'xiaomi_humidifier_set_power'],
  );
  calls = [
    call('smartmi_set_power', { deviceId: breezerId, power: true }),
    call('xiaomi_humidifier_set_power', { deviceId: humidifierId, power: false }),
  ];
  requests.length = 0;
  const both = await run();
  assert.deepEqual(
    requests.map((r) => [r.model, r.parameters.power]),
    [
      [DeviceModelCode.SmartmiFreshAir, true],
      [DeviceModelCode.XiaomiSmartHumidifier2, false],
    ],
  );
  assert.match(both.reply, /Бризер.*включён.*Увлажнитель.*выключен/);
  const batch = await db.orm.public.InteractionAction.where({ interactionId: both.id })
    .orderBy((r) => r.sequence.asc())
    .all();
  assert.deepEqual(
    batch.map((a) => a.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    batch.map((a) => a.operation),
    ['chat', 'smartmi_set_power', 'xiaomi_humidifier_set_power'],
  );
  for (const failed of [DeviceModelCode.SmartmiFreshAir, DeviceModelCode.XiaomiSmartHumidifier2]) {
    failedModel = failed;
    requests.length = 0;
    const partial = await run();
    assert.equal(requests.length, 2, 'A device failure must not skip the remaining command');
    assert.match(partial.reply, /Не удалось получить ответ от прибора/);
    assert.match(
      partial.reply,
      failed === DeviceModelCode.SmartmiFreshAir ? /Увлажнитель.*выключен/ : /Бризер.*включён/,
    );
    const recorded = await db.orm.public.InteractionAction.where({
      interactionId: partial.id,
      service: 'smartHome',
    })
      .orderBy((r) => r.sequence.asc())
      .all();
    assert.equal(recorded.filter((a) => a.error).length, 1);
    assert.equal(recorded.filter((a) => a.result && !a.error).length, 1);
    assert.ok(!JSON.stringify(recorded).includes(secret));
    assert.ok(!partial.reply.includes(secret));
  }
  failedModel = undefined;
  calls = [
    call('smartmi_get_state', { deviceId: breezerId }),
    call('xiaomi_humidifier_get_state', { deviceId: humidifierId }),
  ];
  requests.length = 0;
  assert.match((await run()).reply, /Бризер.*выключен.*Увлажнитель.*выключен/);
  assert.deepEqual(
    requests.map((r) => r.operation),
    ['state', 'state'],
  );
  calls = Array.from({ length: 9 }, () =>
    call('smartmi_set_power', { deviceId: breezerId, power: true }),
  );
  requests.length = 0;
  assert.match((await run()).reply, /до восьми/);
  assert.equal(requests.length, 0);
});

test(
  'device IDs distinguish identical names and reject invalid, missing and wrong-model targets',
  checkDeviceIds,
);

async function checkDeviceIds(t: test.TestContext) {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const home = await db.orm.public.Home.create({ displayName: 'Квартира' });
  const room = await db.orm.public.Room.create({ homeId: home.id, displayName: 'Спальня' });
  const type = await db.orm.public.HomeDeviceType.firstOrThrow({
    code: DeviceModelCode.SmartmiFreshAir,
  });
  const first = await db.orm.public.HomeDevice.create({
    roomId: room.id,
    typeId: type.id,
    displayName: 'Бризер',
    registrationData: { ip: '192.168.1.10', token: secret },
  });
  const second = await db.orm.public.HomeDevice.create({
    roomId: room.id,
    typeId: type.id,
    displayName: 'Бризер',
    registrationData: { ip: '192.168.1.11', token: secret },
  });
  const interaction = await db.orm.public.Interaction.create({
    userId,
    deviceId,
    status: 'processing',
    inputAudioKey: 'id-test.wav',
  });
  const requests: DeviceCommand[] = [];
  const driver = recordPower.bind(null, requests);
  const tools = createHomeTools(db, driver);
  const catalogue = await tools.catalogue();
  assert.equal(catalogue.length, 2);
  assert.deepEqual(
    catalogue.map((device) => device.name),
    ['Бризер', 'Бризер'],
  );
  assert.deepEqual(catalogue.map((device) => device.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(catalogue[0].commands, [
    'smartmi_get_state',
    'smartmi_set_power',
    'smartmi_set_mode',
    'smartmi_set_speed',
    'smartmi_set_brightness',
    'smartmi_set_buzzer',
    'smartmi_set_child_lock',
    'smartmi_set_heater',
    'smartmi_reset_filter',
  ]);
  let sequence = 1;
  for (const id of [first.id, second.id]) {
    const command = call('smartmi_set_power', { deviceId: id, power: true });
    const reply = await tools.execute(interaction.id, sequence++, command);
    assert.match(reply, /включён/);
  }
  assert.deepEqual(
    requests.map((request) => request.registrationData),
    [first.registrationData, second.registrationData],
  );
  const missingId = randomUUID();
  const rejected: Array<[string, Record<string, unknown>, RegExp]> = [
    ['smartmi_set_power', { device: 'Бризер', power: true }, /разобрать/],
    ['smartmi_set_power', { deviceId: first.id, power: 'true' }, /разобрать/],
    ['smartmi_set_power', { deviceId: first.id, power: true, token: secret }, /разобрать/],
    ['smartmi_set_power', { deviceId: 'invented', power: true }, /разобрать/],
    ['smartmi_set_power', { deviceId: missingId, power: true }, /Не нашла/],
    ['ballu_set_speed', { deviceId: first.id, speed: 3 }, /недоступна для выбранной модели/],
    ['unknown_tool', { token: secret }, /не поддерживается/],
  ];
  for (const [name, args, expected] of rejected) {
    const command = call(name, args);
    const reply = await tools.execute(interaction.id, sequence++, command);
    assert.match(reply, expected);
  }
  assert.equal(requests.length, 2, 'Rejected calls must not contact devices');
  await db.orm.public.HomeDevice.where({ id: second.id }).update({ displayName: 'Бризер у окна' });
  const context = await tools.context();
  assert.match(context, /Бризер у окна/);
  assert.ok(context.includes(second.id));
  assert.doesNotMatch(context, /registrationData|192\.168/);
  assert.ok(!context.includes(secret));
  const actions = await db.orm.public.InteractionAction.where({
    interactionId: interaction.id,
  }).all();
  assert.equal(actions.length, 9, 'Every accepted or rejected call must be journaled');
  const journal = JSON.stringify(actions);
  assert.ok(!journal.includes(secret));
}

async function recordPower(requests: DeviceCommand[], command: DeviceCommand) {
  requests.push(command);
  return { power: command.parameters.power ?? false, humidity: 42 };
}
