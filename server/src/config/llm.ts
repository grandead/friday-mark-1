import 'dotenv/config';

export const llmConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
};
