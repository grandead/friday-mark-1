import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
} from 'node:crypto';
import { EventEmitter } from 'node:events';
import test, { mock } from 'node:test';

const KEY = generateKeyPairSync('x25519');
const PUBLIC = KEY.publicKey.export({ type: 'spki', format: 'der' });
const IP = '192.0.2.1';
const TOKEN = Buffer.alloc(16, 7);
const CREDS = { ip: IP, token: TOKEN.toString('hex') };
const TXT = {
  vendor: 'rusclimate',
  devtype: '69',
  protocol: '2',
  curve: '29',
  public: Buffer.from(PUBLIC.subarray(-32)).reverse().toString('hex'),
};
const SNAPSHOT = [
  [1, 3],
  [15, 1],
  [2, 20, 0],
  [9, 1],
  [28, 0],
  [11, 0, 0],
  [34, 0, 0, 12, 0],
  [66, 0, 1, 0],
  [66, 1, 0, 1],
  [20, 7, 153],
  [19, 50, 25],
  [3, 45, 0, 0, 0],
  [7, 0],
  [32, 5, 0],
];
let reports = SNAPSHOT;
let response: 'echo' | 'invalid' | 'wrong' | 'dropFirst' = 'echo';
let advertised = TXT;
let handshakeToken = TOKEN;
let controller = new AbortController();
let closed = 0;
let sockets = 0;
const writes: number[][] = [];
let lastReset: Buffer | undefined;

let discoveryError = false;
class Mdns extends EventEmitter {
  query(name: string) {
    assert.equal(name, '_syncleo._udp.local');
    if (discoveryError) {
      queueMicrotask(() => this.emit('error', new Error('Unable to bind mDNS')));
      return;
    }
    const device = `test.${name}`;
    const txt = Object.entries(advertised).map(([k, v]) => Buffer.from(`${k}=${v}`));
    const packet = {
      answers: [{ type: 'PTR', name, data: device, ttl: 60 }],
      additionals: [
        { type: 'TXT', name: device, data: txt, ttl: 60 },
        { type: 'SRV', name: device, data: { target: 'test.local', port: 7331 }, ttl: 60 },
        { type: 'A', name: 'test.local', data: IP, ttl: 60 },
      ],
    };
    queueMicrotask(() => this.emit('response', packet, { address: IP }));
  }
  destroy() {}
}

