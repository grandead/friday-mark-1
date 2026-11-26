"""Qingping CGDN1 / CGD1ST MIoT measurements and local settings."""
from functools import partial

from miio_common import (
    MiioCommandError, confirm_property, decode_enum, read_properties, write_property,
)

PROPERTIES = {
    "humidity": (3, 1), "pm25": (3, 4), "pm10": (3, 5),
    "temperature": (3, 7), "co2": (3, 8),
    "battery": (4, 1), "chargingState": (4, 2), "voltage": (4, 3),
    "monitoringInterval": (9, 4), "screenOffDelay": (9, 5),
    "powerOffDelay": (9, 6), "temperatureUnit": (9, 7),
    "screensaverDelay": (9, 8), "autoSlideInterval": (9, 10),
    "twelveHourClock": (9, 19),
}
CGD1ST_PROPERTIES = {**PROPERTIES, "powerOffSeconds": (9, 18), "pm25Standard": (9, 20)}
WRITABLE = {
    "monitoringInterval", "screenOffDelay", "powerOffDelay", "temperatureUnit",
    "screensaverDelay", "autoSlideInterval", "twelveHourClock",
    "powerOffSeconds", "pm25Standard",
}
PM25_STANDARDS = {0: "cn", 1: "us"}
PM25_STANDARD_VALUES = {"cn": 0, "us": 1}


def read_state(device, model="cgllc.airm.cgdn1"):
    properties = CGD1ST_PROPERTIES if model == "cgllc.airm.cgd1st" else PROPERTIES
    state = read_properties(device, properties)
    if not all(name in state for name in ("humidity", "temperature", "co2", "pm25", "pm10")):
        raise MiioCommandError("invalid_device_state")
    if "twelveHourClock" in state:
        value = state["twelveHourClock"]
        if type(value) is not int or value not in (0, 1):
            raise MiioCommandError("invalid_device_state")
        state["twelveHourClock"] = value == 1
    decode_enum(state, "pm25Standard", PM25_STANDARDS)
    return state


def execute(device, command):
    model = command.get("hardwareModel", "cgllc.airm.cgdn1")
    properties = CGD1ST_PROPERTIES if model == "cgllc.airm.cgd1st" else PROPERTIES
    reader = partial(read_state, model=model)
    state = reader(device)
    operation = command["operation"]
    if operation == "state":
        return state
    if operation not in WRITABLE or operation not in state:
        raise MiioCommandError("unsupported")
    wanted = command[operation]
    if model == "cgllc.airm.cgdn1":
        if ((operation == "screenOffDelay" and wanted == 600)
                or (operation == "powerOffDelay" and wanted == 10)):
            raise MiioCommandError("unsupported")
    if state[operation] == wanted:
        return state
    value = int(wanted) if operation == "twelveHourClock" else wanted
    if operation == "pm25Standard":
        value = PM25_STANDARD_VALUES[wanted]
    write_property(device, properties, operation, value)
    return confirm_property(device, reader, operation, wanted)
