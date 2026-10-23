# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Conversation search across titles and message contents (`?q=`), with a
  debounced search box in the sidebar.
- Pin/unpin conversations; pinned chats sort first and are marked in the list.
- Edit and resend any earlier user message: the stale answer and later turns
  are removed before the new question is answered.
- Thumbs up/down feedback on assistant replies, stored per message and shown
  after reload.
- Model picker in the header and settings, driven by the authenticated
  `/v1/models` allowlist.
- Voice input in the composer using the Web Speech API (hidden when the
  browser does not support it).
- Relative timestamps, a "jump to latest" control, and automatic scrolling
  that pauses while you read earlier messages.
- Image editing: attach a PNG/JPEG/WEBP and describe the change; the backend
  sends the picture to an image-to-image model (`IMAGE_MODEL`) and stores the
  result in the conversation. Requires provider credits for the image model.
- Document upload in the composer: attach a `.pdf`, `.docx` or `.txt` file, the
  backend validates its type and extracts its text, and the extracted content
  becomes part of the next chat turn (together with the typed question, when
  present).

### Changed

- The assistant is now a general-purpose assistant for any topic (research,
  writing, coding, math, analysis, planning, translation, everyday questions)
  and receives the real current date on every turn, so relative dates and
  "latest" questions are resolved correctly and current facts go through web
  search instead of stale model knowledge.
- Chat messages are no longer capped at 15,000 characters: the full text is
  sent. When a message exceeds the model's context window, the excerpts most
  relevant to the question are kept (instead of an arbitrary prefix) and the
  transcript notes it; very long user messages are collapsed in the UI. A 32 MB
  request-body safety valve protects the process from abuse.

### Fixed

- Live web search now actually activates when `TAVILY_API_KEY` is set in
  `backend/.env`: the tool reads the central Settings object instead of only
  process environment variables, which previously left search unconfigured.
- Conversation and message timestamps are serialised as UTC with an offset, so
  relative times ("just now", "2h ago") render correctly in the browser.
- Request validation failures (HTTP 422) now name the offending field and the
  rule that failed (without echoing the submitted content) and are logged with
  the request id.

## [1.1.0] - 2026-10-23

### Added

- Server-Sent Events protocol (`meta` / `token` / `error` / `done`) with model
  attribution and partial-answer persistence on disconnect.
- Stop generating and regenerate actions in the UI.
- Accessible confirmation dialogs, error boundary, toasts, and keyboard support.
- Conversation pagination, "clear all" action, and last-conversation restore.
- Per-user rate limiting for chat and uploads, upstream request timeouts, and
  request ids on every log line and response (`X-Request-ID`).
- Versioned SQLite migrations, liveness/readiness probes, and a combined
  `/health` report.
- Security headers (nosniff, frame denial, referrer policy, CSP, HSTS in
  production).
- Non-root backend container, nginx-served frontend container, and
  `docker-compose.yml`.
- Frontend unit tests (Vitest), backend coverage tooling, pre-commit hooks,
  Dependabot, issue/PR templates, and project documentation.

### Changed

- Authentication now fails closed: a missing or invalid token is `401` instead
  of a shared `default` user. Legacy `default` conversations can be claimed with
  `backend/scripts/claim_legacy_conversations.py`.
- Chat responses must be model names from the configured allowlist (`422`
  otherwise).
- Conversation export and deletion are scoped to the authenticated owner.
- `POST /api/chat` accepts `regenerate: true` to replace the trailing answer.
- Uploads support `.pdf`, `.docx` and `.txt`; extraction failures return `422`
  instead of an empty success.
- `App.jsx` was split into components, hooks and library modules; the syntax
  highlighter is lazy-loaded and vendor code is split into cached chunks.
- Requirements were split into runtime (`requirements.txt`) and development
  (`requirements-dev.txt`) dependencies.

### Fixed

- Upload path traversal via crafted filenames.
- Export endpoint returning other users' conversations.
- "Clear all" deleting every user's conversations.
- CI Docker build using an incorrect context path.
- Uvicorn access logging being disabled by the logging configuration.
- Clerk tokens rejected because of the missing `aud` claim and clock skew.
- Chats appearing to "not save" in the sidebar after the first message.
- Upstream error text being stored as an assistant message.

## [1.0.0] - 2026-09-15

- Initial release: streaming chat, calculator and web search tools, Clerk
  authentication, SQLite conversation history, dark/light themes.
