"""Password (scrypt) dan cookie sesi bertanda tangan HMAC. Hanya memakai pustaka standar."""

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time

from app.config import get_settings

log = logging.getLogger(__name__)

COOKIE_NAME = "pu_session"
SESSION_DAYS = 30
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

_secret = get_settings().secret_key
if not _secret:
    _secret = secrets.token_hex(32)
    log.warning("SECRET_KEY belum diatur; memakai kunci acak (user akan ter-logout saat restart).")
_SECRET = _secret.encode()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def _sign(payload: str) -> str:
    mac = hmac.new(_SECRET, payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def make_token(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + SESSION_DAYS * 86400}"
    return f"{payload}.{_sign(payload)}"


def read_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        user_id, expires, signature = token.split(".")
    except ValueError:
        return None
    payload = f"{user_id}.{expires}"
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    if not expires.isdigit() or int(expires) < time.time():
        return None
    return int(user_id) if user_id.isdigit() else None
