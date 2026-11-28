import { createHash, timingSafeEqual } from 'node:crypto';
import { createSocket, type RemoteInfo } from 'node:dgram';
import {
  MiioPacket,
  MiioProtocol,
  MiioTimeoutError,
  MiioTransport,
} from '@martyndevries/xiaomi-miio';
import { DeviceCommandError } from '../../utils';

export type State = Record<string, unknown>;
export type Change = { field: string; wanted: unknown };

export class MiioSession {
  private readonly transport: MiioTransport;
  private readonly token: Buffer;
  private failure?: Error;

  constructor(
    private readonly ip: string,
    hexToken: string,
    private readonly signal: AbortSignal,
  ) {
    this.token = MiioProtocol.tokenFromHex(hexToken);
    this.transport = new MiioTransport({
      address: ip,
      token: this.token,
      timeout: 3000,
      retries: 1,
      createSocket: () => this.openSocket(),
    });
    this.transport.on('error', (error: Error) => this.fail(error));
  }

  private openSocket() {
    const socket = createSocket('udp4');
    // Run before the transport decodes the reply or resolves its pending request.
    socket.on('message', (packet, peer) => this.verify(packet, peer));
    return socket;
  }

  private verify(packet: Buffer, peer: RemoteInfo) {
    if (
      peer.address !== this.ip ||
      peer.port !== MiioProtocol.PORT ||
      !validPacket(packet, this.token)
    ) {
      const error = new DeviceCommandError('device_unreachable');
      this.fail(error);
    }
  }

  read(method: string, params: unknown[] = []) {
    return this.send(method, params, false);
  }

  write(method: string, params: unknown[]) {
    return this.send(method, params, true);
  }

  private async send(method: string, params: unknown[], write: boolean) {
    this.signal.throwIfAborted();
    if (this.failure) throw this.failure;
    const options = write ? { retries: 0 } : undefined;
    try {
      return await this.transport.send(method, params, options);
    } catch (error) {
      if (this.failure) throw this.failure;
      if (write && (error instanceof MiioTimeoutError || this.signal.aborted)) {
        throw new DeviceCommandError('not_confirmed');
      }
      throw error;
    }
  }

  private fail(error: Error) {
    this.failure = error;
    this.close();
  }

  close() {
    this.transport.destroy();
  }
}

function validPacket(packet: Buffer, token: Buffer) {
  if (
    packet.length < MiioPacket.HEADER_SIZE ||
    packet.readUInt16BE(0) !== MiioPacket.MAGIC ||
    packet.readUInt16BE(2) !== packet.length
  )
    return false;
  if (packet.length === MiioPacket.HEADER_SIZE) return true;
  const header = packet.subarray(0, 16);
  const received = packet.subarray(16, 32);
  const payload = packet.subarray(32);
  const checksum = createHash('md5').update(header).update(token).update(payload).digest();
  return timingSafeEqual(received, checksum);
}

export function decode(state: State, field: string, values: readonly unknown[]) {
  const index = state[field];
  if (index === undefined) return;
  if (typeof index !== 'number' || !Number.isInteger(index) || values[index] === undefined) {
    throw new DeviceCommandError('invalid_device_state');
  }
  state[field] = values[index];
}
