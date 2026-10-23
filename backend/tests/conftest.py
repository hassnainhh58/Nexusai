"""
Shared pytest configuration.

The database location is redirected to a temporary file BEFORE the application
is imported, so a test run never touches the real development database.
"""

import os
import tempfile
from pathlib import Path

_TEMP_DIR = Path(tempfile.mkdtemp(prefix="nexusai-tests-"))
os.environ["NEXUSAI_DB_PATH"] = str(_TEMP_DIR / "nexusai-test.db")
# Keep the test run offline-friendly: the upstream provider is never called.
os.environ.setdefault("LLM_API_KEY", "test-key")
# Tests exercise authentication itself, so it must stay enabled. The issuer is
# required for the app to report itself ready; a placeholder keeps the suite
# independent of a developer's .env (CI has none). Tests that verify tokens
# override it explicitly.
os.environ.setdefault("AUTH_REQUIRED", "true")
os.environ.setdefault("CLERK_JWT_ISSUER", "https://clerk.example.dev")
