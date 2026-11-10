from collections import Counter

from fastapi import APIRouter, HTTPException, Request

from app.config import get_settings
from app.limiter import limiter
from app.schemas import InsightRequest, InsightResult, ReplyRequest, ReplyResult
from app.services import gemini
from app.services.prompts import (
    INSIGHT_PROMPT,
    REPLY_PROMPT,
    build_insight_prompt,
    build_reply_prompt,
)

router = APIRouter(prefix="/api", tags=["insight"])

MAX_SUMMARIES = 800


def ensure_ready() -> None:
    if not get_settings().gemini_api_key:
        raise HTTPException(
            503,
            "API key Gemini belum diatur. Isi GEMINI_API_KEY di file .env lalu jalankan ulang server.",
        )


async def run_gemini(coro):
    try:
        return await coro
    except gemini.GeminiFatalError as exc:
        raise HTTPException(
            502, "Gemini menolak permintaan. Periksa GEMINI_API_KEY dan GEMINI_MODEL di file .env."
        ) from exc
    except Exception as exc:
        raise HTTPException(503, "Gemini sedang sibuk. Coba lagi beberapa saat lagi.") from exc


def build_stats(body: InsightRequest) -> tuple[dict, list[str]]:
    items = [it for it in body.items if not it.is_spam]
    sentiments = Counter(it.sentiment for it in items)
    topics = Counter(t for it in items for t in it.topics)
    negative_topics = Counter(t for it in items if it.sentiment == "negative" for t in it.topics)
    stats = {
        "total_ulasan": len(body.items),
        "spam": len(body.items) - len(items),
        "positif": sentiments["positive"],
        "netral": sentiments["neutral"],
        "negatif": sentiments["negative"],
        "urgensi_tinggi": sum(it.urgency == "high" for it in items),
        "topik_terbanyak": dict(topics.most_common(8)),
        "topik_negatif_terbanyak": dict(negative_topics.most_common(8)),
    }
    # Utamakan ulasan negatif & mendesak agar keluhan penting pasti terbaca.
    rank = {"high": 0, "medium": 1, "low": 2}
    ordered = sorted(items, key=lambda it: (rank[it.urgency], it.sentiment != "negative"))
    summaries = [
        f"[{it.sentiment}; {', '.join(it.topics)}] {it.summary}" for it in ordered[:MAX_SUMMARIES]
    ]
    return stats, summaries


@router.post("/insight", response_model=InsightResult)
@limiter.limit("10/minute")
async def insight(request: Request, body: InsightRequest) -> InsightResult:
    ensure_ready()
    stats, summaries = build_stats(body)
    if not summaries:
        raise HTTPException(400, "Semua ulasan terdeteksi spam, belum ada yang bisa dianalisis.")
    result = await run_gemini(
        gemini.generate_with_retry(
            InsightResult, INSIGHT_PROMPT, build_insight_prompt(stats, summaries), 0.3
        )
    )
    return InsightResult(
        overview=result.overview.strip(),
        liked=result.liked[:3],
        complaints=result.complaints[:3],
        suggestions=result.suggestions[:3],
    )


@router.post("/reply", response_model=ReplyResult)
@limiter.limit("20/minute")
async def reply(request: Request, body: ReplyRequest) -> ReplyResult:
    ensure_ready()
    prompt = build_reply_prompt(
        body.text[: get_settings().max_review_chars],
        body.sentiment,
        body.topics,
        body.tone,
        body.business_name,
    )
    result = await run_gemini(gemini.generate_with_retry(ReplyResult, REPLY_PROMPT, prompt, 0.7))
    return ReplyResult(reply=result.reply.strip())
