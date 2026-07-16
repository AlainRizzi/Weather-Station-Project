from datetime import datetime

from sqlalchemy import ForeignKey, String, Float, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)


class Reading(Base):
    __tablename__ = "readings"

    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), primary_key=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_dir_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    noise_db: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm2_5_ugm3: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm10_ugm3: Mapped[float | None] = mapped_column(Float, nullable=True)


class ChatLog(Base):
    __tablename__ = "chat_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_message: Mapped[str] = mapped_column(Text)
    intent: Mapped[str | None] = mapped_column(String, nullable=True)
    generated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply: Mapped[str | None] = mapped_column(Text, nullable=True)
