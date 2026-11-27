'use client';

import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { userError } from '@/lib/errors';
import { type Task, writeTask } from '@/lib/tasks';

type FormSession = { task?: Task };

export function TaskForm({
  task,
  refresh,
  disabled,
}: {
  task?: Task;
  refresh: () => void;
  disabled?: boolean;
}) {
  const [session, setSession] = useState<FormSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (open: boolean) => toggleForm(open, task, busy, setSession, setError);
  const close = () => setSession(null);
  const initial = session?.task ?? task;
  const action = task ? 'Сохранить' : 'Добавить';
  const pendingAction = task ? 'Сохраняем…' : 'Добавляем…';
  return (
    <Dialog open={session !== null} onOpenChange={toggle}>
      <DialogTrigger asChild>
        {task ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="icon-button"
            aria-label={`Редактировать задачу «${task.title}»`}
            title="Редактировать задачу"
            disabled={disabled}
          >
            <Pencil size={17} aria-hidden />
          </Button>
        ) : (
          <Button type="button" className="button primary">
            <Plus size={17} aria-hidden />
            Добавить задачу
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="home-dialog" showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle>{task ? 'Редактировать задачу' : 'Новая задача'}</DialogTitle>
        <form
          key={session ? 'open' : 'closed'}
          onSubmit={(event) => submitTask(event, initial, refresh, close, setBusy, setError)}
        >
          <fieldset className="home-fields" disabled={busy}>
            <Label className="form-field">
              Название
              <Input name="title" defaultValue={initial?.title} required maxLength={120} />
            </Label>
            <Label className="form-field">
              Описание (необязательно)
              <Textarea name="description" defaultValue={initial?.description ?? ''} rows={3} />
            </Label>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <DialogClose asChild>
              <Button type="button" className="button secondary" disabled={busy}>
                Отмена
              </Button>
            </DialogClose>
            <Button type="submit" className="button primary" disabled={busy}>
              {busy ? pendingAction : action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toggleForm(
  open: boolean,
  task: Task | undefined,
  busy: boolean,
  setSession: (session: FormSession | null) => void,
  setError: (error: string) => void,
) {
  if (busy) return;
  setError('');
  setSession(open ? { task } : null);
}

async function submitTask(
  event: FormEvent<HTMLFormElement>,
  task: Task | undefined,
  refresh: () => void,
  close: () => void,
  setBusy: (busy: boolean) => void,
  setError: (error: string) => void,
) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const title = data.get('title')?.toString().trim();
  const description = data.get('description')?.toString() ?? '';
  if (!title) {
    setError('Введите название задачи.');
    return;
  }
  setBusy(true);
  setError('');
  try {
    const fields: { title?: string; description?: string | null } = {};
    if (title !== task?.title) fields.title = title;
    if (description !== (task?.description ?? '')) fields.description = description.trim() || null;
    if (fields.title !== undefined || fields.description !== undefined) {
      const method = task ? 'PATCH' : 'POST';
      await writeTask(method, task?.id, fields);
    }
    close();
    void refresh();
  } catch (error) {
    const message = userError(error);
    setError(message);
  } finally {
    setBusy(false);
  }
}
