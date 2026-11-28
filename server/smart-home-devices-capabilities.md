# Smart home devices capabilities

Checked on 2026-11-27. Device operations and schemas live in [`src/services/smart-home/devices/`](src/services/smart-home/devices/). Each model declares its voice tools in [`src/services/llm-tools/smart-home/devices/`](src/services/llm-tools/smart-home/devices/). The catalogue lists them for each stored device. All tools require `deviceId`; settings use named, validated arguments. Settings succeed only after readback matches the request. Unsupported optional properties are omitted, never reported as zero or false.

## Smartmi Fresh Air — 9 tools

Hardware: `zhimi.airfresh.va4`; `va2` is also supported, without heater control.

| Tool suffix (`smartmi_`) | Input / result                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_state`              | Power, mode, humidity, temperature, CO₂, PM2.5 and average PM2.5, screen, buzzer, lock, heater, filter hours, remaining filter life if available, motor RPM, total use time, NTC temperature |
| `set_power`              | `power`: boolean                                                                                                                                                                             |
| `set_mode`               | `mode`: auto, silent, interval, low, middle, strong                                                                                                                                          |
| `set_speed`              | `speed`: 1–3, mapped to low/middle/strong; leaves the previous mode                                                                                                                          |
| `set_brightness`         | `brightness`: bright, dim, off                                                                                                                                                               |
| `set_buzzer`             | `buzzer`: boolean                                                                                                                                                                            |
| `set_child_lock`         | `childLock`: boolean                                                                                                                                                                         |
| `set_heater`             | `heater`: boolean, VA4 only                                                                                                                                                                  |
| `reset_filter`           | Always sends reset, then requires a fresh zero-hour reading                                                                                                                                  |

No known local command sets a target temperature, target CO₂ or arbitrary motor RPM. `app_extra` is an undocumented service value and reads as null on this VA4. The separate legacy `led` field also reads as null; screen control uses `led_level`. No CO₂ calibration command was established. We do not expose raw RPC, Wi-Fi provisioning or firmware updates as voice tools.

Sources: [python-miio implementation](https://python-miio.readthedocs.io/en/stable/_modules/miio/integrations/airpurifier/zhimi/airfresh.html), [Xiaomi VA4 specification](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:air-fresh:0000A012:zhimi-va4:2).

## Xiaomi Smart Humidifier 2 — 9 tools

Hardware: `deerma.humidifier.jsq2g`. Do not use these property IDs for other Xiaomi humidifier models.

| Tool suffix (`xiaomi_humidifier_`) | Input / MIoT property                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_state`                        | All 18 operating properties: power, level, target, mode, activity, fault, humidity, temperature, sound, indicator, tank and water status, sensor faults, protection settings and activation flags |
| `set_power`                        | `power`: boolean; 2.1                                                                                                                                                                             |
| `set_level`                        | `level`: 1–3 manual output, 4 constant humidity; 2.5                                                                                                                                              |
| `set_target_humidity`              | `targetHumidity`: integer 40–70%; 2.6                                                                                                                                                             |
| `set_mode`                         | `mode`: manual / constantHumidity, encoded as 0 / 1; 2.8                                                                                                                                          |
| `set_buzzer`                       | `buzzer`: boolean; 5.1                                                                                                                                                                            |
| `set_indicator`                    | `indicator`: boolean; 6.1                                                                                                                                                                         |
| `set_overwet_protection`           | `overwetProtection`: boolean; 7.6                                                                                                                                                                 |
| `set_constant_protection`          | `constantProtection`: boolean; 7.8                                                                                                                                                                |

All writable properties in spec v2 are covered. The 2.1 action duplicates explicit power control. Temperature, tank state, water shortage and protection activation are read-only. There is no separate UV switch or water-volume reading in this spec. Xiaomi Home offers schedules, but no local schedule protocol was established for this integration; creating schedules needs a separate scheduler or cloud integration.

