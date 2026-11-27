import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { Database } from '../src/services/database';
import {
  type DeviceCommand,
  DeviceCommandError,
  type DeviceDriver,
} from '../src/services/smart-home/driver';
import { createHomeTools, DEVICE_TOOLS as TOOLS } from './home-tools';
import { withServiceResources } from './service-resources';

const { TOOL_DEFINITIONS } = await import('../src/services/llm-tools');

const { executeDeviceCommand } = await import('../src/services/smart-home');

const DEVICE_ID = '019ace9d-0000-7000-8000-000000000001';
const READ_CALL = { function: { name: 'smartmi_get_state', arguments: { deviceId: DEVICE_ID } } };

test(
  'each model owns unique tools whose JSON schemas come from their Zod schemas',
  checkDefinitions,
);
test('each model reads and describes its own state', checkStates);
test('all power commands require confirmed state', checkPowerConfirmation);
test('executor preserves driver errors and safe diagnostics', checkFailures);
test('executor trusts stored credentials and preserves journal failures', checkStoredCredentials);

function checkDefinitions() {
  const names = new Set<string>();
  for (const [name, { tool }] of TOOLS) {
    assert.equal(names.has(name), false);
    names.add(name);
    const definition = TOOL_DEFINITIONS.find((item) => item.function.name === name)!;
    const parameters = z.toJSONSchema(tool.schema);
    assert.deepEqual(definition.function.parameters, parameters);
    assert.ok(parameters.required?.includes('deviceId'));
    assert.equal(parameters.additionalProperties, false);
  }
  assert.equal(names.size, 37);
  assert.equal(TOOL_DEFINITIONS.length, names.size);
}

async function run(name: string, args: Record<string, unknown>, driver: DeviceDriver) {
  const entry = TOOLS.get(name)!;
  const input = { deviceId: DEVICE_ID, ...args };
  const parsed = entry.tool.schema.parse(input);
  const connection = {
    model: entry.model.code,
    transport: entry.model.transport,
    registrationData: {},
  };
  return withServiceResources({ driver }, () => entry.tool.execute(parsed, connection));
}

async function checkStates() {
  const humidifier = await run('xiaomi_humidifier_get_state', {}, async () => ({
    power: false,
    humidity: 0,
  }));
  assert.equal(humidifier.description, 'выключен. Влажность 0 процентов.');
  const smartmi = await run('smartmi_get_state', {}, async () => ({
    power: true,
    humidity: 42,
    temperature: 22,
    co2: 850,
    pm25: 0,
  }));
  assert.equal(
    smartmi.description,
    'включён. Влажность 42 процентов. Температура 22 градусов. CO2 850 ppm. PM2.5 0 микрограммов на кубометр.',
  );
  const ballu = await run('ballu_get_state', {}, async () => ({
    power: true,
    temperature: 25,
    co2: 850,
  }));
  assert.equal(ballu.description, 'включён. Температура приточного воздуха 25 градусов.');
  for (const name of ['xiaomi_humidifier_get_state', 'smartmi_get_state', 'ballu_get_state']) {
    for (const state of [{ power: 'on' }, { power: true, humidity: 101 }, null]) {
      const driver = returnState.bind(null, state);
      const pending = run(name, {}, driver);
      await assert.rejects(pending, { code: 'invalid_device_state' });
    }
  }
}

async function returnState(state: unknown) {
  return state;
}

async function checkPowerConfirmation() {
  for (const name of ['xiaomi_humidifier_set_power', 'smartmi_set_power', 'ballu_set_power']) {
    const pending = run(name, { power: false }, async () => ({ power: true }));
    await assert.rejects(pending, { code: 'not_confirmed' });
    const result = await run(name, { power: false }, confirmPowerRequest);
    assert.equal(result.description, 'выключен.');
  }
}

async function confirmPowerRequest(request: DeviceCommand) {
  assert.equal(request.operation, 'power');
  assert.deepEqual(request.parameters, { power: false });
  return { power: false };
}

