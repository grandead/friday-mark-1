'use client';

import { Lightbulb, Music2, Power, Volume2 } from 'lucide-react';
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

const MODEL = DeviceModelCode.BalluAsp100;
const MODES = { manual: 'Ручной', night: 'Ночной', turbo: 'Турбо', eco: 'Эко' } as const;
const SOUNDS = {
  off: 'Без звука',
  rain: 'Дождь',
  sea: 'Море',
  forest: 'Лес',
  birds: 'Птицы',
  fireplace: 'Камин',
} as const;
const TEMPERATURES = [5, 10, 15, 20, 25];
const SPEEDS = ['1', '2', '3', '4', '5', '6', '7'];
type Change =
  | { power: boolean }
  | { mode: keyof typeof MODES }
  | { speed: number }
  | { temperature: number }
  | { sound: keyof typeof SOUNDS }
  | { buttonSound: boolean }
  | { backlightAutoOff: boolean };

export function BalluControls({ deviceId }: { deviceId: string }) {
  const { reading, busy, error, apply } = useDeviceControls(deviceId, readState, writeState);
  const { state } = reading;
  const disabled = busy || reading.status !== 'online';
  const mode = state?.mode;
  const speed = state?.speed;
  const target = state?.targetTemperature;
  const selectTemperature = (value: string) => apply({ temperature: +value });
  const selectMode = (value: string) => isOption(MODES, value) && apply({ mode: value });
  const selectSound = (value: string) => isOption(SOUNDS, value) && apply({ sound: value });
  const selectSpeed = (value: string) => apply({ speed: +value });
  return (
    <div className="appliance-panel">
      <DeviceReadings reading={reading} label="Показания бризера" supplyAir>
        {state?.pm25 !== undefined && (
          <Measurement
            label="Мелкие частицы PM2.5"
            symbol="PM2.5"
            value={state.pm25}
            unit="мкг/м³"
          />
        )}
        {mode === 'turbo' && state?.turboSeconds !== undefined && (
          <Measurement
            label="Осталось в турборежиме"
            symbol="Турбо"
            value={state.turboSeconds}
            unit="с"
          />
        )}
      </DeviceReadings>
      <fieldset
        className="appliance-controls"
        aria-label="Управление бризером"
        disabled={disabled}
        aria-busy={busy}
      >
        <DeviceToggle
          label="Питание"
          value={state?.power}
          disabled={disabled}
          onClick={() => apply({ power: !state?.power })}
        >
          <Power size={17} />
        </DeviceToggle>
        <DeviceToggle
          label="Звук кнопок"
          value={state?.buttonSound}
          disabled={disabled}
          onClick={() => apply({ buttonSound: !state?.buttonSound })}
        >
          <Volume2 size={17} />
        </DeviceToggle>
        <DeviceToggle
          label="Автогашение подсветки"
          value={state?.backlightAutoOff}
          disabled={disabled}
          onClick={() => apply({ backlightAutoOff: !state?.backlightAutoOff })}
        >
          <Lightbulb size={17} />
        </DeviceToggle>
        <Select
          value={mode && isOption(MODES, mode) ? mode : ''}
          onValueChange={selectMode}
          disabled={disabled}
        >
          <SelectTrigger className="button secondary device-select" aria-label="Режим вентиляции">
            <SelectValue placeholder={mode === 'auto' ? 'Авто' : 'Режим'} />
          </SelectTrigger>
          <SelectContent>{Object.entries(MODES).map(renderOption)}</SelectContent>
        </Select>
        {state?.power && mode === 'manual' && (
          <Select
            value={speed && speed <= 7 ? String(speed) : ''}
            onValueChange={selectSpeed}
            disabled={disabled}
          >
            <SelectTrigger
              className="button secondary device-select"
              aria-label="Скорость вентиляции"
            >
              Скорость <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>{SPEEDS.map(renderSpeed)}</SelectContent>
          </Select>
        )}
        <Select
          value={state?.sound ?? ''}
          onValueChange={selectSound}
          disabled={disabled || state?.sound === undefined}
        >
          <SelectTrigger
            className="button secondary device-select"
            aria-label="Фоновый звук"
            title="Фоновый звук"
          >
            <Music2 size={16} aria-hidden="true" />
            <SelectValue placeholder="Фоновый звук" />
          </SelectTrigger>
          <SelectContent>{Object.entries(SOUNDS).map(renderOption)}</SelectContent>
        </Select>
        {state?.heaterInstalled && target !== undefined && (
          <Select value={String(target)} onValueChange={selectTemperature} disabled={disabled}>
            <SelectTrigger
              className="button secondary device-select"
              aria-label="Температура нагрева"
            >
              <SelectValue>Нагрев до {target} °C</SelectValue>
            </SelectTrigger>
            <SelectContent>{TEMPERATURES.map(renderTemperature)}</SelectContent>
          </Select>
        )}
      </fieldset>
      {!!state?.errorCode && (
        <p className="form-error" role="status">
          Код ошибки прибора: {state.errorCode}
        </p>
      )}
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

function renderTemperature(temperature: number) {
  const value = String(temperature);
  return (
    <SelectItem key={value} value={value}>
      {temperature} °C
    </SelectItem>
  );
}

function renderSpeed(speed: string) {
  return (
    <SelectItem key={speed} value={speed}>
      {speed}
    </SelectItem>
  );
}

function readState(id: string, signal: AbortSignal) {
  return runDeviceCommand({ id, model: MODEL }, 'getState', {}, signal);
}

function writeState(id: string, change: Change, signal: AbortSignal) {
  const device = { id, model: MODEL } as const;
  if ('power' in change) return runDeviceCommand(device, 'setPower', change, signal);
  if ('speed' in change) return runDeviceCommand(device, 'setSpeed', change, signal);
  if ('mode' in change) return runDeviceCommand(device, 'setMode', change, signal);
  if ('temperature' in change) return runDeviceCommand(device, 'setTemperature', change, signal);
  if ('sound' in change) return runDeviceCommand(device, 'setSound', change, signal);
  if ('buttonSound' in change)
    return runDeviceCommand(device, 'setButtonSound', { enabled: change.buttonSound }, signal);
  return runDeviceCommand(
    device,
    'setBacklightAutoOff',
    { enabled: change.backlightAutoOff },
    signal,
  );
}
