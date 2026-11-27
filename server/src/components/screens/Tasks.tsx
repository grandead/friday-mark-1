'use client';

import { ListChecks, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TaskForm } from '@/components/TaskForm';
import { Button } from '@/components/ui/button';
import { useTasks } from '@/hooks/useTasks';
import { userError } from '@/lib/errors';
import { type Task, writeTask } from '@/lib/tasks';

export function Tasks() {
  const { tasks, reconnecting, error, refresh } = useTasks();
  const done = tasks?.filter((task) => task.status === 'Done').length ?? 0;
  const row = (task: Task) => <TaskRow key={task.id} task={task} refresh={refresh} />;
  return (
    <main className="wrap tasks-page">
      <div className="page-heading">
        <h1>Список задач</h1>
        <TaskForm refresh={refresh} />
      </div>
      {reconnecting && (
        <p className="notice" role="status">
          Восстанавливаем соединение…
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <Button className="retry" onClick={refresh}>
            Повторить
          </Button>
        </div>
      )}
      {tasks === null && !error && (
        <p className="notice" role="status">
          Загружаем задачи…
        </p>
      )}
      {tasks?.length === 0 && (
        <div className="panel home-empty">
          <span className="empty-icon">
            <ListChecks size={30} aria-hidden />
          </span>
          <h2>Задач пока нет</h2>
        </div>
      )}
      {!!tasks?.length && (
        <section className="panel task-panel" aria-label="Задачи">
          <div className="task-progress">
            <span>
              Выполнено{' '}
              <strong>
                {done} из {tasks.length}
              </strong>
            </span>
            <progress aria-label="Выполнено задач" value={done} max={tasks.length} />
          </div>
          <ul className="task-list">{tasks.map(row)}</ul>
        </section>
      )}
    </main>
  );
}

function TaskRow({ task, refresh }: { task: Task; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = task.status === 'Done';
  const change = (remove: boolean) => changeTask(task, remove, refresh, setBusy, setError);
  return (
    <li className="task-row">
      <label className="task-check">
        <input type="checkbox" checked={done} disabled={busy} onChange={() => change(false)} />
        <span>{task.title}</span>
      </label>
      <div className="task-actions">
        <TaskForm task={task} refresh={refresh} disabled={busy} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="icon-button task-remove"
          aria-label={`Удалить задачу «${task.title}»`}
          title="Удалить задачу"
          disabled={busy}
          onClick={() => change(true)}
        >
          <Trash2 size={17} aria-hidden />
        </Button>
      </div>
      {task.description && <p className="task-description">{task.description}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

async function changeTask(
  task: Task,
  remove: boolean,
  refresh: () => void,
  setBusy: (busy: boolean) => void,
  setError: (error: string) => void,
) {
  setBusy(true);
  setError('');
  try {
    if (remove) await writeTask('DELETE', task.id);
    else {
      const status = task.status === 'Done' ? 'Pending' : 'Done';
      await writeTask('PATCH', task.id, { status });
    }
    await refresh();
  } catch (error) {
    const message = userError(error);
    setError(message);
  } finally {
    setBusy(false);
  }
}
