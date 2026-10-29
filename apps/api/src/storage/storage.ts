// src/storage/storage.ts — SQLite storage layer (01-storage-sqlite.md)

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { SCHEMA_SQL, getVecTableSql, getSchemaSqlV2, getSchemaSqlV3, getSchemaSqlV4, getSchemaSqlV5, getSchemaSqlV6, getSchemaSqlV7, getSchemaSqlV8, getSchemaSqlV9, getSchemaSqlV10 } from '../schema/schema.js';
import { uuid, nowUtc } from '../types/common.js';
import { createHash } from 'node:crypto';

export interface StorageConfig {
  storageDir: string;
  embeddingDim: number;
  sleepLogPath?: string;
}

export class Storage {
  private db: Database.Database;
  private storageDir: string;
  private embeddingDim: number;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(config: StorageConfig) {
    this.storageDir = config.storageDir;
    this.embeddingDim = config.embeddingDim;

    // Ensure storage dir exists
    const fs = require('fs');
    if (!fs.existsSync(config.storageDir)) {
      fs.mkdirSync(config.storageDir, { recursive: true });
    }

    // Capability probes before opening
    this.probeCapabilities();

    // Open database
    const dbPath = `${config.storageDir}/memory.db`;
    this.db = new Database(dbPath);

    // Apply pragmas
    this.applyPragmas();

    // Load sqlite-vec
    sqliteVec.load(this.db);

    // Verify extensions
    this.verifyExtensions();

    // Run migrations (placeholder - will be populated)
    this.runMigrations();

    // memories_vec is dimension-dependent, so it lives outside the migration
    // chain and is ensured idempotently at every open.
    this.ensureVecTable();
  }

  private ensureVecTable(): void {
    this.db.exec(getVecTableSql(this.embeddingDim));
  }

  private probeCapabilities(): void {
    const scratch = new Database(':memory:');
    try {
      scratch.exec('CREATE VIRTUAL TABLE _fts_probe USING fts5(content)');
      scratch.exec("INSERT INTO _fts_probe VALUES ('test')");
      const ftsResult = scratch.prepare("SELECT * FROM _fts_probe WHERE _fts_probe MATCH 'test'").all();
      if (ftsResult.length === 0) throw new Error('FTS5 probe failed');

      sqliteVec.load(scratch);
      scratch.prepare('SELECT vec_version()').get();

      scratch.close();
    } catch (e) {
      scratch.close();
      throw new Error(`Capability probe failed: ${e}`);
    }
  }

  private applyPragmas(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('wal_autocheckpoint = 1000');
    this.db.pragma('cache_size = -64000'); // 64MB page cache (negative = KB)
  }

