import logging
import os
import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .agents.assistant import default_model_name, provider
from .api.files import router as files_router
from .api.chat import router as chat_router
from .core.logging_config import setup_logging
from .database.db import get_db, init_db

# ==========================================
# INITIALIZATION & LOGGING
# ==========================================

setup_logging()
logger = logging.getLogger("nexusai.server")

# Initialize database schema and perform migrations
try:
    init_db()
    logger.info("Database schema initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize database: {e}")

# ==========================================
# FASTAPI APPLICATION
# ==========================================

app = FastAPI(
    title="NexusAI Intelligence API",
    description="Production-grade AI Assistant Backend with streaming, tools, and conversation persistence.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ==========================================
# CORS CONFIGURATION
# ==========================================

cors_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [
    origin.strip()
    for origin in cors_env.split(",")
    if origin.strip()
] or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Conversation-ID", "X-Request-ID", "X-Process-Time"],
)


# ==========================================
# REQUEST ID & PROCESS TIME MIDDLEWARE
# ==========================================

@app.middleware("http")
async def request_metrics_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start_time = time.perf_counter()

    response: Response = await call_next(request)

    process_time = time.perf_counter() - start_time
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time"] = f"{process_time:.4f}s"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"

    return response


# ==========================================
# GLOBAL EXCEPTION HANDLER
# ==========================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error processing {request.method} {request.url}: {exc}", exc_info=True)
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


# ==========================================
# ROOT
# ==========================================

@app.get("/", tags=["System"])
async def root():
    return {
        "message": "NexusAI API is online and operational",
        "status": "ok",
        "version": "1.0.0",
        "docs": "/docs",
    }


# ==========================================
# HEALTH CHECK
# ==========================================

@app.get("/health", tags=["System"])
async def health():
    db_status = "healthy"
    try:
        with get_db() as conn:
            conn.execute("SELECT 1;").fetchone()
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        db_status = f"unhealthy: {e}"

    is_healthy = db_status == "healthy"
    status_code = status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "database": db_status,
            "model": default_model_name,
            "version": "1.0.0",
        },
    )


# ==========================================
# MODELS (OPENAI COMPATIBLE)
# ==========================================

# In-memory cache for models endpoint (60s TTL)
_models_cache: dict[str, Any] = {"data": None, "timestamp": 0}


@app.get("/v1/models", tags=["Models"])
async def get_models():
    """
    Returns available models from the upstream provider.
    Cached for 60 seconds to prevent rate limiting upstream.
    """
    now = time.time()
    if _models_cache["data"] and (now - _models_cache["timestamp"] < 60):
        return _models_cache["data"]

    try:
        response = await provider.client.models.list()
        data = response.to_dict()
        # Ensure top-level object key as per original behavior
        if not data.get("object"):
            data["object"] = "list"
        _models_cache["data"] = data
        _models_cache["timestamp"] = now
        return data
    except Exception as e:
        logger.error(f"Failed to fetch models from upstream provider: {e}")
        if _models_cache["data"]:
            return _models_cache["data"]
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch models from upstream provider: {e}",
        )