# Weather Station Project

A Raspberry Pi based weather station that streams sensor readings (temperature,
humidity, pressure, wind, noise, PM2.5/PM10 particulate matter, ...) to a cloud database once per second,
with a website to visualize the data and a chatbot that answers questions in
plain English — both technical data questions ("what was last week's highest
temperature?") and small talk / questions about the station itself.

## Architecture

```
Raspberry Pi / ESP32 (sensors)
  -> sensor_client.py / sensor_client.ino reads sensors every 30s
  -> POST /readings  (HTTPS)
       |
       v
FastAPI backend  ---------------------------  React frontend
  - /readings   (ingest)                       - Dashboard (latest/historical readings)
  - /stats/*    (dashboard queries)             - Chatbot page
  - /chat       (text-to-SQL chatbot via
                 Ollama Cloud, gpt-oss:20b)
       |
       v
PostgreSQL (Railway)
  - stations
  - readings
  - chat_log
```

Repo layout:

```
pi/         Raspberry Pi (Python) / ESP32 (Arduino) sensor-reading + upload script
backend/    FastAPI app (ingestion API, stats API, chatbot) + db/migrations (SQL schema)
frontend/   React (Vite) website
```

## Deployment target (Railway + Vercel)

- **Backend + Database** — both hosted on **Railway**, in the same project:
  a Postgres service, and the backend service built directly from
  [backend/Dockerfile](backend/Dockerfile) (Railway's "Root Directory" for
  that service is set to `backend`). The backend's `DATABASE_URL` uses
  Railway's private network reference (`${{Postgres.DATABASE_URL}}`)
  rather than the public proxy URL, so traffic stays inside Railway's
  network and avoids egress billing. The schema in
  [backend/db/migrations/001_init.sql](backend/db/migrations/001_init.sql)
  is applied automatically via a Railway **Pre-Deploy Command**:
  `psql "$DATABASE_URL" -f db/migrations/001_init.sql` (path is relative to
  `/app` inside the built image, i.e. `backend/`'s contents).
- **Frontend** — deployed separately on **Vercel** (Root Directory set to
  `frontend`), which auto-detects the Vite build. No container needed.

`docker-compose.yml` at the repo root is **local development only** (it runs
a throwaway Postgres container alongside the backend/frontend) — it is not
part of the Railway/Vercel deployment path.

## The chatbot

Two intents are handled without touching the database:
- **Greetings / small talk** ("hi", "hello") → a canned friendly reply.
- **Station info** ("what are you", "how does this station work") → a
  templated description of the hardware/setup.

Everything else is treated as a **data question** and goes through:
1. The user's message + a description of the `readings`/`stations` schema is
   sent to the LLM with a system prompt instructing it to output *only* a
   read-only `SELECT` statement.
2. The generated SQL is checked (must start with `SELECT`, no
   DDL/DML keywords) before execution.
3. The query runs against Postgres; the result rows are sent back to the LLM
   to be summarized into a short natural-language answer.

The LLM used is **[Ollama Cloud](https://ollama.com/pricing)**'s
`gpt-oss:20b-cloud` model, called through its OpenAI-compatible API — this
keeps the chatbot free (Ollama's Free tier, no credit card) and avoids
hosting a model on our own compute, at the cost of somewhat weaker SQL
generation than a frontier model like Claude/GPT — hence the strict
SELECT-only validation regardless of which LLM generates the query. Get a
free API key at [ollama.com](https://ollama.com) (Cloud → API keys).

See [backend/app/services/chatbot.py](backend/app/services/chatbot.py).

**Security note:** in production, point `DATABASE_URL` at a Postgres role
that only has `SELECT` on `readings`/`stations` (not the ingestion role) so
that even a prompt-injection attempt against the LLM can't mutate data.

## Setup

### 1. Database

For local development, use the included Docker Compose file (spins up
Postgres and runs the migration automatically). It's exposed on host port
**5433** (not the default 5432), to avoid clashing with a native Postgres
install some machines already have listening on 5432:

```bash
docker compose up db
```

Point `DATABASE_URL` in `backend/.env` at `localhost:5433`.

For Railway, add a Postgres service to the project, then either let the
backend service's **Pre-Deploy Command** apply the schema automatically on
every deploy (see "Deployment target" above), or run it manually against
the public proxy connection string (Postgres service → Connect tab):

```bash
psql "<your-railway-postgres-public-url>" -f backend/db/migrations/001_init.sql
```

### 2. Backend (FastAPI)

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, OLLAMA_API_KEY
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs available at `http://localhost:8000/docs`.

### 3. Sensor client (Raspberry Pi or ESP32)

Two equivalent implementations are provided; use whichever matches your
hardware.

**Raspberry Pi** ([pi/sensor_client.py](pi/sensor_client.py)) — copy `pi/`
to the Pi, then:

```bash
cd pi
cp .env.example .env   # set API_URL to your deployed backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python sensor_client.py
```

**ESP32** ([pi/sensor_client.ino](pi/sensor_client.ino)) — open in the
Arduino IDE (install the `ModbusMaster` and `ArduinoJson` libraries, plus
the `esp32` board package), fill in the Wi-Fi/API constants near the top of
the file, and flash it. See the file's header comment for wiring notes
(UART2 pins, optional RS485 driver-enable pin).

Sensor: **Linovision IOT-S300WS8 8-in-1** weather sensor over RS485/Modbus
RTU. Both clients read three separate register blocks per the sensor's
manual (main block, then PM2.5/PM10, then noise, read as separate Modbus
requests — the manual requires this and the gaps between them are
undefined). The default Modbus slave ID is set to `1`, but the manual's
per-model default-address table lists `46` for the 8-in-1 (S800) variant —
confirm the real address on the physical device (USB config tool, or ASCII
command `0XA;MBAD=?`) before relying on the default.

Configure the serial connection via `MODBUS_PORT`, `MODBUS_BAUDRATE`,
`MODBUS_PARITY`, `MODBUS_SLAVE_ID` in `pi/.env` (Python) or the constants
near the top of `sensor_client.ino` (ESP32).

### 4. Frontend (React)

```bash
cd frontend
cp .env.example .env   # set VITE_API_URL
npm install
npm run dev
```

Open `http://localhost:5173`.

`VITE_API_URL` must include the scheme (`https://...`, not just the bare
host) — without it, the browser treats API calls as relative paths against
the frontend's own origin instead of the backend, which fails silently
with a 404 rather than an obvious connection error.

## Demo (no Raspberry Pi needed)

To show the dashboard/chatbot working without real hardware, seed the local
database with 2 weeks of synthetic readings (temperature, humidity,
pressure, wind, noise, PM2.5/PM10) sampled every 10 minutes, with a
realistic daily temperature/humidity cycle instead of flat placeholder
values:

```bash
cd backend
.venv\Scripts\activate       # Windows, after the venv from step 2 above
python -m scripts.seed_demo_data
```

This inserts/replaces readings for a `demo-station` station (2,016 rows —
14 days × 144 readings/day). Re-run it any time to regenerate a fresh 2-week
window ending "now." Then start the backend and frontend as in steps 2 and 4
above — the dashboard and chatbot will show this data immediately, no `pi/`
script required. It only ever touches `demo-station` rows, so it's safe to
delete later without affecting any other station's data:

```sql
DELETE FROM readings WHERE station_id = (SELECT id FROM stations WHERE name = 'demo-station');
DELETE FROM stations WHERE name = 'demo-station';
```

To seed a deployed Railway database instead of the local one, set
`DATABASE_URL` to the Postgres service's public proxy URL (Connect tab —
the private `*.railway.internal` host is only reachable from inside
Railway's network, not from your machine) before running the script:

```bash
set DATABASE_URL=postgresql+psycopg://postgres:<password>@<public-host>:<port>/railway   # Windows cmd
python -m scripts.seed_demo_data
```

See [backend/scripts/seed_demo_data.py](backend/scripts/seed_demo_data.py).

## Deploying to Railway + Vercel

### Database + Backend → Railway

1. Create a Railway project, add a **Postgres** service to it.
2. Add the backend as a second service in the same project, deployed from
   this GitHub repo, with **Root Directory** set to `backend` (Railway
   builds `backend/Dockerfile` directly — no Railpack/buildpack guessing).
3. In the backend service's **Variables** tab, set:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the private-network
     reference — keeps traffic off the public internet and out of egress
     billing; do **not** use `DATABASE_PUBLIC_URL` here).
   - `OLLAMA_API_KEY` = your key from [ollama.com](https://ollama.com)
     (Cloud → API keys).
   - `CORS_ORIGINS` = your Vercel production domain (see below), e.g.
     `https://your-project.vercel.app`.
4. In the backend service's **Settings → Deploy**, generate a public domain
   (target port `8001`, matching the `EXPOSE`/`CMD` port in
   `backend/Dockerfile`), and set a **Pre-Deploy Command** to apply the
   schema on every deploy:
   ```
   psql "$DATABASE_URL" -f db/migrations/001_init.sql
   ```
   (path is relative to `/app` inside the image, i.e. `backend/db/migrations/`
   — the migration uses `CREATE TABLE IF NOT EXISTS`, so it's safe to
   re-run on every deploy.)

### Frontend → Vercel

1. Import this repo as a new Vercel project, with **Root Directory** set to
   `frontend`. Vercel auto-detects the Vite build, no config needed.
2. Set the `VITE_API_URL` environment variable to the backend's Railway
   domain from step 4 above (e.g.
   `https://weather-station-project-production.up.railway.app`), including
   the `https://` scheme.
3. After deploying, note your project's **stable production domain**
   (Project → Settings → Domains — looks like `your-project.vercel.app`,
   with no random suffix). Use that exact URL for `CORS_ORIGINS` on
   Railway, not a preview-deployment URL (Vercel gives every preview build
   its own random subdomain, which won't match a fixed `CORS_ORIGINS`
   value). Test against the production domain, not preview links.

## Environment variables summary

| File | Variable | Purpose |
|---|---|---|
| `pi/.env` | `API_URL`, `STATION_NAME`, `SAMPLE_INTERVAL_SECONDS` | Where/how the Pi sends readings |
| `backend/.env` | `DATABASE_URL`, `OLLAMA_API_KEY`, `CORS_ORIGINS` | DB connection, LLM key, allowed frontend origins |
| `frontend/.env` | `VITE_API_URL` | Backend base URL for the website |

## Next steps

- Add more chart/history views to the dashboard (e.g. using `recharts`,
  already included in `frontend/package.json`).
- Add authentication for the website if it shouldn't be public.
- Add a scheduled downsampling/retention policy once data volume grows.
