import type { listInteractions } from '../_data/list-interactions';
import { serializeInteraction } from './serialize-interaction';
export function serializeInteractionPage({
  rows,
  pageSize,
}: Awaited<ReturnType<typeof listInteractions>>) {
  const items = rows.slice(0, pageSize).map(serializeInteraction);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > pageSize && last ? { startedAt: last.startedAt, id: last.id } : null,
  };
}
