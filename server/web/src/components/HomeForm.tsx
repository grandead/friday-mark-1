import { Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AppError } from '../../../shared/errors';
import { userError } from '../lib/errors';
import {
  type DeviceType,
  type Home,
  type HomeDevice,
  homeRequest,
  type Room,
} from '../lib/smartHome';

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [ip, setIp] = useState('');
  const [token, setToken] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const type = types.find((item) => item.id === typeId);
  const title =
    target.kind === 'home'
      ? 'Новый дом'
      : target.kind === 'room'
        ? 'Новая комната'
        : 'Добавить устройство';
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError('Введите название.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'home') {
        const value = await homeRequest<Pick<Home, 'id' | 'displayName'>>('/api/smart-home/homes', {
          displayName: name.trim(),
        });
        onSaved({ kind: 'home', value });
      } else if (target.kind === 'room') {
        const value = await homeRequest<Omit<Room, 'devices'>>('/api/smart-home/rooms', {
          homeId: target.home.id,
          displayName: name.trim(),
        });
        onSaved({ kind: 'room', value });
      } else {
        if (!type) throw new AppError('model_required');
        const registrationData =
          type.registrationType === 'miioToken'
            ? { ip: ip.trim(), token: token.trim() }
            : { shareUrl: shareUrl.trim() };
        const value = await homeRequest<HomeDevice>('/api/smart-home/devices', {
          roomId: target.room.id,
          typeId: type.id,
          displayName: name.trim(),
          registrationData,
        });
        onSaved({ kind: 'device', value });
      }
      onClose();
    } catch (error) {
      setError(userError(error));
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop clicks supplement the native Escape/onCancel handler and the close button.
    <dialog
      ref={dialog}
      className="home-dialog"
      aria-labelledby="home-form-title"
      aria-describedby="home-form-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="form-heading">
        <h2 id="home-form-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p id="home-form-description" className="muted form-description">
        {target.kind === 'home'
          ? 'Дом объединяет комнаты и их устройства.'
          : target.kind === 'room'
            ? `Дом: ${target.home.displayName}`
            : `Комната: ${target.room.displayName}`}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="home-fields">
          <label className="form-field">
            {target.kind === 'device' ? 'Название устройства' : 'Название'}
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                target.kind === 'home'
                  ? 'Например, Квартира'
                  : target.kind === 'room'
                    ? 'Например, Спальня'
                    : 'Например, Бризер у окна'
              }
            />
          </label>
          {target.kind === 'device' && (
            <>
              <label className="form-field">
                Модель устройства
                <select
                  required
                  value={typeId}
                  onChange={(event) => {
                    setTypeId(event.target.value);
                    setIp('');
                    setToken('');
                    setShareUrl('');
                    setVisible(false);
                    setError('');
                  }}
                >
                  <option value="" disabled>
                    Выберите модель
                  </option>
                  {types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {type && (
                <div className="connection-fields">
                  <h3>Данные подключения</h3>
                  {type.registrationType === 'miioToken' ? (
                    <>
                      <label className="form-field">
                        IP-адрес
                        <input
                          required
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="192.168.1.100"
                          value={ip}
                          onChange={(event) => setIp(event.target.value)}
                        />
                      </label>
                      <label className="form-field" htmlFor="device-token">
                        Токен Xiaomi
                      </label>
                      <div className="secret-field">
                        <input
                          id="device-token"
                          required
                          type={visible ? 'text' : 'password'}
                          autoComplete="off"
                          spellCheck={false}
                          minLength={32}
                          maxLength={32}
                          pattern="[a-fA-F0-9]{32}"
                          title="32 символа: цифры и буквы от a до f"
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                          aria-describedby="token-hint"
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={visible ? 'Скрыть токен' : 'Показать токен'}
                          onClick={() => setVisible((value) => !value)}
                        >
                          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <p className="field-hint" id="token-hint">
                        Локальный токен устройства из Xiaomi Cloud Tokens Extractor.
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="form-field">
                        Ссылка доступа HOMMYN
                        <textarea
                          required
                          rows={3}
                          maxLength={4096}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="rusklimat://device-share/…"
                          value={shareUrl}
                          onChange={(event) => setShareUrl(event.target.value)}
                          aria-describedby="share-hint"
                        />
                      </label>
                      <p className="field-hint" id="share-hint">
                        В HOMMYN откройте настройки прибора → Управление доступом → Поделиться и
                        скопируйте ссылку.
                      </p>
                    </>
                  )}
                  <p className="registration-note">
                    Сохраним данные подключения. Связь с прибором на этом шаге не проверяется.
                  </p>
                </div>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
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
          </button>
        </div>
      </form>
    </dialog>
  );
}