Sources: [Xiaomi specification](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:humidifier:0000A00E:deerma-jsq2g:2), [Xiaomi product FAQ](https://www.mi.com/my/support/faq/details/KA-11463/).

## Qingping Air Monitor Lite — 10 tools

Supported protocol models: `cgllc.airm.cgdn1` and `cgllc.airm.cgd1st`. The registered device is CGD1ST. Both use the same measurement IDs; CGD1ST has extra timer values and settings. No on/off tool: a powered-off monitor cannot be woken through this API.

| Tool suffix (`qingping_`) | Input / MIoT property                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `get_state`               | CO₂, PM2.5, PM10, temperature, humidity, battery, charging, voltage and available settings below |
| `set_monitoring_interval` | `monitoringInterval`: 0, 1, 60, 300, 600 seconds; 9.4                                            |
| `set_screen_off_delay`    | `screenOffDelay`: 0, 15, 30, 60, 300 seconds; CGD1ST also 600; 9.5                               |
| `set_power_off_delay`     | `powerOffDelay`: 0, 15, 30, 60 minutes; CGD1ST also 10; 9.6                                      |
| `set_temperature_unit`    | `temperatureUnit`: c / f; 9.7; readings stay in Celsius                                          |
| `set_screensaver_delay`   | `screensaverDelay`: 0–1800 seconds; 9.8                                                          |
| `set_auto_slide_interval` | `autoSlideInterval`: 0–3600 seconds; 9.10                                                        |
| `set_clock_format`        | `twelveHourClock`: boolean encoded as 0 / 1; 9.19                                                |
| `set_power_off_seconds`   | `powerOffSeconds`: 0–65535 seconds; CGD1ST 9.18; use instead of the older minute setting         |
| `set_pm25_standard`       | `pm25Standard`: cn / us, encoded as 0 / 1; CGD1ST 9.20                                           |

Zero disables the screen/power timeout and auto-slide; monitoring interval zero means unset. Missing optional settings fail as unsupported, without writing. Spec v3 also lists night hours, timezone, screensaver type, page order, LED thresholds and CO₂ reset. Their full behavior, encoding or safe completion has not been verified; successful reads alone are not enough to offer these controls. They are not exposed as raw numeric/string commands. The old setting actions duplicate property writes. MQTT is a separate connection mode and is not configured by these tools.

Sources: [python-miio implementation](https://python-miio.readthedocs.io/en/stable/_modules/miio/airqualitymonitor_miot.html), [Xiaomi CGDN1 specification](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:air-monitor:0000A008:cgllc-cgdn1:3), [Xiaomi CGD1ST specification](https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:air-monitor:0000A008:cgllc-cgd1st:2).

## Ballu ONEAIR ASP-100 — 9 tools

Catalogue code: `ballu-oneair-asp-100`. The two installed breezers use HOMMYN, vendor `rusclimate`, Syncleo device type `69`. They have no CO₂ sensor. This section describes the implemented local integration; protocol fields do not imply that every unit has the corresponding sensor or hardware.

### Connection

Register the IPv4 address and 32-character hexadecimal token in `registrationData`. The adapter discovers the matching IPv4 address through `_syncleo._udp.local.` to obtain its UDP port and protocol metadata, then authenticates with the stored token. The server and device need the same local network with mDNS/multicast available. No cloud login is used for these commands. Keep the token out of prompts and logs.

### Commands

All tools require `deviceId`. The table lists additional arguments. Boolean and integer values are validated without coercion or clamping.

| Tool suffix (`ballu_`)   | Arguments and behavior                                                                                                                                                  | Driver operation / wire command           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `get_state`              | No extra arguments. Read current state and available diagnostics below.                                                                                                 | `state`; no setting writes                |
| `set_power`              | `power`: boolean. Turning an off unit on selects manual mode. An already-on unit keeps its current mode. Turning off selects mode 0.                                    | `power`; `MODE` 1 / 0                     |
| `set_mode`               | `mode`: manual, night, turbo, eco. Selects an on mode. Turbo runs for 15 minutes, then returns to the previous mode. Eco is passive ventilation without fan or heating. | `mode`; `MODE` 1 / 3 / 4 / 5              |
| `set_speed`              | `speed`: integer 1–7. Switch to manual mode first, then set speed; leaves night or turbo mode.                                                                          | `speed`; `MODE` 1, then `SPEED`           |
| `set_temperature`        | `temperature`: integer 5–25 °C. Set the supply-air heating target. Requires a confirmed installed heater. Does not change the operating mode or power.                  | `targetTemperature`; `TARGET_TEMPERATURE` |
| `set_button_sound`       | `enabled`: boolean. Enable or disable button sounds. Does not control ambient sounds.                                                                                   | `buttonSound`; `VOLUME`                   |
| `set_backlight_auto_off` | `enabled`: boolean. Enable or disable automatic backlight shutoff. Does not switch the light immediately or set a timeout duration.                                     | `backlightAutoOff`; `BACKLIGHT`           |
| `set_sound`              | `sound`: off, rain, sea, forest, birds, fireplace. Select or stop an ambient sound.                                                                                     | `sound`; `AMOUNT` 0–5 in that order       |
| `reset_filter`           | No extra arguments. Reset the main filter counter after servicing, only on an explicit request. Always send the reset and require a fresh zero reading.                 | `resetFilter`; `EXPENDABLES` 0            |

Wire opcodes covered by the protocol tests: `MODE` 1, `TARGET_TEMPERATURE` 2, `VOLUME` 9, `AMOUNT` 11, `SPEED` 15, `BACKLIGHT` 28 and `EXPENDABLES` 34. Wire names such as `VOLUME` and `AMOUNT` are protocol identifiers; their meaning here is specific to ASP-100.

### State and diagnostics

Only `power` is required in the parsed state. Other fields are included when reported by the device.

| State fields                               | Meaning and handling                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `power`, `mode`                            | Power is derived from mode: off is false, other known modes are true. Read modes include off and auto, but auto cannot be selected by a tool for these units.             |
| `speed`                                    | Reported speed. The parser accepts 0–8; writable manual speeds are restricted to 1–7.                                                                                     |
| `targetTemperature`                        | Supply-air heating target. Read values can be 0–25; writable targets are 5–25 °C.                                                                                         |
| `temperature`                              | Reported supply-air temperature, not room temperature.                                                                                                                    |
| `heaterInstalled`, `co2SensorInstalled`    | Optional hardware flags from `PROGRAM_DATA`, mode 0. Missing flags mean unknown hardware.                                                                                 |
| `buttonSound`, `backlightAutoOff`, `sound` | Current settings corresponding to the tools above.                                                                                                                        |
| `filterCounter`                            | Raw main-filter counter, 0–65535. Its unit is not established; do not describe it as remaining percent, days or hours.                                                    |
| `errorCode`                                | Numeric device diagnostic. Zero is described as no errors; other values remain numeric codes.                                                                             |
| `turboSeconds`                             | Reported time remaining in turbo mode, in seconds. Spoken only while turbo is active.                                                                                     |
| `humidity`, `pm25`                         | Optional measurements, included only if actually reported. Their absence is not a zero reading or proof that the sensor is installed.                                     |
| `co2`                                      | The generic decoder can receive this field, but the installed units have no CO₂ sensor. The spoken Ballu state always omits it, even when the capability flag is missing. |

### Confirmation and limits

- Each command opens a local connection and reads the initial state. Discovery has a 7-second timeout; the first power state has a 10-second timeout, followed by one second for optional fields. The Node driver limits the whole adapter process to 30 seconds.
- An ordinary setting already equal to the current value is not sent again. A changed setting requires a new device update with the requested value within five seconds per step. A filter reset always needs a new acknowledgement, even if the initial counter is zero.
- The TypeScript handler also checks the returned value. Mode changes require power on; speed changes require the requested speed, manual mode and power on; temperature changes require the requested target and `heaterInstalled: true`.
- A missing required setting produces `unsupported`. A missing heater produces `heater_missing`; an unknown heater flag produces `hardware_unknown`. A write without matching confirmation produces `not_confirmed`; it may still have affected the physical device. Connection failures produce `device_unreachable`.
- There is no tool for automatic CO₂ control or a CO₂ target. There is no separate heater on/off switch, room-temperature target, night-mode speed, ambient-sound volume, direct backlight switch, custom turbo duration, schedule or prefilter reset in this integration. Do not substitute eco mode or whole-device power for heater control.

Implementation sources: [command schemas and handlers](src/services/smart-home/devices/ballu-asp100.ts), [wire mappings and acknowledgements](src/services/smart-home/drivers/syncleo/ballu_protocol.py), [discovery and connection](src/services/smart-home/drivers/syncleo/syncleo_adapter.py). The adapter pins `pysyncleo==0.4.1` and `zeroconf==0.154.0`.

## Verification

- Read-only checks passed on the registered Smartmi VA4 (`1.4.6_1014`) and Deerma JSQ2G (`2.2.2`). All 18 humidifier properties answered successfully.
- Read-only checks passed on Qingping CGD1ST (`2.1.7_0481`) after correcting its stored IP. All 27 measurement, battery and setting properties answered successfully. The separate MAC property was not requested.
- The Node.js miIO driver and previous Python adapter returned matching property names and types on the registered Smartmi VA4 (15 fields), Deerma JSQ2G (18) and Qingping CGD1ST (17).
- No physical setting was changed or filter counter reset. Protocol writes and readback failures are tested with simulated devices in `test/miio.test.ts`; tool schemas and handlers are tested in `test/xiaomi-commands.test.ts`.
- Ballu wire encoding, unsupported inputs, hardware checks and fresh acknowledgements are covered by [`test/test_ballu.py`](test/test_ballu.py). Tool validation, model matching, returned-state checks, error reporting and CO₂ omission are covered by [`test/ballu-commands.test.ts`](test/ballu-commands.test.ts). This documentation update used the implementation and these test cases; it did not run new commands on physical Ballu devices.
