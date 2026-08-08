"""
Deletes data past its retention window:
  - readings older than READINGS_RETENTION_DAYS
  - chat_log rows older than CHAT_LOG_RETENTION_DAYS

Meant to run on a schedule (e.g. Railway's Cron Job deploy type, once daily)
against the same DATABASE_URL the backend itself uses -- see
db.py (backend/app/db.py) for where that comes from. Not triggered by any
HTTP endpoint, so it's never reachable from outside Railway's own scheduler.

Usage (from backend/, with DATABASE_URL pointing at the target DB):
    python -m scripts.cleanup_old_data
"""

from datetime import datetime, timedelta

from sqlalchemy import delete

from app.db import SessionLocal
from app.models.models import ChatLog, Reading

READINGS_RETENTION_DAYS = 30
CHAT_LOG_RETENTION_DAYS = 7


def main() -> None:
    db = SessionLocal()
    try:
        # datetime.now() here (naive) is fine to compare against TIMESTAMPTZ
        # columns -- the DB session's own timezone (Asia/Beirut, set in
        # db.py) is what psycopg uses to interpret it, matching how every
        # other date literal in this app's SQL is resolved.
        readings_cutoff = datetime.now() - timedelta(days=READINGS_RETENTION_DAYS)
        chat_log_cutoff = datetime.now() - timedelta(days=CHAT_LOG_RETENTION_DAYS)

        readings_result = db.execute(delete(Reading).where(Reading.time < readings_cutoff))
        chat_log_result = db.execute(delete(ChatLog).where(ChatLog.created_at < chat_log_cutoff))
        db.commit()

        print(
            f"Deleted {readings_result.rowcount} reading(s) older than "
            f"{READINGS_RETENTION_DAYS} days (before {readings_cutoff.isoformat()})"
        )
        print(
            f"Deleted {chat_log_result.rowcount} chat_log row(s) older than "
            f"{CHAT_LOG_RETENTION_DAYS} days (before {chat_log_cutoff.isoformat()})"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
