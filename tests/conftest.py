import os
import tempfile
from pathlib import Path

# Harus di-set sebelum modul app diimpor.
_tmp = Path(tempfile.mkdtemp())
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["GEMINI_API_KEY"] = "test-key"
os.environ["RATE_LIMIT"] = "1000/minute"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import gemini  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr(gemini, "BACKOFF_SECONDS", 0)
