import asyncio
import uuid

from app.schemas import ReviewIn, ReviewResult
from app.services import gemini


def fake_result(review: ReviewIn, **overrides) -> ReviewResult:
    data = {
        "id": review.id,
        "sentiment": "negative" if "rusak" in review.text else "positive",
        "confidence": 0.9,
        "topics": ["kualitas produk"],
        "urgency": "low",
        "summary": "Ringkasan",
        "is_spam": False,
    }
    data.update(overrides)
    return ReviewResult(**data)


def test_classify_and_cache(client, monkeypatch):
    calls: list[int] = []

    async def fake_call(reviews, topics):
        calls.append(len(reviews))
        return [fake_result(r) for r in reviews]

    monkeypatch.setattr(gemini, "call_gemini", fake_call)
    text = f"Barang rusak {uuid.uuid4()}"
    body = {
        "reviews": [{"id": "a", "text": text}, {"id": "b", "text": "Bagus sekali " + text[-8:]}]
    }

    first = client.post("/api/classify", json=body).json()
    assert [r["id"] for r in first["results"]] == ["a", "b"]
    assert first["results"][0]["sentiment"] == "negative"
    assert first["cached"] == 0
    assert calls == [2]

    second = client.post("/api/classify", json=body).json()
    assert second["cached"] == 2
    assert calls == [2]  # tidak memanggil Gemini lagi


def test_duplicate_ids_rejected(client):
    body = {"reviews": [{"id": "a", "text": "x"}, {"id": "a", "text": "y"}]}
    assert client.post("/api/classify", json=body).status_code == 422


def test_missing_key_returns_503(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    res = client.post("/api/classify", json={"reviews": [{"id": "a", "text": "halo"}]})
    assert res.status_code == 503
    assert "GEMINI_API_KEY" in res.json()["detail"]


def test_fatal_error_returns_502(client, monkeypatch):
    async def fake_call(reviews, topics):
        raise gemini.GeminiFatalError("bad key")

    monkeypatch.setattr(gemini, "call_gemini", fake_call)
    res = client.post("/api/classify", json={"reviews": [{"id": "a", "text": str(uuid.uuid4())}]})
    assert res.status_code == 502


def test_missing_ids_are_retried():
    reviews = [ReviewIn(id=str(i), text=f"ulasan {i}") for i in range(4)]
    calls: list[list[str]] = []

    async def flaky(group, topics):
        calls.append([r.id for r in group])
        return [fake_result(r) for r in group if len(calls) > 1 or r.id != "2"]

    results, failed = asyncio.run(gemini.classify_reviews(reviews, ["harga", "lainnya"], flaky))
    assert [r.id for r in results] == ["0", "1", "2", "3"]
    assert failed == []
    assert calls == [["0", "1", "2", "3"], ["2"]]


def test_bad_review_is_isolated():
    reviews = [ReviewIn(id=str(i), text=f"ulasan {i}") for i in range(4)]

    async def breaks_on_3(group, topics):
        if any(r.id == "3" for r in group):
            raise ValueError("JSON tidak valid")
        return [fake_result(r) for r in group]

    results, failed = asyncio.run(gemini.classify_reviews(reviews, ["lainnya"], breaks_on_3))
    assert [r.id for r in results] == ["0", "1", "2"]
    assert failed == ["3"]


def test_sanitize_topics_and_confidence():
    review = ReviewIn(id="x", text="t")
    raw = fake_result(review, topics=["Harga", "topik aneh", "harga"], confidence=1.7)
    clean = gemini._sanitize(raw, ["harga", "pengiriman", "lainnya"])
    assert clean.topics == ["harga", "lainnya"]
    assert clean.confidence == 1.0
