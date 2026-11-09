# Kysely migration

Seme targets **Kysely 0.29.7** (`kysely@^0.29.7` in `apps/api`). Kysely shares
the existing better-sqlite3 handle through `SqliteDialect`, so pragmas, WAL,
sqlite-vec and FTS5 keep working unchanged.

## Rules

- Application reads/writes go through `storage.getKysely()`; multi-statement
  writes use `storage.transact()` so they join the existing write queue.
- Raw SQL is allowed only for: migrations (`schema/schema.ts`), PRAGMAs,
  capability probes, and FTS5 / vec0 virtual tables that have no Kysely builder.
- `src/storage/database.ts` is the single typed schema. Change it in the same
  commit as a migration.
- Do not add new `.prepare(` calls outside the exceptions above.

## Status

Migrated:

- `storage/storage.ts` — Kysely instance, transaction helper
- `storage/database.ts` — typed schema for every table
- `provenance/provenance-store.ts` — entity + relationship provenance, source counts
- `resolver/entity-resolver.ts`, `resolver/relationship-resolver.ts`
- `extraction/pipeline.ts` — entity mention + relationship evidence writes
- `ingestion/source-ingestion.ts` — source, episode and turn inserts
- `api/service.ts` / `server.ts` — provenance endpoints

Remaining raw SQL (rough count of `.prepare(` calls at time of writing):

| Module                 | Calls | Notes                                  |
| ---------------------- | ----: | -------------------------------------- |
| `sleep/`               |    51 | graph dedup, decay, profile repair     |
| `deletion/`            |    30 | cascade deletes                        |
| `api/service.ts`       |    24 | remaining memory/wiki/task handlers    |
| `graph/graph-store.ts` |    24 | async conversion cascades into callers |
| `wiki/`                |    17 | page CRUD + versioning                 |
| `profile/`             |    17 | compiler + versions                    |
| `import/`              |    16 | bundle restore                         |
| `scripts/`             |    15 | seeders (may stay raw)                 |
| `adaptation/`          |    14 | adaptation state                       |
| `ingest/`              |    12 | episode/turn ingest                    |
| `retrieval/`           |    10 | hybrid candidate queries               |
| `kb/`                  |     8 | intelligence queries                   |
| `integrations/`        |     8 | service connections                    |
| `procedures/`          |     7 | SOP CRUD                               |
| `extraction/`          |     2 | memory candidate read in pipeline      |
| `tasks/`               |     6 | task CRUD                              |
| `search/`              |     5 | FTS5 (may stay raw)                    |
| `review/`              |     5 | review queue                           |
| `validation/`          |     3 | evidence lookup                        |
| `identity/`            |     3 | identity core                          |
| `deprecation/`         |     2 | archive sweep                          |
| `evals/`               |    60 | test fixtures (may stay raw)           |

Order: `graph-store` → `wiki`/`profile`/`retrieval` → `sleep`/`deletion` →
remaining CRUD modules. `search/` FTS5 and `scripts/` seeders can remain raw
where Kysely adds no value.
