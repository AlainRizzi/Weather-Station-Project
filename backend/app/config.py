from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    ollama_api_key: str
    cors_origins: str = "http://localhost:5173"
    # Optional regex for origins that vary per-deploy (e.g. Vercel's random
    # per-commit preview URLs), matched via CORSMiddleware's allow_origin_regex.
    # CORS_ORIGINS above still does exact-match for stable domains.
    cors_origin_regex: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
