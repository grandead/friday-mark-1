export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ModelReply = {
  text: string;
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type LanguageModel = {
  provider: string;
  model: string;
  generate: (messages: ChatMessage[]) => Promise<ModelReply>;
};
