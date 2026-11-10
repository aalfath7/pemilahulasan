from typing import Literal

from pydantic import BaseModel, Field, field_validator

Sentiment = Literal["positive", "neutral", "negative"]
Urgency = Literal["low", "medium", "high"]

OTHER_TOPIC = "lainnya"
DEFAULT_TOPICS = [
    "kualitas produk",
    "harga",
    "pengiriman",
    "pelayanan",
    "kemasan",
    "aplikasi/website",
    OTHER_TOPIC,
]

MAX_BATCH = 50


class ReviewIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=10_000)
    rating: float | None = None


class ClassifyRequest(BaseModel):
    reviews: list[ReviewIn] = Field(min_length=1, max_length=MAX_BATCH)
    categories: list[str] | None = Field(default=None, max_length=20)

    @field_validator("reviews")
    @classmethod
    def unique_ids(cls, reviews: list[ReviewIn]) -> list[ReviewIn]:
        if len({r.id for r in reviews}) != len(reviews):
            raise ValueError("id ulasan harus unik")
        return reviews


class ReviewResult(BaseModel):
    """Hasil per ulasan. Model ini juga dipakai sebagai response_schema Gemini."""

    id: str
    sentiment: Sentiment
    confidence: float
    topics: list[str]
    urgency: Urgency
    summary: str
    is_spam: bool


class BatchResult(BaseModel):
    results: list[ReviewResult]


class ClassifyResponse(BaseModel):
    results: list[ReviewResult]
    cached: int
    failed: list[str]


class UploadResponse(BaseModel):
    filename: str
    columns: list[str]
    rows: list[list[str]]
    total_rows: int
    truncated: bool
    suggested_text: int
    suggested_rating: int | None


# ---------- Insight & balasan ----------
class InsightItem(BaseModel):
    sentiment: Sentiment
    topics: list[str] = Field(max_length=5)
    urgency: Urgency
    summary: str = Field(max_length=400)
    is_spam: bool = False


class InsightRequest(BaseModel):
    items: list[InsightItem] = Field(min_length=1, max_length=5000)


class InsightResult(BaseModel):
    overview: str
    liked: list[str]
    complaints: list[str]
    suggestions: list[str]


class ReplyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    sentiment: Sentiment
    topics: list[str] = Field(default_factory=list, max_length=5)
    tone: Literal["ramah", "formal"] = "ramah"
    business_name: str | None = Field(default=None, max_length=80)


class ReplyResult(BaseModel):
    reply: str


# ---------- Akun ----------
class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)


class Me(BaseModel):
    email: str | None
    max_reviews: int


# ---------- Riwayat ----------
class HistoryCounts(BaseModel):
    positive: int = 0
    neutral: int = 0
    negative: int = 0


class HistorySave(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    created_at: str = Field(max_length=40)
    topics: list[str] = Field(max_length=21)
    reviews: list[ReviewIn] = Field(max_length=5000)
    results: list[ReviewResult] = Field(max_length=5000)
    counts: HistoryCounts = HistoryCounts()
    insight: InsightResult | None = None


class HistoryMeta(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    review_count: int
    done_count: int
    counts: HistoryCounts


class ExportRequest(BaseModel):
    columns: list[str] = Field(min_length=1, max_length=30)
    rows: list[list[str | int | float | bool | None]] = Field(max_length=20_000)
