"""
Runs on the Raspberry Pi. Reads the Linovision IOT-S300WS8 8-in-1 weather
sensor over RS485/Modbus RTU on an interval and POSTs each reading to the
backend ingestion API.
"""

import os
import time
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

# The station's own civil time, DST-aware -- readings are timestamped in
# this zone, not UTC, so "today"/"July 30" means the same calendar day here
# as it does to the person standing at the station. zoneinfo is Python
# stdlib (3.9+), no extra dependency; dayjs's own "timezone" plugin (bundled
# with dayjs, also no new npm package) is the frontend-side equivalent.
STATION_TZ = ZoneInfo("Asia/Beirut")

import requests
from dotenv import load_dotenv
from pymodbus.client import ModbusSerialClient

load_dotenv()

API_URL = os.environ["API_URL"]  # e.g. https://api.yourdomain.com/readings
STATION_NAME = os.environ.get("STATION_NAME", "default-station")
SAMPLE_INTERVAL_SECONDS = float(os.environ.get("SAMPLE_INTERVAL_SECONDS", "1"))

MODBUS_PORT = os.environ.get("MODBUS_PORT", "/dev/ttyUSB0")
MODBUS_BAUDRATE = int(os.environ.get("MODBUS_BAUDRATE", "9600"))
MODBUS_PARITY = os.environ.get("MODBUS_PARITY", "N")
MODBUS_SLAVE_ID = int(os.environ.get("MODBUS_SLAVE_ID", "1"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sensor_client")

modbus_client = ModbusSerialClient(
    port=MODBUS_PORT,
    baudrate=MODBUS_BAUDRATE,
    parity=MODBUS_PARITY,
    stopbits=1,
    bytesize=8,
    timeout=3,
)

# Input register addresses (word offsets) from the IOT-S300WS8 Modbus-RTU
# manual, section 4.1.2 "Register Address Definition". Every field is a
# signed int32 spanning 2 registers (big-endian), true value = raw / 1000.
# Only the fields with a matching column in the backend's `readings` table
# are read here; the sensor exposes more (rainfall, light, tilt, etc.) that
# can be added later alongside a schema change.
LINOVISION_REGISTERS = {
    "temperature_c": 0x0000,
    "humidity_pct": 0x0002,
    "pressure_hpa": 0x0004,  # manual reports Pa; ingestion API expects hPa
    "wind_dir_deg": 0x000C,  # average wind direction
    "wind_speed_ms": 0x0012,  # average wind speed
    "pm2_5_ugm3": 0x0030,
    "pm10_ugm3": 0x0032,
    "noise_db": 0x0048,
}

# The manual (section 4.1.2) requires PM2.5/PM10/noise to be read in separate
# requests from the main block, and the gaps between them (0x0020-0x002F,
# 0x0034-0x0047) are undefined -- a single request spanning 0x0000-0x0049
# risks an illegal-address exception from the sensor. Read each contiguous
# block separately instead, matching the manual's own reference reads
# (p.20-21): the first block reads the whole defined 0x0000-0x001F run
# (temp through dumping-of-state) even though we only use a subset of those
# fields.
REGISTER_BLOCKS = [
    (0x0000, 0x0020),  # temp, humidity, pressure, wind, rain, heating temp, dumping state
    (0x0030, 0x0004),  # pm2_5, pm10
    (0x0048, 0x0002),  # noise
]

_SCALE = 1000.0


def _decode_int32(high: int, low: int) -> int:
    value = (high << 16) | low
    if value >= 0x8000_0000:
        value -= 0x1_0000_0000
    return value


def read_sensors() -> dict:
    """Read all 8 values from the Linovision unit, one request per register block."""
    if not modbus_client.connected and not modbus_client.connect():
        raise ConnectionError(f"Could not open Modbus port {MODBUS_PORT}")

    reading = {}
    for start_address, count in REGISTER_BLOCKS:
        result = modbus_client.read_input_registers(
            address=start_address, count=count, slave=MODBUS_SLAVE_ID
        )
        if result.isError():
            raise IOError(f"Modbus read error: {result}")

        for field, address in LINOVISION_REGISTERS.items():
            if not (start_address <= address < start_address + count):
                continue
            offset = address - start_address
            high, low = result.registers[offset], result.registers[offset + 1]
            reading[field] = _decode_int32(high, low) / _SCALE

    reading["pressure_hpa"] /= 100  # Pa -> hPa
    return reading


def send_reading(reading: dict) -> None:
    payload = {
        "station_name": STATION_NAME,
        "time": datetime.now(STATION_TZ).isoformat(),
        **reading,
    }
    response = requests.post(API_URL, json=payload, timeout=5)
    response.raise_for_status()


def main() -> None:
    log.info("Starting sensor loop for station '%s' (interval=%ss)", STATION_NAME, SAMPLE_INTERVAL_SECONDS)
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
