import { useEffect, useState } from 'react';
import { ChevronRight, DoorOpen, Droplets, House, Plus, Radio, Wind } from 'lucide-react';
import { HomeForm, type HomeFormTarget, type CreatedHomeEntity } from '../components/HomeForm';
import { homeRequest, type SmartHomeData } from '../lib/smartHome';

function countLabel(count: number, words: [string, string, string]) {
  const end = count % 10, hundred = count % 100;
  return `${count} ${words[hundred >= 11 && hundred <= 14 ? 2 : end === 1 ? 0 : end >= 2 && end <= 4 ? 1 : 2]}`;
}
const roomCount = (count: number) => countLabel(count, ['комната', 'комнаты', 'комнат']);
const deviceCount = (count: number) => countLabel(count, ['устройство', 'устройства', 'устройств']);

export function SmartHome() {
  const [data, setData] = useState<SmartHomeData | null>(null);
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('home') ?? '');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<HomeFormTarget | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const request = new AbortController();
    setError('');
    homeRequest<SmartHomeData>('/api/smart-home', undefined, request.signal).then(value => {
      if (!request.signal.aborted) setData(value);
    }).catch(error => { if (!request.signal.aborted) setError(error.message); });
    return () => request.abort();
  }, [retry]);
  const home = data?.homes.find(item => item.id === selected) ?? data?.homes[0];
  function select(id: string) { setSelected(id); history.replaceState(null, '', `/smart-home?home=${encodeURIComponent(id)}`); }
  function saved(entity: CreatedHomeEntity) {
    setData(previous => {
      if (!previous) return previous;
      if (entity.kind === 'home') return { ...previous, homes: [...previous.homes, { ...entity.value, rooms: [] }] };
      if (entity.kind === 'room') return { ...previous, homes: previous.homes.map(home => home.id === entity.value.homeId ? { ...home, rooms: [...home.rooms, { ...entity.value, devices: [] }] } : home) };
      return { ...previous, homes: previous.homes.map(home => ({ ...home, rooms: home.rooms.map(room => room.id === entity.value.roomId ? { ...room, devices: [...room.devices, entity.value] } : room) })) };
    });
    if (entity.kind === 'home') select(entity.value.id);
    setMessage(`${entity.kind === 'home' ? 'Дом' : entity.kind === 'room' ? 'Комната' : 'Устройство'} «${entity.value.displayName}» ${entity.kind === 'room' ? 'добавлена' : entity.kind === 'home' ? 'добавлен' : 'добавлено'}.`);
  }
  return <main className="wrap smart-home-page">
    <div className="page-heading home-page-heading"><div><h1>Умный дом</h1><p className="page-description">Дома, комнаты и устройства — в одном месте.</p></div>
      <button className="button primary" disabled={!data} onClick={() => setTarget({ kind: 'home' })}><Plus size={17} />Добавить дом</button>
    </div>
    <p className="sr-only" role="status">{message}</p>
    {error && <div className="notice error" role="alert">{error} <button className="retry" onClick={() => setRetry(value => value + 1)}>Повторить</button></div>}
    {!data && !error && <p className="notice" role="status">Загружаем дома…</p>}
    {data && !data.homes.length && <section className="panel home-empty"><span className="empty-icon"><House size={30} /></span><h2>Начнём с дома</h2><p>Добавьте квартиру или дом, затем создайте комнаты<br className="desktop-break" /> и разместите в них устройства.</p><button className="button primary" onClick={() => setTarget({ kind: 'home' })}><Plus size={17} />Создать первый дом</button></section>}
    {data && home && <div className="home-layout">
      <aside className="home-sidebar"><div className="section-eyebrow">Дома <span>{data.homes.length}</span></div><nav aria-label="Выбор дома">{data.homes.map(item => <button key={item.id} className={`home-choice ${home.id === item.id ? 'selected' : ''}`} aria-pressed={home.id === item.id} onClick={() => select(item.id)}>
        <House size={19} /><span><strong>{item.displayName}</strong><small>{roomCount(item.rooms.length)}</small></span><ChevronRight size={16} />
      </button>)}</nav></aside>
      <section className="home-content" aria-label={`Дом ${home.displayName}`}>
        <div className="home-section-heading"><div><h2>{home.displayName}</h2><p className="muted">{roomCount(home.rooms.length)} · {deviceCount(home.rooms.reduce((total, room) => total + room.devices.length, 0))}</p></div><button className="button secondary" onClick={() => setTarget({ kind: 'room', home })}><Plus size={16} />Добавить комнату</button></div>
        {!home.rooms.length ? <div className="panel home-empty room-empty"><span className="empty-icon"><DoorOpen size={27} /></span><h2>Какие комнаты есть дома?</h2><p>Например, спальня, гостиная или кухня.<br />Комнаты помогут находить нужные устройства.</p><button className="button secondary" onClick={() => setTarget({ kind: 'room', home })}><Plus size={16} />Создать комнату</button></div> : <div className="room-grid">{home.rooms.map(room => <section key={room.id} className="panel room-card" aria-label={`Комната ${room.displayName}`}>
          <div className="room-heading"><span className="room-icon"><DoorOpen size={20} /></span><div><h3>{room.displayName}</h3><p className="muted">{deviceCount(room.devices.length)}</p></div><button className="icon-button add-device-icon" aria-label={`Добавить устройство в ${room.displayName}`} title="Добавить устройство" onClick={() => setTarget({ kind: 'device', room })}><Plus size={20} /></button></div>
          {room.devices.length ? <ul className="home-device-list">{room.devices.map(device => {
            const type = data.deviceTypes.find(item => item.id === device.typeId);
            const Icon = type?.kind === 'humidifier' ? Droplets : type?.kind === 'breezer' ? Wind : Radio;
            return <li key={device.id}><span className="device-icon"><Icon size={20} /></span><div><strong>{device.displayName}</strong><p>{type?.displayName ?? 'Устройство'}</p></div></li>;
          })}</ul> : <p className="room-empty-text">Устройств пока нет</p>}
          <button className="room-add" onClick={() => setTarget({ kind: 'device', room })}><Plus size={16} />Добавить устройство</button>
        </section>)}</div>}
      </section>
    </div>}
    {target && data && <HomeForm target={target} types={data.deviceTypes} onSaved={saved} onClose={() => setTarget(null)} />}
  </main>;
}
