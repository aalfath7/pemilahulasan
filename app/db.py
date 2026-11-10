from collections.abc import AsyncIterator
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings


def normalize_db_url(url: str) -> str:
    """Ubah connection string Postgres biasa (mis. dari Neon) ke format asyncpg."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+asyncpg://" + url[len(prefix) :]
    if url.startswith("postgresql+asyncpg://"):
        parts = urlsplit(url)
        query = []
        for key, value in parse_qsl(parts.query):
            if key == "sslmode":
                query.append(("ssl", value))
            elif key != "channel_binding":  # tidak didukung asyncpg
                query.append((key, value))
        url = urlunsplit(parts._replace(query=urlencode(query)))
    return url


class Base(DeclarativeBase):
    pass


class CacheEntry(Base):
    __tablename__ = "classify_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    result: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class HistorySession(Base):
    """Satu sesi pemilahan milik user. `data` berisi JSON ulasan + hasil."""

    __tablename__ = "history_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    review_count: Mapped[int] = mapped_column(Integer)
    done_count: Mapped[int] = mapped_column(Integer)
    counts: Mapped[str] = mapped_column(Text)
    data: Mapped[str] = mapped_column(Text)


engine = create_async_engine(normalize_db_url(get_settings().database_url), pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
