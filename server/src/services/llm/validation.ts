import { z } from 'zod';

const ARGUMENT_KEY = z.string();
const ARGUMENT_VALUE = z.unknown();
const FUNCTION_FIELDS = {
  name: z.string().min(1).max(100),
  arguments: z.record(ARGUMENT_KEY, ARGUMENT_VALUE),
};
const TOOL_CALL_FIELDS = { function: z.object(FUNCTION_FIELDS) };
const TOOL_CALL = z.object(TOOL_CALL_FIELDS);
const MESSAGE_FIELDS = {
  content: z.string().trim().max(6000),
  tool_calls: z.array(TOOL_CALL).optional(),
};
const MESSAGE = z
  .object(MESSAGE_FIELDS)
  .refine((message) => message.content.length > 0 || Boolean(message.tool_calls?.length));
const TOKEN_COUNT = z.number().int().nonnegative().default(0);
const REPLY_FIELDS = {
  model: z.string().min(1),
  done: z.literal(true),
  done_reason: z.string().optional(),
  message: MESSAGE,
  prompt_eval_count: TOKEN_COUNT,
  eval_count: TOKEN_COUNT,
};
export const OLLAMA_REPLY_SCHEMA = z.object(REPLY_FIELDS);
