import { Cpu, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { EntryList } from '../components/EntryList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { userError } from '../lib/errors';
import { type Device, getJson, type User } from '../lib/journal';

function EntityFilter({
  label,
  all,
  value,
  onChange,
  items,
  children,
}: {
  label: string;
  all: string;
  value: string;
  onChange: (value: string) => void;
  items: { id: string; displayName: string }[];
  children: ReactNode;
}) {
  return (
    <Select
      value={value || 'all'}
      onValueChange={(value) => onChange(value === 'all' ? '' : value)}
    >
      <SelectTrigger aria-label={label}>
        {children}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Journal() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [deviceId, setDevice] = useState('');
  const [userId, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter deliberately restarts the request.
  useEffect(() => {
    const request = new AbortController();
    setError('');
    Promise.all([
      getJson<Device[]>('/api/devices', request.signal),
      getJson<User[]>('/api/users', request.signal),
    ])
      .then(([devices, users]) => {
        if (!request.signal.aborted) {
          setDevices(devices);
          setUsers(users);
        }
      })
      .catch((error) => {
        if (!request.signal.aborted) setError(userError(error));
      });
    return () => request.abort();
  }, [retry]);

  const query = new URLSearchParams();
  if (deviceId) query.set('deviceId', deviceId);
  if (userId) query.set('userId', userId);
  const fromTime = from ? new Date(from).getTime() : undefined;
  // Include the whole selected final minute, matching the precision of the controls.
  const toTime = to ? new Date(to).getTime() + 59_999 : undefined;
  const invalidDates =
    (fromTime !== undefined && !Number.isFinite(fromTime)) ||
    (toTime !== undefined && !Number.isFinite(toTime)) ||
    (fromTime !== undefined && toTime !== undefined && fromTime > toTime);
  if (fromTime !== undefined && !invalidDates) query.set('from', new Date(fromTime).toISOString());
  if (toTime !== undefined && !invalidDates) query.set('to', new Date(toTime).toISOString());
  const hasFilters = Boolean(deviceId || userId || from || to);

  return (
    <main className="wrap">
      <div className="page-heading">
        <h1>Журнал обращений</h1>
      </div>
      <fieldset className="journal-filters" aria-label="Фильтры журнала">
        <EntityFilter
          label="Устройство"
          all="Все устройства"
          value={deviceId}
          onChange={setDevice}
          items={devices}
        >
          <Cpu size={16} />
        </EntityFilter>
        <EntityFilter
          label="Пользователь"
          all="Все пользователи"
          value={userId}
          onChange={setUser}
          items={users}
        >
          <Users size={16} />
        </EntityFilter>
        <div className="date-range">
          <label>
            <span>С</span>
            <input
              type="datetime-local"
              aria-label="Дата и время начала"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            <span>По</span>
            <input
              type="datetime-local"
              aria-label="Дата и время окончания"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {hasFilters && (
          <button
            type="button"
            className="clear-filters"
            aria-label="Сбросить фильтры"
            title="Сбросить фильтры"
            onClick={() => {
              setDevice('');
              setUser('');
              setFrom('');
              setTo('');
            }}
          >
            <X size={17} />
          </button>
        )}
      </fieldset>
      {error && (
        <div className="notice error" role="alert">
          Не удалось загрузить фильтры. {error}{' '}
          <button type="button" className="retry" onClick={() => setRetry((v) => v + 1)}>
            Повторить
          </button>
        </div>
      )}
      {invalidDates ? (
        <p className="notice error" role="alert">
          Начало периода должно быть раньше его окончания.
        </p>
      ) : (
        <EntryList key={query.toString()} query={query.toString()} />
      )}
    </main>
  );
}
