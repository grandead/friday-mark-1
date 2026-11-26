import {
  CalendarDays,
  CircleUserRound,
  Cpu,
  Headphones,
  ListChecks,
  MessageSquareText,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { USER_ERRORS } from '../../shared/user-errors.ru';
import { formatDate, formatTime, getInteractionStatusText, type Interaction } from '../lib/journal';

function AudioPlayer({
  interactionId,
  kind,
  label,
}: {
  interactionId: string;
  kind: 'input' | 'output';
  label: string;
}) {
  const src = `/api/audio/${interactionId}/${kind}`;
  return (
    <div className="player">
      <div className="label">
        <Headphones size={15} />
        {label}
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: The transcript and assistant reply are displayed as text in this interaction. */}
      <audio key={src} controls preload="metadata" aria-label={label} src={src} />
    </div>
  );
}

export function InteractionDetail({ interaction }: { interaction: Interaction }) {
  return (
    <Card
      role="article"
      className="panel detail"
      aria-label={`Обращение ${formatDate(interaction.startedAt)}, ${formatTime(interaction.startedAt)}`}
      data-interaction-id={interaction.id}
    >
      <div className="meta">
        <span>
          <CalendarDays />
          {formatDate(interaction.startedAt)} {new Date(interaction.startedAt).getFullYear()},{' '}
          {formatTime(interaction.startedAt)}
        </span>
        <span>
          <Cpu />
          {interaction.device.displayName}
        </span>
        <span>
          <CircleUserRound />
          {interaction.user.displayName}
        </span>
        <Badge variant="secondary" className={`status ${interaction.status}`}>
          {getInteractionStatusText(interaction.status)}
        </Badge>
      </div>
      {interaction.hasInputAudio && (
        <AudioPlayer interactionId={interaction.id} kind="input" label="Входящая запись" />
      )}
      <section className="transcript">
        <h3>
          <MessageSquareText />
          Расшифровка
        </h3>
        <p>
          {interaction.transcript?.trim() ||
            (interaction.status === 'processing' ? 'Идёт распознавание…' : 'Расшифровки нет.')}
        </p>
      </section>
      {interaction.responseText && (
        <section>
          <h3>{interaction.responseSource === 'llm' ? 'Ответ LLM' : 'Ответ Пятницы'}</h3>
          <p>{interaction.responseText}</p>
        </section>
      )}
      {interaction.hasOutputAudio && (
        <AudioPlayer interactionId={interaction.id} kind="output" label="Исходящая запись" />
      )}
      {interaction.actions.length > 0 && (
        <section className="actions">
          <h3>
            <ListChecks />
            Действия
          </h3>
          {interaction.actions.map(renderAction)}
        </section>
      )}
      {interaction.error && <p className="error">{USER_ERRORS[interaction.error.code]}</p>}
    </Card>
  );
}

function renderAction(a: Interaction['actions'][number]) {
  return (
    <details key={a.id}>
      <summary>
        {a.service} · {a.operation}
      </summary>
      <pre>
        {JSON.stringify(
          {
            initiator: a.initiator,
            arguments: a.arguments,
            result: a.result,
            error: a.error ? USER_ERRORS[a.error.code] : null,
          },
          null,
          2,
        )}
      </pre>
    </details>
  );
}