function fixture() {
  const writes: unknown[] = [];
  const device = {
    id: DEVICE_ID,
    displayName: 'Бризер',
    type: { code: 'smartmi-fresh-air' },
    room: { displayName: 'Комната' },
    registrationData: { ip: '192.168.1.2', token: 'stored-secret-token' },
  };
  const collection = {
    select: returnSelf,
    include: returnSelf,
    where: returnSelf,
    first: returnState.bind(null, device),
    create: createAction.bind(null, writes),
    update: recordWrite.bind(null, writes),
  };
  const client = {
    orm: { public: { HomeDevice: collection, InteractionAction: collection } },
  } as unknown as Database;
  return { client, collection, writes, device };
}
function returnSelf(this: unknown) {
  return this;
}
async function createAction(writes: unknown[], args: unknown) {
  writes.push(args);
  return { id: 'action' };
}
async function recordWrite(writes: unknown[], args: unknown) {
  writes.push(args);
}
async function throwError(error: Error): Promise<never> {
  throw error;
}

async function checkFailures() {
  for (const [error, expected] of [
    [new DeviceCommandError('device_unreachable'), 'device_unreachable'],
    [new Error('secret token'), 'internal_error'],
  ] as const) {
    const { client, writes } = fixture();
    const driver = throwError.bind(null, error);
    const reply = await executeTestTool(client, driver, 'interaction', 1, READ_CALL);
    assert.match(reply, /Не удалось/);
    const journal = JSON.stringify(writes);
    assert.ok(journal.includes(expected));
    assert.doesNotMatch(journal, /secret token/);
    assert.doesNotMatch(reply, /secret token/);
  }
  const { client, collection, writes } = fixture();
  collection.first = throwError.bind(null, new Error('secret database URL'));
  const reply = await executeTestTool(client, shouldNotRun, 'interaction', 1, READ_CALL);
  const journal = JSON.stringify(writes);
  assert.match(reply, /Не удалось/);
  assert.match(journal, /internal_error/);
  assert.doesNotMatch(journal, /secret database URL/);
}

async function shouldNotRun() {
  assert.fail('Driver must not run');
}

async function checkStoredCredentials() {
  const { client, collection, writes, device } = fixture();
  const calls: DeviceCommand[] = [];
  const driver = captureRequest.bind(null, calls);
  await executeTestTool(client, driver, 'interaction', 1, READ_CALL);
  assert.deepEqual(calls[0].registrationData, device.registrationData);
  const journal = JSON.stringify(writes);
  assert.doesNotMatch(journal, /stored-secret-token/);
  const failure = new Error('Database unavailable');
  collection.update = throwError.bind(null, failure);
  const pending = executeTestTool(client, driver, 'interaction', 2, READ_CALL);
  await assert.rejects(pending, failure);
  assert.equal(writes.length, 3, 'No second write to report a fictitious device failure');
}
async function captureRequest(calls: DeviceCommand[], command: DeviceCommand) {
  calls.push(command);
  return { power: true };
}

function executeTestTool(
  db: Database,
  driver: DeviceDriver,
  id: string,
  sequence: number,
  call: typeof READ_CALL,
) {
  const tools = createHomeTools(db, driver);
  return tools.execute(id, sequence, call);
}

test('registered device commands validate inputs, choose the transport and return only confirmed state', async () => {
  const { client, device, writes, collection } = fixture();
  const calls: DeviceCommand[] = [];
  const driver = captureRequest.bind(null, calls);
  const resources = { db: client, driver };
  const power = { operation: 'power', power: true };
  for (const [code, transport] of [
    ['smartmi-fresh-air', 'miio'],
    ['ballu-oneair-asp-100', 'syncleo'],
  ]) {
    device.type.code = code;
    const result = await withServiceResources(resources, () =>
      executeDeviceCommand(DEVICE_ID, power),
    );
    assert.deepEqual(result, { power: true });
    const request = calls.at(-1);
    assert.equal(request?.transport, transport);
    assert.deepEqual(request?.registrationData, device.registrationData);
  }
  for (const command of [
    { operation: 'speed', speed: 8 },
    { operation: 'power', power: 'yes' },
    { ...power, token: 'untrusted' },
    { ...power, deviceId: 'another-device' },
  ]) {
    const pending = withServiceResources(resources, () => executeDeviceCommand(DEVICE_ID, command));
    await assert.rejects(pending, { code: 'invalid_device_command' });
  }
  device.type.code = 'qingping-air-monitor-lite';
  const unsupported = withServiceResources(resources, () => executeDeviceCommand(DEVICE_ID, power));
  await assert.rejects(unsupported, { code: 'unsupported' });
  collection.first = returnState.bind(null, null);
  const missing = withServiceResources(resources, () => executeDeviceCommand(DEVICE_ID, power));
  await assert.rejects(missing, { code: 'entity_not_found' });
  assert.equal(calls.length, 2);
  assert.equal(writes.length, 0);
});
