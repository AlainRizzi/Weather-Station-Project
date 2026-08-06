from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import settings

# Managed Postgres providers (e.g. Railway) hand out plain postgresql:// URLs,
# which SQLAlchemy defaults to the psycopg2 driver; this project installs
# psycopg (v3) instead, so force that driver regardless of the URL we're given.
database_url = settings.database_url
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(database_url, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def set_session_timezone(dbapi_connection, connection_record):
    # Readings are timestamped in the station's own civil time (Asia/Beirut,
    # DST-aware), not UTC -- every date literal, date_trunc() bucket, and
    # ::date cast in application SQL (chatbot-generated or otherwise) must
    # resolve against that same zone, or a bare '2026-07-30' would silently
    # mean UTC midnight instead of Beirut midnight and reintroduce the exact
    # day-boundary mismatch this was fixed for.
    with dbapi_connection.cursor() as cursor:
        cursor.execute("SET TIME ZONE 'Asia/Beirut'")


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
