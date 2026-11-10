"""Panggilan ke Gemini: batching, retry dengan backoff, dan pemecahan batch yang gagal."""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence

from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from app.config import get_settings
from app.schemas import OTHER_TOPIC, BatchResult, ReviewIn, ReviewResult
from app.services.prompts import SYSTEM_PROMPT, build_prompt

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 1.0

CallFn = Callable[[Sequence[ReviewIn], Sequence[str]], Awaitable[list[ReviewResult]]]


class GeminiFatalError(RuntimeError):
    """Kesalahan yang tidak akan hilang dengan mencoba ulang (API key salah, model tidak ada)."""


_client: genai.Client | None = None
_semaphore: asyncio.Semaphore | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=get_settings().gemini_api_key)
    return _client


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().gemini_concurrency)
    return _semaphore


def _is_fatal(exc: errors.ClientError) -> bool:
    if exc.code in (401, 403, 404):
        return True
    return exc.code == 400 and "api key" in str(exc).lower()


async def generate[T: BaseModel](
    schema: type[T], system: str, prompt: str, temperature: float = 0.1
) -> T:
    """Satu panggilan Gemini dengan output JSON sesuai `schema`."""
    async with _get_semaphore():
        try:
            response = await _get_client().aio.models.generate_content(
                model=get_settings().gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=temperature,
                ),
            )
        except errors.ClientError as exc:
            if _is_fatal(exc):
                raise GeminiFatalError(str(exc)) from exc
            raise
    if isinstance(response.parsed, schema):
        return response.parsed
    return schema.model_validate_json(response.text or "")


async def generate_with_retry[T: BaseModel](
    schema: type[T], system: str, prompt: str, temperature: float = 0.1
) -> T:
    for attempt in range(MAX_ATTEMPTS):
        try:
            return await generate(schema, system, prompt, temperature)
        except GeminiFatalError:
            raise
        except Exception as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            log.warning("Panggilan Gemini gagal (percobaan %d): %s", attempt + 1, exc)
            await asyncio.sleep(BACKOFF_SECONDS * 2**attempt)
    raise AssertionError("tidak tercapai")


async def call_gemini(reviews: Sequence[ReviewIn], topics: Sequence[str]) -> list[ReviewResult]:
    batch = await generate(BatchResult, SYSTEM_PROMPT, build_prompt(reviews, topics))
    return batch.results


def _sanitize(result: ReviewResult, topics: Sequence[str]) -> ReviewResult:
    allowed = {t.lower(): t for t in topics}
    fallback = allowed.get(OTHER_TOPIC, topics[-1])
    cleaned: list[str] = []
    for topic in result.topics:
        name = allowed.get(topic.strip().lower(), fallback)
        if name not in cleaned:
            cleaned.append(name)
    return result.model_copy(
        update={
            "topics": cleaned[:3] or [fallback],
            "confidence": min(max(result.confidence, 0.0), 1.0),
            "summary": result.summary.strip()[:300],
        }
    )


async def classify_reviews(
    reviews: Sequence[ReviewIn], topics: Sequence[str], call: CallFn | None = None
) -> tuple[list[ReviewResult], list[str]]:
    """Kembalikan (hasil berurutan sesuai input, daftar id yang gagal)."""
    done: dict[str, ReviewResult] = {}
    failed: list[str] = []
    await _classify_group(list(reviews), topics, call or call_gemini, done, failed)
    return [done[r.id] for r in reviews if r.id in done], failed


async def _classify_group(
    group: list[ReviewIn],
    topics: Sequence[str],
    call: CallFn,
    done: dict[str, ReviewResult],
    failed: list[str],
) -> None:
    results: list[ReviewResult] | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            results = await call(group, topics)
            break
        except GeminiFatalError:
            raise
        except Exception as exc:  # jaringan, 429, 5xx, JSON tidak valid
            log.warning("Batch %d ulasan gagal (percobaan %d): %s", len(group), attempt + 1, exc)
            if attempt < MAX_ATTEMPTS - 1:
                await asyncio.sleep(BACKOFF_SECONDS * 2**attempt)

    ids = {r.id for r in group}
    for result in results or []:
        if result.id in ids and result.id not in done:
            done[result.id] = _sanitize(result, topics)

    missing = [r for r in group if r.id not in done]
    if not missing:
        return
    if len(group) == 1:
        failed.append(group[0].id)
    elif len(missing) < len(group):
        # Sebagian berhasil: ulangi hanya yang belum ada hasilnya.
        await _classify_group(missing, topics, call, done, failed)
    else:
        # Seluruh batch gagal: pecah dua agar ulasan bermasalah terisolasi.
        mid = len(group) // 2
        await _classify_group(group[:mid], topics, call, done, failed)
        await _classify_group(group[mid:], topics, call, done, failed)
