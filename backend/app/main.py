from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import readings, chat, stats

app = FastAPI(title="Weather Station API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(readings.router)
app.include_router(chat.router)
app.include_router(stats.router)


@app.get("/health")
def health():
    return {"status": "ok"}
