# Seme monorepo — agent guide

Seme is a local-first, single-user memory engine for AI companions. SQLite-backed.

- `apps/api` — Hono on Node, Kysely + better-sqlite3, sqlite-vec for embeddings.
- `apps/web` — TanStack Start dashboard (React, Tailwind). Design spec: `docs/ui-redesign-spec.md`. It is authoritative and wins over any older design doc.

## Running things

- API: `cd apps/api && npx portless api.seme npm run dev` → `https://api.seme.lvh.me` (health: `/health`).
- Web: `cd apps/web && npx portless web.seme npm run dev` → `https://web.seme.lvh.me`. The web dev server proxies `/api` to the API for its worktree (see `apps/web/vite.config.ts`).
- Worktrees get their own URLs with a branch prefix (e.g. `portless-wt.api.seme.lvh.me`).
- **Restart the API without asking** whenever it needs one. Stop the old process chain by PID (never a broad `pkill -f`). Start it with the command above and check `/health`.

## Storage

- Main checkout: `~/.hominem` (the real store). `SEME_STORAGE_DIR` overrides it.
- Git worktrees: `~/.hominem/worktrees/<branch>`, set by `apps/api/scripts/dev.mjs`.
- Experiments go in an isolated `SEME_STORAGE_DIR` on a different port, never the real store.
- Back up the real store (`sqlite3 ~/.hominem/memory.db ".backup '<file>'"`) before any write to it, and get a yes before writing to it.
- Forgetting a memory (`POST /memory/forget`) soft-deletes it to a `deleted` tombstone. Hard-deleting needs better-sqlite3 with sqlite-vec loaded. The `sqlite3` CLI has no FTS5, so it can't touch `memories_fts`.

## Ingestion and extraction

- Text submissions are saved as episodes in `user` mode. URL and PDF sources are `document` mode.
- `document` mode only yields entities for document content. Running user statements through it returns nothing. Don't re-run user text in `document` mode.
- Each submission runs extraction in the background (`runSourceExtraction` in `apps/api/src/api/service.ts`).
- Live progress: `GET /ingest/episodes/:id/status` reports the current stage and counts. It's held in memory, so a restart forgets it and returns 404.

## Validation rules

- A memory needs non-empty `value_text`, `subject` and `predicate`. The gate rejects it, and so do `rememberCommand` and `correctMemory`. `/memory/remember` returns 400 `ERR_VALIDATION`.
- Don't write rows that skip these checks, from a script or a migration.

## Checks before calling work done

- API: `cd apps/api && npx tsc` (must pass).
- Web: `cd apps/web && npm run typecheck`.
- Repo: `npm run lint` and `npm run format:check`.
- Anything that touches the real store or the live API: say what you ran and what you saw.

## Git

- Commit and push only when asked. Branch off `main` for PRs.
- Don't add attribution lines to commit messages or PR descriptions.
