"""deerma.humidifier.jsq2g MIoT properties (spec v2)."""
from miio_common import (
    MiioCommandError, confirm_property, decode_enum, read_properties, write_property,
)

PROPERTIES = {
    "power": (2, 1), "fault": (2, 2), "level": (2, 5),
    "targetHumidity": (2, 6), "status": (2, 7), "mode": (2, 8),
    "humidity": (3, 1), "temperature": (3, 7),
    "buzzer": (5, 1), "indicator": (6, 1),
    "tankLifted": (7, 1), "waterShortage": (7, 2),
    "humiditySensorFault": (7, 3), "temperatureSensorFault": (7, 4),
    "overwetProtectionActive": (7, 5), "overwetProtection": (7, 6),
    "constantProtectionActive": (7, 7), "constantProtection": (7, 8),
}
WRITABLE = {
    "power", "level", "targetHumidity", "mode", "buzzer", "indicator",
    "overwetProtection", "constantProtection",
}
MODES = {0: "manual", 1: "constantHumidity"}
MODE_VALUES = {"manual": 0, "constantHumidity": 1}
FAULTS = {0: "none", 1: "waterShortage", 2: "tankSeparated"}
STATUSES = {1: "idle", 2: "humidifying"}


def read_state(device):
    state = read_properties(device, PROPERTIES)
    if type(state.get("power")) is not bool:
        raise MiioCommandError("invalid_device_state")
    decode_enum(state, "mode", MODES)
    decode_enum(state, "fault", FAULTS)
    decode_enum(state, "status", STATUSES)
    return state


def execute(device, command):
    state = read_state(device)
    operation = command["operation"]
    if operation == "state":
        return state
    if operation not in WRITABLE or operation not in state:
        raise MiioCommandError("unsupported")
    wanted = command[operation]
    if state[operation] == wanted:
        return state
    value = MODE_VALUES[wanted] if operation == "mode" else wanted
    write_property(device, PROPERTIES, operation, value)
    return confirm_property(device, read_state, operation, wanted)
