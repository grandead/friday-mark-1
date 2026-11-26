import { z } from 'zod';
import { errorResponse } from '../../../../shared/errors';
import { listInteractions } from './_data/list-interactions';
import { serializeInteractionPage } from './_lib/serialize-interaction-page';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);
    const parsed = QUERY_SCHEMA.safeParse(query);
    if (!parsed.success) {
      const error = errorResponse('invalid_journal_query');
      return Response.json(error, { status: 400 });
    }
    const interactions = await listInteractions(parsed.data);
    const page = serializeInteractionPage(interactions);
    return Response.json(page);
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}

const OPTIONAL_ID = z.uuidv7().optional();
const OPTIONAL_DATE = z.iso.datetime({ offset: true }).optional();
const QUERY_FIELDS = {
  deviceId: OPTIONAL_ID,
  userId: OPTIONAL_ID,
  beforeId: OPTIONAL_ID,
  from: OPTIONAL_DATE,
  to: OPTIONAL_DATE,
  before: OPTIONAL_DATE,
};
const QUERY_SCHEMA = z
  .object(QUERY_FIELDS)
  .refine((q) => Boolean(q.before) === Boolean(q.beforeId), 'Incomplete cursor')
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), 'Invalid date range');

export type InteractionsQuery = z.infer<typeof QUERY_SCHEMA>;
