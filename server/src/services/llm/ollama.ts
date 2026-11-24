import { AppError } from '../../../shared/errors.js';
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
    async generate(messages, tools) {
      const started = performance.now();
      const signal = AbortSignal.any([shutdown, AbortSignal.timeout(timeoutMs)]);
      let response: Response;
      let body: unknown;
      try {
        response = await fetch(endpoint, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, messages, tools, stream: false, think: Boolean(tools?.length), keep_alive: '15m',
            options: { num_ctx: 8192, num_predict: tools?.length ? 2048 : 512, temperature: tools?.length ? 0 : 0.6 },
          }),
        });
        body = await response.json();
      } catch (error) {
        if (shutdown.aborted) throw new AppError('processing_stopped');
        if (signal.aborted) throw new AppError('llm_timeout', `Ollama did not respond within ${timeoutMs} ms.`);
        throw new AppError('llm_unavailable', `Failed to obtain an Ollama response (${endpoint.origin}).`, { cause: error });
      }
      if (!response.ok) {
        const detail = typeof body === 'object' && body && 'error' in body ? String(body.error).slice(0, 300) : '';
        throw new AppError('llm_http_error', `Ollama HTTP ${response.status}${detail ? ': ' + detail : ''}`);
      }
      // Thinking can exhaust the budget before producing any content/tool call.
      if (body && typeof body === 'object' && 'done_reason' in body && body.done_reason === 'length') throw new AppError('llm_reply_too_long');
      const parsed = ollamaReply.safeParse(body);
      if (!parsed.success) throw new AppError('invalid_llm_reply');
      const reply = parsed.data;
      if (reply.message.tool_calls?.length && !tools?.length) throw new AppError('tools_not_allowed');
      return {
        text: reply.message.content, toolCalls: reply.message.tool_calls, model: reply.model,
        durationMs: Math.round(performance.now() - started),
        inputTokens: reply.prompt_eval_count, outputTokens: reply.eval_count,
      };
    },
  };
}
