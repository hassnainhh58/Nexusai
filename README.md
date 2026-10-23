# NexusAI

A production-minded AI workspace: a React 19 + Vite frontend on top of a
FastAPI backend with streaming chat, tool use (calculator, live web search),
and multi-user conversation history stored in SQLite.

- **Streaming answers** over Server-Sent Events, with stop / regenerate.
- **Authentication by Clerk**, verified server-side against the instance JWKS.
  Authentication fails closed: no token means `401`, and every query is scoped
  to the signed-in user.
- **Model fallback**: if the primary model is unavailable (empty balance,
  provider outage) or leaves a turn unfinished, the next configured model
  answers automatically.
- **Polished UI**: markdown + syntax-highlighted code, dark/light theme, mobile
  sidebar, confirmation dialogs, error recovery.

```
nexusai/
  backend/                       FastAPI service
    app/
      agents/assistant.py        pydantic-ai agent, provider, model allowlist
      api/                       chat, files routers
      core/                      config, auth, logging, rate limiting
      database/db.py             SQLite storage + migrations
      models/                    request/response schemas
      services/                  streaming, history, file extraction
      tools/                     calculator, Tavily web search
    scripts/                     one-off maintenance scripts
    tests/                       pytest suite (isolated temp database)
    requirements.txt             runtime dependencies
    requirements-dev.txt         test/lint dependencies
  frontend/                      React 19 + Vite + Clerk
    src/components/              Sidebar, MessageList, Composer, dialogs, ...
    src/hooks/                   useChat, useConversations, useTheme
    src/lib/                     API client, SSE parser, formatting helpers
    src/*.test.js                Vitest unit tests
  docker-compose.yml             backend + nginx-served frontend
```

## Prerequisites

