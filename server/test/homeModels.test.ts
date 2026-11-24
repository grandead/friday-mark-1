import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { type DeviceCommand, DeviceCommandError } from '../src/services/smartHome/driver.js';
import { commandsFor, type DeviceModel } from '../src/services/smartHome/model.js';
import { balluAsp100 } from '../src/services/smartHome/models/balluAsp100.js';
import { smartHumidifier2 } from '../src/services/smartHome/models/smartHumidifier2.js';
import { smartmiFreshAir } from '../src/services/smartHome/models/smartmiFreshAir.js';
import { createModelRegistry, homeModels } from '../src/services/smartHome/registry.js';
import { createHomeTools } from '../src/services/smartHome/tools.js';

function prepare(model: DeviceModel, name: string, args: Record<string, unknown> = {}) {
  const result = model.commands
    .find((command) => command.definition.function.name === name)!
    .prepare({ device: 'Прибор', ...args });
  if (!result.ok) assert.fail(result.reply);
  return result.command;
}
function connection(model: DeviceModel) {
  return { model: model.code, transport: model.transport, registrationData: {} };
}

test('each model validates and describes only its own state', async () => {
  const humidifier = prepare(smartHumidifier2, 'get_device_state');
  const smartmi = prepare(smartmiFreshAir, 'get_device_state');
  const ballu = prepare(balluAsp100, 'get_device_state');
  assert.equal(
    (
      await humidifier.run(connection(smartHumidifier2), async () => ({
        power: false,
        humidity: 0,
      }))
    ).description,
    'выключен. Влажность 0 процентов.',
  );
  const air = { power: true, humidity: 42, temperature: 22, co2: 850, pm25: 0 };
  assert.equal(
    (await smartmi.run(connection(smartmiFreshAir), async () => air)).description,
    'включён. Влажность 42 процентов. Температура 22 градусов. CO2 850 ppm. PM2.5 0 микрограммов на кубометр.',
  );
  assert.equal(
    (
      await ballu.run(connection(balluAsp100), async () => ({
        power: true,
        temperature: 25,
        co2: 850,
      }))
    ).description,
    'включён. Температура приточного воздуха 25 градусов.',
  );
  await assert.rejects(
    humidifier.run(connection(smartHumidifier2), async () => air),
    { code: 'invalid_device_state' },
  );
  await assert.rejects(
    smartmi.run(connection(smartmiFreshAir), async () => ({ power: true, sound: 'rain' })),
    { code: 'invalid_device_state' },
  );
  for (const model of homeModels.models.values()) {
    const read = prepare(model, 'get_device_state');
    for (const state of [{ power: 'on' }, { power: true, humidity: 101 }, null]) {
      await assert.rejects(
        read.run(connection(model), async () => state),
        { code: 'invalid_device_state' },
      );
    }
    const power = prepare(model, 'set_device_power', { power: false });
    await assert.rejects(
      power.run(connection(model), async () => ({ power: true })),
      { code: 'not_confirmed' },
    );
    const result = await power.run(connection(model), async (request) => {
      assert.deepEqual(request, {
        ...connection(model),
        operation: 'power',
        parameters: { power: false },
      });
      return { power: false };
    });
    assert.equal(result.description, 'выключен.');
  }
});

test('registry deduplicates shared tools and rejects conflicting registrations', () => {
  assert.equal(homeModels.definitions.length, 9);
  assert.equal(homeModels.commands.size, 9);
  assert.throws(
    () => createModelRegistry([smartHumidifier2, smartHumidifier2]),
    /Duplicate device model/,
  );
  assert.throws(
    () =>
      createModelRegistry([
        {
          ...smartHumidifier2,
          commands: [...smartHumidifier2.commands, smartHumidifier2.commands[0]],
        },
      ]),
    /Duplicate command/,
  );
  const conflicting = {
    ...smartmiFreshAir,
    commands: smartmiFreshAir.commands.map((command) => ({
      ...command,
      definition: {
        ...command.definition,
        function: { ...command.definition.function, description: 'Different contract' },
      },
    })),
  };
  assert.throws(
    () => createModelRegistry([smartHumidifier2, conflicting]),
    /Conflicting tool definition/,
  );
});

