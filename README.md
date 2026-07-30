# Weather Station Project

A Raspberry Pi based weather station that streams sensor readings (temperature,
humidity, pressure, wind, noise, PM2.5/PM10 particulate matter, ...) to a cloud database once per second,
with a website to visualize the data and a chatbot that answers questions in
plain English — both technical data questions ("what was last week's highest
temperature?") and small talk / questions about the station itself.

## Architecture

```
Raspberry Pi (sensors)
  -> sensor_client.py reads sensors every 1s
  -> POST /readings  (HTTPS + API key)
       |
       v
FastAPI backend  ---------------------------  React frontend
  - /readings   (ingest, station-key auth)     - Dashboard (latest/historical readings)
  - /stats/*    (dashboard queries)            - Chatbot page
  - /chat       (text-to-SQL chatbot via
                 Ollama Cloud, gpt-oss:20b)
       |
       v
PostgreSQL (Amazon RDS)
  - stations
  - readings
  - chat_log
```

Repo layout:

```
pi/         Raspberry Pi sensor-reading + upload script
backend/    FastAPI app (ingestion API, stats API, chatbot)
frontend/   React (Vite) website
db/         SQL schema / migrations
```

## Deployment target (AWS)

- **Backend** — Docker image (`backend/Dockerfile`) pushed to Amazon ECR, run
  on **ECS Fargate** behind an Application Load Balancer.
- **Frontend** — static Vite build (`npm run build` → `frontend/dist/`)
  uploaded to an **S3** bucket, served through **CloudFront**. No container
  needed for the frontend.
- **Database** — **Amazon RDS for PostgreSQL**, in the same VPC as the ECS
  service so the backend reaches it over a private subnet rather than the
  public internet. RDS doesn't support the TimescaleDB extension, so the
  schema in [db/migrations/001_init.sql](db/migrations/001_init.sql) is
  plain SQL; the Timescale-specific hypertable line is commented out and
  only relevant if this ever moves to Timescale Cloud instead.

`docker-compose.yml` at the repo root is **local development only** (it runs
a throwaway Postgres container) — it is not part of the AWS deployment path.

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
hosting a model on our own AWS compute, at the cost of somewhat weaker SQL
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

For AWS, create an RDS for PostgreSQL instance, then run the schema against
it once it's reachable:

```bash
psql "<your-rds-connection-string>" -f db/migrations/001_init.sql
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

### 3. Raspberry Pi client

Copy `pi/` to the Raspberry Pi, then:

```bash
cd pi
cp .env.example .env   # set API_URL to your deployed backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python sensor_client.py
```

Sensor: **Linovision 8-in-1** weather sensor over RS485/Modbus RTU, via a
USB-to-RS485 adapter on the Pi. `read_sensors()` in
[pi/sensor_client.py](pi/sensor_client.py) polls it with `pymodbus`; the
register addresses/scales in `LINOVISION_REGISTERS` are placeholders and
need to be updated from the sensor's Modbus manual once it's in hand.
Configure the serial connection via `MODBUS_PORT`, `MODBUS_BAUDRATE`,
`MODBUS_PARITY`, `MODBUS_SLAVE_ID` in `pi/.env`.

### 4. Frontend (React)

```bash
cd frontend
cp .env.example .env   # set VITE_API_URL
npm install
npm run dev
```

Open `http://localhost:5173`.

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
script required.

See [backend/scripts/seed_demo_data.py](backend/scripts/seed_demo_data.py).

## Deploying to AWS

### Backend → ECR + ECS Fargate

```bash
cd backend
docker build -t weather-station-backend .
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
docker tag weather-station-backend:latest <account-id>.dkr.ecr.<region>.amazonaws.com/weather-station-backend:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/weather-station-backend:latest
```

Then point an ECS Fargate service/task definition at that image, with
`DATABASE_URL`, `OLLAMA_API_KEY`, and `CORS_ORIGINS`
set as task environment variables (use AWS Secrets Manager or SSM Parameter
Store for the secrets, not plaintext task definitions). Put the service
behind an Application Load Balancer and in the same VPC as the RDS instance.

### Frontend → S3 + CloudFront

```bash
cd frontend
npm run build
aws s3 sync dist/ s3://<your-bucket-name> --delete
```

Point a CloudFront distribution at the bucket (with an origin access
control) and set `VITE_API_URL` at build time to the ALB/CloudFront URL in
front of the backend.

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
