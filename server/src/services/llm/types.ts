export type ToolCall = { function: { name: string; arguments: Record<string, unknown> } };
export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

export type ModelReply = {
  text: string;
  toolCalls?: ToolCall[];
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};
export type GenerateResponse = (
  messages: ChatMessage[],
  tools?: ToolDefinition[],
) => Promise<ModelReply>;