  private verifyExtensions(): void {
    // Verify sqlite-vec is loaded
    try {
      this.db.prepare('SELECT vec_version()').get();
    } catch {
      throw new Error('sqlite-vec not available');
    }

    // Verify FTS5
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts_check USING fts5(content)');
      this.db.exec('DROP TABLE _fts_check');
    } catch {
      throw new Error('FTS5 not available');
    }
  }

  private runMigrations(): void {
    // Create migration bookkeeping tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  TEXT NOT NULL,
        checksum    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Check embedding_dim
    const meta = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'embedding_dim'").get() as { value: string } | undefined;
    if (meta) {
      if (parseInt(meta.value) !== this.embeddingDim) {
        throw new Error(`Embedding dimension mismatch: stored=${meta.value}, configured=${this.embeddingDim}`);
      }
    } else {
      // First run - record embedding_dim
      this.db.prepare("INSERT INTO schema_meta (key, value) VALUES ('embedding_dim', ?)").run(String(this.embeddingDim));
      this.db.prepare("INSERT INTO schema_meta (key, value) VALUES ('created_at', ?)").run(nowUtc());
      this.db.prepare("INSERT INTO schema_meta (key, value) VALUES ('file_format', 'self-healing-memory/1')").run();
    }

    // Apply migrations
    const migrations = this.getMigrations();
    const applied = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
    const appliedVersions = new Set(applied.map(r => r.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        // Verify checksum
        const stored = this.db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(migration.version) as { checksum: string };
        if (stored.checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for version ${migration.version}`);
        }
        continue;
      }

      // Check no downgrade
      const maxApplied = applied.length > 0 ? Math.max(...applied.map(r => r.version)) : 0;
      if (migration.version <= maxApplied && !appliedVersions.has(migration.version)) {
        // This shouldn't happen if migrations are sequential
      }

      // Apply migration in transaction (with optional FK disable)
      const needsFkDisable = (migration as any).disableForeignKeys;
      if (needsFkDisable) {
        this.db.pragma('foreign_keys = OFF');
      }
      try {
        const txn = this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(
            migration.version, migration.name, nowUtc(), migration.checksum
          );
        });
        txn();
      } finally {
        if (needsFkDisable) {
          this.db.pragma('foreign_keys = ON');
        }
      }
    }
  }

  private getMigrations(): Array<{ version: number; name: string; sql: string; checksum: string; disableForeignKeys?: boolean }> {
    // v1 must be dimension-agnostic so its checksum is stable when the
    // embedding dimension changes. memories_vec is created separately at
    // startup with the runtime dimension (see ensureVecTable).
    const v1Sql = SCHEMA_SQL;
    const v2Sql = getSchemaSqlV2();
    const v3Sql = getSchemaSqlV3();
    const v4Sql = getSchemaSqlV4();
    const v5Sql = getSchemaSqlV5();
    const v6Sql = getSchemaSqlV6();
    const v7Sql = getSchemaSqlV7();
    const v8Sql = getSchemaSqlV8();
    const v9Sql = getSchemaSqlV9();
    const v10Sql = getSchemaSqlV10();
    return [
      { version: 1, name: 'initial_schema', sql: v1Sql, checksum: createHash('sha256').update(v1Sql).digest('hex') },
      { version: 2, name: 'expand_memory_kinds', sql: v2Sql, checksum: createHash('sha256').update(v2Sql).digest('hex'), disableForeignKeys: true },
      { version: 3, name: 'knowledge_graph_tables', sql: v3Sql, checksum: createHash('sha256').update(v3Sql).digest('hex') },
      { version: 4, name: 'knowledge_wiki_tables', sql: v4Sql, checksum: createHash('sha256').update(v4Sql).digest('hex') },
      { version: 5, name: 'source_ingestion_table', sql: v5Sql, checksum: createHash('sha256').update(v5Sql).digest('hex') },
      { version: 6, name: 'kb_tasks_table', sql: v6Sql, checksum: createHash('sha256').update(v6Sql).digest('hex') },
      { version: 7, name: 'procedures_table', sql: v7Sql, checksum: createHash('sha256').update(v7Sql).digest('hex') },
      { version: 8, name: 'integrations_table', sql: v8Sql, checksum: createHash('sha256').update(v8Sql).digest('hex') },
      { version: 9, name: 'remove_entity_type_constraint', sql: v9Sql, checksum: createHash('sha256').update(v9Sql).digest('hex'), disableForeignKeys: true },
      { version: 10, name: 'source_type_free_form', sql: v10Sql, checksum: createHash('sha256').update(v10Sql).digest('hex'), disableForeignKeys: true },
    ];
  }

  // Write path: serialised via write queue
  async write<T>(fn: (db: Database.Database) => T): Promise<T> {
    const result = this.writeQueue.then(() => {
      const txn = this.db.transaction(() => fn(this.db));
      return txn();
    });
    this.writeQueue = result.then(() => {}, () => {});
    return result;
  }

  // Read access
  read<T>(fn: (db: Database.Database) => T): T {
    return fn(this.db);
  }

  // Checkpoint for backup
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  // Integrity check
  integrityCheck(): string {
    const result = this.db.pragma('integrity_check') as { integrity_check: string }[];
    return result[0]?.integrity_check ?? 'unknown';
  }

  foreignKeyCheck(): unknown[] {
    return this.db.pragma('foreign_key_check') as unknown[];
  }

  close(): void {
    this.db.close();
  }

  getDb(): Database.Database {
    return this.db;
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  getEmbeddingDim(): number {
    return this.embeddingDim;
  }
}