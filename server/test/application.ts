import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mock } from 'node:test';
import type { RecordingEvent } from '../src/services/audio';
import type { AudioMessage } from '../src/services/audio/validation';
import { routes, withRouteResources } from './routes';
import { resources, type ServiceResources, withServiceResources } from './service-resources';

const { RecordingSession } = await import('../src/services/audio');
const { waitForInteractions } = await import('../src/services/interactions');

type Options = ServiceResources & { recordingsDir: string };
export async function buildApp(options: Options) {
  mkdirSync(options.recordingsDir, { recursive: true });
  const shutdown = new AbortController();
  // Test adapter invokes the same handlers as the Next route modules, with an isolated database.
  function dispatch(request: Request) {
    return withRouteResources(options, async () => {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST') {
        if (path === '/api/smart-home/homes') return routes.createHome(request);
        if (path === '/api/smart-home/rooms') return routes.createRoom(request);
        if (path === '/api/smart-home/devices') return routes.createDevice(request);
      }
      if (path === '/api/smart-home') return routes.homes();
      if (path === '/api/users') return routes.users();
      if (path === '/api/devices') return routes.devices();
      if (path === '/api/interactions') return routes.interactions(request);
      if (path === '/api/interactions/live') {
        const signal = AbortSignal.any([request.signal, shutdown.signal]);
        const liveRequest = new Request(request, { signal });
        return routes.live(liveRequest);
      }
      if (path === '/api/health') return routes.health();
      const audio = /^\/api\/audio\/([^/]+)\/([^/]+)$/.exec(path);
      if (audio) {
        const params = Promise.resolve({ id: audio[1], kind: audio[2] });
        return routes.audio(request, { params });
      }
      return new Response(null, { status: 404 });
    });
  }
  const http = createServer(async (req, res) => {
    const abort = new AbortController();
    res.once('close', () => abort.abort());
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: abort.signal,
      });
      const response = await dispatch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res);
      else res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  const audio = createAudioServer();
  http.on('upgrade', (req, socket, head) => {
    if (req.url === '/audio')
      withServiceResources(options, () =>
        audio.server.handleUpgrade(req, socket, head, (ws) =>
          audio.server.emit('connection', ws, req),
        ),
      );
    else socket.destroy();
  });
  return {
    async listen({ host, port }: { host: string; port: number }) {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, resolve);
      });
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      return `http://${host}:${address.port}`;
    },
    async inject(
      input:
        | string
        | { url: string; method?: string; payload?: unknown; headers?: Record<string, string> },
    ) {
      const { url, method, headers, payload } = typeof input === 'string' ? { url: input } : input;
      const response = await dispatch(
        new Request(`http://localhost${url}`, {
          method,
          headers,
          body: payload === undefined ? undefined : JSON.stringify(payload),
        }),
      );
      const rawPayload = Buffer.from(await response.arrayBuffer());
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body: rawPayload.toString(),
        rawPayload,
        // biome-ignore lint/suspicious/noExplicitAny: Match the previous injection helper while callers may supply a response type.
        json<T = any>(): T {
          return JSON.parse(rawPayload.toString());
        },
      };
    },
    async close() {
      shutdown.abort();
      await audio.close();
      await waitForInteractions();
      if (http.listening)
        await new Promise<void>((resolve, reject) =>
          http.close((e) => (e ? reject(e) : resolve())),
        );
    },
  };
}

class TestRecordingSession extends RecordingSession {
  private readonly processingOptions = resources();
  constructor(notify: (event: RecordingEvent) => void, onTimeout: (reason: string) => void) {
    super(notify, onTimeout);
  }

  public override abort(reason: string) {
    return withServiceResources(this.processingOptions, () => super.abort(reason));
  }

  public override receive(message: AudioMessage) {
    return withServiceResources(this.processingOptions, () => super.receive(message));
  }
}

const AUDIO_MODULE = new URL('../src/services/audio/index.ts', import.meta.url);
const audioService = await import('../src/services/audio');
mock.module(AUDIO_MODULE, {
  cache: true,
  namedExports: { ...audioService, RecordingSession: TestRecordingSession },
});
const { createAudioServer } = await import('../src/ws/audio');
