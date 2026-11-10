from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.db import User, get_session
from app.deps import current_user
from app.limiter import limiter
from app.schemas import Credentials, Me
from app.services.auth import (
    COOKIE_NAME,
    SESSION_DAYS,
    hash_password,
    make_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["akun"])


def _me(user: User | None) -> Me:
    settings = get_settings()
    if user is None:
        return Me(email=None, max_reviews=settings.demo_max_reviews)
    return Me(email=user.email, max_reviews=settings.member_max_reviews)


def _set_cookie(request: Request, response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        make_token(user.id),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )


@router.get("/me", response_model=Me)
async def me(user: User | None = Depends(current_user)) -> Me:
    return _me(user)


@router.post("/register", response_model=Me)
@limiter.limit("5/minute")
async def register(
    request: Request,
    response: Response,
    body: Credentials,
    session: AsyncSession = Depends(get_session),
) -> Me:
    email = body.email.strip().lower()
    password_hash = await run_in_threadpool(hash_password, body.password)
    user = User(
        email=email, password_hash=password_hash, created_at=datetime.now(UTC).replace(tzinfo=None)
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Email ini sudah terdaftar. Silakan masuk.") from exc
    _set_cookie(request, response, user)
    return _me(user)


@router.post("/login", response_model=Me)
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    body: Credentials,
    session: AsyncSession = Depends(get_session),
) -> Me:
    email = body.email.strip().lower()
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    valid = user is not None and await run_in_threadpool(
        verify_password, body.password, user.password_hash
    )
    if not valid:
        raise HTTPException(401, "Email atau password salah.")
    _set_cookie(request, response, user)
    return _me(user)


@router.post("/logout", response_model=Me)
async def logout(response: Response) -> Me:
    response.delete_cookie(COOKIE_NAME)
    return _me(None)
