from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select, insert
from sqlalchemy.orm import Session
from fastapi import Depends

from app.db import get_db
from app.models.models import Station, Reading

router = APIRouter(prefix="/readings", tags=["readings"])


class ReadingIn(BaseModel):
    station_name: str
    time: datetime
    temperature_c: float | None = None
    humidity_pct: float | None = None
    pressure_hpa: float | None = None
    wind_speed_ms: float | None = None
    wind_dir_deg: float | None = None
    noise_db: float | None = None
    pm2_5_ugm3: float | None = None
    pm10_ugm3: float | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
def create_reading(payload: ReadingIn, db: Session = Depends(get_db)):
    station = db.scalar(select(Station).where(Station.name == payload.station_name))
    if station is None:
        station = Station(name=payload.station_name)
        db.add(station)
        db.flush()

    db.execute(
        insert(Reading).values(
            time=payload.time,
            station_id=station.id,
            temperature_c=payload.temperature_c,
            humidity_pct=payload.humidity_pct,
            pressure_hpa=payload.pressure_hpa,
            wind_speed_ms=payload.wind_speed_ms,
            wind_dir_deg=payload.wind_dir_deg,
            noise_db=payload.noise_db,
            pm2_5_ugm3=payload.pm2_5_ugm3,
            pm10_ugm3=payload.pm10_ugm3,
        )
    )
    db.commit()
    return {"status": "ok"}
