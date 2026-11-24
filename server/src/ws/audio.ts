import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { RecordingEvent, RecordingSession } from '../services/audio/session.js';
import { parseAudioMessage } from '../services/validation/audioMessage.js';

type Options = {
  openSession: (
    send: (event: RecordingEvent) => void,
    onTimeout: (reason: string) => void,
  ) => RecordingSession;
  log: (message: string) => void;
};

export async function audioRoutes(app: FastifyInstance, options: Options) {
  let current: WebSocket | undefined;
  const connections = new Set<Promise<void>>();
  app.get('/audio', { websocket: true }, (socket) => {
    // A rebooted board can reconnect before the old TCP connection times out.
    current?.terminate();
    current = socket;
    const closed = handleConnection(socket, options);
    connections.add(closed);
    void closed.then(() => {
      connections.delete(closed);
      if (current === socket) current = undefined;
    });
  });
  app.addHook('onClose', async () => {
    await Promise.all(connections);
  });
}

function handleConnection(socket: WebSocket, { openSession, log }: Options): Promise<void> {
  let pending = Promise.resolve();
  let failed = false;
  function send(event: RecordingEvent | { type: 'error'; message: string }) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }

  async function abort(reason: string) {
    try {
      await session.abort(reason);
    } catch (error) {
      log(`Failed to save incomplete recording: ${error}`);
    }
  }

  async function fail(reason: string) {
    if (failed) return;
    failed = true;
    await abort(reason);
    send({ type: 'error', message: reason });
    socket.close(1008, Buffer.byteLength(reason) <= 123 ? reason : 'Invalid message');
  }

  function queueFailure(reason: string) {
    pending = pending.then(() => fail(reason));
  }

  const session = openSession(send, queueFailure);
  log('ESP32 connected. Waiting for the wake word or touch input.');
  // Install listeners synchronously and preserve frame order across database writes.
  socket.on('message', (raw: RawData, binary: boolean) => {
    pending = pending
      .then(async () => {
        if (failed) return;
        await session.receive(parseAudioMessage(toBuffer(raw), binary));
      })
      .catch((error) => fail(error instanceof Error ? error.message : 'Invalid message'));
  });
  socket.on('error', (error) => queueFailure(error.message));
  return new Promise((resolve) => {
    socket.once('close', () => {
      void pending.finally(async () => {
        await abort('Connection closed');
        log('ESP32 connection closed.');
        resolve();
      });
    });
  });
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}
