'use client';

import { Flame, LockKeyhole, Monitor, Power, Volume2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeviceControls } from '@/hooks/useDeviceControls';
import { DeviceModelCode, runDeviceCommand } from '@/lib/smart-home';
import { DeviceReadings, Measurement } from './DeviceReadings';
import { DeviceToggle } from './DeviceToggle';

const MODEL = DeviceModelCode.SmartmiFreshAir;
const MODES = {
  auto: 'Авто',
  silent: 'Тихий',
  interval: 'Интервальный',
  low: 'Низкая скорость',
  middle: 'Средняя скорость',
  strong: 'Высокая скорость',
} as const;
const BRIGHTNESS = { bright: 'Яркий', dim: 'Тусклый', off: 'Выключен' } as const;
type Change =
  | { power: boolean }
  | { buzzer: boolean }
  | { childLock: boolean }
  | { heater: boolean }
  | { mode: keyof typeof MODES }
  | { brightness: keyof typeof BRIGHTNESS };

export function SmartmiControls({ deviceId }: { deviceId: string }) {
  const { reading, busy, error, apply } = useDeviceControls(deviceId, readState, writeState);
  const { state } = reading;
  const disabled = busy || reading.status !== 'online';
  const selectMode = (value: string) => isOption(MODES, value) && apply({ mode: value });
  const selectScreen = (key: string) => isOption(BRIGHTNESS, key) && apply({ brightness: key });
  return (
    <div className="appliance-panel">
      <DeviceReadings reading={reading} label="Показания Smartmi Fresh Air">
        <Measurement label="Углекислый газ" symbol="CO₂" value={state?.co2} unit="ppm" />
        <Measurement
          label="Мелкие частицы PM2.5"
          symbol="PM2.5"
          value={state?.pm25}
          unit="мкг/м³"
        />
      </DeviceReadings>
      <fieldset
        className="appliance-controls"
        aria-label="Управление Smartmi Fresh Air"
        disabled={disabled}
        aria-busy={busy}
      >
        <DeviceToggle
          label="Питание"
          disabled={disabled}
          value={state?.power}
          onClick={() => apply({ power: !state?.power })}
        >
          <Power size={17} />
        </DeviceToggle>
        <DeviceToggle
          label="Звук кнопок"
          disabled={disabled}
          value={state?.buzzer}
          onClick={() => apply({ buzzer: !state?.buzzer })}
        >
          <Volume2 size={17} />
        </DeviceToggle>
        <DeviceToggle
          label="Блокировка от детей"
          disabled={disabled}
          value={state?.childLock}
          onClick={() => apply({ childLock: !state?.childLock })}
        >
          <LockKeyhole size={17} />
        </DeviceToggle>
        {state?.heater !== undefined && (
          <DeviceToggle
            label="Нагрев"
            disabled={disabled}
            value={state.heater}
            onClick={() => apply({ heater: !state.heater })}
          >
            <Flame size={17} />
          </DeviceToggle>
        )}
        <Select
          value={state?.mode ?? ''}
          onValueChange={selectMode}
          disabled={disabled || state?.mode === undefined}
        >
          <SelectTrigger className="button secondary device-select" aria-label="Режим вентиляции">
            <SelectValue placeholder="Режим" />
          </SelectTrigger>
          <SelectContent>{Object.entries(MODES).map(renderOption)}</SelectContent>
        </Select>
        <Select
          value={state?.brightness ?? ''}
          onValueChange={selectScreen}
          disabled={disabled || state?.brightness === undefined}
        >
          <SelectTrigger
            className="button secondary device-select"
            aria-label="Яркость экрана"
            title="Яркость экрана"
          >
            <Monitor size={16} aria-hidden="true" />
            <SelectValue placeholder="Экран" />
          </SelectTrigger>
          <SelectContent>{Object.entries(BRIGHTNESS).map(renderOption)}</SelectContent>
        </Select>
      </fieldset>
      {state?.filterLife !== undefined && <p>Ресурс фильтра: {state.filterLife} %</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function isOption<T extends object>(options: T, value: string): value is keyof T & string {
  return Object.hasOwn(options, value);
}

function renderOption([value, label]: [string, string]) {
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
  if ('buzzer' in change) return runDeviceCommand(device, 'setBuzzer', change, signal);
  if ('childLock' in change) return runDeviceCommand(device, 'setChildLock', change, signal);
  if ('heater' in change) return runDeviceCommand(device, 'setHeater', change, signal);
  if ('mode' in change) return runDeviceCommand(device, 'setMode', change, signal);
  return runDeviceCommand(device, 'setBrightness', change, signal);
}
