import { z } from 'zod';

export const ollamaReply = z.object({
  model: z.string().min(1),
  done: z.literal(true),
  done_reason: z.string().optional(),
  message: z.object({
    content: z.string().trim().max(6000),
    tool_calls: z.array(z.object({ function: z.object({ name: z.string().min(1).max(100), arguments: z.record(z.string(), z.unknown()) }) })).max(8).optional(),
  }).refine(message => message.content.length > 0 || Boolean(message.tool_calls?.length)),
  prompt_eval_count: z.number().int().nonnegative().default(0),
  eval_count: z.number().int().nonnegative().default(0),
});
