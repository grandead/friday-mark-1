# /// script
# requires-python = ">=3.14.2,<3.15"
# dependencies = ["pysyncleo==0.4.1", "zeroconf==0.154.0"]
# ///
"""Local HOMMYN ASP-100: discover the registered appliance, authenticate, read/verify settings."""
import asyncio
import json
import logging
import sys
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf, IPVersion
from ballu_protocol import BalluState, CommandError, apply_command
from pysyncleo.models import SyncleoUdpDevice
from pysyncleo.transport import TransportManager


async def discover(*, ip):
    loop = asyncio.get_running_loop()
    found = loop.create_future()

    def deliver(device):
        if not found.done():
            found.set_result(device)

    class Listener(ServiceListener):
        def add_service(self, zc, service_type, name):
            info = zc.get_service_info(service_type, name, timeout=1500)
            if not info:
                return
            props = {k.decode(): v.decode() for k, v in info.properties.items() if v is not None}
            actual_mac = props.get("macaddr", props.get("mac", ""))
            if not actual_mac:
                return
            addresses = info.parsed_addresses(IPVersion.V4Only)
            if ip not in addresses or props.get("vendor", "").lower() != "rusclimate" or props.get("devtype") != "69":
                return
            props["mac"] = actual_mac
            loop.call_soon_threadsafe(deliver, SyncleoUdpDevice.from_zeroconf(ip, info.port, props))

        update_service = add_service

        def remove_service(self, *args):
            pass

    zc = Zeroconf(ip_version=IPVersion.V4Only)
    browser = ServiceBrowser(zc, "_syncleo._udp.local.", Listener())
    try:
        return await asyncio.wait_for(found, 7)
    finally:
        await asyncio.to_thread(browser.cancel)
        await asyncio.to_thread(zc.close)


async def execute(command):
    credentials = command["credentials"]
    device = await discover(ip=credentials["ip"])
    operation = {**command["args"], "operation": command["operation"]}
    return await run_device(device, credentials["token"], operation)


async def run_device(device, token, command):
    device.device_token = bytes.fromhex(token)
    manager = TransportManager()
    transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(lambda: manager, local_addr=("0.0.0.0", 0))
    connection = manager.register_device(device)
    state = BalluState()
    changed = asyncio.Event()

    def received(cmd):
        state.receive(cmd)
        changed.set()

    async def wait_for(predicate, timeout):
        async with asyncio.timeout(timeout):
            while not predicate():
                changed.clear()
                # No await between inspecting state and clearing the event.
                await changed.wait()

    connection.register_callback(received)
    try:
        await connection.connect()
        await wait_for(lambda: "power" in state.values, 10)
        # Initial snapshot contains capabilities as well as the current values.
        await asyncio.sleep(1.0)
        await apply_command(command, state, connection.send_command, wait_for)
        return state.values
    finally:
        manager.unregister_device(device)
        transport.close()


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    if "--check" in sys.argv:
        print("Syncleo ready")
        sys.exit(0)
    try:
        print(json.dumps(asyncio.run(execute(json.load(sys.stdin)))))
    except CommandError as error:
        print(json.dumps({"error": error.code}))
        sys.exit(1)
    except (TimeoutError, OSError):
        print('{"error":"device_unreachable"}')
        sys.exit(1)
    except Exception:
        sys.exit("Device command failed")
