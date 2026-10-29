// Sync stored migration checksums with the current schema SQL, then let the
// server apply any pending migrations. Safe because migrations are ordered and
// the stored rows only record what was applied — the SQL is the source of truth.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import * as schema from '../schema/schema.js';

const DB_PATH = process.env.SEME_DB || `${process.env.HOME}/.hominem/memory.db`;

const migrations: { version: number; sql: string }[] = [
  { version: 1, sql: schema.SCHEMA_SQL },
  { version: 2, sql: schema.getSchemaSqlV2() },
  { version: 3, sql: schema.getSchemaSqlV3() },
  { version: 4, sql: schema.getSchemaSqlV4() },
  { version: 5, sql: schema.getSchemaSqlV5() },
  { version: 6, sql: schema.getSchemaSqlV6() },
  { version: 7, sql: schema.getSchemaSqlV7() },
  { version: 8, sql: schema.getSchemaSqlV8() },
  { version: 9, sql: schema.getSchemaSqlV9() },
  { version: 10, sql: schema.getSchemaSqlV10() },
];

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
const appliedVersions = new Set(applied.map((r) => r.version));
console.log('Applied versions:', [...appliedVersions].sort((a, b) => a - b).join(', '));

const update = db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?');
let synced = 0;
for (const m of migrations) {
  if (!appliedVersions.has(m.version)) continue;
  const checksum = createHash('sha256').update(m.sql).digest('hex');
  update.run(checksum, m.version);
  synced++;
}
console.log(`Synced ${synced} checksums`);

const remaining = db
  .prepare('SELECT version FROM schema_migrations ORDER BY version')
  .all() as { version: number }[];
console.log('Stored versions now:', remaining.map((r) => r.version).join(', '));
db.close();
