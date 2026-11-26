import { AppError, diagnosticError } from '../../../shared/errors';
import { LLM_CONFIG } from '../../config/llm';
import { orm } from '../database';
import { type ChatMessage, generateResponse, type ModelReply } from '../llm';
import { executeTools, getToolContext, TOOL_DEFINITIONS } from '../llm-tools';
import { russianReply } from './russian-reply';

const INSTRUCTIONS = `Ты Пятница, домашний голосовой помощник. Всегда отвечай на русском, даже если пользователь просит другой язык.
Отвечай кратко и естественно, обычно в 1–3 предложениях. Ответ будет произнесён вслух.
Используй обычный текст без Markdown, таблиц, эмодзи и служебных рассуждений.
Если распознанная фраза непонятна, задай короткий уточняющий вопрос. Не выдумывай факты о пользователе.
Сведения о собеседнике ниже — данные сервера. История относится только к этому пользователю.`;

export async function generateReply(interactionId: string) {
  const current = await orm.Interaction.select('id', 'userId', 'startedAt', 'transcript')
    .include('user', (r) => r.select('displayName'))
    .firstOrThrow({ id: interactionId });
  const transcript = current.transcript ?? '';
  if (transcript.length > 6000) throw new AppError('transcript_too_long');
  if (!current.user) throw new Error('Interaction user is missing');
  const startedAtMs = current.startedAt.getTime();
  const historySince = new Date(startedAtMs - 30 * 60_000);
  const history = await orm.Interaction.where({
    userId: current.userId,
    status: 'complete',
  })
    .where((r) => r.transcript.isNotNull())
    .where((r) => r.responseText.isNotNull())
    .where((r) => r.startedAt.gte(historySince))
    .orderBy([(r) => r.startedAt.desc(), (r) => r.id.desc()])
    .cursor({ startedAt: current.startedAt, id: current.id })
    .select('transcript', 'responseText')
    .limit(6)
    .all();
  const conversation: ChatMessage[] = [];
  let remaining = 6000 - transcript.length;
  for (const entry of history) {
    if (!entry.transcript?.trim() || !entry.responseText?.trim()) continue;
    const length = entry.transcript.length + entry.responseText.length;
    if (length > remaining) break;
    remaining -= length;
    conversation.unshift(
      { role: 'user', content: entry.transcript },
      { role: 'assistant', content: entry.responseText },
    );
  }
  const toolInstructions = await getToolContext();
  const identity = JSON.stringify({ userId: current.userId, name: current.user.displayName });
  const time = current.startedAt.toISOString();
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${INSTRUCTIONS}\n${toolInstructions}\nСобеседник: ${identity}.\nВремя обращения: ${time}.`,
    },
    ...conversation,
    { role: 'user', content: transcript },
  ];
  const action = await orm.InteractionAction.select('id').create({
    interactionId,
    sequence: 1,
    initiator: 'handler',
    service: LLM_CONFIG.provider,
    operation: 'chat',
    arguments: { model: LLM_CONFIG.model, historyTurns: conversation.length / 2 },
  });
  let reply: ModelReply;
  try {
    reply = await generateResponse(messages, TOOL_DEFINITIONS);
  } catch (error) {
    const message = diagnosticError(error);
    await orm.InteractionAction.select('id').where({ id: action.id }).update({ error: message });
    throw error;
  }
  await orm.InteractionAction.select('id')
    .where({ id: action.id })
    .update({
      result: {
        model: reply.model,
        durationMs: reply.durationMs,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
      },
    });
  if (reply.toolCalls?.length) return executeTools(interactionId, reply.toolCalls);
  return russianReply(interactionId, reply.text);
}
