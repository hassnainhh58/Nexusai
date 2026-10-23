"""Centralised, validated application configuration.

Every environment-dependent value is declared here instead of being read with
``os.getenv`` at import time, so a misconfigured deployment fails fast and the
same values are used by the API, the agent and the tests.
"""

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Keep the pydantic-ai ASCII banner out of server logs.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# Locate backend/.env reliably, regardless of the process working directory.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------
    # Runtime
    # ------------------------------------------------------------------
    environment: str = "development"
    log_level: str = "INFO"
    app_version: str = "1.1.0"

    # ------------------------------------------------------------------
    # LLM provider
    # ------------------------------------------------------------------
    llm_api_key: str = ""
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_provider: str = "openrouter"
    llm_model: str = "x-ai/grok-4.3"
    # Comma separated list of models tried when the primary one is
    # unavailable (out of credits, upstream error) or leaves a turn unfinished.
    llm_fallback_model: str = ""
    llm_timeout_seconds: float = Field(default=90.0, gt=0)

    # Image editing goes through the provider's dedicated Image API. The
    # uploaded picture is sent as an input reference, so the model edits it
    # instead of generating an unrelated image.
    image_model: str = "google/gemini-3.1-flash-image"
    image_timeout_seconds: float = Field(default=180.0, gt=0)

    tavily_api_key: str = ""

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    # When true (the default) every API route requires a valid Clerk token.
    # It can only be disabled explicitly for offline/local development.
    auth_required: bool = True
    clerk_jwt_issuer: str = ""
    clerk_jwt_audience: str = "clerk"

    # ------------------------------------------------------------------
    # HTTP / storage
    # ------------------------------------------------------------------
    cors_origins: str = ""
    max_upload_size_mb: int = Field(default=10, gt=0)
    nexusai_db_path: str = ""

    # ------------------------------------------------------------------
    # Limits
    # ------------------------------------------------------------------
    # Per-user sliding window applied to expensive endpoints (chat, upload).
    rate_limit_requests_per_minute: int = Field(default=30, gt=0)
    rate_limit_burst: int = Field(default=5, ge=0)
    max_history_turns: int = Field(default=10, gt=0)
    conversations_page_size: int = Field(default=50, gt=0, le=200)

    # Chat messages have no application-level character limit. The only bound
    # is the model's context window, so the budget below decides how much text
    # is sent; larger input keeps its most relevant excerpts.
    model_context_tokens: int = Field(default=1_000_000, gt=0)
    # HTTP safety valve (protects the process from absurd bodies). Far above any
    # message a person or a 10 MB upload can produce.
    max_request_body_mb: int = Field(default=32, gt=0)

    # ------------------------------------------------------------------
    # Derived helpers
    # ------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def fallback_models(self) -> list[str]:
        return [name.strip() for name in self.llm_fallback_model.split(",") if name.strip()]

    @property
    def allowed_models(self) -> list[str]:
        """Model names a client is allowed to request."""
        models = [self.llm_model.strip(), *self.fallback_models]
        return [name for name in dict.fromkeys(models) if name]

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_path(self) -> Path:
        return Path(self.nexusai_db_path) if self.nexusai_db_path else BACKEND_DIR / "nexusai.db"

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def max_request_body_bytes(self) -> int:
        return self.max_request_body_mb * 1024 * 1024

    @property
    def context_char_budget(self) -> int:
        """Characters allowed for one message or for the conversation history.

        About 2.5 characters per token is the pessimistic case (dense code), so
        0.8 characters per context token leaves the prompt well inside the
        window even when the message and the history are both at the budget.
        """
        return int(self.model_context_tokens * 0.8)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def validate_runtime(self) -> list[str]:
        """Returns configuration problems, raising in production.

        Development is allowed to boot with warnings so the API docs and tests
        stay usable, but a production deployment must never start half
        configured.
        """
        problems: list[str] = []
        if not self.llm_api_key:
            problems.append("LLM_API_KEY is not set: chat requests cannot be served.")
        if self.auth_required and not self.clerk_jwt_issuer:
            problems.append(
                "CLERK_JWT_ISSUER is not set while AUTH_REQUIRED=true: tokens cannot be verified."
            )
        if self.is_production and not self.cors_origin_list:
            problems.append("CORS_ORIGINS must list the allowed frontend origins.")

        if problems and self.is_production:
            raise RuntimeError("Invalid configuration: " + " ".join(problems))
        return problems


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
