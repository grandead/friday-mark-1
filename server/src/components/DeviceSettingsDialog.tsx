import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestError, userError } from '@/lib/errors';
import { DeviceModelCode, type DeviceType, type HomeDevice, homeRequest } from '@/lib/smart-home';
import { ConnectionFields } from './HomeForm';
import { SmartmiFilterReset } from './SmartmiFilterReset';

type Settings = { displayName: string; ip: string };
export type DeviceAction = { device: HomeDevice; action: 'edit' | 'delete' };
type Props = DeviceAction & {
  type: DeviceType;
  onClose: () => void;
  onChanged: (message: string) => void;
};

export function DeviceSettingsDialog({ device, action, type, onClose, onChanged }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmDelete = action === 'delete';
  const [error, setError] = useState('');
  const url = `/api/smart-home/devices/${device.id}`;
  useEffect(
    () => (confirmDelete ? undefined : loadSettings(url, setSettings, setError)),
    [url, confirmDelete],
  );
  const callbacks = { url, busy, setBusy, setError, onChanged, onClose };
  const submit = (event: FormEvent<HTMLFormElement>) => save(event, settings, callbacks);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="home-dialog" showCloseButton={false}>
        <DialogTitle>
          {confirmDelete ? 'Удалить устройство?' : 'Редактировать устройство'}
        </DialogTitle>
        <DialogDescription className="muted form-description">
          {confirmDelete
            ? `«${device.displayName}» будет удалено из комнаты вместе с сохранёнными данными подключения.`
            : type.displayName}
        </DialogDescription>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {confirmDelete ? (
          <div className="form-actions">
            <Button className="button secondary" disabled={busy} onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => mutate(callbacks, 'DELETE')}
            >
              Удалить устройство
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {settings ? (
              <fieldset className="home-fields" disabled={busy}>
                <Label className="form-field">
                  Название устройства
                  <Input
                    autoFocus
                    required
                    maxLength={120}
                    name="displayName"
                    defaultValue={settings.displayName}
                  />
                </Label>
                <ConnectionFields type={type} ip={settings.ip} />
                {type.code === DeviceModelCode.SmartmiFreshAir && (
                  <SmartmiFilterReset device={device} />
                )}
              </fieldset>
            ) : (
              !error && <p role="status">Загружаем настройки…</p>
            )}
            <div className="form-actions">
              <Button type="button" className="button secondary" disabled={busy} onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" className="button primary" disabled={busy || !settings}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function loadSettings(
  url: string,
  update: (settings: Settings) => void,
  fail: (message: string) => void,
) {
  const controller = new AbortController();
  void readSettings(url, controller.signal, update, fail);
  return () => controller.abort();
}

async function readSettings(
  url: string,
  signal: AbortSignal,
  update: (settings: Settings) => void,
  fail: (message: string) => void,
) {
  try {
    const settings = await homeRequest<Settings>(url, undefined, signal);
    if (!signal.aborted) update(settings);
  } catch (error) {
    const message = userError(error);
    if (!signal.aborted) fail(message);
  }
}

function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

type Callbacks = Pick<Props, 'onChanged' | 'onClose'> & {
  url: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
};

function save(event: FormEvent<HTMLFormElement>, settings: Settings | null, callbacks: Callbacks) {
  event.preventDefault();
  if (!settings || callbacks.busy) return;
  const data = new FormData(event.currentTarget);
  const displayName = field(data, 'displayName');
  const ip = field(data, 'ip');
  const token = field(data, 'token');
  const changes: Partial<Settings & { token: string }> = {};
  if (displayName !== settings.displayName) changes.displayName = displayName;
  if (ip !== settings.ip) changes.ip = ip;
  if (token) changes.token = token;
  if (!Object.keys(changes).length) return callbacks.onClose();
  void mutate(callbacks, 'PATCH', changes);
}

async function mutate(
  callbacks: Callbacks,
  method: 'PATCH' | 'DELETE',
  changes?: Partial<Settings & { token: string }>,
) {
  if (callbacks.busy) return;
  callbacks.setBusy(true);
  callbacks.setError('');
  try {
    const body = JSON.stringify(changes);
    const response = await fetch(callbacks.url, {
      method,
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw await requestError(response);
    callbacks.onChanged(
      method === 'DELETE' ? 'Устройство удалено.' : 'Настройки устройства сохранены.',
    );
  } catch (error) {
    const message = userError(error);
    callbacks.setError(message);
    callbacks.setBusy(false);
  }
}
