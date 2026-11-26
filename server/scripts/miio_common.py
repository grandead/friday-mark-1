"""Small miIO protocol helpers; no credentials or raw errors leave the worker."""
import time


class MiioCommandError(Exception):
    pass


def read_properties(device, properties):
    result = {}
    names = list(properties)
    for offset in range(0, len(names), 6):
        batch = names[offset:offset + 6]
        request = []
        expected = {}
        for name in batch:
            siid, piid = properties[name]
            request.append({"did": name, "siid": siid, "piid": piid})
            expected[(siid, piid)] = name
        rows = device.send("get_properties", request)
        if not isinstance(rows, list):
            raise MiioCommandError("invalid_device_state")
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                raise MiioCommandError("invalid_device_state")
            key = (row.get("siid"), row.get("piid"))
            if key not in expected or key in seen:
                raise MiioCommandError("invalid_device_state")
            seen.add(key)
            if row.get("code") == 0 and row.get("value") is not None:
                result[expected[key]] = row["value"]
    return result


def write_property(device, properties, name, value):
    siid, piid = properties[name]
    request = [{"did": name, "siid": siid, "piid": piid, "value": value}]
    rows = device.send("set_properties", request)
    if not isinstance(rows, list) or len(rows) != 1:
        raise MiioCommandError("not_confirmed")
    row = rows[0]
    if (not isinstance(row, dict) or row.get("siid") != siid
            or row.get("piid") != piid or row.get("code") not in (0, 1)):
        raise MiioCommandError("not_confirmed")


def confirm_property(device, read_state, field, wanted):
    for _ in range(3):
        time.sleep(0.4)
        state = read_state(device)
        if field in state and state[field] == wanted:
            return state
    raise MiioCommandError("not_confirmed")


def decode_enum(state, field, values):
    if field not in state:
        return
    raw = state[field]
    if not isinstance(raw, (str, int)) or type(raw) is bool or raw not in values:
        raise MiioCommandError("invalid_device_state")
    state[field] = values[raw]
