import type { Prisma, PrismaClient } from '@prisma/client';
import { basename } from 'node:path';
import type { JournalQuery } from '../validation/journal.js';

export function listDevices(db: PrismaClient) {
  return db.device.findMany({
    select: { id: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
}

export function listUsers(db: PrismaClient) {
  return db.user.findMany({
    select: { id: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
}

const entrySelect = {
  id: true, deviceId: true, userId: true, startedAt: true, status: true,
  transcript: true, responseText: true, responseSource: true, error: true,
  inputAudioKey: true, outputAudioKey: true,
  device: { select: { id: true, displayName: true } },
  user: { select: { id: true, displayName: true } },
  actions: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true, initiator: true, service: true, operation: true,
      arguments: true, result: true, error: true,
    },
  },
} satisfies Prisma.InteractionSelect;

type EntryRow = Prisma.InteractionGetPayload<{ select: typeof entrySelect }>;

function serializeEntry({ inputAudioKey, outputAudioKey, startedAt, ...row }: EntryRow) {
  return {
    ...row,
    startedAt: startedAt.toISOString(),
    inputAudio: audioUrl(row.id, 'input', inputAudioKey),
    outputAudio: audioUrl(row.id, 'output', outputAudioKey),
  };
}

export async function getJournalEntry(db: PrismaClient, id: string) {
  const row = await db.interaction.findUnique({ where: { id }, select: entrySelect });
  return row ? serializeEntry(row) : null;
}

export async function listInteractions(db: PrismaClient, query: JournalQuery) {
  const { deviceId, userId, from, to, before, beforeId, page } = query;
  const pageSize = 15;
  const where: Prisma.InteractionWhereInput = {
    deviceId, userId,
    startedAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
  };
  const cursor: Prisma.InteractionWhereInput = before && beforeId ? {
    OR: [
      { startedAt: { lt: new Date(before) } },
      { startedAt: new Date(before), id: { lt: beforeId } },
    ],
  } : {};
  const [total, rows] = await db.$transaction([
    db.interaction.count({ where }),
    db.interaction.findMany({
      where: { AND: [where, cursor] },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: before ? 0 : (page - 1) * pageSize,
      take: pageSize + 1,
      select: entrySelect,
    }),
  ]);
  const items = rows.slice(0, pageSize).map(serializeEntry);
  const last = items.at(-1);
  return {
    page, pageSize, total, items,
    nextCursor: rows.length > pageSize && last ? { startedAt: last.startedAt, id: last.id } : null,
  };
}

function audioUrl(id: string, kind: 'input' | 'output', key: string | null) {
  return key && key.endsWith('.wav') ? `/api/interactions/${id}/audio/${kind}` : null;
}

export async function audioKey(db: PrismaClient, id: string, kind: 'input' | 'output') {
  const row = await db.interaction.findUnique({
    where: { id },
    select: { inputAudioKey: true, outputAudioKey: true },
  });
  const key = kind === 'input' ? row?.inputAudioKey : row?.outputAudioKey;
  return key && basename(key) === key && key.endsWith('.wav') ? key : null;
}
