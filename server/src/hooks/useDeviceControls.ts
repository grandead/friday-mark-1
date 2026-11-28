import { type RefObject, useEffect, useRef, useState } from 'react';
import { userError } from '@/lib/errors';
import { type DeviceReading, useDeviceReadings } from './useDeviceReadings';

type Write<State, Change> = (id: string, change: Change, signal: AbortSignal) => Promise<State>;

export function useDeviceControls<State, Change>(
  deviceId: string,
  read: (id: string, signal: AbortSignal) => Promise<State>,
  write: Write<State, Change>,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reading, update] = useDeviceReadings(deviceId, read, busy);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const controls = { deviceId, request, write, update, setBusy, setError };
  const apply = (change: Change) => applyChange(change, controls);
  return { reading, busy, error, apply };
}

async function applyChange<State, Change>(
  change: Change,
  controls: {
    deviceId: string;
    write: Write<State, Change>;
    request: RefObject<AbortController | null>;
    update: (reading: DeviceReading<State>) => void;
    setBusy: (busy: boolean) => void;
    setError: (error: string) => void;
  },
) {
  const { request, deviceId, update, setBusy, setError } = controls;
  if (request.current) return;
  const controller = new AbortController();
  request.current = controller;
  setBusy(true);
  setError('');
  try {
    const state = await controls.write(deviceId, change, controller.signal);
    if (!controller.signal.aborted) update({ status: 'online', state });
  } catch (error) {
    const message = userError(error);
    if (!controller.signal.aborted) setError(message);
  } finally {
    request.current = null;
    if (!controller.signal.aborted) setBusy(false);
  }
}
