"""Local commands for zhimi.airfresh.va2 and va4; heater is VA4-only."""
from functools import partial

from miio_common import MiioCommandError, confirm_property, decode_enum

PROPERTIES = {
    "power": "power", "mode": "mode", "humidity": "humidity",
    "temperature": "temp_dec", "co2": "co2", "pm25": "aqi",
    "averagePm25": "average_aqi", "brightness": "led_level",
    "buzzer": "buzzer", "childLock": "child_lock", "heater": "ptc_state",
    "filterHours": "f1_hour_used", "filterLife": "filter_life",
    "motorRpm": "motor1_speed", "useSeconds": "use_time",
    "heaterTemperature": "ntcT",
}
METHODS = {
    "power": "set_power", "mode": "set_mode", "brightness": "set_led_level",
    "buzzer": "set_buzzer", "childLock": "set_child_lock", "heater": "set_ptc_state",
}
BRIGHTNESS = {0: "bright", 1: "dim", 2: "off"}
BRIGHTNESS_VALUES = {"bright": 0, "dim": 1, "off": 2}
SPEED_MODES = {1: "low", 2: "middle", 3: "strong"}
SPEEDS = {"low": 1, "middle": 2, "strong": 3}
SWITCHES = {"on": True, "off": False}


def read_state(device, model):
    state = {}
    names = list(PROPERTIES)
    if model == "zhimi.airfresh.va2":
        names.remove("heater")
    for offset in range(0, len(names), 6):
        batch = names[offset:offset + 6]
        request = [PROPERTIES[name] for name in batch]
        rows = device.send("get_prop", request)
        if not isinstance(rows, list) or len(rows) != len(batch):
            raise MiioCommandError("invalid_device_state")
        for name, value in zip(batch, rows):
            if value is not None:
                state[name] = value
    for field in ("power", "buzzer", "childLock", "heater"):
        decode_enum(state, field, SWITCHES)
    decode_enum(state, "brightness", BRIGHTNESS)
    if type(state.get("power")) is not bool:
        raise MiioCommandError("invalid_device_state")
    if model == "zhimi.airfresh.va2" and "temperature" in state:
        state["temperature"] /= 10
    mode = state.get("mode")
    if mode in SPEEDS:
        state["speed"] = SPEEDS[mode]
    return state


def execute(device, command):
    model = command["hardwareModel"]
    reader = partial(read_state, model=model)
    state = reader(device)
    operation = command["operation"]
    if operation == "state":
        return state
    if operation == "resetFilter":
        if "filterHours" not in state:
            raise MiioCommandError("unsupported")
        response = device.send("reset_filter1", [])
        if response != ["ok"]:
            raise MiioCommandError("not_confirmed")
        return confirm_property(device, reader, "filterHours", 0)
    field = "mode" if operation == "speed" else operation
    if field not in METHODS or field not in state:
        raise MiioCommandError("unsupported")
    wanted = SPEED_MODES[command["speed"]] if operation == "speed" else command[field]
    if state[field] == wanted:
        return state
    value = wanted
    if field in ("power", "buzzer", "childLock", "heater"):
        value = "on" if wanted else "off"
    elif field == "brightness":
        value = BRIGHTNESS_VALUES[wanted]
    response = device.send(METHODS[field], [value])
    if response != ["ok"]:
        raise MiioCommandError("not_confirmed")
    return confirm_property(device, reader, field, wanted)
