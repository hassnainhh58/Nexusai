import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .agents.assistant import allowed_model_names, default_model_name, provider
from .api.chat import router as chat_router
from .api.files import router as files_router
from .api.images import router as images_router
from .core.auth import CurrentUser, get_current_user
from .core.config import get_settings
from .core.logging_config import (
    request_id_ctx,
    request_user_ctx,
    setup_logging,
)
from .database.db import get_db, init_db

# ==========================================
# INITIALIZATION & LOGGING
# ==========================================

setup_logging()
logger = logging.getLogger("nexusai.server")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Validates configuration and prepares storage before serving traffic."""
    for problem in settings.validate_runtime():
        logger.warning("Configuration: %s", problem)

    init_db()
    logger.info(
        "NexusAI %s started (environment=%s, model=%s, auth_required=%s)",
        settings.app_version,
        settings.environment,
        default_model_name,
        settings.auth_required,
    )
    try:
        yield
    finally:
        logger.info("NexusAI shutting down")


# ==========================================
# FASTAPI APPLICATION
# ==========================================

app = FastAPI(
    title="NexusAI Intelligence API",
    description="Production-grade AI Assistant Backend with streaming, tools, and conversation persistence.",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ==========================================
# CORS CONFIGURATION
# ==========================================

allowed_origins = settings.cors_origin_list or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]

# In development the Vite dev server may pick any free port, so every localhost
# origin is accepted. This is disabled in production.
allow_localhost_regex = not settings.is_production

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$" if allow_localhost_regex else None
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Conversation-ID", "X-Request-ID", "X-Process-Time", "X-Model"],
)

_DOCS_PATHS = {"/docs", "/redoc", "/openapi.json"}


# ==========================================
# REQUEST CONTEXT, ACCESS LOG & SECURITY HEADERS
# ==========================================
@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request_id_token = request_id_ctx.set(request_id)
    request_user_token = request_user_ctx.set("-")

    start_time = time.perf_counter()
    response: Response | None = None
    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = (time.perf_counter() - start_time) * 1000
        status_code = response.status_code if response is not None else 500
        logger.info(
            "%s %s -> %s (%.0f ms)",
            request.method,
            request.url.path,
            status_code,
            duration_ms,
        )
        if response is not None:
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Process-Time"] = f"{duration_ms / 1000:.4f}s"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
            if settings.is_production:
                response.headers["Strict-Transport-Security"] = (
                    "max-age=31536000; includeSubDomains"
                )
            # The API only returns JSON, so a maximally restrictive policy is
            # safe. Interactive docs need their own assets, so they are exempt.
            if request.url.path not in _DOCS_PATHS and not request.url.path.startswith(
                ("/docs/", "/redoc/")
            ):
                response.headers["Content-Security-Policy"] = (
                    "default-src 'none'; frame-ancestors 'none'"
                )
        request_id_ctx.reset(request_id_token)
        request_user_ctx.reset(request_user_token)


# ==========================================
# GLOBAL EXCEPTION HANDLER
# ==========================================
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled error processing %s %s: %s",
        request.method,
        request.url,
        exc,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An internal server error occurred. Please try again later.",
            "error_type": type(exc).__name__,
        },
    )


# ==========================================
# ROUTES
# ==========================================

app.include_router(chat_router)
app.include_router(files_router)
app.include_router(images_router)


# ==========================================
# ROOT
# ==========================================
@app.get("/", tags=["System"])
async def root():
    return {
        "message": "NexusAI API is online and operational",
        "status": "ok",
        "version": settings.app_version,
        "docs": "/docs",
    }


# ==========================================
# HEALTH CHECKS
# ==========================================
def _database_status() -> str:
    try:
        with get_db() as conn:
            conn.execute("SELECT 1;").fetchone()
        return "healthy"
    except Exception as exc:  # pragma: no cover - requires a broken database
        logger.error("Database health check failed: %s", exc)
        return f"unhealthy: {exc}"


@app.get("/health/live", tags=["System"])
async def health_live():
    """Liveness: the process is up (no dependencies checked)."""
    return {"status": "alive", "version": settings.app_version}


@app.get("/health/ready", tags=["System"])
async def health_ready():
    """Readiness: storage and configuration are usable."""
    db_status = _database_status()
    problems = settings.validate_runtime()
    is_ready = db_status == "healthy" and not problems
    return JSONResponse(
        status_code=status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if is_ready else "not_ready",
            "database": db_status,
            "problems": problems,
            "version": settings.app_version,
        },
    )


@app.get("/health", response_model=None, tags=["System"])
async def health():
    """Combined health report, kept for backwards compatibility."""
    db_status = _database_status()
    is_healthy = db_status == "healthy"

    return JSONResponse(
        status_code=status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "database": db_status,
            "model": default_model_name,
            "version": settings.app_version,
        },
    )


# ==========================================
# MODELS (OPENAI COMPATIBLE)
# ==========================================

# In-memory cache for the models endpoint (60s TTL)
_models_cache: dict[str, Any] = {"data": None, "timestamp": 0}


@app.get("/v1/models", tags=["Models"])
async def get_models(current_user: CurrentUser = Depends(get_current_user)):
    """
    Returns the configured models. Only the allowlisted models are exposed so
    the endpoint does not leak the whole upstream catalogue.
    """
    now = time.time()
    if _models_cache["data"] and (now - _models_cache["timestamp"] < 60):
        return _models_cache["data"]

    try:
        response = await provider.client.models.list()
        upstream = response.to_dict()
        upstream_ids = {item.get("id") for item in upstream.get("data", [])}
        data = {
            "object": "list",
            "data": [
                {"id": name, "object": "model"}
                for name in allowed_model_names()
                if name in upstream_ids
            ],
        }
        _models_cache["data"] = data
        _models_cache["timestamp"] = now
        return data
    except Exception as exc:
        logger.error("Failed to fetch models from upstream provider: %s", exc)
        if _models_cache["data"]:
            return _models_cache["data"]
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch models from upstream provider: {exc}",
        ) from exc
