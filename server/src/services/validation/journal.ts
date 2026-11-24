import { z } from 'zod';

export const journalQuery = z
  .object({
    deviceId: z.uuidv7().optional(),
    userId: z.uuidv7().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuidv7().optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
  })
  .refine((q) => Boolean(q.before) === Boolean(q.beforeId), 'Incomplete cursor')
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), 'Invalid date range');
export type JournalQuery = z.infer<typeof journalQuery>;
export const audioParams = z.object({ id: z.uuidv7(), kind: z.enum(['input', 'output']) });
