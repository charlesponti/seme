// Runs one case end to end: a fresh store, the real ingest path, the real
// extraction pipeline, then reads back what that episode produced.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '../../api/service.js';
import type { Case, Turn } from './dataset.js';
import type { PredEntity, PredMemory, PredOutput, PredRelation, SourceTurn } from './grade.js';

export async function runCase(
  c: Case,
  storageRoot: string,
): Promise<{ pred: PredOutput; latencyMs: number }> {
  const dir = mkdtempSync(join(storageRoot, `${c.id}-`));
  const svc = new MemoryService({ storageDir: dir, embeddingDim: 1024 }) as any;
  const started = Date.now();
  let db: Database.Database | null = null;
  try {
    let episodeId: string;
    if (c.mode === 'conversation') {
      const sessionId = `eval-${c.id}`;
      for (const t of c.input as Turn[]) {
        await svc.recordTurn(sessionId, t.role, t.content);
      }
      // IngestManager.endSession closes the episode without starting extraction;
      // the harness awaits the pipeline itself so results are ready when it returns.
      const ended = await svc.ingest.endSession(sessionId);
      episodeId = ended.episode_id;
    } else {
      const sourceType = c.mode === 'document' ? 'document' : 'text';
      const ingested = await svc.sourceIngestion.ingestText(
        c.input as string,
        `eval ${c.id}`,
        `eval-${c.id}`,
        sourceType,
      );
      episodeId = ingested.episode_id;
    }
    await svc.extractionPipeline.run(episodeId);
    const latencyMs = Date.now() - started;

    db = new Database(join(dir, 'memory.db'), { readonly: true });
    const pred = readEpisode(db, episodeId);
    return { pred, latencyMs };
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function readEpisode(db: Database.Database, episodeId: string): PredOutput {
  const turns = db
    .prepare('SELECT id, role, content FROM turns WHERE episode_id = ? ORDER BY ts')
    .all(episodeId) as SourceTurn[];
  const turnIds = turns.map((t) => t.id);
  const inEpisode = turnIds.length ? `(${turnIds.map(() => '?').join(',')})` : '(NULL)';

  // Entities: anything linked to a turn of this episode, one per name.
  const entityRows = db
    .prepare(
      `SELECT e.name AS name, e.type AS type, l.evidence_quote AS evidence_quote, l.turn_id AS turn_id
         FROM entity_turn_links l JOIN entities e ON e.id = l.entity_id
        WHERE l.turn_id IN ${inEpisode}`,
    )
    .all(...turnIds) as {
    name: string;
    type: string;
    evidence_quote: string | null;
    turn_id: string | null;
  }[];
  const seenEntity = new Set<string>();
  const entities: PredEntity[] = [];
  for (const r of entityRows) {
    const key = r.name.toLowerCase();
    if (seenEntity.has(key)) continue;
    seenEntity.add(key);
    entities.push({
      name: r.name,
      type: r.type,
      evidence_quote: r.evidence_quote,
      turn_id: r.turn_id,
    });
  }

  // Relations created from this episode (only stated claims are stored as edges).
  const relations = db
    .prepare(
      `SELECT s.name AS source, t.name AS target, r.relation_type AS relation_type,
              r.evidence_quote AS evidence_quote, r.source_turn_id AS turn_id
         FROM relationships r
         JOIN entities s ON s.id = r.source_id
         JOIN entities t ON t.id = r.target_id
        WHERE r.source_episode_id = ?`,
    )
    .all(episodeId) as PredRelation[];

  const memories = db
    .prepare(
      `SELECT predicate, subject, kind, modality, value_text, evidence_quote, source_turn_id AS turn_id, source_episode_id AS episode_id
         FROM memories WHERE source_episode_id = ? AND status = 'active'`,
    )
    .all(episodeId) as PredMemory[];

  const feedback = db
    .prepare('SELECT COUNT(*) AS n FROM feedback_events WHERE episode_id = ?')
    .get(episodeId) as { n: number };

  return {
    entities,
    relations,
    memories,
    feedback_events: feedback.n,
    turns,
    episode_id: episodeId,
  };
}
