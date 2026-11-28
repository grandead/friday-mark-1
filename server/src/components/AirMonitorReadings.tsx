'use client';

import { useDeviceReadings } from '@/hooks/useDeviceReadings';
import { DeviceModelCode, runDeviceCommand } from '@/lib/smart-home';
import { DeviceReadings, Measurement } from './DeviceReadings';

export function AirMonitorReadings({ deviceId }: { deviceId: string }) {
  const [reading] = useDeviceReadings(deviceId, readMonitor);
  const { state } = reading;
  return (
    <DeviceReadings reading={reading} label="Показания монитора воздуха">
      <Measurement label="Углекислый газ" symbol="CO₂" value={state?.co2} unit="ppm" />
      <Measurement label="Мелкие частицы PM2.5" symbol="PM2.5" value={state?.pm25} unit="мкг/м³" />
      <Measurement label="Частицы PM10" symbol="PM10" value={state?.pm10} unit="мкг/м³" />
    </DeviceReadings>
  );
}

function readMonitor(id: string, signal: AbortSignal) {
  return runDeviceCommand(
    { id, model: DeviceModelCode.QingpingAirMonitorLite },
    'getState',
    {},
    signal,
  );
}