function crypt(decrypt: boolean, key: Buffer, iv: Buffer, seq: number, data: Buffer) {
  const rotate = (b: Buffer, n: number) => Buffer.concat([b.subarray(n), b.subarray(0, n)]);
  const cipher = (decrypt ? createDecipheriv : createCipheriv)(
    'aes-128-cbc',
    rotate(key, seq & 15),
    rotate(iv, seq >> 4),
  );
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

class Peer extends EventEmitter {
  inbound!: Buffer;
  outbound!: Buffer;
  sequence = 0;

  connect(port: number, ip: string) {
    assert.equal(ip, IP);
    assert.equal(port, 7331);
    sockets++;
    queueMicrotask(() => this.emit('connect'));
  }
  close() {
    closed++;
  }

  reply(seq: number, type: number, body: number[]) {
    const data = crypt(false, this.outbound, this.inbound, seq, Buffer.from([seq, ...body]));
    const frame = Buffer.concat([Buffer.from([seq, type, 0, 0]), data]);
    frame.writeUInt16LE(data.length, 2);
    queueMicrotask(() => this.emit('message', frame));
    return frame;
  }

  send(packet: Buffer) {
    const [seq, type] = packet;
    assert.equal(packet.readUInt16LE(2), packet.length - 4);
    if (type === 0) return;
    if (seq === 0) {
      const key = createPublicKey({
        key: Buffer.concat([
          PUBLIC.subarray(0, -32),
          Buffer.from(packet.subarray(5, 37)).reverse(),
        ]),
        type: 'spki',
        format: 'der',
      });
      const digest = createHash('sha256')
        .update(diffieHellman({ privateKey: KEY.privateKey, publicKey: key }).reverse())
        .digest();
      this.outbound = digest.subarray(0, 16);
      this.inbound = digest.subarray(16);
      const cipher = createDecipheriv('aes-128-cbc', this.inbound, this.outbound).setAutoPadding(
        false,
      );
      assert.deepEqual(Buffer.concat([cipher.update(packet.subarray(37)), cipher.final()]), TOKEN);
      this.reply(this.sequence++, 1, [0, 2, 0, 1, 38, 0, ...handshakeToken]);
      for (const report of reports) {
        const frame = this.reply(this.sequence++, 1, report);
        if (report[0] === 34) lastReset = frame;
      }
      return;
    }
    const body = crypt(true, this.inbound, this.outbound, seq, packet.subarray(4));
    assert.equal(body[0], seq);
    const write = [...body.subarray(1)];
    writes.push(write);
    if (response === 'dropFirst' && writes.length === 1) return;
    this.reply(seq, 0, []);
    if (response === 'invalid' && lastReset) {
      const stale = lastReset;
      queueMicrotask(() => this.emit('message', stale));
      this.reply(this.sequence++, 1, [write[0]]);
    } else {
      this.reply(this.sequence++, 1, response === 'wrong' ? [write[0], 0] : write);
    }
  }
}

mock.module('multicast-dns', { defaultExport: () => new Mdns() });
mock.module('node:dgram', { namedExports: { createSocket: () => new Peer() } });
const runtime = new URL('../src/services/runtime/index.ts', import.meta.url);
mock.module(runtime, { namedExports: { getShutdownSignal: () => controller.signal } });
const ballu = await import('../src/services/smart-home/devices/ballu-asp100');
const { runCommand } = await import('../src/services/smart-home/drivers/syncleo');

test.beforeEach(() => {
  reports = SNAPSHOT;
  discoveryError = false;
  response = 'echo';
  advertised = TXT;
  handshakeToken = TOKEN;
  controller = new AbortController();
  writes.length = 0;
  lastReset = undefined;
});
test.afterEach(() => assert.equal(closed, sockets));

test('ASP-100 decodes the authenticated snapshot and preserves optional fields', async () => {
  const state = await ballu.getState(CREDS, {});
  assert.deepEqual(state, {
    mode: 'night',
    power: true,
    speed: 1,
    targetTemperature: 20,
    buttonSound: true,
    backlightAutoOff: false,
    sound: 'off',
    filterCounter: 0,
    heaterInstalled: true,
    co2SensorInstalled: false,
    temperature: -7.25,
    humidity: 50.25,
    turboSeconds: 45,
    errorCode: 0,
    pm25: 5,
  });
  assert.deepEqual(writes, []);
});

test('another model supplies its own initial report and write opcode', async () => {
  advertised = { ...TXT, vendor: 'another', devtype: '81' };
  reports = [[91, 7]];
  const state = await runCommand(CREDS, { vendor: 'another', deviceType: 81 }, async (session) => {
    let level: number | undefined;
    await session.read(
      (field, data) => {
        if (field !== 91) return false;
        level = data[0];
        return true;
      },
      () => level !== undefined,
    );
    await session.write(91, [9], () => level === 9);
    return level;
  });
  assert.equal(state, 9);
  assert.deepEqual(writes, [[91, 9]]);
});

test('ASP-100 sends model-specific command bytes and confirms writes in order', async () => {
  await ballu.setPower(CREDS, { power: true });
  await ballu.setPower(CREDS, { power: false });
  await ballu.setMode(CREDS, { mode: 'eco' });
  await ballu.setSpeed(CREDS, { speed: 4 });
  await ballu.setTemperature(CREDS, { temperature: 22 });
  await ballu.setButtonSound(CREDS, { enabled: false });
  await ballu.setBacklightAutoOff(CREDS, { enabled: true });
  await ballu.setSound(CREDS, { sound: 'fireplace' });
  await ballu.resetFilter(CREDS, {});
  assert.deepEqual(writes, [
    [1, 0],
    [1, 5],
    [1, 1],
    [15, 4],
    [2, 22, 0],
    [9, 0],
    [28, 1],
    [11, 5, 0],
    [34, 0, 0],
  ]);
});

test('hardware and reported capabilities guard model writes', async () => {
  reports = [
    [1, 1],
    [66, 0, 0],
  ];
  await assert.rejects(ballu.setTemperature(CREDS, { temperature: 20 }), {
    code: 'heater_missing',
  });
  reports = [[1, 1]];
  await assert.rejects(ballu.setTemperature(CREDS, { temperature: 20 }), {
    code: 'hardware_unknown',
  });
  await assert.rejects(ballu.setSound(CREDS, { sound: 'sea' }), { code: 'unsupported' });
  assert.deepEqual(writes, []);
});

test('a cached zero, a retransmitted report, a truncated report and a transport ACK cannot confirm reset', async () => {
  response = 'invalid';
  await assert.rejects(ballu.resetFilter(CREDS, {}), { code: 'not_confirmed' });
  assert.deepEqual(writes, [[34, 0, 0]]);
});

test('wrong reported value stops a multistep write', async () => {
  response = 'wrong';
  await assert.rejects(ballu.setSpeed(CREDS, { speed: 3 }), { code: 'not_confirmed' });
  assert.deepEqual(writes, [[1, 1]]);
});

test('protocol, model, auth and shutdown failures do not write settings', async () => {
  advertised = { ...TXT, protocol: '1' };
  await assert.rejects(ballu.getState(CREDS, {}), { code: 'unsupported' });
  advertised = { ...TXT, devtype: '32' };
  await assert.rejects(ballu.getState(CREDS, {}), { code: 'unsupported' });
  advertised = TXT;
  handshakeToken = Buffer.alloc(16);
  await assert.rejects(ballu.getState(CREDS, {}), { code: 'device_rejected_command' });
  controller.abort();
  await assert.rejects(ballu.getState(CREDS, {}), { code: 'processing_stopped' });
  assert.deepEqual(writes, []);
});

test('mDNS socket errors fail the command without opening a device session', async () => {
  discoveryError = true;
  const before = sockets;
  await assert.rejects(ballu.getState(CREDS, {}), { code: 'device_unreachable' });
  assert.equal(sockets, before);
});

test('a lost command packet is retried before a queued read uses the device', async () => {
  response = 'dropFirst';
  const before = sockets;
  const setting = ballu.setButtonSound(CREDS, { enabled: false });
  const read = ballu.getState(CREDS, {});
  const changed = await setting;
  assert.equal(changed.buttonSound, false);
  assert.deepEqual(writes, [
    [9, 0],
    [9, 0],
  ]);
  assert.equal(sockets, before + 1);
  await read;
  assert.equal(sockets, before + 2);
});
