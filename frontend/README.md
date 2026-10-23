# NexusAI frontend

React 19 + Vite frontend for the NexusAI workspace.

See the [project README](../README.md) for setup and troubleshooting.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server on <http://localhost:5173> |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Preview the production bundle |
| `npm run lint` | oxlint |
| `npm run test` | Vitest unit tests |

## Structure

- `src/App.jsx` — layout and orchestration
- `src/components/` — sidebar, message list, composer, dialogs, error boundary
- `src/hooks/` — chat streaming, conversation list, theme
- `src/lib/` — API client (Clerk token + 401 retry), SSE parser, formatting

The backend streams Server-Sent Events (`meta` / `token` / `error` / `done`);
`src/lib/sse.js` parses them and is covered by unit tests.

## Environment

Copy `.env.example` to `.env.local`:

- `VITE_CLERK_PUBLISHABLE_KEY` — required, Clerk publishable key
- `VITE_API_URL` — optional, absolute backend URL. Leave empty to use the Vite
  dev proxy (`/api` -> `http://127.0.0.1:8000`), which avoids CORS entirely.
