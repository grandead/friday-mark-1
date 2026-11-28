import { useEffect, useState } from 'react';
import { AppError } from '../../shared/errors';

const POLL_MS = 30_000;
export type DeviceReading<State> = {
  status: 'pending' | 'online' | 'offline' | 'error';
  state?: State;
};
type Read<State> = (id: string, signal: AbortSignal) => Promise<State>;
type Update<State> = (reading: DeviceReading<State>) => void;

export function useDeviceReadings<State>(id: string, read: Read<State>, paused = false) {
  const [reading, update] = useState<DeviceReading<State>>({ status: 'pending' });
  useEffect(() => (paused ? undefined : watch(id, read, update)), [id, read, paused]);
  return [reading, update] as const;
}

function watch<State>(id: string, read: Read<State>, update: Update<State>) {
  const controller = new AbortController();
  const { signal } = controller;
  let timer = 0;
  const schedule = () => (timer = signal.aborted ? 0 : window.setTimeout(refresh, POLL_MS));
  const refresh = () => fetchReading(id, read, signal, update).then(schedule);
  signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
  void refresh();
  return () => controller.abort();
}

async function fetchReading<State>(
  id: string,
  read: Read<State>,
  signal: AbortSignal,
  update: Update<State>,
) {
  try {
    const state = await read(id, signal);
    if (!signal.aborted) update({ status: 'online', state });
  } catch (error) {
    if (signal.aborted) return;
    const offline = error instanceof AppError && error.code === 'device_unreachable';
    update({ status: offline ? 'offline' : 'error' });
  }
}
