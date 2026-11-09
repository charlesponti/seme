// Eval runs and baselines live in one SQLite file outside the repo: ~/.hominem/seme.evals.db
// by default, SEME_EVALS_DB overrides it. Nothing here writes into git.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HistoryEntry {
  ts: string;
  pass_rate: number | null;
  entity_f1: number | null;
  memory_recall: number | null;
  relation_f1: number | null;
  cases: number;
  repeats: number;
  judge: boolean;
  seme_skills?: string;
}

export interface BaselineData {
  meta?: Record<string, unknown>;
  metrics: Record<string, number | null>;
}

export function evalsDbPath(): string {
  return process.env.SEME_EVALS_DB || join(homedir(), '.hominem', 'seme.evals.db');
}

/** Folder for the eval database and the generated HTML and Markdown reports. */
export function evalsHome(): string {
  return dirname(evalsDbPath());
}

export function openEvalsDb(path = evalsDbPath()): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('full', 'filter')),
      ts TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_kind_ts ON runs (kind, ts);
    CREATE TABLE IF NOT EXISTS baselines (
      name TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
  `);
  return db;
}

interface RunResult {
  meta: {
    ts: string;
    cases: number;
    repeats: number;
    judge_model: string | null;
    config?: { seme_skills?: string };
  };
  metrics: Record<string, number | null>;
}

export function saveRun(
  db: Database.Database,
  id: string,
  kind: 'full' | 'filter',
  result: RunResult,
): void {
  const m = result.metrics;
  const summary: HistoryEntry = {
    ts: result.meta.ts,
    pass_rate: m.pass_rate ?? null,
    entity_f1: m.entity_f1 ?? null,
    memory_recall: m.memory_recall ?? null,
    relation_f1: m.relation_f1 ?? null,
    cases: result.meta.cases,
    repeats: result.meta.repeats,
    judge: result.meta.judge_model !== null,
    seme_skills: result.meta.config?.seme_skills,
  };
  db.prepare(
    'INSERT OR REPLACE INTO runs (id, kind, ts, summary_json, result_json) VALUES (?, ?, ?, ?, ?)',
  ).run(id, kind, result.meta.ts, JSON.stringify(summary), JSON.stringify(result));
}

/** The last `limit` full runs, oldest first. */
export function recentHistory(db: Database.Database, limit = 100): HistoryEntry[] {
  const rows = db
    .prepare("SELECT summary_json FROM runs WHERE kind = 'full' ORDER BY ts DESC LIMIT ?")
    .all(limit) as { summary_json: string }[];
  return rows.map((r) => JSON.parse(r.summary_json) as HistoryEntry).reverse();
}

export function saveBaseline(
  db: Database.Database,
  name: string,
  data: BaselineData & { meta: Record<string, unknown> },
): void {
  db.prepare('INSERT OR REPLACE INTO baselines (name, ts, data_json) VALUES (?, ?, ?)').run(
    name,
    String(data.meta.ts ?? new Date().toISOString()),
    JSON.stringify(data),
  );
}

export function loadBaseline(db: Database.Database, name: string): BaselineData | null {
  const row = db.prepare('SELECT data_json FROM baselines WHERE name = ?').get(name) as
    | { data_json: string }
    | undefined;
  return row ? (JSON.parse(row.data_json) as BaselineData) : null;
}

export function listBaselines(db: Database.Database): { name: string; ts: string }[] {
  return db.prepare('SELECT name, ts FROM baselines ORDER BY ts DESC').all() as {
    name: string;
    ts: string;
  }[];
}
