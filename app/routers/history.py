import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import HistorySession, User, get_session
from app.deps import require_user
from app.limiter import limiter
from app.schemas import HistoryCounts, HistoryMeta, HistorySave

router = APIRouter(prefix="/api/history", tags=["riwayat"])

SessionId = Path(pattern=r"^[0-9a-fA-F-]{36}$")


def _meta(row: HistorySession) -> HistoryMeta:
    return HistoryMeta(
        id=row.id,
        title=row.title,
        created_at=row.created_at,
        updated_at=row.updated_at.isoformat() + "Z",
        review_count=row.review_count,
        done_count=row.done_count,
        counts=HistoryCounts(**json.loads(row.counts)),
    )


async def _get_own(session: AsyncSession, user: User, session_id: str) -> HistorySession:
    row = await session.get(HistorySession, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Sesi tidak ditemukan.")
    return row


@router.get("", response_model=list[HistoryMeta])
async def list_history(
    user: User = Depends(require_user), session: AsyncSession = Depends(get_session)
) -> list[HistoryMeta]:
    rows = await session.execute(
        select(HistorySession)
        .where(HistorySession.user_id == user.id)
        .order_by(HistorySession.updated_at.desc())
    )
    return [_meta(row) for row in rows.scalars()]


@router.get("/{session_id}")
async def get_history(
    session_id: str = SessionId,
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await _get_own(session, user, session_id)
    return {**_meta(row).model_dump(), **json.loads(row.data)}


@router.put("/{session_id}", response_model=HistoryMeta)
@limiter.limit("60/minute")
async def save_history(
    request: Request,
    body: HistorySave,
    session_id: str = SessionId,
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> HistoryMeta:
    row = await session.get(HistorySession, session_id)
    if row is not None and row.user_id != user.id:
        raise HTTPException(404, "Sesi tidak ditemukan.")
    if row is None:
        total = await session.scalar(
            select(func.count())
            .select_from(HistorySession)
            .where(HistorySession.user_id == user.id)
        )
        limit = get_settings().history_max_sessions
        if total >= limit:
            raise HTTPException(
                409,
                f"Riwayat penuh (maks. {limit} sesi). Hapus beberapa sesi lama terlebih dahulu.",
            )
        row = HistorySession(id=session_id, user_id=user.id)
        session.add(row)

    row.title = body.title
    row.created_at = body.created_at
    row.updated_at = datetime.now(UTC).replace(tzinfo=None)
    row.review_count = len(body.reviews)
    row.done_count = len(body.results)
    row.counts = body.counts.model_dump_json()
    row.data = json.dumps(
        {
            "topics": body.topics,
            "reviews": [r.model_dump() for r in body.reviews],
            "results": [r.model_dump() for r in body.results],
            "insight": body.insight.model_dump() if body.insight else None,
        },
        ensure_ascii=False,
    )
    await session.commit()
    return _meta(row)


@router.delete("/{session_id}", status_code=204)
async def delete_history(
    session_id: str = SessionId,
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    row = await _get_own(session, user, session_id)
    await session.delete(row)
    await session.commit()
