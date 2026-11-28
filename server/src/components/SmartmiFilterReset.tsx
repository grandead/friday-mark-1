import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { userError } from '@/lib/errors';
import { DeviceModelCode, type HomeDevice, runDeviceCommand } from '@/lib/smart-home';

export function SmartmiFilterReset({ device }: { device: HomeDevice }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const confirm = () => resetFilter(device.id, setBusy, setOpen, setMessage);
  return (
    <div>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogTrigger asChild>
          <Button type="button" className="button secondary">
            Сбросить счётчик фильтра…
          </Button>
        </DialogTrigger>
        <DialogContent className="home-dialog" showCloseButton={false}>
          <DialogTitle>Фильтр заменён?</DialogTitle>
          <DialogDescription className="muted form-description">
            У бризера «{device.displayName}» обнулится счётчик часов работы фильтра.
          </DialogDescription>
          <div className="form-actions">
            <Button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button type="button" className="button primary" disabled={busy} onClick={confirm}>
              {busy ? 'Сбрасываем…' : 'Фильтр заменён, сбросить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <p role="status">{message}</p>
    </div>
  );
}

async function resetFilter(
  id: string,
  setBusy: (busy: boolean) => void,
  setOpen: (open: boolean) => void,
  setMessage: (message: string) => void,
) {
  setBusy(true);
  try {
    await runDeviceCommand({ id, model: DeviceModelCode.SmartmiFreshAir }, 'resetFilter', {});
    setMessage('Бризер подтвердил сброс счётчика фильтра.');
  } catch (error) {
    const message = userError(error);
    setMessage(message);
  } finally {
    setBusy(false);
    setOpen(false);
  }
}
