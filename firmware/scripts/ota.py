#!/usr/bin/env python3
"""Provision local OTA credentials or serve one ESP-IDF build over HTTPS."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
KEYS = LOCAL / 'ota'
PORT = 8443
CERT_NAME = 'friday-ota.local'


def prepare():
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    if not KEYS.exists():
        with tempfile.TemporaryDirectory(dir=LOCAL) as temporary:
            new = Path(temporary) / 'ota'
            new.mkdir(mode=0o700)
            subprocess.run([
                'openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt',
                'ec_paramgen_curve:P-256', '-nodes', '-sha256', '-days', '3650',
                '-subj', f'/CN={CERT_NAME}', '-addext', f'subjectAltName=DNS:{CERT_NAME}',
                '-keyout', str(new / 'key.pem'), '-out', str(new / 'cert.pem'),
            ], check=True)
            (new / 'token').write_text(secrets.token_hex(32))
            try:
                new.rename(KEYS)
            except OSError:
                if not KEYS.is_dir():
                    raise
    cfg = LOCAL / 'network_config.h'
    host = None
    if cfg.exists():
        match = re.search(r'^#define FRIDAY_SERVER_URI (".*")$', cfg.read_text(), re.M)
        if not match:
            raise SystemExit('Missing server URI in network_config.h')
        host = urlsplit(json.loads(match[1])).hostname
    header = LOCAL / 'ota_config.h'
    body = ''.join(f'#define {key} {json.dumps(val)}\n' for key, val in {
        'FRIDAY_OTA_HOST': host or '',
        'FRIDAY_OTA_CERT_NAME': CERT_NAME,
        'FRIDAY_OTA_PORT': str(PORT),
        'FRIDAY_OTA_CERT': (KEYS / 'cert.pem').read_text(),
        'FRIDAY_OTA_AUTH': 'Bearer ' + (KEYS / 'token').read_text().strip(),
    }.items())
    if not header.exists() or header.read_text() != body:
        header.write_text(body)


def serve(bind):
    if not (KEYS / 'key.pem').exists():
        raise SystemExit('Build and flash OTA-enabled firmware over USB first.')
    image = (ROOT / 'build/friday_firmware.bin').read_bytes()
    digest = hashlib.sha256(image[:-32]).digest()
    if image[:1] != b'\xe9' or image[-32:] != digest:
        raise SystemExit('Invalid ESP-IDF image. Rebuild the firmware.')
    expected = digest.hex()
    token = 'Bearer ' + (KEYS / 'token').read_text().strip()
    confirmed = False
    sent = False
    previous_boot = False

    class Update(BaseHTTPRequestHandler):
        def do_GET(self):
            nonlocal confirmed, sent, previous_boot
            if self.path != '/firmware.bin':
                self.send_error(404)
                return
            if not hmac.compare_digest(self.headers.get('Authorization', ''), token):
                self.send_error(403)
                return
            running = self.headers.get('X-Friday-Image', '')
            if not re.fullmatch('[a-f0-9]{64}', running):
                self.send_error(400)
                return
            if running == expected:
                self.send_response(304)
                self.end_headers()
                confirmed = True
                print(f'ESP32 {self.client_address[0]} confirmed image {expected[:12]}.', flush=True)
                return
            if sent:
                previous_boot = True
                self.send_error(409, 'Device still running previous firmware')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(image)))
            self.end_headers()
            # sendall's timeout covers the entire call. Give the ESP32 time to
            # erase and program flash while still bounding a stalled write.
            self.connection.settimeout(20)
            for offset in range(0, len(image), 16 * 1024):
                self.wfile.write(image[offset:offset + 16 * 1024])
            sent = True
            print('Image transferred. Waiting for confirmation after reboot.', flush=True)

        def log_message(self, fmt, *args):
            pass

    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(KEYS / 'cert.pem', KEYS / 'key.pem')

    class Server(HTTPServer):
        def get_request(self):
            sock, addr = super().get_request()
            sock.settimeout(8)
            try:
                return tls.wrap_socket(sock, server_side=True), addr
            except OSError:
                sock.close()
                raise

    with Server((bind, PORT), Update) as server:
        server.timeout = 1
        print(f'OTA ready on port {PORT}. Press EN on the ESP32. Image {expected[:12]}.', flush=True)
        deadline = time.monotonic() + 180
        while not (confirmed or previous_boot) and time.monotonic() < deadline:
            server.handle_request()
    if previous_boot:
        raise SystemExit('The board booted the previous image. Run the command again to retry.')
    if not confirmed:
        raise SystemExit('ESP32 did not confirm the running image within 3 minutes.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'serve'])
    parser.add_argument('--bind', default='', help='Listen on a particular Mac interface')
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'prepare':
        prepare()
    else:
        serve(args.bind)
