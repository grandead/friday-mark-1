import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { mock } from 'node:test';
import { MiioPacket } from '@martyndevries/xiaomi-miio';
import { ERROR_MESSAGES } from '../shared/errors';

const TOKEN = Buffer.alloc(16, 7);
const TOKEN_HEX = TOKEN.toString('hex');
const IP = '127.0.0.1';
const MODELS = {
  humidifier: 'xiaomi-smart-humidifier-2',
  monitor: 'qingping-air-monitor-lite',
  smartmi: 'smartmi-fresh-air',
};
const HARDWARE = {
  humidifier: 'deerma.humidifier.jsq2g',
  monitor: 'cgllc.airm.cgd1st',
  smartmi: 'zhimi.airfresh.va4',
};
const VALUES: Record<keyof typeof MODELS, Record<string, unknown>> = {
  humidifier: {
    '2.1': false,
    '2.2': 1,
    '2.5': 1,
    '2.6': 50,
    '2.7': 1,
    '2.8': 0,
    '3.1': 37,
    '3.7': 26,
    '5.1': false,
    '6.1': false,
    '7.6': false,
    '7.8': false,
  },
  monitor: {
    '3.1': 40,
    '3.4': 5,
    '3.5': 9,
    '3.7': 23.7,
    '3.8': 800,
    '4.1': 100,
    '9.4': 1,
    '9.5': 30,
    '9.6': 15,
    '9.7': 'c',
    '9.8': 60,
    '9.10': 0,
    '9.18': 900,
    '9.19': 0,
    '9.20': 0,
  },
  smartmi: {
    power: 'off',
    mode: 'auto',
    temp_dec: 24.5,
    led_level: 0,
    buzzer: 'off',
    child_lock: 'off',
    ptc_state: 'off',
    f1_hour_used: 125,
  },
};
const SMARTMI_SET: Record<string, string> = {
  set_power: 'power',
  set_mode: 'mode',
  set_led_level: 'led_level',
  set_buzzer: 'buzzer',
  set_child_lock: 'child_lock',
  set_ptc_state: 'ptc_state',
};
type Model = keyof typeof MODELS;
type Request = { id: number; method: string; params: unknown[] };
type Property = { siid: number; piid: number; did: string; value?: unknown };

class Appliance {
  hardware: string;
  values: Record<string, unknown>;
  writes: Request[] = [];
  applyWrite = true;
  invalidAck = false;
  duplicate = false;
  corrupt = false;
  dropWrites = false;
  closed = false;
  rejectMethod?: string;
  socketError?: Error;

  constructor(readonly model: Model) {
    this.hardware = HARDWARE[model];
    this.values = { ...VALUES[model] };
  }
  respond({ method, params, id }: Request) {
    if (method === 'miIO.info') return { model: this.hardware };
    if (method === 'get_prop') return params.map((key) => this.values[String(key)] ?? null);
    if (method === 'get_properties') {
      assert.ok(params.length <= 6);
      const rows = (params as Property[]).map((property) => this.readProperty(property));
      if (this.duplicate) rows.push(rows[0]);
      return rows.reverse();
    }
    this.writes.push({ id, method, params });
    if (method === 'set_properties') {
      const [p] = params as Property[];
      if (this.applyWrite) this.values[`${p.siid}.${p.piid}`] = p.value;
      return [{ ...p, piid: this.invalidAck ? 999 : p.piid, code: 0 }];
    }
    if (method === 'reset_filter1') {
      if (this.applyWrite) this.values.f1_hour_used = 0;
    } else {
      const supported = Object.hasOwn(SMARTMI_SET, method);
      assert.ok(supported);
      if (this.applyWrite) this.values[SMARTMI_SET[method]] = params[0];
    }
    return [this.invalidAck ? 'error' : 'ok'];
  }

  private readProperty(property: Property) {
    const key = `${property.siid}.${property.piid}`;
    return { ...property, code: key in this.values ? 0 : -4003, value: this.values[key] ?? null };
  }
}

