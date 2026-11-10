from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Semua konfigurasi dibaca dari environment / file .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_concurrency: int = 3

    database_url: str = "sqlite+aiosqlite:///./data.db"
    cache_ttl_days: int = 30

    demo_max_reviews: int = 200
    member_max_reviews: int = 2000
    max_review_chars: int = 1000
    max_upload_mb: int = 10
    rate_limit: str = "30/minute"

    # Wajib diisi di produksi; jika kosong, dibuat acak saat server start (semua user ter-logout saat restart).
    secret_key: str = ""
    history_max_sessions: int = 50


@lru_cache
def get_settings() -> Settings:
    return Settings()
