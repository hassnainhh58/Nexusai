# Contributing

Thanks for taking the time to improve NexusAI.

## Setup

```powershell
# Backend
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt -r backend\requirements-dev.txt

# Frontend
cd frontend
npm install
```

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to
`frontend/.env.local`, then fill in the keys. Neither file is committed.

## Quality gates

Run these before opening a pull request (CI runs the same checks):

```powershell
cd backend
python -m ruff check .
python -m ruff format --check .
python -m pytest

cd ..\frontend
npm run lint
npm run test
npm run build
```

`pre-commit install` wires the backend formatters into every commit.

## Guidelines

- Keep the existing structure: routers in `app/api`, business logic in
  `app/services`, persistence in `app/database`.
- Every new API route must authenticate and scope data by `current_user.id`.
- Never persist or log secrets, tokens, or upstream error bodies that contain
  provider details.
- Add a test for new behaviour. Backend tests use a temporary SQLite database.
- Keep user-visible strings in sentence case and explain errors in plain
  language.
- One logical change per pull request; describe it with the PR template.

## Commit messages

Use the imperative mood and a short summary:

```
fix: scope conversation export to the owner
feat: add regenerate action to the assistant reply
docs: document the streaming event format
```

## Reporting bugs

Open an issue with the bug report template. Include the request id from the
`X-Request-ID` response header when the problem involves the API.
