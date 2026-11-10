import uuid

from app.schemas import InsightResult, ReplyResult
from app.services import auth, gemini


def test_insight_prioritizes_negative(client, monkeypatch):
    seen: dict = {}

    async def fake_generate(schema, system, prompt, temperature=0.1):
        seen["prompt"] = prompt
        return InsightResult(overview=" Ok ", liked=["a"] * 5, complaints=["b"], suggestions=[])

    monkeypatch.setattr(gemini, "generate", fake_generate)
    items = [
        {"sentiment": "positive", "topics": ["harga"], "urgency": "low", "summary": "murah"},
        {"sentiment": "negative", "topics": ["pengiriman"], "urgency": "high", "summary": "telat"},
        {
            "sentiment": "neutral",
            "topics": [],
            "urgency": "low",
            "summary": "promo",
            "is_spam": True,
        },
    ]
    res = client.post("/api/insight", json={"items": items})
    assert res.status_code == 200
    data = res.json()
    assert data["overview"] == "Ok"
    assert len(data["liked"]) == 3
    prompt = seen["prompt"]
    assert '"spam": 1' in prompt
    assert prompt.index("telat") < prompt.index("murah")
    assert "promo" not in prompt


def test_reply(client, monkeypatch):
    async def fake_generate(schema, system, prompt, temperature=0.1):
        assert '"nada": "formal"' in prompt
        return ReplyResult(reply="  Mohon maaf, Bapak/Ibu.  ")

    monkeypatch.setattr(gemini, "generate", fake_generate)
    body = {"text": "Barang rusak", "sentiment": "negative", "tone": "formal"}
    assert client.post("/api/reply", json=body).json() == {"reply": "Mohon maaf, Bapak/Ibu."}


def test_insight_gemini_busy_returns_503(client, monkeypatch):
    async def broken(*args, **kwargs):
        raise TimeoutError

    monkeypatch.setattr(gemini, "generate", broken)
    items = [{"sentiment": "positive", "topics": [], "urgency": "low", "summary": "x"}]
    assert client.post("/api/insight", json={"items": items}).status_code == 503


def test_password_and_token():
    stored = auth.hash_password("rahasia123")
    assert auth.verify_password("rahasia123", stored)
    assert not auth.verify_password("salah", stored)
    token = auth.make_token(7)
    assert auth.read_token(token) == 7
    assert auth.read_token(token[:-2] + "xx") is None
    assert auth.read_token("garbage") is None


def _register(client) -> str:
    email = f"u{uuid.uuid4().hex[:8]}@contoh.id"
    res = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert res.status_code == 200
    assert res.json()["email"] == email
    return email


def test_auth_flow(client):
    assert client.get("/api/auth/me").json()["email"] is None
    email = _register(client)
    me = client.get("/api/auth/me").json()
    assert me == {"email": email, "max_reviews": 2000}

    dup = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert dup.status_code == 409

    client.post("/api/auth/logout")
    client.cookies.clear()
    bad = client.post("/api/auth/login", json={"email": email, "password": "salahsalah"})
    assert bad.status_code == 401
    ok = client.post("/api/auth/login", json={"email": email.upper(), "password": "password123"})
    assert ok.status_code == 200


def test_history_crud_and_isolation(client):
    assert client.get("/api/history").status_code == 401
    _register(client)
    sid = str(uuid.uuid4())
    body = {
        "title": "Contoh data",
        "created_at": "2026-11-10T10:00:00Z",
        "topics": ["harga", "lainnya"],
        "reviews": [{"id": "r1", "text": "Murah"}, {"id": "r2", "text": "Mahal"}],
        "results": [
            {
                "id": "r1",
                "sentiment": "positive",
                "confidence": 0.9,
                "topics": ["harga"],
                "urgency": "low",
                "summary": "Murah",
                "is_spam": False,
            }
        ],
        "counts": {"positive": 1},
    }
    meta = client.put(f"/api/history/{sid}", json=body).json()
    assert meta["review_count"] == 2 and meta["done_count"] == 1
    assert [m["id"] for m in client.get("/api/history").json()] == [sid]
    full = client.get(f"/api/history/{sid}").json()
    assert full["reviews"][1]["text"] == "Mahal"
    assert full["topics"] == ["harga", "lainnya"]

    # User lain tidak bisa membaca atau menimpa
    client.cookies.clear()
    _register(client)
    assert client.get(f"/api/history/{sid}").status_code == 404
    assert client.put(f"/api/history/{sid}", json=body).status_code == 404
    assert client.get("/api/history").json() == []


def test_security_headers_and_api_404(client):
    res = client.get("/")
    assert "script-src 'self'" in res.headers["content-security-policy"]
    assert client.get("/api/tidak-ada").status_code == 404
