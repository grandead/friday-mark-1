import { createSocket } from 'node:dgram';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceCommandError } from '../../utils';
import type { DeviceCredentials } from './device-credentials';
import type { Endpoint } from './discovery';
import { Frames } from './frames';

const EMPTY = Buffer.alloc(0);
type Report = (field: number, data: Buffer) => boolean;

export class SyncleoSession {
  private readonly frames: Frames;
  private readonly socket = createSocket('udp4');
  private readonly changes = new EventEmitter();
  private readonly failure = new AbortController();
  private readonly signal: AbortSignal;
  private readonly unacked = new Map<number, Buffer>();
  private readonly received = new Set<number>();
  private readonly revisions = new Map<number, number>();
  private receive?: Report;
  private authenticated = false;
  private sequence = 0;

  constructor(
    private endpoint: Endpoint,
    private credentials: DeviceCredentials,
    signal: AbortSignal,
  ) {
    this.frames = new Frames(endpoint.publicKey);
    this.signal = AbortSignal.any([signal, this.failure.signal]);
    this.socket.on('message', (packet) => this.handlePacket(packet));
    this.socket.on('error', () => this.failure.abort());
  }

  async read(receive: Report, ready: () => boolean) {
    this.receive = receive;
    this.signal.throwIfAborted();
    this.socket.connect(this.endpoint.port, this.credentials.ip);
    await once(this.socket, 'connect', { signal: this.signal });
    const handshake = this.frames.handshake(this.credentials.token);
    this.transmit(0, handshake);
    const initialized = () => this.authenticated && ready();
    await this.waitFor(initialized, 10000, 'device_unreachable');
    await delay(1000, undefined, { signal: this.signal });
  }

  async write(field: number, bytes: number[], matches: () => boolean, force = false) {
    if (!force && matches()) return;
    const previous = this.revisions.get(field) ?? 0;
    this.send(field, bytes);
    const confirmed = () => (this.revisions.get(field) ?? 0) > previous && matches();
    await this.waitFor(confirmed, 5000, 'not_confirmed');
    this.unacked.delete(this.sequence);
  }

  private send(field: number, bytes: number[]) {
    this.sequence = (this.sequence + 1) & 255;
    const body = Buffer.from([field, ...bytes]);
    const packet = this.frames.encode(this.sequence, 1, body);
    this.transmit(this.sequence, packet);
  }

  private transmit(seq: number, packet: Buffer) {
    this.unacked.set(seq, packet);
    this.socket.send(packet);
  }

  private retry() {
    for (const packet of this.unacked.values()) this.socket.send(packet);
  }

  private async waitFor(
    ready: () => boolean,
    timeout: number,
    code: 'not_confirmed' | 'device_unreachable',
  ) {
    const deadline = AbortSignal.timeout(timeout);
    const signal = AbortSignal.any([this.signal, deadline]);
    const retry = setInterval(() => this.retry(), 1000);
    try {
      while (!ready()) await once(this.changes, 'report', { signal });
    } catch (error) {
      if (deadline.aborted) throw new DeviceCommandError(code);
      throw error;
    } finally {
      clearInterval(retry);
    }
  }

  private handlePacket(packet: Buffer) {
    const report = this.frames.decode(packet);
    if (!report) return;
    const { seq, type, payload } = report;
    if (type === 0) {
      this.unacked.delete(seq);
      return;
    }
    if (type !== 1 || !payload.length) return;
    const field = payload[0];
    if (!this.authenticated && field !== 0) return;
    const ack = this.frames.encode(seq, 0, EMPTY);
    this.socket.send(ack);
    if (this.received.has(seq)) return;
    this.received.add(seq);
    this.received.delete((seq - 128) & 255);
    if (field === 0) {
      if (this.authenticated || payload.length < 22) return;
      const token = payload.subarray(6, 22);
      if (!token.some((byte) => byte !== 0)) {
        this.failure.abort(new DeviceCommandError('device_rejected_command'));
        return;
      }
      this.authenticated = true;
      this.unacked.delete(0);
      this.changes.emit('report');
      return;
    }
    const data = payload.subarray(1);
    if (!this.receive?.(field, data)) return;
    const revision = this.revisions.get(field) ?? 0;
    this.revisions.set(field, revision + 1);
    this.changes.emit('report');
  }

  async execute<T>(action: (session: SyncleoSession) => Promise<T>) {
    try {
      return await action(this);
    } catch (error) {
      if (this.failure.signal.reason instanceof DeviceCommandError)
        throw this.failure.signal.reason;
      throw error;
    } finally {
      this.socket.close();
    }
  }
}
