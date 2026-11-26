# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["python-miio==0.5.12"]
# ///
"""One local command; credentials arrive on stdin, only safe state leaves stdout."""
import json
import logging
import sys

from miio import Device
from miio.exceptions import DeviceException

import humidifier_miio
import qingping_miio
import smartmi_miio
from miio_common import MiioCommandError

MODELS = {
    "xiaomi-smart-humidifier-2": ("deerma.humidifier.jsq2g",),
    "smartmi-fresh-air": ("zhimi.airfresh.va2", "zhimi.airfresh.va4"),
    "qingping-air-monitor-lite": ("cgllc.airm.cgdn1", "cgllc.airm.cgd1st"),
}
HANDLERS = {
    "xiaomi-smart-humidifier-2": humidifier_miio.execute,
    "smartmi-fresh-air": smartmi_miio.execute,
    "qingping-air-monitor-lite": qingping_miio.execute,
}


def execute(command):
    model = command["model"]
    if model not in MODELS:
        raise MiioCommandError("unsupported")
    config = command["registrationData"]
    device = Device(config["ip"], config["token"], timeout=3)
    device.retry_count = 1
    hardware_model = device.info().model
    if hardware_model not in MODELS[model]:
        raise MiioCommandError("unsupported")
    request = {**command, "hardwareModel": hardware_model}
    return HANDLERS[model](device, request)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    if "--check" in sys.argv:
        print("miIO ready")
        sys.exit(0)
    try:
        command = json.load(sys.stdin)
        state = execute(command)
        output = json.dumps(state)
        print(output)
    except MiioCommandError as error:
        output = json.dumps({"error": str(error)})
        print(output)
        sys.exit(1)
    except (DeviceException, OSError):
        print('{"error":"device_unreachable"}')
        sys.exit(1)
    except Exception:
        sys.exit("Device command failed")
