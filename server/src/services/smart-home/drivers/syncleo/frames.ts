import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
} from 'node:crypto';

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function frame(seq: number, type: number, body: Buffer) {
  const header = Buffer.from([seq, type, 0, 0]);
  header.writeUInt16LE(body.length, 2);
  return Buffer.concat([header, body]);
}

function rotate(key: Buffer, offset: number) {
  const tail = key.subarray(offset);
  const head = key.subarray(0, offset);
  return Buffer.concat([tail, head]);
}

// Syncleo v2 uses reversed X25519 wire keys and splits the shared digest by direction.
export class Frames {
  private readonly incoming: Buffer;
  private readonly outgoing: Buffer;
  private readonly publicKey: Buffer;

  constructor(remote: string) {
    const pair = generateKeyPairSync('x25519');
    const remoteKey = Buffer.from(remote, 'hex').reverse();
    const der = Buffer.concat([X25519_SPKI_PREFIX, remoteKey]);
    const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    const shared = diffieHellman({ privateKey: pair.privateKey, publicKey });
    shared.reverse();
    const digest = createHash('sha256').update(shared).digest();
    this.incoming = digest.subarray(0, 16);
    this.outgoing = digest.subarray(16);
    this.publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).reverse();
  }

  handshake(token: string) {
    const cipher = createCipheriv('aes-128-cbc', this.outgoing, this.incoming);
    cipher.setAutoPadding(false);
    const encrypted = cipher.update(token, 'hex');
    const final = cipher.final();
    const prefix = Buffer.from([0]);
    const body = Buffer.concat([prefix, this.publicKey, encrypted, final]);
    return frame(0, 1, body);
  }

  encode(seq: number, type: number, payload: Buffer) {
    const key = rotate(this.outgoing, seq & 15);
    const iv = rotate(this.incoming, seq >> 4);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const prefix = Buffer.from([seq]);
    const bytes = Buffer.concat([prefix, payload]);
    const encrypted = cipher.update(bytes);
    const final = cipher.final();
    const body = Buffer.concat([encrypted, final]);
    return frame(seq, type, body);
  }

  decode(packet: Buffer) {
    if (packet.length < 20 || packet.readUInt16LE(2) !== packet.length - 4) return;
    const [seq, type] = packet;
    const key = rotate(this.incoming, seq & 15);
    const iv = rotate(this.outgoing, seq >> 4);
    const cipher = createDecipheriv('aes-128-cbc', key, iv);
    try {
      const bytes = packet.subarray(4);
      const plain = cipher.update(bytes);
      const final = cipher.final();
      const body = Buffer.concat([plain, final]);
      if (body[0] === seq) return { seq, type, payload: body.subarray(1) };
    } catch {
      // Ignore datagrams that cannot be decoded with this session's keys.
    }
  }
}
