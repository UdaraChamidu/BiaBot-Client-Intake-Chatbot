"""Auth helpers for client and admin access control."""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

bearer_scheme = HTTPBearer(auto_error=False)


def create_client_token(client_code: str, client_name: str) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_exp_minutes)
    payload = {
        "sub": client_code,
        "client_name": client_name,
        "role": "client",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


async def get_client_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "client":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid token role",
        )
    return {
        "client_code": payload.get("sub"),
        "client_name": payload.get("client_name"),
    }


async def require_admin(
    x_admin_password: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None),
) -> None:
    candidate = x_admin_password or x_admin_key
    if not is_valid_admin_secret(candidate):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin password",
        )


def get_admin_secret() -> str:
    settings = get_settings()
    return settings.admin_password or settings.admin_api_key


def is_valid_admin_secret(candidate: str | None) -> bool:
    if not candidate:
        return False
    return candidate == get_admin_secret()
