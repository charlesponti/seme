# Seme Monorepo

Self-healing memory system for AI companions. Local-first, single-user, SQLite-backed.

## Structure

```
apps/
├── api/          # Seme backend (Hono + SQLite + TypeScript)
└── web/          # TanStack Start web dashboard (React + Tailwind)
```

## Quick Start

### 1. Start the API server

```bash
npm run dev:api
# or: cd apps/api && npm run dev
```

The API runs on port 3000 by default.

### 2. Start the web dashboard

```bash
npm run dev:web
# or: cd apps/web && npm run dev
```

The web app runs on port 5173 by default.

### 3. Open the dashboard

Visit http://localhost:5173 in your browser.

## Environment Variables

- `SEME_STORAGE_DIR` — Storage directory (default: `~/.hominem`)
- `SEME_API_URL` / `VITE_SEME_API_URL` — API URL for the web app (default: `http://localhost:3000`)
- `OPENROUTER_API_KEY` — OpenRouter API key for LLM extraction

## Building

```bash
npm run build  # Builds both api and web
```

## Testing

```bash
cd apps/api
node dist/evals/system-eval.js
node dist/evals/extraction-eval.js
```