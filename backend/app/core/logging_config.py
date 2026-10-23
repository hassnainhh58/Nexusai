"""Structured logging with request correlation.

Every log line emitted while handling a request carries the same request id,
which is also returned to the client in the ``X-Request-ID`` header. Uvicorn's
own loggers are routed through the same formatter instead of being replaced
(``force=True`` used to silently disable the access log).
"""

import logging
import logging.config
import sys
from contextvars import ContextVar

from .config import get_settings

# Populated by the request middleware in ``app.main``.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
request_user_ctx: ContextVar[str] = ContextVar("request_user", default="-")


class RequestContextFilter(logging.Filter):
    """Injects the current request id / user into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.request_user = request_user_ctx.get()
        return True


def setup_logging() -> None:
    """Configures one formatter shared by the app and uvicorn loggers."""
    settings = get_settings()
    level = settings.log_level.upper()

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "request_context": {"()": RequestContextFilter},
            },
            "formatters": {
                "default": {
                    "format": (
                        "%(asctime)s | %(levelname)-7s | %(name)s | "
                        "req=%(request_id)s user=%(request_user)s | %(message)s"
                    ),
                    "datefmt": "%Y-%m-%d %H:%M:%S",
                },
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "stream": sys.stdout,
                    "formatter": "default",
                    "filters": ["request_context"],
                },
            },
            "root": {"level": level, "handlers": ["console"]},
            "loggers": {
                # Uvicorn routes through our handler instead of its own.
                "uvicorn": {"level": level, "handlers": ["console"], "propagate": False},
                "uvicorn.error": {
                    "level": level,
                    "handlers": ["console"],
                    "propagate": False,
                },
                # Requests are logged by our middleware with a request id, so
                # uvicorn's own access log would duplicate every line.
                "uvicorn.access": {
                    "level": "WARNING",
                    "handlers": ["console"],
                    "propagate": False,
                },
                # Tone down overly verbose third-party loggers.
                "httpx": {"level": "WARNING"},
                "httpcore": {"level": "WARNING"},
                "urllib3": {"level": "WARNING"},
            },
        }
    )
