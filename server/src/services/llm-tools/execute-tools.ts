import { AppError, diagnosticError } from '../../../shared/errors';
import { USER_ERRORS } from '../../../shared/user-errors.ru';
import { orm } from '../database';
import type { ToolCall } from '../llm';
import { MAX_TOOL_CALLS, TOOLS, type ToolOutcome } from './registry';

const INVALID_ARGUMENTS = 'Не удалось разобрать команду. Уточните нужное действие и его параметры.';

export async function executeTools(interactionId: string, calls: ToolCall[]): Promise<string> {
  if (calls.length > MAX_TOOL_CALLS) {
    const reply =
      'За одно обращение могу выполнить до восьми команд. Разделите запрос на несколько частей.';
    await orm.InteractionAction.select('id').create({
      interactionId,
      sequence: 2,
      initiator: 'handler',
      service: 'llmTools',
      operation: 'reject_batch',
      arguments: { count: calls.length },
      result: { status: 'rejected', reply },
    });
    return reply;
  }
  // Preserve model order and each verified outcome without a second model pass.
  const replies: string[] = [];
  for (const [index, call] of calls.entries()) {
    const sequence = index + 2;
    const reply = await executeTool(interactionId, sequence, call);
    replies.push(reply);
  }
  return replies.join(' ');
}

export async function executeTool(
  interactionId: string,
  sequence: number,
  call: ToolCall,
): Promise<string> {
  const entry = TOOLS.get(call.function.name);
  const parsed = entry?.tool.schema.safeParse(call.function.arguments);
  // Never journal unvalidated arguments or an unknown name from model output.
  const args = parsed?.success ? parsed.data : {};
  const action = await orm.InteractionAction.select('id').create({
    interactionId,
    sequence,
    initiator: 'llm',
    service: entry?.section.name ?? 'llmTools',
    operation: entry?.tool.name ?? 'unknown_tool',
    arguments: args,
  });
  let outcome: ToolOutcome;
  if (!entry) {
    outcome = { reply: 'Эта команда пока не поддерживается.', status: 'rejected' };
  } else if (!parsed?.success) {
    outcome = { reply: entry.tool.invalidReply ?? INVALID_ARGUMENTS, status: 'rejected' };
  } else {
    try {
      outcome = await entry.section.execute(entry.tool.name, parsed.data);
    } catch (cause) {
      outcome = failedOutcome(cause);
    }
  }
  // Journal failures propagate; they are not failures of the executed command.
  const { error = null, ...result } = outcome;
  await orm.InteractionAction.select('id').where({ id: action.id }).update({ result, error });
  return outcome.reply;
}

function failedOutcome(cause: unknown): ToolOutcome {
  const code = cause instanceof AppError ? cause.code : 'internal_error';
  const failure = new AppError(code);
  const diagnostic = diagnosticError(failure);
  // Unexpected errors may include credentials. Keep only safe source locations.
  const stack = cause instanceof Error ? (cause.stack?.split('\n') ?? []) : [];
  const locations = stack.filter(isSourceLocation);
  const error = [diagnostic, ...locations].join('\n');
  return { reply: USER_ERRORS[code], status: 'failed', errorCode: failure.code, error };
}

function isSourceLocation(line: string) {
  return /^\s+at [\w.$<> ]*\(?\/?[\w/._-]+\.[cm]?[jt]s:\d+:\d+\)?$/.test(line);
}
