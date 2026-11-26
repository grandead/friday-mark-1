import { getShutdownSignal } from '../runtime';
import { type Signals, subscribe, unsubscribe } from '../signals';

const HEARTBEAT_MS = 25_000;
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_PENDING_EVENTS = 64;

type SignalHandlers = {
  [Name in keyof Signals]?: (payload: Signals[Name]) => unknown;
};

export function createLiveStream(requestSignal: AbortSignal, handlers: SignalHandlers) {
  const source = new LiveStream(requestSignal, handlers);
  const strategy = new ByteLengthQueuingStrategy({ highWaterMark: MAX_BUFFERED_BYTES });
  return new ReadableStream<Uint8Array>(source, strategy);
}

class LiveStream implements UnderlyingDefaultSource<Uint8Array> {
  private readonly signal: AbortSignal;
  private readonly encoder = new TextEncoder();
  private readonly subscriptions: symbol[] = [];
  private readonly onAbort = () => this.close();
  private closed = false;
  private queue = Promise.resolve();
  private pendingEvents = 0;
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    requestSignal: AbortSignal,
    private readonly handlers: SignalHandlers,
  ) {
    const shutdownSignal = getShutdownSignal();
    this.signal = AbortSignal.any([requestSignal, shutdownSignal]);
  }

  public start(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.controller = controller;
    if (this.signal.aborted) {
      this.close();
      return;
    }
    const names = Object.keys(this.handlers) as Array<keyof Signals>;
    for (const name of names) this.subscribeToSignal(name);
    this.heartbeat = setInterval(() => this.sendFrame(': heartbeat\n\n'), HEARTBEAT_MS);
    this.signal.addEventListener('abort', this.onAbort, { once: true });
    this.sendFrame(': connected\n\n');
  }

  public cancel() {
    this.cleanup();
  }

  private subscribeToSignal<Name extends keyof Signals>(name: Name) {
    const handler = this.handlers[name];
    if (!handler) return;
    const subscription = subscribe(name, (payload) => this.queueEvent(name, handler, payload));
    this.subscriptions.push(subscription);
  }

  private queueEvent<Payload>(
    name: string,
    handler: (payload: Payload) => unknown,
    payload: Payload,
  ) {
    if (this.closed) return;
    if (this.pendingEvents >= MAX_PENDING_EVENTS) {
      this.close();
      return;
    }
    this.pendingEvents++;
    this.queue = this.queue.then(() => this.sendEvent(name, handler, payload));
    return this.queue;
  }

  private async sendEvent<Payload>(
    name: string,
    handler: (payload: Payload) => unknown,
    payload: Payload,
  ) {
    try {
      if (this.closed) return;
      const result = await handler(payload);
      if (this.closed || result === null || result === undefined) return;
      const data = JSON.stringify(result);
      this.sendFrame(`event: ${name}\ndata: ${data}\n\n`);
    } catch (error) {
      if (!this.closed) {
        console.error('Failed to send live event:', error);
        this.close();
      }
    } finally {
      this.pendingEvents--;
    }
  }

  private sendFrame(frame: string) {
    if (this.closed || !this.controller) return;
    const encoded = this.encoder.encode(frame);
    const available = this.controller.desiredSize ?? 0;
    if (encoded.byteLength > available) {
      this.close();
      return;
    }
    this.controller.enqueue(encoded);
  }

  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const subscription of this.subscriptions) unsubscribe(subscription);
    this.signal.removeEventListener('abort', this.onAbort);
  }

  private close() {
    if (this.closed) return;
    this.cleanup();
    this.controller?.close();
  }
}
