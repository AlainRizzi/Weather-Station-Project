-- Initial schema for the weather station project.
-- Target: PostgreSQL (with optional TimescaleDB extension for hypertables).
-- Safe to run on plain Postgres too — the CREATE EXTENSION / hypertable
-- calls are the only Timescale-specific parts and are clearly marked.

-- Enable TimescaleDB if available (no-op / comment out on plain Postgres).
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS stations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    location    TEXT,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS readings (
    time            TIMESTAMPTZ NOT NULL,
    station_id      INTEGER NOT NULL REFERENCES stations(id),
    temperature_c   DOUBLE PRECISION,
    humidity_pct    DOUBLE PRECISION,
    pressure_hpa    DOUBLE PRECISION,
    wind_speed_ms   DOUBLE PRECISION,
    wind_dir_deg    DOUBLE PRECISION,
    rain_mm         DOUBLE PRECISION,
    uv_index        DOUBLE PRECISION,
    PRIMARY KEY (station_id, time)
);

-- Turns `readings` into a TimescaleDB hypertable partitioned by time.
-- Skip this call (and the extension above) if you chose plain Postgres.
SELECT create_hypertable('readings', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_readings_station_time
    ON readings (station_id, time DESC);

-- Chatbot conversation log (optional, useful for debugging/auditing
-- generated SQL and answers).
CREATE TABLE IF NOT EXISTS chat_log (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_message    TEXT NOT NULL,
    intent          TEXT,          -- 'sql_query' | 'greeting' | 'station_info'
    generated_sql   TEXT,
    reply           TEXT
);
