"""JWT validation for the ingestion service (RBAC on upload).

Stateless: there is no user table here. We trust the role claim inside the JWT,
which was signed by the retriever with the SHARED AUTH_SECRET. Same algorithm and
required-claims policy as the retriever. Open (synthetic admin) when auth is off.
"""
import jwt
from fastapi import Depends, HTTPException, Request

from .config import settings

ROLES = ["viewer", "editor", "admin"]
_RANK = {r: i for i, r in enumerate(ROLES)}
_ALGO = "HS256"
_OPEN_ADMIN = {"id": "open", "username": "open", "role": "admin"}


def _bearer(request: Request) -> str | None:
    h = request.headers.get("Authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


def current_user(request: Request) -> dict:
    if not settings.auth_enabled:
        return _OPEN_ADMIN
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="authentication required")
    try:
        claims = jwt.decode(token, settings.auth_secret, algorithms=[_ALGO],
                            options={"require": ["exp", "sub", "iat"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid token")
    return {"id": claims.get("sub", ""), "username": claims.get("username", ""),
            "role": claims.get("role", "viewer")}


def require_role(minimum: str):
    floor = _RANK[minimum]

    def dep(user: dict = Depends(current_user)) -> dict:
        if _RANK.get(user["role"], -1) < floor:
            raise HTTPException(status_code=403, detail=f"requires {minimum} role")
        return user

    return dep


require_editor = require_role("editor")
