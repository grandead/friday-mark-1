import type { DeviceModel } from './common';
import { BALLU_ASP100 } from './devices/ballu-asp100';
import { QINGPING_AIR_MONITOR_LITE } from './devices/qingping-air-monitor-lite';
import { SMART_HUMIDIFIER_2 } from './devices/smart-humidifier2';
import { SMARTMI_FRESH_AIR } from './devices/smartmi-fresh-air';

export const DEVICE_MODELS: readonly DeviceModel[] = [
  SMART_HUMIDIFIER_2,
  SMARTMI_FRESH_AIR,
  BALLU_ASP100,
  QINGPING_AIR_MONITOR_LITE,
];
