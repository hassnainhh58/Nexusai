"""End-to-end tests for the NexusAI backend API."""

import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.api import chat as chat_module
from app.api.chat import derive_title
from app.core import auth
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.database.db import init_db
from app.main import app
from app.services.chat_service import ChatStreamEvent, build_message_history


# ==========================================
# FIXTURES
# ==========================================
@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    init_db()


@pytest.fixture()
def client():
    """Authenticated client: the dependency is overridden with a fixed user."""
    from app.core.auth import CurrentUser, get_current_user

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id="test-user", is_authenticated=True
    )
    limiter.reset()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def set_user(user_id: str) -> None:
    """Switches the authenticated identity for subsequent requests."""
    from app.core.auth import CurrentUser, get_current_user

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id, is_authenticated=True
    )


@pytest.fixture()
def anon_client():
    """Unauthenticated client (no dependency override)."""
    app.dependency_overrides.clear()
    limiter.reset()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in body.strip().split("\n\n"):
        if not block.strip():
            continue
        event = None
        data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        events.append((event or "", data or {}))
    return events


# ==========================================
# SYSTEM ENDPOINTS
# ==========================================
def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "healthy"


def test_live_and_ready_endpoints(client):
    assert client.get("/health/live").json()["status"] == "alive"
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"


def test_security_headers_are_present(client):
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Content-Security-Policy"].startswith("default-src 'none'")
    assert response.headers["X-Request-ID"]


def test_cors_preflight_allows_localhost_ports(client):
    response = client.options(
        "/api/chat/conversations",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"


# ==========================================
# AUTHENTICATION
# ==========================================
def test_missing_token_is_rejected(anon_client):
    assert anon_client.get("/api/chat/conversations").status_code == 401


def test_malformed_authorization_header_is_rejected(anon_client):
    response = anon_client.get("/api/chat/conversations", headers={"Authorization": "not-a-bearer"})
    assert response.status_code == 401


def test_invalid_token_is_rejected(anon_client):
    response = anon_client.get(
        "/api/chat/conversations", headers={"Authorization": "Bearer garbage.token.value"}
    )
    assert response.status_code == 401


def test_health_endpoints_stay_public(anon_client):
    assert anon_client.get("/health/live").status_code == 200
    assert anon_client.get("/health/ready").status_code == 200


def _mint_token(private_key, issuer: str, subject: str = "user_from_token") -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": subject,
            "iss": issuer,
            "iat": now,
            "nbf": now - timedelta(seconds=5),
            "exp": now + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
    )


