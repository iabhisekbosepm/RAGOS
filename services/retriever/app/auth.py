"""Self-contained auth: bcrypt password hashing + HS256 JWT + RBAC dependencies.

No external IdP (no Keycloak/JVM). Users live in the local SQLite `users` table.
When settings.auth_enabled is False the whole app stays open — the dependencies
return a synthetic admin so existing behavior is unchanged during development.

Role order: viewer < editor < admin. `require_role(x)` allows role >= x.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from . import db
from .config import settings

ROLES = ["viewer", "editor", "admin"]
_RANK = {r: i for i, r in enumerate(ROLES)}
_ALGO = "HS256"


# A fixed bcrypt hash of a random value — used to spend ~equal time on unknown
# usernames so login can't be timed to enumerate valid accounts.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode()

_DEFAULT_SECRET = "dev-only-change-me"
_DEFAULT_ADMIN_PW = "admin"


# ── passwords ────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    # bcrypt silently truncates at 72 bytes — reject longer so it's not surprising.
    if len(password.encode("utf-8")) > 72:
        raise ValueError("password must be ≤ 72 bytes")
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], password_hash.encode())
    except (ValueError, TypeError):
        return False


def dummy_verify() -> None:
    """Constant-time-ish decoy check for unknown usernames (anti-enumeration)."""
    try:
        bcrypt.checkpw(b"x", _DUMMY_HASH.encode())
    except Exception:
        pass


def validate_startup() -> None:
    """Refuse to run with insecure defaults once auth is actually enforced."""
    if not settings.auth_enabled:
        return
    if settings.auth_secret == _DEFAULT_SECRET:
        raise RuntimeError("AUTH_SECRET must be set to a strong value before enabling auth")
    if len(settings.auth_secret) < 16:
        raise RuntimeError("AUTH_SECRET is too short (use ≥ 16 random chars)")
    if settings.auth_admin_password == _DEFAULT_ADMIN_PW and db.count_users() == 0:
        raise RuntimeError("Change AUTH_ADMIN_PASSWORD before enabling auth (default is insecure)")


# ── tokens ───────────────────────────────────────────────────────────
def make_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=settings.auth_token_ttl_hours),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm=_ALGO)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.auth_secret, algorithms=[_ALGO],
                      options={"require": ["exp", "sub", "iat"]})


# ── seeding ──────────────────────────────────────────────────────────
def seed_admin() -> None:
    """Create the first admin from env if the user table is empty."""
    if db.count_users() == 0 and settings.auth_admin_user and settings.auth_admin_password:
        db.create_user(settings.auth_admin_user,
                       hash_password(settings.auth_admin_password), "admin")


# ── dependencies ─────────────────────────────────────────────────────
_OPEN_ADMIN = {"id": "open", "username": "open", "role": "admin"}


def _bearer(request: Request) -> str | None:
    h = request.headers.get("Authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


def current_user(request: Request) -> dict:
    """Resolve the caller. Open (synthetic admin) when auth is disabled."""
    if not settings.auth_enabled:
        return _OPEN_ADMIN
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="authentication required")
    try:
        claims = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid token")
    user = db.get_user(claims.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="user no longer exists")
    return {"id": user["id"], "username": user["username"], "role": user["role"]}


def require_role(minimum: str):
    """Dependency factory: allow callers whose role rank >= `minimum`."""
    floor = _RANK[minimum]

    def dep(user: dict = Depends(current_user)) -> dict:
        if _RANK.get(user["role"], -1) < floor:
            raise HTTPException(status_code=403, detail=f"requires {minimum} role")
        return user

    return dep


require_viewer = require_role("viewer")
require_editor = require_role("editor")
require_admin = require_role("admin")
