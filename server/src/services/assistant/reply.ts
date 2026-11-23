import type { PrismaClient } from '@prisma/client';
import type { ChatMessage, LanguageModel } from '../llm/types.js';

const instructions = `Ты Пятница, домашний голосовой помощник. Отвечай по-русски, кратко и естественно, обычно в 1–3 предложениях.
Твой ответ будет произнесён вслух. Используй обычный текст без Markdown, таблиц, эмодзи и служебных рассуждений.
Если распознанная фраза непонятна, задай короткий уточняющий вопрос. Не выдумывай факты о пользователе.
На этом этапе тебе не предоставлены инструменты, доступ к интернету или показания устройств. Не заявляй, что выполнила действие или проверила состояние устройства.
Сведения о собеседнике ниже — данные сервера. История относится только к этому пользователю.`;

export function createAssistant(db: PrismaClient, llm: LanguageModel) {
  return async function generateReply(interactionId: string, transcript: string) {
    if (transcript.length > 6000) throw new Error('Распознанная фраза слишком длинная для голосового диалога');
    const current = await db.interaction.findUniqueOrThrow({
      where: { id: interactionId },
      select: { id: true, userId: true, startedAt: true, user: { select: { displayName: true } } },
    });
    const history = await db.interaction.findMany({
      where: {
        userId: current.userId, status: 'complete', transcript: { not: null }, responseText: { not: null },
        startedAt: { gte: new Date(current.startedAt.getTime() - 30 * 60_000) },
        OR: [
          { startedAt: { lt: current.startedAt } },
          { startedAt: current.startedAt, id: { lt: current.id } },
        ],
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: 6,
      select: { transcript: true, responseText: true },
    });
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
    const messages: ChatMessage[] = [
      { role: 'system', content: `${instructions}\nСобеседник: ${JSON.stringify({ userId: current.userId, name: current.user.displayName })}.\nВремя обращения: ${current.startedAt.toISOString()}.` },
      ...conversation,
      { role: 'user', content: transcript },
    ];
    const action = await db.interactionAction.create({ data: {
      interactionId, sequence: 1, initiator: 'handler', service: llm.provider, operation: 'chat',
      arguments: { model: llm.model, historyTurns: conversation.length / 2 },
    } });
    try {
      const reply = await llm.generate(messages);
      await db.interactionAction.update({ where: { id: action.id }, data: { result: {
        model: reply.model, durationMs: reply.durationMs, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens,
      } } });
      return reply.text;
    } catch (error) {
      await db.interactionAction.update({ where: { id: action.id }, data: { error: String(error) } });
      throw error;
    }
  };
}