// A model with neither power nor the built-in tool names exercises the generic executor.
const sensor: DeviceModel = {
  code: 'test-sensor',
  transport: 'miio',
  registrationType: 'miioToken',
  commands: [
    commandsFor(z.strictObject({ illuminance: z.number().nonnegative() }))({
      name: 'read_light',
      operation: 'illuminance',
      description: 'Прочитать освещённость.',
      schema: z.strictObject({}),
      describe: (state) => `Освещённость ${state.illuminance} люкс.`,
    }),
  ],
};
function fixture() {
  const writes: unknown[] = [];
  const device = {
    id: 'device',
    displayName: 'Датчик',
    type: {
      code: sensor.code,
      displayName: 'Датчик света',
      registrationType: sensor.registrationType,
    },
    room: { displayName: 'Комната', home: { displayName: 'Дом' } },
  };
  const db = {
    homeDevice: {
      findMany: async () => [device],
      findUniqueOrThrow: async () => ({
        registrationData: { ip: '192.168.1.2', token: 'a'.repeat(32) },
      }),
    },
    interactionAction: {
      create: async (args: unknown) => {
        writes.push(args);
        return { id: 'action' };
      },
      update: async (args: unknown) => {
        writes.push(args);
      },
    },
  };
  return { db, writes, client: db as unknown as PrismaClient };
}
const lightCall = { function: { name: 'read_light', arguments: { device: 'Датчик' } } };

test('new model supplies catalogue, routing, validation and reply without executor changes', async () => {
  const { client, writes } = fixture();
  const calls: DeviceCommand[] = [];
  const tools = createHomeTools(
    client,
    async (command) => {
      calls.push(command);
      return { illuminance: 123 };
    },
    createModelRegistry([sensor]),
  );
  assert.deepEqual((await tools.catalogue())[0].commands, ['read_light']);
  assert.match(await tools.execute('interaction', 1, lightCall), /Датчик.*Освещённость 123 люкс/);
  assert.equal(calls[0].transport, 'miio');
  assert.equal(calls[0].operation, 'illuminance');
  assert.deepEqual(calls[0].parameters, {});
  assert.ok(!JSON.stringify(writes).includes('a'.repeat(32)));
  assert.ok(JSON.stringify(writes).includes('"executed":true'));
});

test('executor distinguishes device, registration and infrastructure failures without leaking secrets', async () => {
  const registry = createModelRegistry([sensor]);
  for (const [cause, expected] of [
    [new DeviceCommandError('device_unreachable'), 'device_unreachable'],
    [new Error('secret token'), 'internal_error'],
  ] as const) {
    const { client, writes } = fixture();
    const tools = createHomeTools(
      client,
      async () => {
        throw cause;
      },
      registry,
    );
    const reply = await tools.execute('interaction', 1, lightCall);
    assert.match(reply, /Не удалось/);
    assert.ok(JSON.stringify(writes).includes(`"errorCode":"${expected}"`));
    assert.ok(!JSON.stringify(writes).includes('secret token'));
    assert.ok(!reply.includes('secret token'));
  }
  const { db, client, writes } = fixture();
  db.homeDevice.findUniqueOrThrow = async () => {
    throw new Error('secret database URL');
  };
  let calls = 0;
  const tools = createHomeTools(
    client,
    async () => {
      calls++;
      return { illuminance: 0 };
    },
    registry,
  );
  await tools.execute('interaction', 1, lightCall);
  assert.equal(calls, 0);
  assert.ok(JSON.stringify(writes).includes('internal_error'));
  assert.ok(!JSON.stringify(writes).includes('secret database URL'));
  db.homeDevice.findUniqueOrThrow = async () => ({
    registrationData: { ip: '192.168.1.2', token: 'invalid-secret-token' },
  });
  await tools.execute('interaction', 2, lightCall);
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(writes).includes('invalid-secret-token'));
});

test('failed success journaling propagates without misreporting device failure', async () => {
  const { db, client, writes } = fixture();
  const error = new Error('Database unavailable');
  db.interactionAction.update = async () => {
    throw error;
  };
  const tools = createHomeTools(
    client,
    async () => ({ illuminance: 123 }),
    createModelRegistry([sensor]),
  );
  await assert.rejects(tools.execute('interaction', 1, lightCall), error);
  assert.equal(
    writes.length,
    1,
    'The executor must not try to journal a fictitious device failure',
  );
});
