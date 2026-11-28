import type { z } from 'zod';
import {
  balluAsp100,
  DeviceModelCode,
  type MiioCredentials,
  qingpingAirMonitorLite,
  type SyncleoCredentials,
  smartHumidifier2,
  smartmiFreshAir,
} from '@/services/smart-home';

type Credentials = MiioCredentials | SyncleoCredentials;
type CommandHandler = {
  execute(credentials: Credentials, body: unknown): Promise<unknown>;
};

class Command<Args, State> {
  constructor(
    readonly schema: z.ZodType<Args>,
    readonly run: (credentials: Credentials, args: NoInfer<Args>) => Promise<State>,
  ) {}

  execute(credentials: Credentials, body: unknown) {
    const args = this.schema.parse(body);
    return this.run(credentials, args);
  }
}

const COMMANDS = {
  [DeviceModelCode.BalluAsp100]: {
    getState: new Command(balluAsp100.GET_STATE_SCHEMA, balluAsp100.getState),
    setPower: new Command(balluAsp100.SET_POWER_SCHEMA, balluAsp100.setPower),
    setMode: new Command(balluAsp100.SET_MODE_SCHEMA, balluAsp100.setMode),
    setSpeed: new Command(balluAsp100.SET_SPEED_SCHEMA, balluAsp100.setSpeed),
    setBacklightAutoOff: new Command(
      balluAsp100.SET_BACKLIGHT_AUTO_OFF_SCHEMA,
      balluAsp100.setBacklightAutoOff,
    ),
    setButtonSound: new Command(balluAsp100.SET_BUTTON_SOUND_SCHEMA, balluAsp100.setButtonSound),
    resetFilter: new Command(balluAsp100.RESET_FILTER_SCHEMA, balluAsp100.resetFilter),
    setSound: new Command(balluAsp100.SET_SOUND_SCHEMA, balluAsp100.setSound),
    setTemperature: new Command(balluAsp100.SET_TEMPERATURE_SCHEMA, balluAsp100.setTemperature),
  },
  [DeviceModelCode.QingpingAirMonitorLite]: {
    getState: new Command(qingpingAirMonitorLite.GET_STATE_SCHEMA, qingpingAirMonitorLite.getState),
    setAutoSlideInterval: new Command(
      qingpingAirMonitorLite.SET_AUTO_SLIDE_INTERVAL_SCHEMA,
      qingpingAirMonitorLite.setAutoSlideInterval,
    ),
    setMonitoringInterval: new Command(
      qingpingAirMonitorLite.SET_MONITORING_INTERVAL_SCHEMA,
      qingpingAirMonitorLite.setMonitoringInterval,
    ),
    setPm25Standard: new Command(
      qingpingAirMonitorLite.SET_PM25_STANDARD_SCHEMA,
      qingpingAirMonitorLite.setPm25Standard,
    ),
    setPowerOffDelay: new Command(
      qingpingAirMonitorLite.SET_POWER_OFF_DELAY_SCHEMA,
      qingpingAirMonitorLite.setPowerOffDelay,
    ),
    setPowerOffSeconds: new Command(
      qingpingAirMonitorLite.SET_POWER_OFF_SECONDS_SCHEMA,
      qingpingAirMonitorLite.setPowerOffSeconds,
    ),
    setScreenOffDelay: new Command(
      qingpingAirMonitorLite.SET_SCREEN_OFF_DELAY_SCHEMA,
      qingpingAirMonitorLite.setScreenOffDelay,
    ),
    setScreensaverDelay: new Command(
      qingpingAirMonitorLite.SET_SCREENSAVER_DELAY_SCHEMA,
      qingpingAirMonitorLite.setScreensaverDelay,
    ),
    setTemperatureUnit: new Command(
      qingpingAirMonitorLite.SET_TEMPERATURE_UNIT_SCHEMA,
      qingpingAirMonitorLite.setTemperatureUnit,
    ),
    setTwelveHourClock: new Command(
      qingpingAirMonitorLite.SET_TWELVE_HOUR_CLOCK_SCHEMA,
      qingpingAirMonitorLite.setTwelveHourClock,
    ),
  },
  [DeviceModelCode.SmartmiFreshAir]: {
    getState: new Command(smartmiFreshAir.GET_STATE_SCHEMA, smartmiFreshAir.getState),
    setPower: new Command(smartmiFreshAir.SET_POWER_SCHEMA, smartmiFreshAir.setPower),
    setMode: new Command(smartmiFreshAir.SET_MODE_SCHEMA, smartmiFreshAir.setMode),
    setSpeed: new Command(smartmiFreshAir.SET_SPEED_SCHEMA, smartmiFreshAir.setSpeed),
    setBrightness: new Command(
      smartmiFreshAir.SET_BRIGHTNESS_SCHEMA,
      smartmiFreshAir.setBrightness,
    ),
    setBuzzer: new Command(smartmiFreshAir.SET_BUZZER_SCHEMA, smartmiFreshAir.setBuzzer),
    setChildLock: new Command(smartmiFreshAir.SET_CHILD_LOCK_SCHEMA, smartmiFreshAir.setChildLock),
    setHeater: new Command(smartmiFreshAir.SET_HEATER_SCHEMA, smartmiFreshAir.setHeater),
    resetFilter: new Command(smartmiFreshAir.RESET_FILTER_SCHEMA, smartmiFreshAir.resetFilter),
  },
  [DeviceModelCode.XiaomiSmartHumidifier2]: {
    getState: new Command(smartHumidifier2.GET_STATE_SCHEMA, smartHumidifier2.getState),
    setPower: new Command(smartHumidifier2.SET_POWER_SCHEMA, smartHumidifier2.setPower),
    setMode: new Command(smartHumidifier2.SET_MODE_SCHEMA, smartHumidifier2.setMode),
    setBuzzer: new Command(smartHumidifier2.SET_BUZZER_SCHEMA, smartHumidifier2.setBuzzer),
    setConstantProtection: new Command(
      smartHumidifier2.SET_CONSTANT_PROTECTION_SCHEMA,
      smartHumidifier2.setConstantProtection,
    ),
    setIndicator: new Command(smartHumidifier2.SET_INDICATOR_SCHEMA, smartHumidifier2.setIndicator),
    setLevel: new Command(smartHumidifier2.SET_LEVEL_SCHEMA, smartHumidifier2.setLevel),
    setOverwetProtection: new Command(
      smartHumidifier2.SET_OVERWET_PROTECTION_SCHEMA,
      smartHumidifier2.setOverwetProtection,
    ),
    setTargetHumidity: new Command(
      smartHumidifier2.SET_TARGET_HUMIDITY_SCHEMA,
      smartHumidifier2.setTargetHumidity,
    ),
  },
} satisfies Record<DeviceModelCode, Record<string, CommandHandler>>;

type Commands = typeof COMMANDS;
export type DeviceCommandContract = {
  [M in keyof Commands]: {
    [C in keyof Commands[M]]: Commands[M][C] extends Command<infer Args, infer State>
      ? { args: keyof Args extends never ? Record<string, never> : Args; state: State }
      : never;
  };
};

export function getCommand(model: `${DeviceModelCode}`, name: string) {
  const commands: Record<string, CommandHandler> = COMMANDS[model];
  return Object.hasOwn(commands, name) ? commands[name] : undefined;
}
