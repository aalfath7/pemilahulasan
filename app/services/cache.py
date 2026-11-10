"""Cache hasil pemilahan berdasarkan hash teks ulasan. Teks asli tidak disimpan."""

import hashlib
import json
import logging
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import CacheEntry

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def normalize(text: str) -> str:
    return " ".join(text.split())


def make_key(text: str, topics: Sequence[str], model: str) -> str:
    topic_key = "|".join(sorted(t.lower() for t in topics))
    raw = f"{model}\n{topic_key}\n{normalize(text).lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def get_many(session: AsyncSession, keys: Iterable[str], ttl_days: int) -> dict[str, dict]:
    keys = list(set(keys))
    if not keys:
        return {}
    cutoff = _now() - timedelta(days=ttl_days)
    try:
        rows = await session.execute(
            select(CacheEntry).where(CacheEntry.key.in_(keys), CacheEntry.created_at >= cutoff)
        )
    except SQLAlchemyError as exc:
        log.warning("Gagal membaca cache: %s", exc)
        return {}
    return {row.key: json.loads(row.result) for row in rows.scalars()}


async def set_many(session: AsyncSession, items: dict[str, dict]) -> None:
    if not items:
        return
    try:
        for key, data in items.items():
            await session.merge(
                CacheEntry(key=key, result=json.dumps(data, ensure_ascii=False), created_at=_now())
            )
        await session.commit()
    except SQLAlchemyError as exc:
        # Cache bersifat best-effort; kegagalan tidak boleh menggagalkan permintaan.
        log.warning("Gagal menyimpan cache: %s", exc)
        await session.rollback()
