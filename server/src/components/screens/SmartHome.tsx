'use client';
import { ChevronRight, DoorOpen, Droplets, House, Plus, Radio, Wind } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { userError } from '../../lib/errors';
import {
  type DeviceType,
  type Home,
  type HomeDevice,
  homeRequest,
  type Room,
  type SmartHomeData,
} from '../../lib/smart-home';
import { type CreatedHomeEntity, HomeForm, type HomeFormTarget } from '../HomeForm';

function countLabel(count: number, words: [string, string, string]) {
  const end = count % 10,
    hundred = count % 100;
  return `${count} ${words[hundred >= 11 && hundred <= 14 ? 2 : end === 1 ? 0 : end >= 2 && end <= 4 ? 1 : 2]}`;
}
const roomCount = (count: number) => countLabel(count, ['комната', 'комнаты', 'комнат']);
const deviceCount = (count: number) => countLabel(count, ['устройство', 'устройства', 'устройств']);

export function SmartHome() {
  const [data, setData] = useState<SmartHomeData | null>(null);
  const router = useRouter();
  const selected = useSearchParams().get('home') ?? '';
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<HomeFormTarget | null>(null);
  const [message, setMessage] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the catalogue.
  useEffect(() => loadHomes(setData, setError), [retry]);
  const home = data?.homes.find((item) => item.id === selected) ?? data?.homes[0];
  const select = (id: string) => selectHome(router, id);
  const saved = (entity: CreatedHomeEntity) => saveEntity(entity, setData, select, setMessage);
  const types = data?.deviceTypes ?? [];
  const card = (room: Room) => renderRoom(room, types, setTarget);
  const choice = (item: Home) => renderChoice(item, item.id === home?.id, select);
  const devices = home?.rooms.reduce((total, room) => total + room.devices.length, 0) ?? 0;
  return (
    <main className="wrap smart-home-page">
      <div className="page-heading home-page-heading">
        <div>
          <h1>Умный дом</h1>
          <p className="page-description">Дома, комнаты и устройства — в одном месте.</p>
        </div>
        <Button
          type="button"
          className="button primary"
          disabled={!data}
          onClick={() => setTarget({ kind: 'home' })}
        >
          <Plus size={17} />
          Добавить дом
        </Button>
      </div>
      <p className="sr-only" role="status">
        {message}
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <Button type="button" className="retry" onClick={() => setRetry((value) => value + 1)}>
            Повторить
          </Button>
        </div>
      )}
      {!data && !error && (
        <p className="notice" role="status">
          Загружаем дома…
        </p>
      )}
      {data && !data.homes.length && (
        <section className="panel home-empty">
          <span className="empty-icon">
            <House size={30} />
          </span>
          <h2>Начнём с дома</h2>
          <p>
            Добавьте квартиру или дом, затем создайте комнаты
            <br className="desktop-break" /> и разместите в них устройства.
          </p>
          <Button
            type="button"
            className="button primary"
            onClick={() => setTarget({ kind: 'home' })}
          >
            <Plus size={17} />
            Создать первый дом
          </Button>
        </section>
      )}
      {data && home && (
        <div className="home-layout">
          <aside className="home-sidebar">
            <div className="section-eyebrow">
              Дома <span>{data.homes.length}</span>
            </div>
            <nav aria-label="Выбор дома">{data.homes.map(choice)}</nav>
          </aside>
          <section className="home-content" aria-label={`Дом ${home.displayName}`}>
            <div className="home-section-heading">
              <div>
                <h2>{home.displayName}</h2>
                <p className="muted">
                  {roomCount(home.rooms.length)} · {deviceCount(devices)}
                </p>
              </div>
              <Button
                type="button"
                className="button secondary"
                onClick={() => setTarget({ kind: 'room', home })}
              >
                <Plus size={16} />
                Добавить комнату
              </Button>
            </div>
            {!home.rooms.length ? (
              <div className="panel home-empty room-empty">
                <span className="empty-icon">
                  <DoorOpen size={27} />
                </span>
                <h2>Какие комнаты есть дома?</h2>
                <p>
                  Например, спальня, гостиная или кухня.
                  <br />
                  Комнаты помогут находить нужные устройства.
                </p>
                <Button
                  type="button"
                  className="button secondary"
                  onClick={() => setTarget({ kind: 'room', home })}
                >
                  <Plus size={16} />
                  Создать комнату
                </Button>
              </div>
            ) : (
              <div className="room-grid">{home.rooms.map(card)}</div>
            )}
          </section>
        </div>
      )}
      {target && data && (
        <HomeForm
          target={target}
          types={data.deviceTypes}
          onSaved={saved}
          onClose={() => setTarget(null)}
        />
      )}
    </main>
  );
}

