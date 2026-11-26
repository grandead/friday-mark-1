# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = []
# ///
"""Protocol tests: no network, credentials, sleep or physical commands."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import humidifier_miio
import qingping_miio
import smartmi_miio
from miio_common import MiioCommandError, read_properties

HUMIDIFIER = {
    (2, 1): False, (2, 2): 0, (2, 5): 1, (2, 6): 50, (2, 7): 1, (2, 8): 0,
    (3, 1): 37, (3, 7): 26, (5, 1): False, (6, 1): False,
    (7, 1): False, (7, 2): False, (7, 3): False, (7, 4): False,
    (7, 5): False, (7, 6): False, (7, 7): False, (7, 8): False,
}
QINGPING = {
    (3, 1): 40, (3, 4): 5, (3, 5): 9, (3, 7): 23.7, (3, 8): 800,
    (4, 1): 100, (4, 2): 2, (4, 3): 4200,
    (9, 4): 1, (9, 5): 30, (9, 6): 15, (9, 7): "c", (9, 8): 60,
    (9, 10): 0, (9, 19): 0,
}
SMARTMI = {
    "power": "off", "mode": "auto", "humidity": 42, "temp_dec": 24.5,
    "co2": 900, "aqi": 0, "average_aqi": 2, "led_level": 0,
    "buzzer": "off", "child_lock": "off", "ptc_state": "off",
    "f1_hour_used": 125, "filter_life": None, "motor1_speed": 400,
    "use_time": 510000, "ntcT": 30,
}
SMARTMI_METHODS = {
    "set_power": "power", "set_mode": "mode", "set_led_level": "led_level",
    "set_buzzer": "buzzer", "set_child_lock": "child_lock", "set_ptc_state": "ptc_state",
}


class FakeDevice:
    def __init__(self, values, model="zhimi.airfresh.va4"):
        self.values = values.copy()
        self.model = model
        self.calls = []
        self.apply_write = True
        self.reject_write = False
        self.bad_ack = False
        self.missing_after_write = False
        self.wrote = False

    def info(self):
        return SimpleNamespace(model=self.model)

    def send(self, method, params):
        self.calls.append((method, params))
        if method == "get_properties":
            rows = []
            for prop in params:
                key = (prop["siid"], prop["piid"])
                code = 0 if key in self.values else -4003
                if self.wrote and self.missing_after_write:
                    code = -4003
                rows.append({**prop, "code": code, "value": self.values.get(key)})
            return list(reversed(rows))
        if method == "get_prop":
            if self.wrote and self.missing_after_write:
                return [None for _ in params]
            return [self.values.get(prop) for prop in params]
        self.wrote = True
        if method == "set_properties":
            prop = params[0]
            if self.apply_write and not self.reject_write:
                self.values[(prop["siid"], prop["piid"])] = prop["value"]
            ack = {**prop, "code": -4004 if self.reject_write else 0}
            if self.bad_ack:
                ack["piid"] = 999
            return [ack]
        if self.reject_write:
            return ["error"]
        if method == "reset_filter1":
            if self.apply_write:
                self.values["f1_hour_used"] = 0
        elif method in SMARTMI_METHODS:
            if self.apply_write:
                self.values[SMARTMI_METHODS[method]] = params[0]
        else:
            raise AssertionError("Unknown protocol command")
        return ["ok"]


class MiioTests(unittest.TestCase):
    def setUp(self):
        sleep = patch("miio_common.time.sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def test_humidifier_every_writable_property(self):
        cases = [
            ("power", True, (2, 1), True), ("level", 4, (2, 5), 4),
            ("mode", "constantHumidity", (2, 8), 1),
            ("targetHumidity", 65, (2, 6), 65), ("buzzer", True, (5, 1), True),
            ("indicator", True, (6, 1), True),
            ("overwetProtection", True, (7, 6), True),
            ("constantProtection", True, (7, 8), True),
        ]
        for operation, wanted, key, value in cases:
            with self.subTest(operation=operation):
                device = FakeDevice(HUMIDIFIER)
                request = {"operation": operation, operation: wanted}
                state = humidifier_miio.execute(device, request)
                self.assertEqual(state[operation], wanted)
                writes = [params for method, params in device.calls if method == "set_properties"]
                expected = [{"did": operation, "siid": key[0], "piid": key[1], "value": value}]
                self.assertEqual(writes, [expected])
                self.assertEqual(device.calls[-1][0], "get_properties")

    def test_qingping_every_supported_setting(self):
        cases = [
            ("monitoringInterval", 60, 4, 60), ("screenOffDelay", 0, 5, 0),
            ("powerOffDelay", 0, 6, 0), ("temperatureUnit", "f", 7, "f"),
            ("screensaverDelay", 120, 8, 120), ("autoSlideInterval", 30, 10, 30),
            ("twelveHourClock", True, 19, 1),
        ]
        for operation, wanted, piid, value in cases:
            with self.subTest(operation=operation):
                device = FakeDevice(QINGPING)
                request = {"operation": operation, operation: wanted}
                state = qingping_miio.execute(device, request)
                self.assertEqual(state[operation], wanted)
                writes = [params for method, params in device.calls if method == "set_properties"]
                self.assertEqual(writes[0][0]["siid"], 9)
                self.assertEqual(writes[0][0]["piid"], piid)
                self.assertEqual(writes[0][0]["value"], value)
                self.assertEqual(len(writes), 1)
                self.assertEqual(state["temperature"], 23.7)

    def test_smartmi_every_command_and_speed_mapping(self):
        cases = [
            ("power", True, "set_power", "on", "power", True),
            ("mode", "silent", "set_mode", "silent", "mode", "silent"),
            ("brightness", "off", "set_led_level", 2, "brightness", "off"),
            ("buzzer", True, "set_buzzer", "on", "buzzer", True),
            ("childLock", True, "set_child_lock", "on", "childLock", True),
            ("heater", True, "set_ptc_state", "on", "heater", True),
        ]
        for speed, mode in [(1, "low"), (2, "middle"), (3, "strong")]:
            cases.append(("speed", speed, "set_mode", mode, "speed", speed))
        for operation, wanted, method, value, field, expected in cases:
            with self.subTest(operation=operation, wanted=wanted):
                device = FakeDevice(SMARTMI)
                command = {"hardwareModel": device.model, "operation": operation, operation: wanted}
                state = smartmi_miio.execute(device, command)
                writes = [(m, p) for m, p in device.calls if m != "get_prop"]
                self.assertEqual(writes, [(method, [value])])
                self.assertEqual(state[field], expected)
                self.assertEqual(device.calls[-1][0], "get_prop")

    def test_read_only_state_and_units(self):
        device = FakeDevice(SMARTMI)
        state = smartmi_miio.read_state(device, device.model)
        self.assertEqual(state["temperature"], 24.5)
        self.assertNotIn("filterLife", state)
        self.assertEqual(state["filterHours"], 125)
        self.assertTrue(all(method == "get_prop" for method, _ in device.calls))
        device.values["temp_dec"] = 245
        state = smartmi_miio.read_state(device, "zhimi.airfresh.va2")
        self.assertEqual(state["temperature"], 24.5)
        self.assertNotIn("heater", state)
        device = FakeDevice(HUMIDIFIER)
        device.values[(2, 2)] = 1
        device.values[(7, 2)] = True
        state = humidifier_miio.read_state(device)
        self.assertEqual(state["fault"], "waterShortage")
        self.assertTrue(state["waterShortage"])
        self.assertEqual(state["mode"], "manual")
        self.assertEqual(state["status"], "idle")
        self.assertEqual(state["humidity"], 37)

    def test_ack_is_not_state_confirmation(self):
        for module, values, operation, wanted in [
            (humidifier_miio, HUMIDIFIER, "targetHumidity", 60),
            (qingping_miio, QINGPING, "screenOffDelay", 0),
            (smartmi_miio, SMARTMI, "power", True),
        ]:
            for reject in [False, True]:
                with self.subTest(module=module.__name__, reject=reject):
                    device = FakeDevice(values)
                    device.apply_write = False
                    device.reject_write = reject
                    command = {"operation": operation, operation: wanted, "hardwareModel": device.model}
                    with self.assertRaisesRegex(MiioCommandError, "not_confirmed"):
                        module.execute(device, command)

    def test_missing_optional_property_blocks_only_its_command(self):
        device = FakeDevice(QINGPING)
        del device.values[(9, 19)]
        state = qingping_miio.read_state(device)
        self.assertNotIn("twelveHourClock", state)
        with self.assertRaisesRegex(MiioCommandError, "unsupported"):
            qingping_miio.execute(device, {"operation": "twelveHourClock", "twelveHourClock": True})
        self.assertFalse(device.wrote)
        device = FakeDevice(SMARTMI)
        command = {"hardwareModel": "zhimi.airfresh.va2", "operation": "heater", "heater": True}
        with self.assertRaisesRegex(MiioCommandError, "unsupported"):
            smartmi_miio.execute(device, command)
        self.assertFalse(device.wrote)

    def test_noop_and_filter_reset_fresh_confirmation(self):
        device = FakeDevice(HUMIDIFIER)
        humidifier_miio.execute(device, {"operation": "power", "power": False})
        self.assertFalse(device.wrote)
        for hours in [0, 125]:
            device = FakeDevice(SMARTMI)
            device.values["f1_hour_used"] = hours
            command = {"hardwareModel": device.model, "operation": "resetFilter"}
            state = smartmi_miio.execute(device, command)
            self.assertEqual(state["filterHours"], 0)
            self.assertIn(("reset_filter1", []), device.calls)
            self.assertEqual(device.calls[-1][0], "get_prop")
        device.missing_after_write = True
        device.wrote = False
        with self.assertRaises(MiioCommandError):
            smartmi_miio.execute(device, command)

    def test_malformed_and_mismatched_responses(self):
        device = FakeDevice(HUMIDIFIER)
        device.bad_ack = True
        with self.assertRaisesRegex(MiioCommandError, "not_confirmed"):
            humidifier_miio.execute(device, {"operation": "power", "power": True})
        device = FakeDevice(QINGPING)
        del device.values[(3, 8)]
        with self.assertRaisesRegex(MiioCommandError, "invalid_device_state"):
            qingping_miio.read_state(device)
        device = FakeDevice(SMARTMI)
        device.values["power"] = "unknown"
        with self.assertRaisesRegex(MiioCommandError, "invalid_device_state"):
            smartmi_miio.read_state(device, device.model)
        for response in [{}, [None], [{"siid": 9, "piid": 999, "code": 0, "value": True}]]:
            with patch.object(device, "send", return_value=response):
                with self.assertRaisesRegex(MiioCommandError, "invalid_device_state"):
                    read_properties(device, {"power": (2, 1)})

    def test_cgd1st_extra_settings_and_legacy_limits(self):
        values = {**QINGPING, (9, 18): 900, (9, 20): 0}
        for operation, wanted, piid, value in [
            ("screenOffDelay", 600, 5, 600),
            ("powerOffDelay", 10, 6, 10),
            ("powerOffSeconds", 120, 18, 120),
            ("pm25Standard", "us", 20, 1),
        ]:
            with self.subTest(operation=operation):
                device = FakeDevice(values, model="cgllc.airm.cgd1st")
                command = {"hardwareModel": device.model, "operation": operation, operation: wanted}
                state = qingping_miio.execute(device, command)
                self.assertEqual(state[operation], wanted)
                writes = [params for method, params in device.calls if method == "set_properties"]
                self.assertEqual(writes[0][0]["piid"], piid)
                self.assertEqual(writes[0][0]["value"], value)
                legacy = FakeDevice(QINGPING)
                command["hardwareModel"] = "cgllc.airm.cgdn1"
                with self.assertRaisesRegex(MiioCommandError, "unsupported"):
                    qingping_miio.execute(legacy, command)
                self.assertFalse(legacy.wrote)

    def test_dispatch_rejects_wrong_hardware(self):
        modules = {
            "miio": SimpleNamespace(Device=FakeDevice),
            "miio.exceptions": SimpleNamespace(DeviceException=ConnectionError),
        }
        with patch.dict(sys.modules, modules):
            import home_miio
        device = FakeDevice(HUMIDIFIER, model="different.device")
        command = {"model": "xiaomi-smart-humidifier-2", "operation": "power",
                   "power": True, "registrationData": {"ip": "local", "token": "secret"}}
        with patch.object(home_miio, "Device", return_value=device):
            with self.assertRaisesRegex(MiioCommandError, "unsupported"):
                home_miio.execute(command)
        self.assertEqual(device.calls, [])


if __name__ == "__main__":
    unittest.main()
