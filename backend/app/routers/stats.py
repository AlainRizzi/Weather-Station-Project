from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Reading

router = APIRouter(prefix="/stats", tags=["stats"])


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
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Reading)
        .where(Reading.station_id == station_id, Reading.time.between(start, end))
        .order_by(Reading.time)
    ).all()
    return rows