function renderChoice(item: Home, selected: boolean, select: (id: string) => void) {
  return (
    <Button
      type="button"
      key={item.id}
      className={`home-choice ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={() => select(item.id)}
    >
      <House size={19} />
      <span>
        <strong>{item.displayName}</strong>
        <small>{roomCount(item.rooms.length)}</small>
      </span>
      <ChevronRight size={16} />
    </Button>
  );
}
function renderRoom(room: Room, types: DeviceType[], setTarget: (target: HomeFormTarget) => void) {
  const item = (device: HomeDevice) => renderDevice(device, types);
  return (
    <Card key={room.id} className="panel room-card" aria-label={`Комната ${room.displayName}`}>
      <div className="room-heading">
        <span className="room-icon">
          <DoorOpen size={20} />
        </span>
        <div>
          <h3>{room.displayName}</h3>
          <p className="muted">{deviceCount(room.devices.length)}</p>
        </div>
        <Button
          type="button"
          className="icon-button add-device-icon"
          aria-label={`Добавить устройство в ${room.displayName}`}
          title="Добавить устройство"
          onClick={() => setTarget({ kind: 'device', room })}
        >
          <Plus size={20} />
        </Button>
      </div>
      {room.devices.length ? (
        <ul className="home-device-list">{room.devices.map(item)}</ul>
      ) : (
        <p className="room-empty-text">Устройств пока нет</p>
      )}
      <Button
        type="button"
        className="room-add"
        onClick={() => setTarget({ kind: 'device', room })}
      >
        <Plus size={16} />
        Добавить устройство
      </Button>
    </Card>
  );
}
function renderDevice(device: HomeDevice, types: DeviceType[]) {
  const type = types.find((item) => item.id === device.typeId);
  const Icon = type?.kind === 'humidifier' ? Droplets : type?.kind === 'breezer' ? Wind : Radio;
  return (
    <li key={device.id}>
      <span className="device-icon">
        <Icon size={20} />
      </span>
      <div>
        <strong>{device.displayName}</strong>
        <p>{type?.displayName ?? 'Устройство'}</p>
      </div>
    </li>
  );
}
function loadHomes(setData: (data: SmartHomeData) => void, setError: (message: string) => void) {
  const request = new AbortController();
  setError('');
  void fetchHomes(request.signal, setData, setError);
  return () => request.abort();
}
async function fetchHomes(
  signal: AbortSignal,
  setData: (data: SmartHomeData) => void,
  setError: (message: string) => void,
) {
  try {
    const data = await homeRequest<SmartHomeData>('/api/smart-home', undefined, signal);
    if (!signal.aborted) setData(data);
  } catch (error) {
    const message = userError(error);
    if (!signal.aborted) setError(message);
  }
}
function selectHome(router: ReturnType<typeof useRouter>, id: string) {
  const home = encodeURIComponent(id);
  router.replace(`/smart-home?home=${home}`, { scroll: false });
}
function saveEntity(
  entity: CreatedHomeEntity,
  setData: React.Dispatch<React.SetStateAction<SmartHomeData | null>>,
  select: (id: string) => void,
  setMessage: (text: string) => void,
) {
  setData((previous) => addEntity(previous, entity));
  if (entity.kind === 'home') select(entity.value.id);
  const name = entity.value.displayName;
  const message =
    entity.kind === 'home'
      ? `Дом «${name}» добавлен.`
      : entity.kind === 'room'
        ? `Комната «${name}» добавлена.`
        : `Устройство «${name}» добавлено.`;
  setMessage(message);
}
function addEntity(data: SmartHomeData | null, entity: CreatedHomeEntity) {
  if (!data) return data;
  if (entity.kind === 'home')
    return { ...data, homes: [...data.homes, { ...entity.value, rooms: [] }] };
  const homes = data.homes.map((home) => updateHome(home, entity));
  return { ...data, homes };
}
function updateHome(home: Home, entity: Exclude<CreatedHomeEntity, { kind: 'home' }>) {
  if (entity.kind === 'room') {
    if (home.id !== entity.value.homeId) return home;
    return { ...home, rooms: [...home.rooms, { ...entity.value, devices: [] }] };
  }
  const rooms = home.rooms.map((room) => addDevice(room, entity.value));
  return { ...home, rooms };
}
function addDevice(room: Room, device: HomeDevice) {
  if (room.id !== device.roomId) return room;
  return { ...room, devices: [...room.devices, device] };
}
