import { type ErrorCode, errorResponse, isErrorCode } from '../../../../../shared/errors';
import type { listInteractions } from '../_data/list-interactions';

type InteractionRow = Awaited<ReturnType<typeof listInteractions>>['rows'][number];

export function serializeInteraction({
  inputAudioKey,
  outputAudioKey,
  startedAt,
  device,
  user,
  error,
  actions,
  ...row
}: InteractionRow) {
  if (!device || !user) throw new Error('Interaction relations are missing');
  return {
    ...row,
    error: publicDiagnostic(
      error,
      row.status === 'incomplete' ? 'recording_interrupted' : 'internal_error',
    ),
    actions: actions.map(serializeAction),
    device,
    user,
    startedAt: startedAt.toISOString(),
    hasInputAudio: inputAudioKey?.endsWith('.wav') ?? false,
    hasOutputAudio: outputAudioKey?.endsWith('.wav') ?? false,
  };
}

function serializeAction({ error, ...action }: InteractionRow['actions'][number]) {
  return { ...action, error: publicDiagnostic(error, 'internal_error') };
}

function publicDiagnostic(diagnostic: string | null, fallback: ErrorCode) {
  if (!diagnostic) return null;
  const [prefix] = diagnostic.split(':', 1);
  const code = isErrorCode(prefix) ? prefix : fallback;
  return errorResponse(code);
}
