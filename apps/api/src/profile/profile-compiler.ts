// src/profile/profile-compiler.ts — Profile compiler (07-profile-compiler.md)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { isCoreEligible } from '../confidence/confidence.js';
import { GraphStore } from '../graph/graph-store.js';

export class ProfileCompiler {
  private storage: Storage;
  private graphStore: GraphStore;

  constructor(storage: Storage, graphStore?: GraphStore) {
    this.storage = storage;
    this.graphStore = graphStore || new GraphStore(storage);
  }

  async compile(reason: string, triggeringMemoryIds: string[]): Promise<{ version: number; status: string }> {
    const now = nowUtc();

    // Get active memories that are profile-included (slotted) OR unslotted active memories
    const profileMemories = this.storage.read((db) => {
      return db.prepare(`
        SELECT m.* FROM memories m
        LEFT JOIN slot_registry s ON m.slot = s.slot
        WHERE m.status = 'active' AND (s.profile_included = 1 OR m.slot IS NULL)
        ORDER BY m.confidence DESC, m.reinforcement_count DESC
      `).all() as any[];
    });

    // Also get boundary memories (always included)
    const boundaryMemories = this.storage.read((db) => {
      return db.prepare(`
        SELECT * FROM memories WHERE status = 'active' AND kind = 'boundary'
        ORDER BY confidence DESC
      `).all() as any[];
    });

    // Combine and deduplicate
    const allMemories = [...profileMemories, ...boundaryMemories];
    const uniqueIds = new Set(allMemories.map(m => m.id));
    const uniqueMemories = allMemories.filter(m => uniqueIds.has(m.id));
    // Deduplicate
    const seen = new Set<string>();
    const deduped = uniqueMemories.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Build rendered text
    const lines: string[] = [];
    lines.push('## Profile');
    for (const m of deduped) {
      if (m.kind === 'decision') {
        lines.push(`- Decision: ${m.value_text}`);
      } else if (m.kind === 'reference') {
        lines.push(`- Reference: ${m.value_text}`);
      } else if (m.kind === 'anti_pattern') {
        lines.push(`- Avoid: ${m.value_text}`);
      } else {
        lines.push(`- ${m.subject} ${m.predicate}: ${m.value_text}`);
      }
    }

    // Add entity-centric sections from knowledge graph
    const profileEntities = this.graphStore.listEntities(undefined, undefined, 100, 0).entities.filter(e => e.profile_included === 1);
    if (profileEntities.length > 0) {
      lines.push('');
      lines.push('## Entities');
      for (const e of profileEntities) {
        lines.push(`- ${e.name} (${e.type}) — mentioned ${e.mention_count} times`);
      }

      // Relationships between profile-included entities
      const profileEntityIds = new Set(profileEntities.map(e => e.id));
      const snapshot = this.graphStore.getGraphSnapshot();
      const profileRels = snapshot.relationships.filter(r =>
        profileEntityIds.has(r.source_id) && profileEntityIds.has(r.target_id)
      );
      if (profileRels.length > 0) {
        lines.push('');
        lines.push('## Relationships');
        for (const r of profileRels) {
          const src = snapshot.entities.find(e => e.id === r.source_id);
          const tgt = snapshot.entities.find(e => e.id === r.target_id);
          lines.push(`- ${src?.name || r.source_id} -> ${r.relation_type} -> ${tgt?.name || r.target_id}`);
        }
      }
    }

    const renderedText = lines.join('\n');
    const sourceIds = deduped.map(m => m.id);

    // Get current version
    const currentVersion = this.storage.read((db) => {
      const row = db.prepare('SELECT MAX(version) as v FROM profile_versions').get() as { v: number | null };
      return row?.v || 0;
    });

    const newVersion = currentVersion + 1;

    // Check for large diff (hold if > 20% change or > 160 tokens)
    const currentProfile = this.storage.read((db) => {
      return db.prepare('SELECT rendered_text FROM profile WHERE id = ?').get('singleton') as { rendered_text: string } | undefined;
    });

    let status = 'published';
    if (currentProfile) {
      const oldTokens = currentProfile.rendered_text.split(/\s+/).length;
      const newTokens = renderedText.split(/\s+/).length;
      const diff = Math.abs(newTokens - oldTokens);
      const pctChange = oldTokens > 0 ? diff / oldTokens : 1;
      if (pctChange > 0.20 || diff > 160) {
        status = 'held';
      }
    }

    // Write profile and version
    await this.storage.write((db) => {
      // Update or insert profile (only if published)
      if (status === 'published') {
        const existing = db.prepare('SELECT id FROM profile WHERE id = ?').get('singleton');
        if (existing) {
          db.prepare(`
            UPDATE profile SET rendered_text = ?, source_memory_ids = ?, version = ?, updated_at = ?
            WHERE id = 'singleton'
          `).run(renderedText, JSON.stringify(sourceIds), newVersion, now);
        } else {
          db.prepare(`
            INSERT INTO profile (id, rendered_text, source_memory_ids, version, updated_at)
            VALUES ('singleton', ?, ?, ?, ?)
          `).run(renderedText, JSON.stringify(sourceIds), newVersion, now);
        }
      }

      // Always write version record
      db.prepare(`
        INSERT INTO profile_versions (id, version, status, rendered_text, diff_text, reason, triggering_memory_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), newVersion, status, renderedText, null, reason, JSON.stringify(triggeringMemoryIds), now);

      // If held, create review item
      if (status === 'held') {
        db.prepare(`
          INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at)
          VALUES (?, 'held_profile', ?, ?, 'pending', ?)
        `).run(
          uuid(),
          JSON.stringify({ version: newVersion, reason, diff_summary: `Profile change held: ${Math.abs(renderedText.split(/\s+/).length - (currentProfile?.rendered_text.split(/\s+/).length || 0))} token diff` }),
          JSON.stringify(triggeringMemoryIds),
          now
        );
      }

      // Write healing_log
      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'profile_recompile', ?, ?, ?, ?, 0)
      `).run(uuid(), now, 'profile_compiler', JSON.stringify(triggeringMemoryIds), null, JSON.stringify({ version: newVersion, status }), `Profile recompile: ${reason}`);
    });