def test_valid_token_authenticates_the_user(anon_client, monkeypatch):
    """A correctly signed token must reach the API and scope the data."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    issuer = "https://test-instance.clerk.accounts.dev"

    class _SigningKey:
        key = private_key.public_key()

    class _JwksClient:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    settings = get_settings()
    monkeypatch.setattr(settings, "clerk_jwt_issuer", issuer)
    monkeypatch.setattr(auth, "get_jwks_client", lambda: _JwksClient())

    token = _mint_token(private_key, issuer)
    headers = {"Authorization": f"Bearer {token}"}

    response = anon_client.post("/api/chat/conversations", headers=headers)
    assert response.status_code == 201
    conversation_id = response.json()["id"]

    listed = anon_client.get("/api/chat/conversations", headers=headers).json()
    assert [conversation["id"] for conversation in listed] == [conversation_id]

    # A different subject must not see this conversation.
    other_token = _mint_token(private_key, issuer, subject="user_2")
    other = anon_client.get(
        "/api/chat/conversations", headers={"Authorization": f"Bearer {other_token}"}
    ).json()
    assert other == []


def test_token_signed_by_another_key_is_rejected(anon_client, monkeypatch):
    issuer = "https://test-instance.clerk.accounts.dev"
    real_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class _SigningKey:
        key = real_key.public_key()

    class _JwksClient:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    monkeypatch.setattr(get_settings(), "clerk_jwt_issuer", issuer)
    monkeypatch.setattr(auth, "get_jwks_client", lambda: _JwksClient())

    forged = _mint_token(forged_key, issuer)
    response = anon_client.get(
        "/api/chat/conversations", headers={"Authorization": f"Bearer {forged}"}
    )
    assert response.status_code == 401


def test_decode_token_returns_none_without_an_issuer(monkeypatch):
    monkeypatch.setattr(get_settings(), "clerk_jwt_issuer", "")
    monkeypatch.setattr(auth, "get_jwks_client", lambda: None)
    assert auth._decode_token("header.payload.signature") is None


# ==========================================
# CONVERSATIONS
# ==========================================
def test_create_and_list_conversations(client):
    created = client.post("/api/chat/conversations")
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    response = client.get("/api/chat/conversations")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert conversation_id in ids
    # The owner is not exposed in the summary payload.
    assert "user_id" not in response.json()[0]


def test_get_conversation_detail(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    response = client.get(f"/api/chat/conversations/{conversation_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == conversation_id
    assert data["messages"] == []


def test_rename_conversation(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    response = client.patch(f"/api/chat/conversations/{conversation_id}", json={"title": "Renamed"})
    assert response.status_code == 200
    assert response.json()["title"] == "Renamed"
    detail = client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert detail["title"] == "Renamed"


def test_rename_conversation_rejects_blank_title(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    response = client.patch(f"/api/chat/conversations/{conversation_id}", json={"title": "   "})
    assert response.status_code in (400, 422)


def test_delete_conversation_removes_its_messages(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    assert client.delete(f"/api/chat/conversations/{conversation_id}").status_code == 200
    assert client.get(f"/api/chat/conversations/{conversation_id}").status_code == 404


def test_unknown_conversation_returns_404(client):
    assert client.get("/api/chat/conversations/999999").status_code == 404


def test_conversations_are_isolated_between_users(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]

    set_user("other-user")
    assert client.get(f"/api/chat/conversations/{conversation_id}").status_code == 404
    assert client.delete(f"/api/chat/conversations/{conversation_id}").status_code == 404
    assert (
        client.patch(
            f"/api/chat/conversations/{conversation_id}", json={"title": "Hijacked"}
        ).status_code
        == 404
    )

    # The owner still sees it untouched.
    set_user("test-user")
    assert client.get(f"/api/chat/conversations/{conversation_id}").status_code == 200


def test_export_conversation_markdown(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    client.patch(f"/api/chat/conversations/{conversation_id}", json={"title": "Exported"})

    response = client.get(f"/api/chat/conversations/{conversation_id}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "# Exported" in response.text


def test_export_is_forbidden_for_non_owners(client):
    conversation_id = client.post("/api/chat/conversations").json()["id"]
    set_user("other-user")
    assert client.get(f"/api/chat/conversations/{conversation_id}/export").status_code == 404


def test_clear_all_only_deletes_the_callers_conversations(client):
    set_user("other-user")
    other_conversation = client.post("/api/chat/conversations").json()["id"]

    set_user("test-user")
    client.post("/api/chat/conversations")

    cleared = client.delete("/api/chat/conversations")
    assert cleared.status_code == 200
    assert client.get("/api/chat/conversations").json() == []

    # The other user's data survived.
    set_user("other-user")
    assert client.get(f"/api/chat/conversations/{other_conversation}").status_code == 200


def test_conversation_list_supports_pagination(client):
    for _ in range(3):
        client.post("/api/chat/conversations")

    page = client.get("/api/chat/conversations?limit=2&offset=0").json()
    assert len(page) == 2


# ==========================================
# CHAT
# ==========================================
def test_chat_requires_a_message_field(client):
    assert client.post("/api/chat", json={}).status_code == 422


def test_chat_rejects_empty_message(client):
    assert client.post("/api/chat", json={"message": "   "}).status_code == 422


def test_chat_rejects_unknown_conversation(client):
    response = client.post("/api/chat", json={"message": "hi", "conversation_id": 999999})
    assert response.status_code == 404


def test_chat_rejects_models_outside_the_allowlist(client):
    response = client.post("/api/chat", json={"message": "hi", "model": "evil/expensive"})
    assert response.status_code == 422
    assert "Allowed models" in response.json()["detail"]


def test_chat_streams_sse_and_persists_the_exchange(client, monkeypatch):
    async def fake_stream(*_args, **_kwargs):
        yield ChatStreamEvent(type="meta", model="test-model")
        yield ChatStreamEvent(type="token", text="Hello ", model="test-model")
        yield ChatStreamEvent(type="token", text="world", model="test-model")

    monkeypatch.setattr(chat_module, "stream_chat", fake_stream)

    response = client.post("/api/chat", json={"message": "hi there"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    conversation_id = int(response.headers["X-Conversation-ID"])
    events = parse_sse(response.text)
    assert events[0] == ("meta", {"model": "test-model"})
    assert "".join(data["text"] for name, data in events if name == "token") == "Hello world"
    assert events[-1][0] == "done"
    assert events[-1][1]["conversation_id"] == conversation_id
    assert events[-1][1]["model"] == "test-model"

    detail = client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "Hello world"
    # The title is derived from the first message.
    assert detail["title"] == "hi there"


def test_chat_does_not_store_upstream_errors_in_the_history(client, monkeypatch):
    async def failing_stream(*_args, **_kwargs):
        raise RuntimeError("upstream exploded")
        yield  # pragma: no cover - keeps this an async generator

    monkeypatch.setattr(chat_module, "stream_chat", failing_stream)

    response = client.post("/api/chat", json={"message": "boom"})
    conversation_id = int(response.headers["X-Conversation-ID"])
    events = parse_sse(response.text)
    assert events[-1][0] == "error"

    detail = client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user"]


def test_chat_regenerates_instead_of_appending(client, monkeypatch):
    calls = []

    async def fake_stream(message, **_kwargs):
        calls.append(message)
        yield ChatStreamEvent(type="meta", model="test-model")
        yield ChatStreamEvent(type="token", text=f"answer {len(calls)}")

    monkeypatch.setattr(chat_module, "stream_chat", fake_stream)

    first = client.post("/api/chat", json={"message": "hello"})
    conversation_id = int(first.headers["X-Conversation-ID"])

    second = client.post("/api/chat", json={"conversation_id": conversation_id, "regenerate": True})
    assert second.status_code == 200
    assert calls == ["hello", "hello"]

    detail = client.get(f"/api/chat/conversations/{conversation_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "answer 2"


def test_regenerate_requires_a_conversation(client):
    response = client.post("/api/chat", json={"regenerate": True})
    assert response.status_code == 400


def test_chat_enforces_the_rate_limit(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_requests_per_minute", 1)
    monkeypatch.setattr(settings, "rate_limit_burst", 0)

    async def fake_stream(*_args, **_kwargs):
        yield ChatStreamEvent(type="token", text="ok")

    monkeypatch.setattr(chat_module, "stream_chat", fake_stream)
    limiter.reset()

    assert client.post("/api/chat", json={"message": "one"}).status_code == 200
    second = client.post("/api/chat", json={"message": "two"})
    assert second.status_code == 429
    assert "Retry-After" in second.headers


# ==========================================
# TITLE + HISTORY
# ==========================================
def test_derive_title_strips_code_and_truncates():
    assert derive_title("hello world") == "hello world"
    assert derive_title("```python\nprint('x')\n```") == "New Chat"
    long_title = derive_title("one two three four five six seven eight")
    assert long_title.endswith("…")
    assert len(long_title) <= 61


def test_build_message_history_preserves_roles():
    rows = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
        {"role": "user", "content": "bye"},
    ]
    history = build_message_history(rows)
    assert len(history) == 3


def test_build_message_history_skips_empty_messages():
    history = build_message_history(
        [
            {"role": "user", "content": "  "},
            {"role": "assistant", "content": "ok"},
            {"role": "user", "content": "next"},
        ]
    )
    # The empty user turn is dropped, and the history cannot start with an
    # assistant reply, so only the trailing user message remains.
    assert len(history) == 1


def test_build_message_history_merges_consecutive_user_turns():
    history = build_message_history(
        [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "second"},
        ]
    )
    assert len(history) == 1


def test_build_message_history_keeps_recent_turns_only():
    rows = []
    for index in range(40):
        rows.append({"role": "user", "content": f"q{index}"})
        rows.append({"role": "assistant", "content": f"a{index}"})
    history = build_message_history(rows)
    assert len(history) <= get_settings().max_history_turns * 2


# ==========================================
# STREAM FALLBACK BEHAVIOUR
# ==========================================
class _FakeResult:
    def __init__(self, chunks):
        self._chunks = chunks

    async def stream_text(self, delta=True):
        for chunk in self._chunks:
            yield chunk

    def all_messages(self):
        return []


class _FakeRunStream:
    def __init__(self, behaviour):
        self._behaviour = behaviour

    async def __aenter__(self):
        result, error = self._behaviour()
        if error:
            raise error
        return result

    async def __aexit__(self, *_exc):
        return False


class _FakeAgent:
    def __init__(self, behaviour):
        self._behaviour = behaviour

    def run_stream(self, *_args, **_kwargs):
        return _FakeRunStream(self._behaviour)


def test_stream_falls_back_to_the_next_model(monkeypatch):
    from app.services import chat_service

    primary = chat_service.default_model_name
    fallbacks = chat_service.fallback_model_names

    def failing():
        raise RuntimeError("out of credits")

    def working():
        return _FakeResult(["answer"]), None

    agents = {
        primary: _FakeAgent(failing),
        "fallback-model": _FakeAgent(working),
    }
    monkeypatch.setattr(chat_service, "fallback_model_names", ["fallback-model"])
    monkeypatch.setattr(chat_service, "get_agent", lambda name: agents[name])

    async def collect():
        return [event async for event in chat_service.stream_chat("question")]

    import asyncio

    events = asyncio.run(collect())
    assert [event.type for event in events] == ["meta", "token"]
    assert events[0].model == "fallback-model"
    assert events[1].text == "answer"
    assert fallbacks is not None  # configuration is still exposed


def test_stream_does_not_restart_a_partially_delivered_answer(monkeypatch):
    from app.services import chat_service

    class _PartiallyFailingAgent:
        def run_stream(self, *_args, **_kwargs):
            class _Context:
                async def __aenter__(self_inner):
                    class _Result:
                        async def stream_text(self_inner2, delta=True):
                            yield "partial"
                            raise RuntimeError("boom")

                    return _Result()

                async def __aexit__(self_inner, *_exc):
                    return False

            return _Context()

    monkeypatch.setattr(chat_service, "fallback_model_names", ["fallback-model"])
    monkeypatch.setattr(
        chat_service,
        "get_agent",
        lambda name: (
            _PartiallyFailingAgent()
            if name == chat_service.default_model_name
            else _FakeAgent(lambda: (_FakeResult(["should not appear"]), None))
        ),
    )

    async def collect():
        return [event async for event in chat_service.stream_chat("question")]

    import asyncio

    with pytest.raises(RuntimeError):
        asyncio.run(collect())


# ==========================================
# TOOLS
# ==========================================
@pytest.mark.parametrize(
    ("expression", "expected"),
    [("2 + 2", "4"), ("10 / 4", "2.5"), ("sqrt(9)", "3")],
)
def test_calculator_evaluates_expressions(expression, expected):
    from app.tools.calculator import evaluate_expression

    assert evaluate_expression(expression) == expected


@pytest.mark.parametrize(
    "expression",
    ["__import__('os').system('echo hi')", "open('x')", "eval('1')"],
)
def test_calculator_rejects_code_execution(expression):
    from app.tools.calculator import evaluate_expression

    result = evaluate_expression(expression)
    assert "not allowed" in result or "Only direct safe function calls" in result


# ==========================================
# FILE UPLOAD
# ==========================================
def test_upload_rejects_unsupported_extension(client):
    response = client.post(
        "/api/files/upload", files={"file": ("notes.exe", b"MZ", "application/octet-stream")}
    )
    assert response.status_code == 400


def test_upload_strips_directory_traversal_from_filename(client):
    response = client.post(
        "/api/files/upload", files={"file": ("../../escape.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 201
    assert response.json()["filename"] == "escape.txt"
    assert response.json()["extracted_text"] == "hello"


def test_upload_rejects_a_pdf_that_is_not_a_pdf(client):
    response = client.post(
        "/api/files/upload",
        files={"file": ("fake.pdf", b"just text", "application/pdf")},
    )
    assert response.status_code == 422


def test_upload_rejects_empty_files(client):
    response = client.post("/api/files/upload", files={"file": ("empty.txt", b"", "text/plain")})
    assert response.status_code == 400


# ==========================================
# IMAGE EDITING
# ==========================================
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _fake_edited_image():
    from app.services.image_service import EditedImage

    return EditedImage(
        data_url="data:image/png;base64,ZmFrZQ==",
        media_type="image/png",
        model="test-image-model",
    )


def test_image_edit_returns_and_persists_the_result(client, monkeypatch):
    from app.api import images as images_module

    prompts = []

    async def fake_edit(image_bytes, prompt):
        prompts.append(prompt)
        assert image_bytes.startswith(b"\x89PNG")
        return _fake_edited_image()

    monkeypatch.setattr(images_module, "edit_image", fake_edit)

    response = client.post(
        "/api/images/edit",
        files={"image": ("photo.png", PNG_BYTES, "image/png")},
        data={"prompt": "make the sky purple"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["image"].startswith("data:image/png;base64,")
    assert payload["model"] == "test-image-model"
    assert prompts == ["make the sky purple"]

    detail = client.get(f"/api/chat/conversations/{payload['conversation_id']}")
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert "make the sky purple" in messages[0]["content"]
    assert "data:image/png;base64,ZmFrZQ==" in messages[1]["content"]


def test_image_edit_requires_a_prompt(client):
    response = client.post(
        "/api/images/edit",
        files={"image": ("photo.png", PNG_BYTES, "image/png")},
        data={"prompt": "   "},
    )
    assert response.status_code == 400


def test_image_edit_rejects_non_image_payloads(client):
    response = client.post(
        "/api/images/edit",
        files={"image": ("notes.txt", b"this is not an image", "text/plain")},
        data={"prompt": "edit this"},
    )
    assert response.status_code == 400


def test_image_edit_rejects_empty_files(client):
    response = client.post(
        "/api/images/edit",
        files={"image": ("empty.png", b"", "image/png")},
        data={"prompt": "edit this"},
    )
    assert response.status_code == 400


def test_image_edit_reports_missing_upstream_credits(client, monkeypatch):
    from app.api import images as images_module
    from app.services.image_service import ImageEditError

    async def fake_edit(image_bytes, prompt):
        raise ImageEditError("The image model requires credits.", status_code=402)

    monkeypatch.setattr(images_module, "edit_image", fake_edit)

    response = client.post(
        "/api/images/edit",
        files={"image": ("photo.png", PNG_BYTES, "image/png")},
        data={"prompt": "edit this"},
    )
    assert response.status_code == 402
    assert "credits" in response.json()["detail"].lower()


def test_image_edit_requires_authentication(anon_client):
    response = anon_client.post(
        "/api/images/edit",
        files={"image": ("photo.png", PNG_BYTES, "image/png")},
        data={"prompt": "edit this"},
    )
    assert response.status_code == 401
