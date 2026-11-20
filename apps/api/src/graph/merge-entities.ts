// src/graph/merge-entities.ts — fold one entity into another, atomically.
//
// Memories keep a free-text `subject`, so they are not rewritten here. Only
// rows that reference the entity by id move: relationships (and their evidence),
// entity_memory_links, entity_turn_links, wiki_pages and kb_tasks.entity_ids.

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface MergeEntitiesResult {
  from_id: string;
  into_id: string;
  relationships_moved: number;
  relationships_merged: number;
  self_loops_dropped: number;
  memory_links_moved: number;
  turn_links_moved: number;
  wiki_pages_moved: number;
}

export class MergeEntitiesError extends Error {
  constructor(
    message: string,
    readonly code: 'ERR_VALIDATION' | 'ERR_NOT_FOUND',
  ) {
    super(message);
  }
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export async function mergeEntities(
  storage: Storage,
  fromId: string,
  intoId: string,
): Promise<MergeEntitiesResult> {
  if (fromId === intoId) {
    throw new MergeEntitiesError('Cannot merge an entity into itself', 'ERR_VALIDATION');
  }

  return storage.write((db) => {
    const from = db.prepare('SELECT * FROM entities WHERE id = ?').get(fromId) as any;
    const into = db.prepare('SELECT * FROM entities WHERE id = ?').get(intoId) as any;
    if (!from) throw new MergeEntitiesError(`Entity not found: ${fromId}`, 'ERR_NOT_FOUND');
    if (!into) throw new MergeEntitiesError(`Entity not found: ${intoId}`, 'ERR_NOT_FOUND');
    if (from.is_self === 1) {
      throw new MergeEntitiesError(
        'Cannot merge the self entity away; merge the other entity into it instead',
        'ERR_VALIDATION',
      );
    }

    const now = nowUtc();
    const result: MergeEntitiesResult = {
      from_id: fromId,
      into_id: intoId,
      relationships_moved: 0,
      relationships_merged: 0,
      self_loops_dropped: 0,
      memory_links_moved: 0,
      turn_links_moved: 0,
      wiki_pages_moved: 0,
    };

    // Relationships: drop edges that become self-loops, repoint the rest, then
    // collapse duplicates on (source, target, relation_type).
    const dropRel = (id: string) => {
      db.prepare('DELETE FROM relationship_sources WHERE relationship_id = ?').run(id);
      db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
    };
    const loops = db
      .prepare(
        `SELECT id FROM relationships
         WHERE (source_id = @f AND target_id IN (@f, @i)) OR (source_id = @i AND target_id = @f)`,
      )
      .all({ f: fromId, i: intoId }) as { id: string }[];
    for (const r of loops) dropRel(r.id);
    result.self_loops_dropped = loops.length;

    result.relationships_moved =
      db.prepare('UPDATE relationships SET source_id = ? WHERE source_id = ?').run(intoId, fromId)
        .changes +
      db.prepare('UPDATE relationships SET target_id = ? WHERE target_id = ?').run(intoId, fromId)
        .changes;

    const dupGroups = db
      .prepare(
        `SELECT source_id, target_id, relation_type FROM relationships
         WHERE source_id = @i OR target_id = @i
         GROUP BY source_id, target_id, relation_type HAVING COUNT(*) > 1`,
      )
      .all({ i: intoId }) as { source_id: string; target_id: string; relation_type: string }[];
    for (const g of dupGroups) {
      const rows = db
        .prepare(
          `SELECT * FROM relationships
           WHERE source_id = ? AND target_id = ? AND relation_type = ?
           ORDER BY mention_count DESC, confidence DESC, first_seen_at ASC`,
        )
        .all(g.source_id, g.target_id, g.relation_type) as any[];
      const keep = rows[0];
      for (const dup of rows.slice(1)) {
        db.prepare(
          `INSERT OR IGNORE INTO relationship_sources
             (relationship_id, turn_id, source_id, evidence_quote, created_at)
           SELECT ?, turn_id, source_id, evidence_quote, created_at
           FROM relationship_sources WHERE relationship_id = ?`,
        ).run(keep.id, dup.id);
        db.prepare(
          `UPDATE relationships SET
             mention_count = mention_count + ?,
             confidence = MAX(confidence, ?),
             weight = MAX(weight, ?),
             first_seen_at = MIN(first_seen_at, ?),
             last_seen_at = MAX(last_seen_at, ?)
           WHERE id = ?`,
        ).run(
          dup.mention_count,
          dup.confidence,
          dup.weight,
          dup.first_seen_at,
          dup.last_seen_at,
          keep.id,
        );
        dropRel(dup.id);
        result.relationships_merged++;
      }
    }

    // Composite-PK link tables: copy over what doesn't collide, then drop the rest.
    result.memory_links_moved = db
      .prepare(
        `INSERT OR IGNORE INTO entity_memory_links (entity_id, memory_id, role, created_at)
         SELECT ?, memory_id, role, created_at FROM entity_memory_links WHERE entity_id = ?`,
      )
      .run(intoId, fromId).changes;
    db.prepare('DELETE FROM entity_memory_links WHERE entity_id = ?').run(fromId);

    result.turn_links_moved = db
      .prepare(
        `INSERT OR IGNORE INTO entity_turn_links
           (entity_id, turn_id, mention_text, role, created_at, source_id, evidence_quote)
         SELECT ?, turn_id, mention_text, role, created_at, source_id, evidence_quote
         FROM entity_turn_links WHERE entity_id = ?`,
      )
      .run(intoId, fromId).changes;
    db.prepare('DELETE FROM entity_turn_links WHERE entity_id = ?').run(fromId);

    result.wiki_pages_moved = db
      .prepare('UPDATE wiki_pages SET entity_id = ?, entity_name = ? WHERE entity_id = ?')
      .run(intoId, into.name, fromId).changes;

    // kb_tasks keep entity ids in a JSON array.
    const tasks = db
      .prepare('SELECT id, entity_ids FROM kb_tasks WHERE entity_ids LIKE ?')
      .all(`%${fromId}%`) as { id: string; entity_ids: string }[];
    for (const t of tasks) {
      const ids = [...new Set(parseList(t.entity_ids).map((e) => (e === fromId ? intoId : e)))];
      db.prepare('UPDATE kb_tasks SET entity_ids = ? WHERE id = ?').run(JSON.stringify(ids), t.id);
    }

    // Fold the entity row itself.
    const aliases: string[] = [];
    const seen = new Set<string>([into.name.toLowerCase()]);
    for (const a of [...parseList(into.aliases), from.name, ...parseList(from.aliases)]) {
      const k = a.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      aliases.push(a.trim());
    }
    const description =
      (from.description || '').length > (into.description || '').length
        ? from.description
        : into.description;
    db.prepare(
      `UPDATE entities SET
         aliases = ?, description = ?,
         mention_count = mention_count + ?,
         confidence = MAX(confidence, ?),
         first_seen_at = MIN(first_seen_at, ?),
         last_seen_at = MAX(last_seen_at, ?),
         first_seen_turn_id = COALESCE(first_seen_turn_id, ?),
         first_seen_source_id = COALESCE(first_seen_source_id, ?)
       WHERE id = ?`,
    ).run(
      JSON.stringify(aliases),
      description,
      from.mention_count,
      from.confidence,
      from.first_seen_at,
      from.last_seen_at,
      from.first_seen_turn_id,
      from.first_seen_source_id,
      intoId,
    );
    db.prepare('DELETE FROM entities WHERE id = ?').run(fromId);

    db.prepare(
      `INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
       VALUES (?, ?, 'manual_merge', 'merge', ?, ?, ?, ?, 0)`,
    ).run(
      uuid(),
      now,
      JSON.stringify([]),
      JSON.stringify({ from, into }),
      JSON.stringify(result),
      `Merged entity ${from.name} (${fromId}) into ${into.name} (${intoId})`,
    );

    return result;
  });
}
