import {
  Cpu,
  CalendarDays,
  CircleUserRound,
  Headphones,
  ListChecks,
  MessageSquareText,
} from 'lucide-react';
import { date, statusText, time, type Entry } from '../lib/journal';

function Player({ src, label }: { src: string; label: string }) {
  return (
    <div className="player">
      <div className="label">
        <Headphones size={15} />
        {label}
      </div>
      <audio key={src} controls preload="metadata" aria-label={label} src={src} />
    </div>
  );
}

export function EntryDetail({ entry }: { entry: Entry }) {
  return (
    <article className="panel detail" aria-label={`Обращение ${date(entry.startedAt)}, ${time(entry.startedAt)}`} data-entry-id={entry.id}>
      <div className="meta">
        <span>
          <CalendarDays />
          {date(entry.startedAt)} {new Date(entry.startedAt).getFullYear()}, {time(entry.startedAt)}
        </span>
        <span>
          <Cpu />
          {entry.device.displayName}
        </span>
        <span>
          <CircleUserRound />
          {entry.user.displayName}
        </span>
        <span className={'status ' + entry.status}>{statusText(entry.status)}</span>
      </div>
      {entry.inputAudio && <Player src={entry.inputAudio} label="Входящая запись" />}
      <section className="transcript">
        <h3>
          <MessageSquareText />
          Расшифровка
        </h3>
        <p>
          {entry.transcript?.trim() ||
            (entry.status === 'processing' ? 'Идёт распознавание…' : 'Расшифровки нет.')}
        </p>
      </section>
      {entry.responseText && (
        <section>
          <h3>{entry.responseSource === 'llm' ? 'Ответ LLM' : 'Ответ Пятницы'}</h3>
          <p>{entry.responseText}</p>
        </section>
      )}
      {entry.outputAudio && <Player src={entry.outputAudio} label="Исходящая запись" />}
      {entry.actions.length > 0 && (
        <section className="actions">
          <h3>
            <ListChecks />
            Действия
          </h3>
          {entry.actions.map((a) => (
            <details key={a.id}>
              <summary>
                {a.service} · {a.operation}
              </summary>
              <pre>
                {JSON.stringify(
                  {
                    инициатор: a.initiator,
                    аргументы: a.arguments,
                    результат: a.result,
                    ошибка: a.error,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
        </section>
      )}
      {entry.error && <p className="error">{entry.error}</p>}
    </article>
  );
}
