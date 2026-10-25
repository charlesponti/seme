// src/import/data-import.ts — Restore from export bundle

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface ImportResult {
  imported: {
    memories: number;
    turns: number;
    episodes: number;
    entities: number;
    relationships: number;
  };
  skipped: number;
  errors: string[];
}

export class DataImport {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  importBundle(bundle: any, strategy: 'skip' | 'overwrite' | 'merge' = 'skip'): ImportResult {
    const result: ImportResult = {
      imported: { memories: 0, turns: 0, episodes: 0, entities: 0, relationships: 0 },
      skipped: 0,
      errors: [],
    };

    const db = this.storage.getDb();

    // Import episodes first (FK dependency)
    if (Array.isArray(bundle.episodes)) {
      for (const ep of bundle.episodes) {
        try {
          const existing = db.prepare('SELECT id FROM episodes WHERE id = ?').get(ep.id);
          if (existing && strategy === 'skip') { result.skipped++; continue; }
          if (existing && strategy === 'overwrite') {
            db.prepare('DELETE FROM episodes WHERE id = ?').run(ep.id);
          }
          db.prepare(`
            INSERT OR REPLACE INTO episodes (id, session_id, started_at, ended_at, summary, summary_version, user_affect_tags, agent_behaviour_tags, extractor_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(ep.id, ep.session_id, ep.started_at, ep.ended_at || null, ep.summary || null, ep.summary_version || null, ep.user_affect_tags || null, ep.agent_behaviour_tags || null, ep.extractor_version || null);
          result.imported.episodes++;
        } catch (e: any) {
          result.errors.push(`Episode ${ep.id}: ${e.message}`);
        }
      }
    }

    // Import turns
    if (Array.isArray(bundle.turns)) {
      for (const turn of bundle.turns) {
        try {
          const existing = db.prepare('SELECT id FROM turns WHERE id = ?').get(turn.id);
          if (existing && strategy === 'skip') { result.skipped++; continue; }
          if (existing && strategy === 'overwrite') {
            db.prepare('DELETE FROM turns WHERE id = ?').run(turn.id);
          }
          db.prepare(`
            INSERT OR REPLACE INTO turns (id, episode_id, session_id, role, content, ts)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(turn.id, turn.episode_id, turn.session_id, turn.role, turn.content, turn.ts);
          result.imported.turns++;
        } catch (e: any) {
          result.errors.push(`Turn ${turn.id}: ${e.message}`);
        }
      }
    }

    // Import memories
    if (Array.isArray(bundle.memories)) {
      for (const mem of bundle.memories) {
        try {
          const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(mem.id);
          if (existing && strategy === 'skip') { result.skipped++; continue; }
          if (existing && strategy === 'overwrite') {
            db.prepare('DELETE FROM memories WHERE id = ?').run(mem.id);
          }
          db.prepare(`
            INSERT OR REPLACE INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote, source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned, valid_from, valid_to, observed_at, recorded_at, superseded_at, superseded_by_id, supersedes_id, last_reinforced_at, last_accessed_at, reinforcement_count, access_count, status, extractor_version, decay_class)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            mem.id, mem.kind, mem.slot || null, mem.subject, mem.predicate, mem.value_text, mem.value_json || null, mem.evidence_quote, mem.source_turn_id, mem.source_episode_id, mem.source_type, mem.modality, mem.confidence, mem.importance, mem.pinned || 0, mem.valid_from || null, mem.valid_to || null, mem.observed_at, mem.recorded_at, mem.superseded_at || null, mem.superseded_by_id || null, mem.supersedes_id || null, mem.last_reinforced_at || null, mem.last_accessed_at || null, mem.reinforcement_count || 0, mem.access_count || 0, mem.status, mem.extractor_version, mem.decay_class
          );
          result.imported.memories++;
        } catch (e: any) {
          result.errors.push(`Memory ${mem.id}: ${e.message}`);
        }
      }
    }

    // Import entities
    if (Array.isArray(bundle.entities)) {
      for (const ent of bundle.entities) {
        try {
          const existing = db.prepare('SELECT id FROM entities WHERE id = ?').get(ent.id);
          if (existing && strategy === 'skip') { result.skipped++; continue; }
          if (existing && strategy === 'overwrite') {
            db.prepare('DELETE FROM entities WHERE id = ?').run(ent.id);
          }
          db.prepare(`
            INSERT OR REPLACE INTO entities (id, name, type, aliases, description, first_seen_at, last_seen_at, mention_count, confidence, source_type, profile_included, pinned)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(ent.id, ent.name, ent.type, JSON.stringify(ent.aliases || []), ent.description || null, ent.first_seen_at, ent.last_seen_at, ent.mention_count || 1, ent.confidence, ent.source_type, ent.profile_included || 0, ent.pinned || 0);
          result.imported.entities++;
        } catch (e: any) {
          result.errors.push(`Entity ${ent.id}: ${e.message}`);
        }
      }
    }

    // Import relationships
    if (Array.isArray(bundle.relationships)) {
      for (const rel of bundle.relationships) {
        try {
          const existing = db.prepare('SELECT id FROM relationships WHERE id = ?').get(rel.id);
          if (existing && strategy === 'skip') { result.skipped++; continue; }
          if (existing && strategy === 'overwrite') {
            db.prepare('DELETE FROM relationships WHERE id = ?').run(rel.id);
          }
          db.prepare(`
            INSERT OR REPLACE INTO relationships (id, source_id, target_id, relation_type, description, weight, first_seen_at, last_seen_at, mention_count, confidence, source_type, source_turn_id, source_episode_id, valid_from, valid_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(rel.id, rel.source_id, rel.target_id, rel.relation_type, rel.description || null, rel.weight || 1.0, rel.first_seen_at, rel.last_seen_at, rel.mention_count || 1, rel.confidence, rel.source_type, rel.source_turn_id, rel.source_episode_id, rel.valid_from || null, rel.valid_to || null);
          result.imported.relationships++;
        } catch (e: any) {
          result.errors.push(`Relationship ${rel.id}: ${e.message}`);
        }
      }
    }

    // Import profile
    if (bundle.profile) {
      try {
        db.prepare('INSERT OR REPLACE INTO profile (id, rendered_text, source_memory_ids, version, updated_at) VALUES (?, ?, ?, ?, ?)').run('singleton', bundle.profile.rendered_text, bundle.profile.source_memory_ids || '[]', bundle.profile.version || 1, bundle.profile.updated_at || nowUtc());
      } catch (e: any) {
        result.errors.push(`Profile: ${e.message}`);
      }
    }

    return result;
  }
}
