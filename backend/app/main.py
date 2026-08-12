from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.routers import readings, chat, stats

app = FastAPI(title="Weather Station API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(readings.router)
app.include_router(chat.router)
app.include_router(stats.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# TEMPORARY -- diagnosing why chatbot-generated date queries appear to use
# UTC day boundaries instead of Asia/Beirut despite db.py's connect-event
# SET TIME ZONE. Remove once resolved.
@app.get("/debug/timezone")
def debug_timezone(db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT current_setting('TIMEZONE') AS tz, now() AS db_now")
    ).mappings().first()
    return dict(row)
