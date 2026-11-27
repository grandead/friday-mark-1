'use client';

import { Cpu, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getJson } from '@/lib/get-json';
import { userError } from '../../lib/errors';
import type { Device, User } from '../../lib/journal';
import { InteractionList } from '../InteractionList';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const EMPTY_FILTERS = { deviceId: '', userId: '', from: '', to: '' };

function renderItem(item: { id: string; displayName: string }) {
  return (
    <SelectItem key={item.id} value={item.id}>
      {item.displayName}
    </SelectItem>
  );
}

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
        {items.map(renderItem)}
      </SelectContent>
    </Select>
  );
}

export function Journal() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { deviceId, userId, from, to } = filters;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter deliberately restarts the request.
  useEffect(() => loadFilters(setDevices, setUsers, setError), [retry]);

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
  if (fromTime !== undefined && !invalidDates) {
    const iso = new Date(fromTime).toISOString();
    query.set('from', iso);
  }
  if (toTime !== undefined && !invalidDates) {
    const iso = new Date(toTime).toISOString();
    query.set('to', iso);
  }
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
          onChange={(deviceId) => setFilters({ ...filters, deviceId })}
          items={devices}
        >
          <Cpu size={16} />
        </EntityFilter>
        <EntityFilter
          label="Пользователь"
          all="Все пользователи"
          value={userId}
          onChange={(userId) => setFilters({ ...filters, userId })}
          items={users}
        >
          <Users size={16} />
        </EntityFilter>
        <div className="date-range">
          <label htmlFor="journal-from">
            <span>С</span>
            <Input
              id="journal-from"
              type="datetime-local"
              aria-label="Дата и время начала"
              value={from}
              max={to || undefined}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label htmlFor="journal-to">
            <span>По</span>
            <Input
              id="journal-to"
              type="datetime-local"
              aria-label="Дата и время окончания"
              value={to}
              min={from || undefined}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
        </div>
        {hasFilters && (
          <Button
            type="button"
            className="clear-filters"
            aria-label="Сбросить фильтры"
            title="Сбросить фильтры"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            <X size={17} />
          </Button>
        )}
      </fieldset>
      {error && (
        <div className="notice error" role="alert">
          Не удалось загрузить фильтры. {error}{' '}
          <Button type="button" className="retry" onClick={() => setRetry((v) => v + 1)}>
            Повторить
          </Button>
        </div>
      )}
      {invalidDates ? (
        <p className="notice error" role="alert">
          Начало периода должно быть раньше его окончания.
        </p>
      ) : (
        <InteractionList key={query.toString()} query={query.toString()} />
      )}
    </main>
  );
}

function loadFilters(
  setDevices: (items: Device[]) => void,
  setUsers: (items: User[]) => void,
  setError: (message: string) => void,
) {
  const request = new AbortController();
  setError('');
  void fetchFilters(request.signal, setDevices, setUsers, setError);
  return () => request.abort();
}

async function fetchFilters(
  signal: AbortSignal,
  setDevices: (items: Device[]) => void,
  setUsers: (items: User[]) => void,
  setError: (message: string) => void,
) {
  try {
    const devicesRequest = getJson<Device[]>('/api/devices', signal);
    const usersRequest = getJson<User[]>('/api/users', signal);
    const [devices, users] = await Promise.all([devicesRequest, usersRequest]);
    if (signal.aborted) return;
    setDevices(devices);
    setUsers(users);
  } catch (error) {
    const message = userError(error);
    if (!signal.aborted) setError(message);
  }
}
