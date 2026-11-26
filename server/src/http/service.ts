import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import next from 'next';
import type { WebSocket } from 'ws';
import { recordingsDir, serverRoot } from '../config/paths';
import { serverPort } from '../config/port';
import { waitForInteractions } from '../services/interactions';
import { abortPendingOperations } from '../services/runtime';
import { createAudioServer } from '../ws/audio';

let server: Promise<HttpService> | undefined;
type NextApp = ReturnType<typeof next>;

class HttpService {
  private readonly http = createServer((req, res) => this.handleRequest(req, res));
  private readonly audio = createAudioServer();
  private readonly handle: ReturnType<NextApp['getRequestHandler']>;

  constructor(private readonly app: NextApp) {
    this.handle = app.getRequestHandler();
    this.http.on('upgrade', this.upgrade);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      await this.handle(request, response);
    } catch (error) {
      console.error('HTTP request failed:', error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  private upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/audio') return;
    const server = this.audio.server;
    const connected = (ws: WebSocket) => server.emit('connection', ws, request);
    this.audio.server.handleUpgrade(request, socket, head, connected);
  };

  async listen({ host, port }: { host: string; port: number }) {
    const listening = once(this.http, 'listening');
    this.http.listen(port, host);
    await listening;
  }

  async close() {
    abortPendingOperations();
    await this.audio.close();
    await waitForInteractions();
    await this.app.close();
    await this.http[Symbol.asyncDispose]();
  }
}

async function initialize() {
  try {
    mkdirSync(recordingsDir, { recursive: true });
    const dev = process.argv.includes('--dev');
    const app = next({ dev, dir: serverRoot, hostname: '0.0.0.0', port: serverPort });
    await app.prepare();
    return new HttpService(app);
  } catch (error) {
    server = undefined;
    throw error;
  }
}

export function getHttpServer() {
  server ??= initialize();
  return server;
}
