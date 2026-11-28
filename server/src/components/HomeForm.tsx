import { Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppError } from '../../shared/errors';
import { userError } from '../lib/errors';
import {
  type DeviceType,
  type Home,
  type HomeDevice,
  homeRequest,
  type Room,
} from '../lib/smart-home';

export type HomeFormTarget =
  | { kind: 'home' }
  | { kind: 'room'; home: Home }
  | { kind: 'device'; room: Room };
export type CreatedHomeEntity =
  | { kind: 'home'; value: Pick<Home, 'id' | 'displayName'> }
  | { kind: 'room'; value: Omit<Room, 'devices'> }
  | { kind: 'device'; value: HomeDevice };

export function HomeForm({
  target,
  types,
  onClose,
  onSaved,
}: {
  target: HomeFormTarget;
  types: DeviceType[];
  onClose: () => void;
  onSaved: (entity: CreatedHomeEntity) => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const type = types.find((item) => item.id === typeId);
  const title =
    target.kind === 'home'
      ? 'Новый дом'
      : target.kind === 'room'
        ? 'Новая комната'
        : 'Добавить устройство';

  const form = { target, type, busy, onSaved, onClose, setBusy, setError };
  const submit = (event: FormEvent<HTMLFormElement>) => submitForm(event, form);
  const choose = (value: string) => chooseType(value, setTypeId, setError);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="home-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => busy && event.preventDefault()}
      >
        <div className="form-heading">
          <DialogTitle>{title}</DialogTitle>
          <Button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </div>
        <DialogDescription className="muted form-description">
          {target.kind === 'home'
            ? 'Дом объединяет комнаты и их устройства.'
            : target.kind === 'room'
              ? `Дом: ${target.home.displayName}`
              : `Комната: ${target.room.displayName}`}
        </DialogDescription>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="home-fields">
            <Label className="form-field">
              {target.kind === 'device' ? 'Название устройства' : 'Название'}
              <Input
                autoFocus
                required
                maxLength={120}
                name="name"
                placeholder={
                  target.kind === 'home'
                    ? 'Например, Квартира'
                    : target.kind === 'room'
                      ? 'Например, Спальня'
                      : 'Например, Бризер у окна'
                }
              />
            </Label>
            {target.kind === 'device' && (
              <>
                <Label className="form-field">
                  Модель устройства
                  <Select required disabled={busy} value={typeId} onValueChange={choose}>
                    <SelectTrigger aria-label="Модель устройства">
                      <SelectValue placeholder="Выберите модель" />
                    </SelectTrigger>
                    <SelectContent>{types.map(renderType)}</SelectContent>
                  </Select>
                </Label>
                {type && <ConnectionFields key={type.id} type={type} />}
              </>
            )}
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              Отмена
            </Button>
            <Button
              type="submit"
              className="button primary"
              disabled={busy || (target.kind === 'device' && !types.length)}
            >
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Сохраняем…
                </>
              ) : target.kind === 'device' ? (
                'Добавить устройство'
              ) : (
                'Создать'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function chooseType(id: string, select: (id: string) => void, setError: (message: string) => void) {
  select(id);
  setError('');
}
function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
type FormState = {
  target: HomeFormTarget;
  type?: DeviceType;
  busy: boolean;
  onSaved: (entity: CreatedHomeEntity) => void;
  onClose: () => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
};
async function submitForm(event: FormEvent<HTMLFormElement>, form: FormState) {
  const { target, type, busy, onSaved, onClose, setBusy, setError } = form;
  event.preventDefault();
  if (busy) return;
  const data = new FormData(event.currentTarget);
  const displayName = field(data, 'name');
  if (!displayName) {
    setError('Введите название.');
    return;
  }
  setBusy(true);
  setError('');
  try {
    if (target.kind === 'home') {
      const value = await homeRequest<Pick<Home, 'id' | 'displayName'>>('/api/smart-home/homes', {
        displayName,
      });
      onSaved({ kind: 'home', value });
    } else if (target.kind === 'room') {
      const value = await homeRequest<Omit<Room, 'devices'>>('/api/smart-home/rooms', {
        homeId: target.home.id,
        displayName,
      });
      onSaved({ kind: 'room', value });
    } else {
      if (!type) throw new AppError('model_required');
      const registrationData = { ip: field(data, 'ip'), token: field(data, 'token') };
      const value = await homeRequest<HomeDevice>('/api/smart-home/devices', {
        roomId: target.room.id,
        typeId: type.id,
        displayName,
        registrationData,
      });
      onSaved({ kind: 'device', value });
    }
    onClose();
  } catch (error) {
    const message = userError(error);
    setError(message);
    setBusy(false);
  }
}

function renderType(item: DeviceType) {
  return (
    <SelectItem key={item.id} value={item.id}>
      {item.displayName}
    </SelectItem>
  );
}
function ConnectionFields({ type }: { type: DeviceType }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="connection-fields">
      <h3>Данные подключения</h3>
      <Label className="form-field">
        IP-адрес
        <Input
          required
          inputMode="decimal"
          autoComplete="off"
          placeholder="192.168.1.100"
          name="ip"
        />
      </Label>
      <Label className="form-field" htmlFor="device-token">
        {type.registrationType === 'miioToken' ? 'Токен Xiaomi' : 'Токен Ballu'}
      </Label>
      <div className="secret-field">
        <Input
          id="device-token"
          required
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          minLength={32}
          maxLength={32}
          pattern="[a-fA-F0-9]{32}"
          title="32 символа: цифры и буквы от a до f"
          name="token"
          aria-describedby="token-hint"
        />
        <Button
          type="button"
          className="icon-button"
          aria-label={visible ? 'Скрыть токен' : 'Показать токен'}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </Button>
      </div>
      <p className="field-hint" id="token-hint">
        {type.registrationType === 'miioToken'
          ? 'Локальный токен устройства из Xiaomi Cloud Tokens Extractor.'
          : 'Локальный токен Ballu из 32 шестнадцатеричных символов.'}
      </p>
      <p className="registration-note">
        Сохраним данные подключения. Связь с прибором на этом шаге не проверяется.
      </p>
    </div>
  );
}
