import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { AppError, diagnosticError, publicError } from '../../shared/errors';
import { parseAudioMessage, type RecordingEvent, RecordingSession } from '../services/audio';

export function createAudioServer() {
  return new AudioServer();
}

class AudioServer {
  readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  private current?: WebSocket;
  private readonly connections = new Set<Promise<void>>();

  constructor() {
    this.server.on('connection', (socket) => this.connect(socket));
  }

  private connect(socket: WebSocket) {
    this.current?.terminate();
    this.current = socket;
    const connection = new AudioConnection(socket);
    const closed = connection.closed.promise;
    this.connections.add(closed);
    void closed.then(() => this.disconnect(socket, closed));
  }

  private disconnect(socket: WebSocket, closed: Promise<void>) {
    this.connections.delete(closed);
    if (this.current === socket) this.current = undefined;
  }

  async close() {
    for (const socket of this.server.clients) socket.terminate();
    await Promise.all(this.connections);
    const closed = Promise.withResolvers<void>();
    this.server.close(() => closed.resolve());
    await closed.promise;
  }
}

class AudioConnection {
  readonly closed = Promise.withResolvers<void>();
  private readonly session: RecordingSession;
  private pending = Promise.resolve();
  private failed = false;

  constructor(private readonly socket: WebSocket) {
    this.session = new RecordingSession(this.send, this.timeout);
    console.log('ESP32 connected. Waiting for the wake word or touch input.');
    socket.on('message', this.queueMessage);
    socket.on('error', this.queueFailure);
    socket.once('close', () => this.pending.then(this.disconnect, this.disconnect));
  }

  private send = (event: RecordingEvent | { type: 'error'; code: string; message: string }) => {
    if (this.socket.readyState !== this.socket.OPEN) return;
    const data = JSON.stringify(event);
    this.socket.send(data);
  };

  private queueMessage = (raw: RawData, binary: boolean) => {
    this.pending = this.pending.then(() => this.receive(raw, binary)).catch(this.fail);
  };

  private async receive(raw: RawData, binary: boolean) {
    if (this.failed) return;
    const buffer = toBuffer(raw);
    const message = parseAudioMessage(buffer, binary);
    await this.session.receive(message);
  }

  private timeout = (reason: string) => {
    const error = new AppError('recording_interrupted', reason);
    this.queueFailure(error);
  };

  private queueFailure = (error: Error) => {
    this.pending = this.pending.then(() => this.fail(error));
  };

  private fail = async (cause: unknown) => {
    if (this.failed) return;
    this.failed = true;
    const diagnostic = diagnosticError(cause);
    await this.abort(diagnostic);
    const error = publicError(cause);
    this.send({ type: 'error', ...error });
    this.socket.close(1008, error.message);
  };

  private async abort(reason: string) {
    try {
      await this.session.abort(reason);
    } catch (error) {
      console.error('Failed to save incomplete recording:', error);
    }
  }

  private disconnect = async () => {
    await this.abort('Connection closed');
    console.log('ESP32 connection closed.');
    this.closed.resolve();
  };
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}