- Python 3.12+
- Node.js 20+
- An [OpenRouter](https://openrouter.ai) (or any OpenAI-compatible) API key
- A [Clerk](https://clerk.com) application
- Optional: a [Tavily](https://tavily.com) key for live web search

## Setup

### 1. Backend

```powershell
cd G:\nexusai
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt -r backend\requirements-dev.txt
copy backend\.env.example backend\.env   # then fill in the keys
```

### 2. Frontend

```powershell
cd G:\nexusai\frontend
copy .env.example .env.local   # set VITE_CLERK_PUBLISHABLE_KEY
npm install
```

## Running

Terminal 1 — backend:

```powershell
cd G:\nexusai\backend
..\venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```powershell
cd G:\nexusai\frontend
npm run dev
```

Open <http://localhost:5173>. The API docs are at
<http://127.0.0.1:8000/docs>.

`vite.config.js` proxies `/api/*` to `http://127.0.0.1:8000`, so the browser only
makes same-origin requests and CORS does not apply in development. Set
`VITE_API_URL` to call the backend directly instead.

## Configuration

All backend settings are declared in `backend/app/core/config.py` and read from
the environment / `backend/.env`. Production startup fails fast if a required
value is missing.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `production` enables strict validation, disables the localhost CORS regex and adds HSTS. |
| `LOG_LEVEL` | `INFO` | Root log level. |
| `LLM_API_KEY` | — | OpenRouter / OpenAI-compatible key. Required in production. |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | Upstream base URL. |
| `LLM_MODEL` | `x-ai/grok-4.3` | Primary model. |
| `LLM_FALLBACK_MODEL` | — | Comma-separated models tried when the primary fails. |
| `LLM_TIMEOUT_SECONDS` | `90` | Upstream HTTP timeout. |
| `TAVILY_API_KEY` | — | Enables the `web_search` tool. |
| `AUTH_REQUIRED` | `true` | When `true`, every API route requires a valid Clerk token. Only set to `false` for offline local development. |
| `CLERK_JWT_ISSUER` | — | Clerk issuer, e.g. `https://<instance>.clerk.accounts.dev`. Required when auth is enabled. |
| `CLERK_JWT_AUDIENCE` | `clerk` | Checked only when a token carries an `aud` claim. |
| `CORS_ORIGINS` | — | Comma-separated allowed origins (required in production). |
| `NEXUSAI_DB_PATH` | `backend/nexusai.db` | SQLite file location. |
| `MAX_UPLOAD_SIZE_MB` | `10` | Upload limit. |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `30` | Per-user limit for chat/upload. |
| `MAX_HISTORY_TURNS` | `10` | Recent turn pairs sent to the model. |

`CLERK_JWT_ISSUER` is derived from the publishable key:
`base64url("<instance>.clerk.accounts.dev$")`.

### Model allowlist and fallback

Clients may only request models from `LLM_MODEL` + `LLM_FALLBACK_MODEL`;
anything else is rejected with `422`. If the primary model fails (HTTP 402
"insufficient credits", provider outage, ...) or returns an **unfinished turn**
(tool results were retrieved but never turned into an answer), the next model is
tried. A fallback never duplicates an answer that was already partially
streamed.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service information |
| `GET` | `/health` | Combined health report (DB, model, version) |
| `GET` | `/health/live` | Liveness probe (no dependencies) |
| `GET` | `/health/ready` | Readiness probe (DB + configuration) |
| `GET` | `/v1/models` | Allowlisted models (authenticated) |
| `POST` | `/api/chat` | Streaming chat |
| `POST` | `/api/chat/conversations` | Create an empty conversation |
| `GET` | `/api/chat/conversations?limit=&offset=` | Paginated conversation list |
| `GET` | `/api/chat/conversations/{id}` | Conversation with messages |
| `PATCH` | `/api/chat/conversations/{id}` | Rename a conversation |
| `DELETE` | `/api/chat/conversations/{id}` | Delete one conversation |
| `DELETE` | `/api/chat/conversations` | Delete the caller's conversations |
| `GET` | `/api/chat/conversations/{id}/export` | Export as Markdown |
| `POST` | `/api/files/upload` | Extract text from `.pdf`, `.docx` or `.txt` |

Every `/api/*` and `/v1/*` route requires
`Authorization: Bearer <clerk-session-token>`. Conversations are scoped to the
token's `sub`; accessing another user's conversation returns `404`.

### Streaming protocol

`POST /api/chat` responds with `text/event-stream` and the conversation id in
the `X-Conversation-ID` header:

```
event: meta
data: {"model":"x-ai/grok-4.3"}

event: token
data: {"text":"Hello"}

event: done
data: {"conversation_id":42,"model":"x-ai/grok-4.3"}
```

An `error` event reports an upstream failure. Errors are never persisted as
assistant messages. Send `{"conversation_id": 42, "regenerate": true}` to
replace the trailing assistant reply instead of appending a new turn.

## Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production bundle into `frontend/dist` |
| `npm run lint` | oxlint |
| `npm run test` | Vitest unit tests (SSE parser, helpers) |
| `python -m pytest` | Backend tests (`backend/`) |
| `python -m pytest --cov=app` | Tests with coverage |
| `python -m ruff check .` | Backend lint |
| `python -m ruff format .` | Backend formatting |

The backend test suite runs against a temporary database (`NEXUSAI_DB_PATH`),
so it never touches development data.

## Docker

```powershell
cd G:\nexusai
docker compose up --build
```

- Frontend: <http://localhost:8080> (nginx serves the bundle and proxies `/api`)
- Backend: <http://localhost:8000>

Set `VITE_CLERK_PUBLISHABLE_KEY` in the environment and provide
`backend/.env` with `LLM_API_KEY`, `CLERK_JWT_ISSUER` and `CORS_ORIGINS`.
The backend runs as a non-root user with a persistent `/data` volume.

Backend image alone:

```powershell
cd G:\nexusai\backend
docker build -t nexusai-backend:latest .
docker run --rm -p 8000:8000 --env-file .env -v nexusai-data:/data nexusai-backend:latest
```

## Maintenance

When authentication became mandatory, conversations created before multi-user
support (`user_id = 'default'`) became invisible. Assign them to their owner:

```powershell
cd G:\nexusai\backend
python scripts\claim_legacy_conversations.py --email you@example.com            # dry run
python scripts\claim_legacy_conversations.py --email you@example.com --apply    # writes + backup
```

The schema is versioned with `PRAGMA user_version` and migrations in
`app/database/db.py` run at startup.

## Troubleshooting

**`'vite' is not recognized`** — the `node_modules/.bin` shims are missing.
Stop the dev server and run `npm install` (on Windows, stop it before `npm ci`
so native bindings are not locked).

**CORS error in the browser** — requests must go through the Vite proxy
(`/api/...`). If you call the backend directly, add the origin to
`CORS_ORIGINS`.

**`401 Unauthorized` on every request** — the Clerk token could not be
verified. Check `CLERK_JWT_ISSUER`, that the frontend and backend use the same
Clerk instance, and that `AUTH_REQUIRED` matches your setup.

**The answer is empty / `Upstream model error`** — the provider rejected the
request. The most common cause is an exhausted OpenRouter balance (HTTP 402);
top up at <https://openrouter.ai/settings/credits>. With
`LLM_FALLBACK_MODEL` configured, a free model answers automatically.

**`The search results were retrieved but the model did not turn them into an
answer`** — the model announced a tool call and stopped. The backend retries
with the next model; switch `LLM_FALLBACK_MODEL` to a model that handles tool
results well (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`).

**`connect ECONNREFUSED 127.0.0.1:8000`** — the backend is not running. Check
<http://127.0.0.1:8000/health/live>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
