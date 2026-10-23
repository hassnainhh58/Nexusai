# Security Policy

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately to the maintainers (see the repository owner profile) with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept helps),
- the affected version/commit.

You can expect an acknowledgement within 72 hours. Please allow time for a fix
to be released before disclosing the issue publicly.

## Security model

- Clerk session JWTs are verified against the instance JWKS, with issuer and
  clock-skew checks. Authentication fails closed: a missing or invalid token is
  a `401`, never a shared anonymous identity.
- Every conversation, message and export query is scoped to the authenticated
  user id; cross-user access returns `404`.
- Upstream model names are restricted to an explicit allowlist.
- Uploaded files are size-limited, extension-checked, signature-checked, parsed
  in a temporary file that is always deleted, and never written to a
  user-controlled path.
- Secrets live in `.env` files (gitignored) or the deployment environment. They
  are never committed and never returned by the API.

## Hardening checklist for deployments

- Set `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, `CLERK_JWT_ISSUER` and a
  non-empty `CORS_ORIGINS`.
- Serve over HTTPS (the API sets HSTS in production).
- Keep `LLM_API_KEY`, `CLERK_SECRET_KEY` and `TAVILY_API_KEY` in a secret store.
- Back up the SQLite database (or move to PostgreSQL before scaling out).
