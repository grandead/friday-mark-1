import { ollamaReply } from '../validation/llm.js';
import type { LanguageModel } from './types.js';

export type OllamaOptions = { baseUrl: string; model: string; timeoutMs: number; signal: AbortSignal };

export function createOllama(options: OllamaOptions): LanguageModel {
  const { baseUrl, model, timeoutMs, signal: shutdown } = options;
  const endpoint = new URL('api/chat', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('OLLAMA_BASE_URL must use HTTP or HTTPS');
  if (!model.trim()) throw new Error('OLLAMA_MODEL must not be empty');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('LLM_TIMEOUT_MS must be a positive integer');

  return {
    provider: 'ollama', model,
    async generate(messages) {
      const started = performance.now();
      const signal = AbortSignal.any([shutdown, AbortSignal.timeout(timeoutMs)]);
      let response: Response;
      let body: unknown;
      try {
        response = await fetch(endpoint, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, messages, stream: false, think: false, keep_alive: '15m',
            options: { num_ctx: 8192, num_predict: 512, temperature: 0.6 },
          }),
        });
        body = await response.json();
      } catch (error) {
        if (shutdown.aborted) throw new Error('Обработка остановлена вместе с сервером');
        if (signal.aborted) throw new Error(`Ollama не ответила за ${timeoutMs / 1000} с`);
        throw new Error(`Не удалось получить ответ Ollama (${endpoint.origin})`, { cause: error });
      }
      if (!response.ok) {
        const detail = typeof body === 'object' && body && 'error' in body ? String(body.error).slice(0, 300) : '';
        throw new Error(`Ollama HTTP ${response.status}${detail ? ': ' + detail : ''}`);
      }
      const parsed = ollamaReply.safeParse(body);
      if (!parsed.success) throw new Error('Ollama вернула пустой или некорректный ответ');
      const reply = parsed.data;
      if (reply.done_reason === 'length') throw new Error('Ответ Ollama превысил лимит длины');
      if (reply.message.tool_calls?.length) throw new Error('Вызовы инструментов LLM пока не подключены');
      return {
        text: reply.message.content, model: reply.model,
        durationMs: Math.round(performance.now() - started),
        inputTokens: reply.prompt_eval_count, outputTokens: reply.eval_count,
      };
    },
  };
}
