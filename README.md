# Seme — Self-Healing Memory for AI Companions

A local-first, single-user long-term memory system for companion chat applications. It learns what is true about its user from conversation — facts, preferences, routines, boundaries — and keeps that knowledge correct over time.

## What it does

- **Learns from conversation** — extracts atomic claims from closed sessions
- **Self-heals** — new statements supersede old ones; near-duplicates merge instead of piling up
- **Provenance-first** — every belief traces back to the exact user utterance it came from
- **Confidence decay** — memories fade over time based on decay class; boundaries never decay
- **Profile compilation** — derived profile recompiled from active memories
- **Retrieval** — per-turn context assembly with hybrid search (vector + FTS5)
- **Deletion cascade** — forget removes content from all stores, logs redacted
- **Sleep job** — periodic consolidation, dedup, contradiction resolution

## Architecture

- **Storage:** Single SQLite file with sqlite-vec (vector search) and FTS5 (full-text search)
- **Language:** TypeScript (Node.js)
- **No external services** — everything runs locally

## Quick start

```bash
npm install
npm run build
node dist/index.js
```

## V1-tonight operations

1. `record_turn` — append a turn to a session
2. `end_session` — close session, trigger extraction
3. `retrieve_context` — get context block for a probe turn
4. `remember_command` — explicit "remember this"
5. `forget_command` — explicit forget with cascade
6. `boundary_command` — explicit boundary statement
7. `get_profile` — current compiled profile

## Project structure

```
src/
├── types/common.ts          — Shared types and enums
├── storage/storage.ts       — SQLite storage layer
├── schema/schema.ts         — All DDL
├── confidence/confidence.ts — Confidence, decay, promotion
├── identity/identity-core.ts — Immutable identity core
├── ingest/ingest.ts         — Turn capture, sessions, episodes
├── validation/validation-gate.ts — Deterministic provenance gate
├── resolver/resolver.ts     — ADD/MERGE/SUPERSEDE/NOOP
├── profile/profile-compiler.ts — Profile compilation
├── retrieval/retrieval.ts   — Context assembly
└── api/service.ts           — Service API
```

## License

MIT

## Author

Charles Ponti / Ponti Studios