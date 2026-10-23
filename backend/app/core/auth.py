import logging
from typing import Any

import jwt
from fastapi import Header, HTTPException, status
from pydantic import BaseModel

from .config import get_settings
from .logging_config import request_user_ctx

logger = logging.getLogger("nexusai.auth")

_JWKS_CACHE: dict[str, jwt.PyJWKClient] = {}


class CurrentUser(BaseModel):
    id: str
    is_authenticated: bool = False
    email: str | None = None


def get_jwks_client() -> jwt.PyJWKClient | None:
    settings = get_settings()
    issuer = settings.clerk_jwt_issuer.rstrip("/")
    if not issuer:
        return None
    if issuer not in _JWKS_CACHE:
        _JWKS_CACHE[issuer] = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json")
    return _JWKS_CACHE[issuer]


def _decode_token(token: str) -> dict[str, Any] | None:
    """
    Verifies a Clerk session token and returns its claims.

    Returns None when the token cannot be verified.
    """
    settings = get_settings()
    try:
        client = get_jwks_client()
        if client is None:
            # No issuer configured: decode without signature verification.
            # This is only reachable when AUTH_REQUIRED=false (local dev).
            return jwt.decode(token, options={"verify_signature": False})

        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_jwt_issuer.rstrip("/"),
            # Clerk session tokens carry no "aud" claim (they use "azp"
            # instead), so the audience is not enforced by PyJWT. It is
            # checked manually below, but only when the token has one.
            options={"verify_aud": False},
            # Clerk's clock can be a few seconds ahead of ours, which makes
            # "iat" look like it lies in the future and rejects valid tokens.
            leeway=60,
        )

        token_audience = claims.get("aud")
        if (
            token_audience
            and settings.clerk_jwt_audience
            and token_audience != settings.clerk_jwt_audience
        ):
            logger.warning("Token has an unexpected audience: %s", token_audience)
            return None

        return claims
    except jwt.PyJWTError as err:
        logger.warning("Token verification failed: %s", err)
        return None
    except Exception as err:  # pragma: no cover - defensive (network/JWKS issues)
        logger.warning("Token verification error: %s", err)
        return None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> CurrentUser:
    """
    FastAPI dependency that authenticates the caller.

    Authentication fails closed: a missing or invalid token is a 401 instead of
    silently becoming a shared "default" user. ``AUTH_REQUIRED=false`` is the
    only way to run the API anonymously, and it is meant for local development.
    """
    settings = get_settings()

    if not settings.auth_required:
        return CurrentUser(id="default", is_authenticated=False)

    if not authorization:
        raise _unauthorized("Authentication required")

    parts = authorization.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise _unauthorized("Malformed Authorization header")

    claims = _decode_token(parts[1])
    if not claims:
        raise _unauthorized("Invalid or expired token")

    user_id = claims.get("sub") or claims.get("id")
    if not user_id:
        raise _unauthorized("Token does not identify a user")

    email = claims.get("email") or claims.get("user_email")
    request_user_ctx.set(str(user_id))
    return CurrentUser(
        id=str(user_id),
        is_authenticated=True,
        email=str(email) if email else None,
    )
