"""ASP-100/type 69 commands. Wire types come from pysyncleo 0.4.1.

Mappings: DeKaN/ha-syncleo devices/breezers.py (type 69) and
he110/ha-rusclimate api/params.py. Unknown fields are never writable.
"""
from dataclasses import dataclass
from pysyncleo.commands import (
    CmdMode, CmdSpeed, CmdTargetTemperature, CmdVolume, CmdBacklight,
    CmdAmount, CmdExpendables,
)

MODES = {0: "off", 1: "manual", 2: "auto", 3: "night", 4: "turbo", 5: "eco"}
SOUNDS = {0: "off", 1: "rain", 2: "sea", 3: "forest", 4: "birds", 5: "fireplace"}


class CommandError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class BalluState:
    def __init__(self):
        self.values = {}
        self.revisions = {}

    def update(self, key, value):
        self.values[key] = value
        self.revisions[key] = self.revisions.get(key, 0) + 1

    def receive(self, cmd):
        name = cmd.command_type.name
        value = getattr(cmd, "value", None)
        if name == "MODE" and value in MODES:
            self.update("mode", MODES[value])
            self.update("power", value != 0)
        elif name == "AMOUNT" and value in SOUNDS:
            self.update("sound", SOUNDS[value])
        elif name in ("VOLUME", "BACKLIGHT") and type(value) is bool:
            self.update("buttonSound" if name == "VOLUME" else "backlightAutoOff", value)
        elif name == "EXPENDABLES" and isinstance(value, list) and value and type(value[0]) is int and 0 <= value[0] <= 65535:
            # Raw counter: firmware/third-party profiles disagree about whether it is remaining %.
            self.update("filterCounter", value[0])
        elif name == "PROGRAM_DATA" and cmd.mode == 0:
            for index, key in enumerate(("heaterInstalled", "co2SensorInstalled")):
                if len(cmd.data) > index and cmd.data[index] in (0, 1):
                    self.update(key, bool(cmd.data[index]))
        else:
            fields = {
                "SPEED": ("speed", 0, 8), "TARGET_TEMPERATURE": ("targetTemperature", 0, 25),
                "TEMPERATURE": ("temperature", -60, 100), "CURRENT_HUMIDITY": ("humidity", 0, 100),
                "CO2": ("co2", 1, 65535), "PM2": ("pm25", 0, 65535),
                "ERROR": ("errorCode", 0, 65535), "TARGET_TIME": ("turboSeconds", 0, 86400),
            }
            if name in fields and type(value) in (int, float):
                key, low, high = fields[name]
                if low <= value <= high:
                    self.update(key, value)


@dataclass
class Step:
    key: str
    wanted: object
    command: object
    always: bool = False


def require_field(state, key):
    if key not in state:
        raise CommandError("unsupported")


def steps_for(command, state):
    operation = command.get("operation")
    if operation == "state":
        return []
    if operation == "power":
        wanted = command.get("power")
        if type(wanted) is not bool:
            raise CommandError("unsupported")
        return [Step("power", wanted, CmdMode(1 if wanted else 0))]
    if operation == "mode":
        mode = command.get("mode")
        values = {name: value for value, name in MODES.items() if name not in ("auto", "off")}
        if mode not in values:
            raise CommandError("unsupported")
        return [Step("mode", mode, CmdMode(values[mode]))]
    if operation == "speed":
        speed = command.get("speed")
        if type(speed) is not int or not 1 <= speed <= 7:
            raise CommandError("unsupported")
        require_field(state, "speed")
        return [Step("mode", "manual", CmdMode(1)), Step("speed", speed, CmdSpeed(speed))]
    if operation == "targetTemperature":
        temperature = command.get("temperature")
        if type(temperature) is not int or not 5 <= temperature <= 25:
            raise CommandError("unsupported")
        if state.get("heaterInstalled") is False:
            raise CommandError("heater_missing")
        if state.get("heaterInstalled") is not True:
            raise CommandError("hardware_unknown")
        require_field(state, "targetTemperature")
        return [Step("targetTemperature", temperature, CmdTargetTemperature(temperature))]
    if operation in ("buttonSound", "backlightAutoOff"):
        enabled = command.get("enabled")
        if type(enabled) is not bool:
            raise CommandError("unsupported")
        require_field(state, operation)
        cls = CmdVolume if operation == "buttonSound" else CmdBacklight
        return [Step(operation, enabled, cls(enabled))]
    if operation == "sound":
        sound = command.get("sound")
        values = {name: value for value, name in SOUNDS.items()}
        if sound not in values:
            raise CommandError("unsupported")
        require_field(state, "sound")
        return [Step("sound", sound, CmdAmount(values[sound]))]
    if operation == "resetFilter":
        require_field(state, "filterCounter")
        return [Step("filterCounter", 0, CmdExpendables(0), always=True)]
    raise CommandError("unsupported")


async def apply_command(command, state, send_command, wait_for):
    for step in steps_for(command, state.values):
        if not step.always and state.values.get(step.key) == step.wanted:
            continue
        revision = state.revisions.get(step.key, 0)
        await send_command(step.command)
        try:
            await wait_for(lambda: state.revisions.get(step.key, 0) > revision and state.values.get(step.key) == step.wanted, 5)
        except TimeoutError:
            raise CommandError("not_confirmed") from None
