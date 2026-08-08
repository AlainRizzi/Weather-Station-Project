"""
Deletes data past its retention window:
  - readings older than READINGS_RETENTION_DAYS
  - chat_log rows older than CHAT_LOG_RETENTION_DAYS

Meant to run on a schedule (e.g. Railway's Cron Job deploy type, once daily).
Deliberately standalone -- connects directly via SQLAlchemy core using only
DATABASE_URL from the environment, with no import from app.* (app.config
requires OLLAMA_API_KEY, which this script has no use for; importing it
would force the cron service to carry a credential it never touches). Not
triggered by any HTTP endpoint, so it's never reachable from outside
Railway's own scheduler.

Usage (with DATABASE_URL pointing at the target DB):
    python -m scripts.cleanup_old_data
"""

import os
from datetime import datetime, timedelta

from sqlalchemy import create_engine, text

READINGS_RETENTION_DAYS = 30
CHAT_LOG_RETENTION_DAYS = 7


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    # Same driver override as app/db.py: managed providers (e.g. Railway)
    # hand out plain postgresql:// URLs, which SQLAlchemy defaults to
    # psycopg2 for; this project installs psycopg (v3) instead.
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

    engine = create_engine(database_url)
    with engine.connect() as conn:
        # Readings/chat_log are timestamped in the station's own civil time
        # (Asia/Beirut, see app/db.py) -- set the same session timezone here
        # so the naive cutoffs below are interpreted consistently, not
        # against whatever this connection's default timezone happens to be.
        conn.execute(text("SET TIME ZONE 'Asia/Beirut'"))

        readings_cutoff = datetime.now() - timedelta(days=READINGS_RETENTION_DAYS)
        chat_log_cutoff = datetime.now() - timedelta(days=CHAT_LOG_RETENTION_DAYS)

        readings_result = conn.execute(
            text("DELETE FROM readings WHERE time < :cutoff"), {"cutoff": readings_cutoff}
        )
        chat_log_result = conn.execute(
            text("DELETE FROM chat_log WHERE created_at < :cutoff"), {"cutoff": chat_log_cutoff}
        )
        conn.commit()

        print(
            f"Deleted {readings_result.rowcount} reading(s) older than "
            f"{READINGS_RETENTION_DAYS} days (before {readings_cutoff.isoformat()})"
        )
        print(
            f"Deleted {chat_log_result.rowcount} chat_log row(s) older than "
            f"{CHAT_LOG_RETENTION_DAYS} days (before {chat_log_cutoff.isoformat()})"
        )


if __name__ == "__main__":
    main()
