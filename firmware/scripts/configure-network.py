#!/usr/bin/env python3
"""Write local build settings without putting the Wi-Fi password in shell history."""
import getpass
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
ssid = input('Wi-Fi 2.4 GHz SSID: ').strip()
password = getpass.getpass('Wi-Fi password (hidden, empty for an open network): ')
try:
    ip = subprocess.check_output(['/usr/sbin/ipconfig', 'getifaddr', 'en0'], text=True).strip()
except (OSError, subprocess.CalledProcessError):
    ip = ''
default = f'ws://{ip}:33000/audio' if ip else ''
uri = input(f'Server WebSocket URL [{default}]: ' if default else 'Server WebSocket URL: ').strip() or default
if len(ssid.encode()) > 32 or not ssid or len(password.encode()) > 63:
    raise SystemExit('Invalid SSID/password length.')
url = urlparse(uri)
if url.scheme != 'ws' or not url.hostname or url.path != '/audio':
    raise SystemExit('Expected ws://MAC_LAN_IP:33000/audio')
folder = root / '.local'
folder.mkdir(mode=0o700, exist_ok=True)
path = folder / 'network_config.h'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('#pragma once\n')
    for name, value in [('FRIDAY_WIFI_SSID', ssid), ('FRIDAY_WIFI_PASSWORD', password), ('FRIDAY_SERVER_URI', uri)]:
        output.write(f'#define {name} {json.dumps(value, ensure_ascii=False)}\n')
print('Saved local settings. Next: ./scripts/idf.sh build (does not flash).')
