from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Reading

router = APIRouter(prefix="/stats", tags=["stats"])

BUCKET_MAP = {"1m": "minute", "1h": "hour", "1d": "day"}


class BucketedReading(BaseModel):
    time: datetime
    temperature_c: float | None
    humidity_pct: float | None
    pressure_hpa: float | None
    wind_speed_ms: float | None
    wind_dir_deg: float | None
    noise_db: float | None
    pm2_5_ugm3: float | None
    pm10_ugm3: float | None


@router.get("/latest")
def latest_reading(station_id: int = Query(1), db: Session = Depends(get_db)):
    row = db.scalar(
        select(Reading).where(Reading.station_id == station_id).order_by(Reading.time.desc())
    )
    return row


@router.get("/range")
def readings_in_range(
    start: datetime,
    end: datetime,
    station_id: int = Query(1),
    bucket: Literal["1m", "1h", "1d"] | None = Query(None),
    db: Session = Depends(get_db),
):
    if bucket is None:
        rows = db.scalars(
            select(Reading)
            .where(Reading.station_id == station_id, Reading.time.between(start, end))
            .order_by(Reading.time)
        ).all()
        return rows

    bucket_col = func.date_trunc(BUCKET_MAP[bucket], Reading.time).label("time")
    stmt = (
        select(
            bucket_col,
            func.avg(Reading.temperature_c).label("temperature_c"),
            func.avg(Reading.humidity_pct).label("humidity_pct"),
            func.avg(Reading.pressure_hpa).label("pressure_hpa"),
            func.avg(Reading.wind_speed_ms).label("wind_speed_ms"),
            func.avg(Reading.wind_dir_deg).label("wind_dir_deg"),
            func.avg(Reading.noise_db).label("noise_db"),
            func.avg(Reading.pm2_5_ugm3).label("pm2_5_ugm3"),
            func.avg(Reading.pm10_ugm3).label("pm10_ugm3"),
        )
        .where(Reading.station_id == station_id, Reading.time.between(start, end))
        .group_by(bucket_col)
        .order_by(bucket_col)
    )
    rows = db.execute(stmt).all()
    return [BucketedReading(**row._mapping) for row in rows]
