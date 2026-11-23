# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["python-miio==0.5.12"]
# ///
import argparse
import getpass
import ipaddress
import logging
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from time import sleep
import warnings

from miio import Device, DeviceException


TOKEN_PATH = Path(__file__).resolve().parents[1] / ".tools" / "humidifier.token"
IP_PATH = TOKEN_PATH.with_suffix(".ip")
POWER = {"did": "power", "siid": 2, "piid": 1}


def read_status(device):
    # MIoT spec deerma-jsq2g:2 — humidifier.on and environment.relative-humidity.
    fields = [
        POWER,
        {"did": "humidity", "siid": 3, "piid": 1},
    ]
    rows = device.send("get_properties", fields)
    values = {(row["siid"], row["piid"]): row.get("value")
              for row in rows if row.get("code") == 0}
    power = values.get((2, 1))
    humidity = values.get((3, 1))
    print("Питание:", {True: "включён", False: "выключен"}.get(power, "нет данных"))
    print("Влажность:", f"{humidity} %" if humidity is not None else "нет данных")
    return int(power is None or humidity is None)


def set_power(device, wanted):
    result = device.send("set_properties", [{**POWER, "value": wanted}])
    if not result or result[0].get("code") not in (0, 1):
        sys.exit("Устройство отклонило команду питания.")
    for attempt in range(3):
        if attempt:
            sleep(0.4)
        rows = device.send("get_properties", [POWER])
        if rows and rows[0].get("code") == 0 and rows[0].get("value") == wanted:
            print("Увлажнитель включён." if wanted else "Увлажнитель выключен.")
            return 0
    sys.exit("Устройство приняло команду, но запрошенное состояние не подтвердилось.")


def save_token(token):
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=TOKEN_PATH.parent, mode="w", delete=False) as temp:
        temp.write(token)
    Path(temp.name).replace(TOKEN_PATH)


def main():
    parser = argparse.ArgumentParser(description="Управление Xiaomi Smart Humidifier 2 по miIO")
    parser.add_argument("ip", nargs="?", type=ipaddress.IPv4Address,
                        default=os.getenv("HUMIDIFIER_IP"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--save-token", action="store_true", help="сохранить проверенный токен для сервера")
    mode.add_argument("--power", choices=["on", "off"], help="использовать сохранённый токен")
    args = parser.parse_args()
    if args.ip is None:
        if not IP_PATH.exists():
            parser.error("Укажи IP увлажнителя или задай HUMIDIFIER_IP")
        args.ip = ipaddress.IPv4Address(IP_PATH.read_text().strip())
    warnings.simplefilter("error", getpass.GetPassWarning)
    try:
        if args.power:
            token = TOKEN_PATH.read_text().strip()
        else:
            token = getpass.getpass("Локальный miIO-токен: ").strip()
    except FileNotFoundError:
        sys.exit("Сначала выполни npm run setup:humidifier в папке server.")
    except (getpass.GetPassWarning, EOFError):
        sys.exit("Запусти команду в интерактивном терминале.")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", token):
        sys.exit("Ожидаются 32 шестнадцатеричных символа.")
    logging.getLogger("miio").setLevel(logging.CRITICAL)
    try:
        device = Device(str(args.ip), token)
        model = device.info().model
        if model != "deerma.humidifier.jsq2g":
            sys.exit(f"По этому адресу другая модель: {model}")
        if args.power:
            return set_power(device, args.power == "on")
        print(f"Модель: {model}")
        status = read_status(device)
        if args.save_token and status == 0:
            save_token(token)
            IP_PATH.write_text(str(args.ip) + "\n")
            print("Токен сохранён для голосовых команд.")
        return status
    except (DeviceException, OSError):
        sys.exit("Запрос к устройству не удался. Проверь IP, токен и подключение к домашней сети.")


if __name__ == "__main__":
    sys.exit(main())
