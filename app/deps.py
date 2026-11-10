from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import User, get_session
from app.services.auth import COOKIE_NAME, read_token


async def current_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User | None:
    user_id = read_token(request.cookies.get(COOKIE_NAME))
    return await session.get(User, user_id) if user_id else None


async def require_user(user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Silakan masuk terlebih dahulu.")
    return user
