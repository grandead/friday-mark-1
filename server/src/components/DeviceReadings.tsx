import { Droplet, Thermometer } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DeviceReading } from '@/hooks/useDeviceReadings';

const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const CONNECTION = {
  pending: 'Проверяем связь',
  online: 'В сети',
  offline: 'Нет связи с прибором',
  error: 'Не удалось получить показания',
};

type Climate = { temperature?: number; humidity?: number };

export function DeviceReadings({
  reading,
  label,
  children,
  supplyAir = false,
}: {
  reading: DeviceReading<Climate>;
  supplyAir?: boolean;
  label: string;
  children?: ReactNode;
}) {
  const { state, status } = reading;
  const connection = CONNECTION[status];
  return (
    <div className="device-readings">
      <span className={`monitor-connection ${status}`} role="status" title={connection}>
        <span className="sr-only">{connection}</span>
      </span>
      <dl aria-label={label}>
        <Measurement
          label={supplyAir ? 'Температура приточного воздуха' : 'Температура'}
          icon={supplyAir ? 'Приток' : <Thermometer size={15} />}
          value={state?.temperature}
          unit="°C"
        />
        {(!supplyAir || state?.humidity !== undefined) && (
          <Measurement
            label="Влажность"
            icon={<Droplet size={15} />}
            value={state?.humidity}
            unit="%"
          />
        )}
        {children}
      </dl>
    </div>
  );
}

export function Measurement({
  label,
  icon,
  symbol,
  value,
  unit,
}: {
  label: string;
  icon?: ReactNode;
  symbol?: string;
  value?: number;
  unit: string;
}) {
  return (
    <div title={label}>
      <dt>
        <span aria-hidden="true">{icon ?? symbol}</span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd>
        {value === undefined ? '—' : NUMBER.format(value)} <small>{unit}</small>
      </dd>
    </div>
  );
}
