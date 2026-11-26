import { AppError } from '../../../shared/errors';
import { LLM_CONFIG } from '../../config/llm';
import { getShutdownSignal } from '../runtime';
import type { ChatMessage, ModelReply, ToolDefinition } from './types';
import { OLLAMA_REPLY_SCHEMA } from './validation';

const MAX_TIMEOUT_MS = 2_147_483_647;
const ERROR_DETAIL_LIMIT = 300;

export async function generateResponse(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
): Promise<ModelReply> {
  const { baseUrl, model, timeoutMs } = LLM_CONFIG;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const endpoint = new URL('api/chat', base);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('OLLAMA_BASE_URL must use HTTP or HTTPS');
  if (!model.trim()) throw new Error('OLLAMA_MODEL must not be empty');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`LLM_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMEOUT_MS}`);

  const shutdown = getShutdownSignal();
  if (shutdown.aborted) throw new AppError('processing_stopped');
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([shutdown, timeout]);
  const hasTools = Boolean(tools?.length);
  const requestBody = JSON.stringify({
    model,
    messages,
    tools,
    stream: false,
    think: hasTools,
    keep_alive: '15m',
    options: {
      num_ctx: 8192,
      num_predict: hasTools ? 2048 : 512,
      temperature: hasTools ? 0 : 0.6,
    },
  });
  const started = performance.now();
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    responseText = await response.text();
  } catch (error) {
    if (shutdown.aborted) throw new AppError('processing_stopped');
    if (signal.aborted)
      throw new AppError('llm_timeout', `Ollama did not respond within ${timeoutMs} ms.`);
    throw new AppError(
      'llm_unavailable',
      `Failed to obtain an Ollama response (${endpoint.origin}).`,
      { cause: error },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    if (response.ok) throw new AppError('invalid_llm_reply');
  }
  if (!response.ok) {
    let detail = '';
    if (body && typeof body === 'object' && 'error' in body) {
      const message = String(body.error);
      detail = message.slice(0, ERROR_DETAIL_LIMIT);
    }
    throw new AppError(
      'llm_http_error',
      `Ollama HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  // Thinking can exhaust the budget before producing content or tool calls.
  if (body && typeof body === 'object' && 'done_reason' in body && body.done_reason === 'length')
    throw new AppError('llm_reply_too_long');
  const parsed = OLLAMA_REPLY_SCHEMA.safeParse(body);
  if (!parsed.success) throw new AppError('invalid_llm_reply');
  const reply = parsed.data;
  if (reply.message.tool_calls?.length && !hasTools) throw new AppError('tools_not_allowed');
  const elapsedMs = performance.now() - started;
  const durationMs = Math.round(elapsedMs);
  return {
    text: reply.message.content,
    toolCalls: reply.message.tool_calls,
    model: reply.model,
    durationMs,
    inputTokens: reply.prompt_eval_count,
    outputTokens: reply.eval_count,
  };
}