class ApplianceSocket extends EventEmitter {
  send(
    data: Buffer,
    _offset: number,
    _len: number,
    port: number,
    address: string,
    callback: () => void,
  ) {
    assert.equal(port, 54321);
    assert.equal(address, IP);
    const request = MiioPacket.decode(data, TOKEN).payload as Request | null;
    let reply: Buffer;
    if (appliance.socketError) {
      const error = appliance.socketError;
      setImmediate(() => this.emit('error', error));
      return;
    }
    if (request && request.method === appliance.rejectMethod) {
      const error = { code: -1, message: 'private device details' };
      reply = MiioPacket.encode(42, 100, TOKEN, { id: request.id, error });
    } else if (request) {
      const result = appliance.respond(request);
      if (appliance.dropWrites && appliance.writes.length) return callback();
      reply = MiioPacket.encode(42, 100, TOKEN, { id: request.id, result });
      if (appliance.corrupt) reply[16] ^= 255;
    } else {
      reply = MiioPacket.createHello();
      reply.writeUInt32BE(42, 8);
      reply.writeUInt32BE(100, 12);
    }
    callback();
    setImmediate(() => this.emit('message', reply, { address, port }));
  }
  close() {
    appliance.closed = true;
  }
}
let appliance: Appliance;
mock.module('node:dgram', { namedExports: { createSocket: () => new ApplianceSocket() } });
const { runDeviceCommand } = await import('../src/services/smart-home/driver');

function start(model: Model) {
  appliance = new Appliance(model);
}
async function run(operation = 'state', value?: unknown) {
  return (await runDeviceCommand({
    transport: 'miio',
    model: MODELS[appliance.model],
    registrationData: { ip: IP, token: TOKEN_HEX },
    operation,
    parameters: { [operation]: value },
  })) as Record<string, unknown>;
}

async function expectCommandError(
  code: keyof typeof ERROR_MESSAGES,
  operation = 'state',
  value?: unknown,
) {
  const pending = run(operation, value);
  await assert.rejects(pending, { code, message: ERROR_MESSAGES[code] });
}

test('all MIoT controls address their property and confirm a fresh state', async () => {
  const cases: [Model, string, unknown, string, unknown][] = [
    ['humidifier', 'power', true, '2.1', true],
    ['humidifier', 'level', 4, '2.5', 4],
    ['humidifier', 'mode', 'constantHumidity', '2.8', 1],
    ['humidifier', 'targetHumidity', 65, '2.6', 65],
    ['humidifier', 'buzzer', true, '5.1', true],
    ['humidifier', 'indicator', true, '6.1', true],
    ['humidifier', 'overwetProtection', true, '7.6', true],
    ['humidifier', 'constantProtection', true, '7.8', true],
    ['monitor', 'monitoringInterval', 60, '9.4', 60],
    ['monitor', 'screenOffDelay', 600, '9.5', 600],
    ['monitor', 'powerOffDelay', 10, '9.6', 10],
    ['monitor', 'temperatureUnit', 'f', '9.7', 'f'],
    ['monitor', 'screensaverDelay', 120, '9.8', 120],
    ['monitor', 'autoSlideInterval', 30, '9.10', 30],
    ['monitor', 'twelveHourClock', true, '9.19', 1],
    ['monitor', 'powerOffSeconds', 120, '9.18', 120],
    ['monitor', 'pm25Standard', 'us', '9.20', 1],
  ];
  for (const [model, field, wanted, key, wireValue] of cases) {
    start(model);
    const state = await run(field, wanted);
    assert.equal(state[field], wanted);
    assert.equal(appliance.writes.length, 1);
    assert.equal(appliance.values[key], wireValue);
    assert.ok(appliance.closed);
  }
});

test('Smartmi confirms switches, modes, levels, brightness and fresh filter resets', async () => {
  for (const [field, wanted, method, wire] of [
    ['power', true, 'set_power', 'on'],
    ['mode', 'silent', 'set_mode', 'silent'],
    ['brightness', 'off', 'set_led_level', 2],
    ['buzzer', true, 'set_buzzer', 'on'],
    ['childLock', true, 'set_child_lock', 'on'],
    ['heater', true, 'set_ptc_state', 'on'],
    ['speed', 1, 'set_mode', 'low'],
    ['speed', 2, 'set_mode', 'middle'],
    ['speed', 3, 'set_mode', 'strong'],
  ] as const) {
    start('smartmi');
    const state = await run(field, wanted);
    assert.equal(state[field], wanted);
    const writes = appliance.writes.map((request) => [request.method, request.params]);
    assert.deepEqual(writes, [[method, [wire]]]);
  }
  for (const hours of [0, 125]) {
    start('smartmi');
    appliance.values.f1_hour_used = hours;
    const state = await run('resetFilter');
    const methods = appliance.writes.map((request) => request.method);
    assert.equal(state.filterHours, 0);
    assert.deepEqual(methods, ['reset_filter1']);
  }
});

