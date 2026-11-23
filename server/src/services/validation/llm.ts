import { z } from 'zod';

export const ollamaReply = z.object({
  model: z.string().min(1),
  done: z.literal(true),
  done_reason: z.string().optional(),
  message: z.object({
    content: z.string().trim().min(1).max(6000),
    tool_calls: z.array(z.unknown()).optional(),
  }),
  prompt_eval_count: z.number().int().nonnegative().default(0),
  eval_count: z.number().int().nonnegative().default(0),
});
