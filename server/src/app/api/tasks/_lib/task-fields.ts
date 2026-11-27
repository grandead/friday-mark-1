import { z } from 'zod';

const TEXT = z.string().refine((value) => !value.includes('\0'));

export const TASK_FIELDS = {
  title: TEXT.trim().min(1).max(120),
  description: TEXT.nullable().optional(),
};
