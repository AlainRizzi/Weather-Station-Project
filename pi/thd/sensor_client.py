"""
Runs on the Raspberry Pi. Reads the Autonics THD-WD1-T temperature/humidity
sensor over RS485/Modbus RTU on an interval and POSTs each reading to the
backend ingestion API.
"""

import os
import time
import logging
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from pymodbus.client import ModbusSerialClient

load_dotenv()

API_URL = os.environ["API_URL"]  # e.g. https://api.yourdomain.com/readings
STATION_NAME = os.environ.get("STATION_NAME", "default-station")
SAMPLE_INTERVAL_SECONDS = float(os.environ.get("SAMPLE_INTERVAL_SECONDS", "1"))

MODBUS_PORT = os.environ.get("MODBUS_PORT", "/dev/ttyUSB1")
MODBUS_BAUDRATE = int(os.environ.get("MODBUS_BAUDRATE", "9600"))
MODBUS_PARITY = os.environ.get("MODBUS_PARITY", "N")
# Factory default is 1 (upper address terminal OPEN, SW1=1) -- see the
# manual's communication address setting table if this unit's rotary
# switch/terminal has been set differently.
MODBUS_SLAVE_ID = int(os.environ.get("MODBUS_SLAVE_ID", "1"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("thd_sensor_client")

modbus_client = ModbusSerialClient(
    port=MODBUS_PORT,
    baudrate=MODBUS_BAUDRATE,
    parity=MODBUS_PARITY,
    stopbits=1,
    bytesize=8,
    timeout=3,
)

# Input register addresses from the THD manual's "Modbus mapping table"
# (300001/300002 in Modicon 3xxxx convention, i.e. 0-indexed input
# registers). Each value is a single 16-bit register, signed, true value =
# raw * 0.01 -- unlike the Linovision sensor, these are NOT 32-bit pairs.
THD_REGISTERS = {
    "temperature_c": 0x0000,
    "humidity_pct": 0x0001,
}

_SCALE = 0.01


def _decode_int16(raw: int) -> int:
    if raw >= 0x8000:
        raw -= 0x1_0000
    return raw


def read_sensors() -> dict:
    """Read temperature and humidity from the THD-WD1-T in one request."""
    if not modbus_client.connected and not modbus_client.connect():
        raise ConnectionError(f"Could not open Modbus port {MODBUS_PORT}")

    result = modbus_client.read_input_registers(
        address=0x0000, count=2, slave=MODBUS_SLAVE_ID
    )
    if result.isError():
        raise IOError(f"Modbus read error: {result}")

    reading = {}
    for field, address in THD_REGISTERS.items():
        reading[field] = _decode_int16(result.registers[address]) * _SCALE
    return reading


def send_reading(reading: dict) -> None:
    payload = {
        "station_name": STATION_NAME,
        "time": datetime.now(timezone.utc).isoformat(),
        **reading,
    }
    response = requests.post(API_URL, json=payload, timeout=5)
    response.raise_for_status()


def main() -> None:
    log.info("Starting THD sensor loop for station '%s' (interval=%ss)", STATION_NAME, SAMPLE_INTERVAL_SECONDS)
    while True:
        start = time.monotonic()
        try:
            reading = read_sensors()
            send_reading(reading)
        except requests.RequestException:
            log.exception("Failed to send reading, will retry next cycle")
        except Exception:
            log.exception("Unexpected error reading sensors")

        elapsed = time.monotonic() - start
        time.sleep(max(0.0, SAMPLE_INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