    return { version: newVersion, status };
  }

  async publishHeld(version: number): Promise<{ published: boolean }> {
    const held = this.storage.read((db: any) => {
      return db.prepare('SELECT * FROM profile_versions WHERE version = ? AND status = ?').get(version, 'held') as any;
    });
    if (!held) return { published: false };

    await this.storage.write((db: any) => {
      // Update profile singleton
      const existing = db.prepare('SELECT id FROM profile WHERE id = ?').get('singleton');
      if (existing) {
        db.prepare(`
          UPDATE profile SET rendered_text = ?, source_memory_ids = ?, version = ?, updated_at = ?
          WHERE id = 'singleton'
        `).run(held.rendered_text, held.triggering_memory_ids, version, nowUtc());
      } else {
        db.prepare(`
          INSERT INTO profile (id, rendered_text, source_memory_ids, version, updated_at)
          VALUES ('singleton', ?, ?, ?, ?)
        `).run(held.rendered_text, held.triggering_memory_ids, version, nowUtc());
      }

      // Mark version as published
      db.prepare("UPDATE profile_versions SET status = 'published' WHERE version = ?").run(version);

      // Log
      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'profile_recompile', ?, ?, ?, ?, 0)
      `).run(uuid(), nowUtc(), 'profile_compiler', held.triggering_memory_ids, null, JSON.stringify({ version, status: 'published' }), `Published held profile v${version}`, 0);
    });

    return { published: true };
  }

  getProfile(): { profile_text: string; profile_version: number; compiled_at: string; source_memory_ids: string[] } {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM profile WHERE id = ?').get('singleton') as any);
    if (!row) {
      return { profile_text: '', profile_version: 0, compiled_at: '', source_memory_ids: [] };
    }
    return {
      profile_text: row.rendered_text,
      profile_version: row.version,
      compiled_at: row.updated_at,
      source_memory_ids: JSON.parse(row.source_memory_ids),
    };
  }
}