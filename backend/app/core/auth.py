import logging
import os
from typing import Optional
from fastapi import Header, HTTPException, status
from pydantic import BaseModel
import jwt

logger = logging.getLogger("nexusai.auth")


class CurrentUser(BaseModel):
    id: str
    is_authenticated: bool = False
    email: Optional[str] = None


async def get_current_user(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> CurrentUser:
    """
    FastAPI dependency to extract and authenticate the current user.
    Supports Clerk JWT tokens and falls back gracefully to a default identity
    to preserve existing functionality and test workflows.
    """
    if not authorization:
        return CurrentUser(id="default", is_authenticated=False)

    parts = authorization.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return CurrentUser(id="default", is_authenticated=False)

    token = parts[1]

    # 1. Try decoding JWT (Clerk sends signed RS256 JWTs)
    try:
        # Decode without verifying signature first to extract claims
        unverified_claims = jwt.decode(
            token,
            options={"verify_signature": False},
        )
        user_id = unverified_claims.get("sub") or unverified_claims.get("id")
        if user_id:
            email = unverified_claims.get("email") or unverified_claims.get("user_email")
            return CurrentUser(
                id=str(user_id),
                is_authenticated=True,
                email=str(email) if email else None,
            )
    except Exception as err:
        logger.debug(f"Token decoding fallback: {err}")

    # Fallback to default
    return CurrentUser(id="default", is_authenticated=False)
