from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    station_api_keys: str  # comma-separated list of valid Pi API keys
    ollama_api_key: str
    cors_origins: str = "http://localhost:5173"

    @property
    def station_api_key_set(self) -> set[str]:
        return {k.strip() for k in self.station_api_keys.split(",") if k.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
