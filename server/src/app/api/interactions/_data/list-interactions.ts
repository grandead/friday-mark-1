import { orm } from '@/services/database';
import type { InteractionsQuery } from '../route';

const PAGE_SIZE = 15;

export async function listInteractions(query: InteractionsQuery) {
  const { deviceId, userId, from, to, before, beforeId } = query;
  let interactions = orm.Interaction.select(
    'id',
    'deviceId',
    'userId',
    'startedAt',
    'status',
    'transcript',
    'responseText',
    'responseSource',
    'error',
    'inputAudioKey',
    'outputAudioKey',
  )
    .include('device', (row) => row.select('id', 'displayName'))
    .include('user', (row) => row.select('id', 'displayName'))
    .include('actions', selectActions)
    .orderBy([(row) => row.startedAt.desc(), (row) => row.id.desc()]);
  if (deviceId) interactions = interactions.where({ deviceId });
  if (userId) interactions = interactions.where({ userId });
  if (from) {
    const fromDate = new Date(from);
    interactions = interactions.where((r) => r.startedAt.gte(fromDate));
  }
  if (to) {
    const toDate = new Date(to);
    interactions = interactions.where((r) => r.startedAt.lte(toDate));
  }
  if (before && beforeId) {
    const startedAt = new Date(before);
    interactions = interactions.cursor({ startedAt, id: beforeId });
  }
  const rows = await interactions.limit(PAGE_SIZE + 1).all();
  return { rows, pageSize: PAGE_SIZE };
}

export function selectActions(actions: Pick<typeof orm.InteractionAction, 'select'>) {
  return actions
    .select('id', 'initiator', 'service', 'operation', 'arguments', 'result', 'error')
    .orderBy((action) => action.sequence.asc());
}
