'use client';

import { Lightbulb, Power, Volume2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeviceControls } from '@/hooks/useDeviceControls';
import { DeviceModelCode, runDeviceCommand } from '@/lib/smart-home';
import { DeviceReadings } from './DeviceReadings';

import { DeviceToggle } from './DeviceToggle';

const MODEL = DeviceModelCode.XiaomiSmartHumidifier2;
const LEVELS = ['Низкая', 'Средняя', 'Высокая', 'Поддержание влажности'] as const;
type Change = { power: boolean } | { indicator: boolean } | { buzzer: boolean } | { level: number };

export function HumidifierControls({ deviceId }: { deviceId: string }) {
  const { reading, busy, error, apply } = useDeviceControls(deviceId, readState, writeState);
  const { state } = reading;
  const disabled = busy || reading.status !== 'online';
  const togglePower = () => apply({ power: !state?.power });
  const toggleIndicator = () => apply({ indicator: !state?.indicator });
  const toggleBuzzer = () => apply({ buzzer: !state?.buzzer });
  const selectLevel = (value: string) => apply({ level: +value });
  return (
    <div className="appliance-panel">
      <DeviceReadings reading={reading} label="Показания увлажнителя" />
      <fieldset
        className="appliance-controls"
        aria-label="Управление увлажнителем"
        aria-busy={busy}
      >
        <DeviceToggle
          label="Питание"
          value={state?.power}
          disabled={disabled}
          onClick={togglePower}
        >
          <Power size={17} />
        </DeviceToggle>
        <DeviceToggle
          label="Подсветка"
          value={state?.indicator}
          disabled={disabled}
          onClick={toggleIndicator}
        >
          <Lightbulb size={17} />
        </DeviceToggle>
        <DeviceToggle label="Звук" value={state?.buzzer} disabled={disabled} onClick={toggleBuzzer}>
          <Volume2 size={17} />
        </DeviceToggle>
        <Select
          value={state?.level?.toString() ?? ''}
          onValueChange={selectLevel}
          disabled={disabled}
        >
          <SelectTrigger
            className="button secondary device-select"
            aria-label="Скорость увлажнения"
            title="Скорость увлажнения"
          >
            <SelectValue placeholder="Скорость" />
          </SelectTrigger>
          <SelectContent>{LEVELS.map(renderLevel)}</SelectContent>
        </Select>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function renderLevel(label: string, index: number) {
  const value = String(index + 1);
  return (
    <SelectItem key={value} value={value}>
      {label}
    </SelectItem>
  );
}

function readState(id: string, signal: AbortSignal) {
  return runDeviceCommand({ id, model: MODEL }, 'getState', {}, signal);
}

function writeState(id: string, change: Change, signal: AbortSignal) {
  const device = { id, model: MODEL } as const;
  if ('power' in change) return runDeviceCommand(device, 'setPower', change, signal);
  if ('indicator' in change) return runDeviceCommand(device, 'setIndicator', change, signal);
  if ('buzzer' in change) return runDeviceCommand(device, 'setBuzzer', change, signal);
  return runDeviceCommand(device, 'setLevel', change, signal);
}
