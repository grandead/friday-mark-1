# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["python-miio==0.5.12"]
# ///
"""One DB-backed miIO command; credentials arrive on stdin, only safe state leaves stdout."""
import json
import logging
import sys
import time
from miio import Device

POWER = {"did": "power", "siid": 2, "piid": 1}


def execute(command):
    config = command["registrationData"]
    device = Device(config["ip"], config["token"])
    model = device.info().model
    humidifier = command["model"] == "xiaomi-smart-humidifier-2"
    if humidifier:
        if model != "deerma.humidifier.jsq2g":
            raise ValueError("Unsupported humidifier model")
    elif command["model"] != "smartmi-fresh-air" or model not in ("zhimi.airfresh.va2", "zhimi.airfresh.va4"):
        raise ValueError("Unsupported airfresh model")

    def state():
        if humidifier:
            rows = device.send("get_properties", [POWER, {"did": "humidity", "siid": 3, "piid": 1}])
            values = {(r["siid"], r["piid"]): r.get("value") for r in rows if r.get("code") == 0}
            power = values.get((2, 1))
            if type(power) is not bool:
                raise ValueError("Missing power")
            result = {"power": power, "humidity": values.get((3, 1))}
        else:
            rows = device.send("get_prop", ["power", "humidity", "temp_dec", "co2", "aqi"])
            if len(rows) != 5 or rows[0] not in ("on", "off"):
                raise ValueError("Missing power")
            result = {"power": rows[0] == "on", "humidity": rows[1], "temperature": rows[2] / 10 if model.endswith("va2") and rows[2] is not None else rows[2], "co2": rows[3], "pm25": rows[4]}
        return {k: v for k, v in result.items() if v is not None}

    before = state()
    if command["operation"] == "state":
        return before
    wanted = command.get("power")
    if command["operation"] != "power" or type(wanted) is not bool:
        raise ValueError("Unsupported command")
    if before["power"] == wanted:
        return before
    if humidifier:
        response = device.send("set_properties", [{**POWER, "value": wanted}])
        if not response or response[0].get("code") not in (0, 1):
            raise ValueError("Power rejected")
    else:
        device.send("set_power", ["on" if wanted else "off"])
    for _ in range(3):
        time.sleep(0.4)
        after = state()
        if after["power"] == wanted:
            return after
    raise ValueError("Power not confirmed")


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    if "--check" in sys.argv:
        print("miIO ready")
        sys.exit(0)
    try:
        print(json.dumps(execute(json.load(sys.stdin))))
    except Exception:
        sys.exit("Device command failed")