test('reads preserve units, capability limits and model identity', async () => {
  start('humidifier');
  const state = await run('power', false);
  assert.equal(state.fault, 'waterShortage');
  assert.equal(state.status, 'idle');
  assert.equal(state.mode, 'manual');
  assert.equal(appliance.writes.length, 0);
  start('smartmi');
  appliance.hardware = 'zhimi.airfresh.va2';
  appliance.values.temp_dec = 245;
  const smartmi = await run();
  assert.equal(smartmi.temperature, 24.5);
  await expectCommandError('unsupported', 'heater', true);
  start('monitor');
  appliance.hardware = 'cgllc.airm.cgdn1';
  delete appliance.values['9.19'];
  for (const [field, wanted] of [
    ['screenOffDelay', 600],
    ['powerOffDelay', 10],
    ['powerOffSeconds', 120],
    ['pm25Standard', 'us'],
    ['twelveHourClock', true],
  ] as const) {
    await expectCommandError('unsupported', field, wanted);
  }
  appliance.hardware = 'other';
  await expectCommandError('unsupported', 'temperatureUnit', 'f');
  assert.equal(appliance.writes.length, 0);
});

test('rejects malformed reads, acknowledgements and unconfirmed changes', async () => {
  start('monitor');
  delete appliance.values['3.8'];
  await expectCommandError('invalid_device_state');
  start('humidifier');
  appliance.duplicate = true;
  await expectCommandError('invalid_device_state');
  start('smartmi');
  appliance.values.power = 'unknown';
  await expectCommandError('invalid_device_state');
  for (const [model, field, wanted] of [
    ['humidifier', 'power', true],
    ['monitor', 'temperatureUnit', 'f'],
    ['smartmi', 'power', true],
  ] as const) {
    start(model);
    appliance.invalidAck = true;
    await expectCommandError('not_confirmed', field, wanted);
    start(model);
    appliance.applyWrite = false;
    await expectCommandError('not_confirmed', field, wanted);
    assert.equal(appliance.writes.length, 1);
  }
});

test('rejects a bad checksum and never retransmits an unacknowledged reset', async () => {
  start('smartmi');
  appliance.corrupt = true;
  await expectCommandError('device_unreachable');
  assert.ok(appliance.closed);
  start('smartmi');
  appliance.dropWrites = true;
  await expectCommandError('not_confirmed', 'resetFilter');
  assert.equal(appliance.writes.length, 1);
});

test('a device rejection is surfaced on both reads and writes', async () => {
  start('smartmi');
  appliance.rejectMethod = 'miIO.info';
  await expectCommandError('device_rejected_command');
  start('smartmi');
  appliance.rejectMethod = 'set_power';
  await expectCommandError('device_rejected_command', 'power', true);
  assert.equal(appliance.values.power, 'off');
});

test('network failures and internal errors have distinct safe diagnostics', async () => {
  start('monitor');
  const network: NodeJS.ErrnoException = new Error('private socket details');
  network.code = 'EHOSTUNREACH';
  appliance.socketError = network;
  await expectCommandError('device_unreachable');
  start('monitor');
  appliance.socketError = new TypeError('private driver details');
  await expectCommandError('internal_error');
});

test('shutdown closes an in-flight miIO handshake before any command can run', async () => {
  const { abortPendingOperations } = await import('../src/services/runtime');
  start('smartmi');
  const pending = run('power', true);
  abortPendingOperations();
  await assert.rejects(pending, { code: 'processing_stopped' });
  assert.ok(appliance.closed);
  assert.equal(appliance.writes.length, 0);
});
