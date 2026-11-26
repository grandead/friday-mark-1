import { AppError } from '../../../shared/errors';
import { processInteraction } from './process-interaction';
import type { InteractionAudio, InteractionEvent } from './types';

const MAX_PENDING_INTERACTIONS = 4;
type InteractionQueue = { tail: Promise<void>; pending: number; reservations: Set<string> };

const state = globalThis as typeof globalThis & { fridayInteractionQueue?: InteractionQueue };
state.fridayInteractionQueue ??= { tail: Promise.resolve(), pending: 0, reservations: new Set() };
const queue = state.fridayInteractionQueue;

export function reserveInteraction(id: string) {
  const count = getPendingInteractionCount();
  if (count >= MAX_PENDING_INTERACTIONS) throw new AppError('interaction_queue_full');
  queue.reservations.add(id);
}

export function releaseInteraction(id: string) {
  queue.reservations.delete(id);
}

export function enqueueInteraction(
  id: string,
  audio: InteractionAudio,
  notify: (event: InteractionEvent) => void,
) {
  if (!queue.reservations.has(id)) reserveInteraction(id);
  releaseInteraction(id);
  queue.pending++;
  queue.tail = queue.tail
    .then(() => processInteraction(id, audio, notify))
    .catch(reportProcessingError)
    .finally(finishInteraction);
}

export function getPendingInteractionCount() {
  return queue.pending + queue.reservations.size;
}

export function waitForInteractions() {
  return queue.tail;
}

function reportProcessingError(error: unknown) {
  console.error('Failed to process interaction:', error);
}

function finishInteraction() {
  queue.pending--;
}
