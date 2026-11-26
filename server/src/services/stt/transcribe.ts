import 'dotenv/config';
import { getShutdownSignal } from '../runtime';

const DEFAULT_TIMEOUT_MS = 300_000;
const ERROR_LIMIT = 8000;

export async function transcribe(wav: Uint8Array): Promise<string> {
  const shutdown = getShutdownSignal();
  shutdown.throwIfAborted();
  const baseUrl = process.env.WHISPER_BASE_URL ?? 'http://127.0.0.1:33001';
  const url = new URL('/inference', baseUrl);
  const timeoutMs = Number(process.env.WHISPER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('WHISPER_TIMEOUT_MS must be a positive integer up to 2147483647');
  }
  const bytes = new Uint8Array(wav);
  const file = new Blob([bytes], { type: 'audio/wav' });
  const body = new FormData();
  body.set('file', file, 'recording.wav');
  body.set('language', process.env.WHISPER_LANGUAGE ?? 'ru');
  body.set('response_format', 'json');
  body.set('temperature_inc', '0');
  body.set('no_context', 'true');

  const controller = new AbortController();
  const onShutdown = () => controller.abort(shutdown.reason);
  const timeoutError = new Error('Whisper request timed out');
  timeoutError.name = 'TimeoutError';
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  shutdown.addEventListener('abort', onShutdown, { once: true });
  try {
    const response = await fetch(url, { method: 'POST', body, signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Whisper returned HTTP ${response.status}`);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') throw new Error('Invalid Whisper response');
    // whisper-server 1.8.2 can return an error object with HTTP 200.
    if ('error' in result) {
      const message = String(result.error);
      const diagnostic = message.slice(0, ERROR_LIMIT);
      throw new Error(`Whisper failed: ${diagnostic}`);
    }
    if (!('text' in result) || typeof result.text !== 'string') {
      throw new Error('Whisper response is missing text');
    }
    return result.text.trim();
  } finally {
    clearTimeout(timeout);
    shutdown.removeEventListener('abort', onShutdown);
  }
}
