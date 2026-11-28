# /// script
# requires-python = ">=3.14.2,<3.15"
# dependencies = ["pysyncleo==0.4.1", "zeroconf==0.154.0"]
# ///
"""No sockets or appliances: verify wire commands and fresh device acknowledgements."""
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/services/smart-home/drivers/syncleo'))
import syncleo_adapter
from ballu_protocol import BalluState, CommandError, steps_for, apply_command
from pysyncleo.commands import CmdMode, CmdSpeed, CmdProgramData, CmdExpendables

BASE = {"power": True, "mode": "manual", "speed": 1, "targetTemperature": 25,
        "heaterInstalled": True, "buttonSound": True, "backlightAutoOff": False,
        "sound": "off", "filterCounter": 17}


class WireTests(unittest.TestCase):
    def test_settings_encode_known_asp100_opcodes(self):
        cases = [
            ({"operation": "mode", "mode": "night"}, 1, b'\x03'),
            ({"operation": "mode", "mode": "turbo"}, 1, b'\x04'),
            ({"operation": "mode", "mode": "eco"}, 1, b'\x05'),
            ({"operation": "targetTemperature", "temperature": 22}, 2, b'\x16\x00'),
            ({"operation": "buttonSound", "enabled": False}, 9, b'\x00'),
            ({"operation": "backlightAutoOff", "enabled": True}, 28, b'\x01'),
            ({"operation": "sound", "sound": "rain"}, 11, b'\x01\x00'),
            ({"operation": "sound", "sound": "fireplace"}, 11, b'\x05\x00'),
            ({"operation": "sound", "sound": "off"}, 11, b'\x00\x00'),
            ({"operation": "resetFilter"}, 34, b'\x00\x00'),
        ]
        for command, opcode, payload in cases:
            with self.subTest(command=command):
                steps = steps_for(command, BASE)
                self.assertEqual(len(steps), 1)
                self.assertEqual(steps[0].command.command_type.value, opcode)
                self.assertEqual(steps[0].command.serialize(), payload)

    def test_unknown_operations_never_produce_writes(self):
        for operation in ["heater", "resetPrefilter"]:
            with self.subTest(operation=operation), self.assertRaises(CommandError):
                steps_for({"operation": operation}, BASE)

    def test_missing_or_unknown_hardware_and_missing_fields(self):
        for capability, error in [(False, 'heater_missing'), (None, 'hardware_unknown')]:
            with self.assertRaises(CommandError) as caught:
                steps_for({"operation": "targetTemperature", "temperature": 20}, {**BASE, "heaterInstalled": capability})
            self.assertEqual(caught.exception.code, error)
        for operation, argument in [('sound', {'sound': 'rain'}), ('buttonSound', {'enabled': True}), ('resetFilter', {})]:
            with self.assertRaises(CommandError):
                steps_for({'operation': operation, **argument}, {})

    def test_decode_capabilities_and_filter_without_treating_absence_as_zero(self):
        state = BalluState()
        state.receive(CmdProgramData(b'\x01\x00', mode=0))
        state.receive(CmdMode(3))
        state.receive(CmdSpeed(1))
        state.receive(CmdExpendables(17))
        self.assertTrue(state.values['heaterInstalled'])
        self.assertFalse(state.values['co2SensorInstalled'])
        self.assertEqual(state.values['mode'], 'night')
        self.assertEqual(state.values['filterCounter'], 17)
        self.assertNotIn('humidity', state.values)
        self.assertNotIn('co2', state.values)
        state.receive(CmdProgramData(b'', mode=0))
        self.assertFalse(state.values['co2SensorInstalled'])


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_uses_registered_ip_and_token(self):
        credentials = {"ip": "192.0.2.1", "token": "ab" * 16}
        request = {"operation": "backlightAutoOff", "args": {"enabled": False}, "credentials": credentials}
        with patch.object(syncleo_adapter, "discover", new_callable=AsyncMock) as discover, patch.object(syncleo_adapter, "run_device", new_callable=AsyncMock) as run:
            result = await syncleo_adapter.execute(request)
            discover.assert_awaited_once_with(ip=credentials["ip"])
            run.assert_awaited_once_with(discover.return_value, credentials["token"], {"operation": "backlightAutoOff", "enabled": False})
            self.assertIs(result, run.return_value)


class AcknowledgementTests(unittest.IsolatedAsyncioTestCase):
    async def test_speed_switches_to_manual_before_changing_speed(self):
        state = BalluState()
        state.values.update({**BASE, 'mode': 'night'})
        sent = []
        async def send(cmd):
            sent.append(cmd.command_type.value)
            state.receive(cmd)
        async def wait(predicate, timeout):
            self.assertTrue(predicate())
        await apply_command({'operation': 'speed', 'speed': 3}, state, send, wait)
        self.assertEqual(sent, [1, 15])
        self.assertEqual(state.values['mode'], 'manual')
        self.assertEqual(state.values['speed'], 3)

    async def test_no_ack_or_wrong_value_is_not_success(self):
        for response in [None, CmdMode(3)]:
            state = BalluState()
            state.values.update(BASE)
            async def send(cmd):
                if response:
                    state.receive(response)
            async def wait(predicate, timeout):
                self.assertFalse(predicate())
                raise TimeoutError()
            with self.assertRaises(CommandError) as caught:
                await apply_command({'operation': 'mode', 'mode': 'turbo'}, state, send, wait)
            self.assertEqual(caught.exception.code, 'not_confirmed')

    async def test_filter_reset_needs_new_ack_even_when_counter_is_zero(self):
        state = BalluState()
        state.values.update({**BASE, 'filterCounter': 0})
        async def send(cmd):
            pass
        async def wait(predicate, timeout):
            self.assertFalse(predicate(), 'Cached zero must not confirm reset')
            raise TimeoutError()
        with self.assertRaises(CommandError):
            await apply_command({'operation': 'resetFilter'}, state, send, wait)

    async def test_idempotent_setting_does_not_send_unnecessary_commands(self):
        state = BalluState()
        state.values.update(BASE)
        async def send(cmd):
            self.fail('Already confirmed value must not be resent')
        async def wait(predicate, timeout):
            self.fail('Nothing to confirm')
        await apply_command({'operation': 'sound', 'sound': 'off'}, state, send, wait)


if __name__ == '__main__':
    unittest.main()
