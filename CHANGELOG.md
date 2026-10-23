# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Image editing: attach a PNG/JPEG/WEBP and describe the change; the backend
  sends the picture to an image-to-image model (`IMAGE_MODEL`) and stores the
  result in the conversation. Requires provider credits for the image model.
- Document upload in the composer: attach a `.pdf`, `.docx` or `.txt` file, the
  backend validates its type and extracts its text, and the extracted content
  becomes part of the next chat turn (together with the typed question, when
  present).

### Fixed

- Request validation failures (HTTP 422) now name the offending field and the
  rule that failed (without echoing the submitted content) and are logged with
  the request id. The composer also warns before sending a message over the
  15,000 character limit instead of letting the request fail.

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
