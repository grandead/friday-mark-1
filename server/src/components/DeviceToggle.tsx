import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function DeviceToggle({
  label,
  value,
  disabled,
  onClick,
  children,
}: {
  label: string;
  value?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const status = value === undefined ? 'нет данных' : value ? 'вкл.' : 'выкл.';
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={`button ${value ? 'primary' : 'secondary'} device-toggle`}
      aria-label={label}
      aria-pressed={value}
      title={`${label}: ${status}`}
      onClick={onClick}
      disabled={disabled || value === undefined}
    >
      {children}
    </Button>
  );
}
