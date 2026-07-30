"""
Seeds the database with 2 weeks of synthetic weather readings, sampled every
10 minutes, for demoing the dashboard/chatbot without a Raspberry Pi.

Not a substitute for db/migrations/001_init.sql (backend/db/migrations/001_init.sql) —
run the migration (or `docker compose up db`, which runs it automatically) first.

Usage (from backend/, with DATABASE_URL pointing at the target DB):
    python -m scripts.seed_demo_data
"""

import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.models import Reading, Station

STATION_NAME = "demo-station"
DAYS = 14
INTERVAL_MINUTES = 10
READINGS_PER_DAY = 24 * 60 // INTERVAL_MINUTES

random.seed(42)


def generate_readings(start: datetime, station_id: int) -> list[dict]:
    readings = []
    total_points = DAYS * READINGS_PER_DAY

    for i in range(total_points):
        t = start + timedelta(minutes=i * INTERVAL_MINUTES)
        hour_frac = t.hour + t.minute / 60

        # Daily cycle: coolest ~5am, warmest ~3pm, plus slow day-to-day drift
        # and small random noise.
        day_drift = 3 * math.sin(2 * math.pi * (i / total_points) * 3)
        diurnal = -math.cos(2 * math.pi * (hour_frac - 5) / 24)
        temperature_c = 18 + day_drift + 8 * diurnal + random.gauss(0, 0.4)

        # Humidity anti-correlates with temperature.
        humidity_pct = min(100, max(20, 65 - 3 * diurnal * 2 + random.gauss(0, 3)))

        # Pressure: slow multi-day weather-system drift.
        pressure_hpa = 1013 + 6 * math.sin(2 * math.pi * (i / total_points) * 2.5) + random.gauss(0, 0.8)

        # Wind: gustier in the afternoon, calmer at night.
        wind_base = 1.5 + 2.5 * max(0, diurnal)
        wind_speed_ms = max(0, wind_base + random.gauss(0, 1.0))
        wind_dir_deg = (200 + 40 * math.sin(2 * math.pi * (i / total_points) * 5) + random.gauss(0, 15)) % 360

        # Noise: quieter at night (~22:00-06:00), busier during the day.
        is_night = t.hour >= 22 or t.hour < 6
        noise_db = (32 if is_night else 45) + random.gauss(0, 3)
        noise_db = max(25, noise_db)

        # Particulates: baseline with occasional short pollution spikes.
        spike = 15 if random.random() < 0.03 else 0
        pm2_5_ugm3 = max(0, 8 + spike + random.gauss(0, 2))
        pm10_ugm3 = max(0, pm2_5_ugm3 * 1.6 + random.gauss(0, 2))

        readings.append(
            {
                "time": t,
                "station_id": station_id,
                "temperature_c": round(temperature_c, 2),
                "humidity_pct": round(humidity_pct, 2),
                "pressure_hpa": round(pressure_hpa, 2),
                "wind_speed_ms": round(wind_speed_ms, 2),
                "wind_dir_deg": round(wind_dir_deg, 1),
                "noise_db": round(noise_db, 1),
                "pm2_5_ugm3": round(pm2_5_ugm3, 1),
                "pm10_ugm3": round(pm10_ugm3, 1),
            }
        )

    return readings


def main() -> None:
    db = SessionLocal()
    try:
        station = db.scalar(select(Station).where(Station.name == STATION_NAME))
        if station is None:
            station = Station(
                name=STATION_NAME,
                location="Turin, Italy (demo)",
                latitude=45.0703,
                longitude=7.6869,
            )
            db.add(station)
            db.flush()

        db.execute(delete(Reading).where(Reading.station_id == station.id))

        end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(days=DAYS)

        readings = generate_readings(start, station.id)
        db.bulk_insert_mappings(Reading, readings)
        db.commit()

        print(f"Seeded {len(readings)} readings for station '{STATION_NAME}' "
              f"({start.isoformat()} -> {end.isoformat()})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
