import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.db import init_db
from app.limiter import limiter, rate_limit_handler
from app.routers import auth, classify, export, history, insight, upload

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield


app = FastAPI(title="Pemilah Ulasan", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    # /docs memakai skrip dari CDN, jadi CSP hanya untuk halaman aplikasi.
    if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
        response.headers.setdefault("Content-Security-Policy", CSP)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Kesalahan tak terduga di %s", request.url.path)
    return JSONResponse(
        status_code=500, content={"detail": "Terjadi kesalahan di server. Coba lagi nanti."}
    )


for router in (classify, upload, export, insight, auth, history):
    app.include_router(router.router)


@app.get("/api/health", tags=["status"])
async def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "gemini_ready": bool(settings.gemini_api_key),
        "model": settings.gemini_model,
        "limits": {
            "demo_max_reviews": settings.demo_max_reviews,
            "member_max_reviews": settings.member_max_reviews,
            "max_upload_mb": settings.max_upload_mb,
        },
    }


@app.api_route(
    "/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"], include_in_schema=False
)
async def api_not_found(path: str) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Endpoint tidak ditemukan."})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
