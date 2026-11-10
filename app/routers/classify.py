from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.limiter import limiter
from app.schemas import (
    DEFAULT_TOPICS,
    OTHER_TOPIC,
    ClassifyRequest,
    ClassifyResponse,
    ReviewResult,
)
from app.services import cache, gemini

router = APIRouter(prefix="/api", tags=["pemilahan"])


def resolve_topics(categories: list[str] | None) -> list[str]:
    if not categories:
        return DEFAULT_TOPICS
    topics: list[str] = []
    for name in categories:
        name = " ".join(name.split()).lower()[:40]
        if name and name != OTHER_TOPIC and name not in topics:
            topics.append(name)
    return [*topics, OTHER_TOPIC]


@router.post("/classify", response_model=ClassifyResponse)
@limiter.limit(get_settings().rate_limit)
async def classify(
    request: Request,
    body: ClassifyRequest,
    session: AsyncSession = Depends(get_session),
) -> ClassifyResponse:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(
            503,
            "API key Gemini belum diatur. Isi GEMINI_API_KEY di file .env lalu jalankan ulang server.",
        )

    topics = resolve_topics(body.categories)
    reviews = [
        r.model_copy(update={"text": cache.normalize(r.text)[: settings.max_review_chars]})
        for r in body.reviews
    ]
    keys = {r.id: cache.make_key(r.text, topics, settings.gemini_model) for r in reviews}

    cached = await cache.get_many(session, keys.values(), settings.cache_ttl_days)
    results: dict[str, ReviewResult] = {
        r.id: ReviewResult(id=r.id, **cached[keys[r.id]]) for r in reviews if keys[r.id] in cached
    }
    cached_count = len(results)

    pending = [r for r in reviews if r.id not in results]
    failed: list[str] = []
    if pending:
        try:
            fresh, failed = await gemini.classify_reviews(pending, topics)
        except gemini.GeminiFatalError as exc:
            raise HTTPException(
                502,
                "Gemini menolak permintaan. Periksa GEMINI_API_KEY dan GEMINI_MODEL di file .env.",
            ) from exc
        for result in fresh:
            results[result.id] = result
        await cache.set_many(
            session, {keys[res.id]: res.model_dump(exclude={"id"}) for res in fresh}
        )

    return ClassifyResponse(
        results=[results[r.id] for r in reviews if r.id in results],
        cached=cached_count,
        failed=failed,
    )
