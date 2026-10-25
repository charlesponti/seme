// src/resolver/entity-resolver.ts — Entity resolution (KG-3)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { EntityCandidate } from '../extraction/entity-extractor.js';

export interface EntityResolution {
  decision: 'ADD' | 'MERGE' | 'NOOP';
  entity_id: string;
  target_id: string | null;
  decided_by: 'rule' | 'model';
  rule_id: string | null;
}

export class EntityResolver {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async resolve(candidate: EntityCandidate): Promise<EntityResolution> {
    const now = nowUtc();
    const entityId = uuid();

    // Find neighbours: same name or alias match
    const neighbours = this.findNeighbours(candidate);

    // Try rules in order
    let decision: EntityResolution['decision'] = 'ADD';
    let targetId: string | null = null;
    let ruleId: string | null = null;
    let decidedBy: 'rule' | 'model' = 'rule';

    // Rule 1: NOOP — same canonical name + type, no new info
    for (const n of neighbours) {
      if (this.isNoop(candidate, n)) {
        decision = 'NOOP';
        targetId = n.id;
        ruleId = 'rule_1_noop';
        break;
      }
    }

    // Rule 2: MERGE — same canonical name, new aliases or higher confidence
    if (decision === 'ADD') {
      for (const n of neighbours) {
        if (this.isMerge(candidate, n)) {
          decision = 'MERGE';
          targetId = n.id;
          ruleId = 'rule_2_merge';
          break;
        }
      }
    }

    // Rule 3: ADD — new entity (different name or type) — default

    // Execute decision
    if (decision === 'ADD') {
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO entities (id, name, type, aliases, description, first_seen_at, last_seen_at, mention_count, confidence, source_type, profile_included, pinned)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entityId, candidate.name, candidate.type, JSON.stringify(candidate.aliases),
          candidate.description, now, now, 1, candidate.confidence, candidate.source_type,
          0, 0
        );
      });
    } else if (decision === 'MERGE' && targetId) {
      await this.storage.write((db: any) => {
        const incumbent = db.prepare('SELECT * FROM entities WHERE id = ?').get(targetId) as any;
        if (incumbent) {
          // Merge aliases
          const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
          const newAliases = [...new Set([...existingAliases, ...candidate.aliases])];

          // Update mention_count, last_seen_at, confidence
          const newMentionCount = incumbent.mention_count + 1;
          const newConfidence = Math.max(incumbent.confidence, candidate.confidence);
          const newDescription = candidate.description && candidate.description.length > (incumbent.description || '').length
            ? candidate.description
            : incumbent.description;

          db.prepare(`
            UPDATE entities SET
              aliases = ?,
              description = ?,
              last_seen_at = ?,
              mention_count = ?,
              confidence = ?
            WHERE id = ?
          `).run(
            JSON.stringify(newAliases), newDescription, now, newMentionCount, newConfidence, targetId
          );
        }
      });
    }
    // NOOP: do nothing

    return {
      decision,
      entity_id: decision === 'ADD' ? entityId : (targetId || entityId),
      target_id: targetId,
      decided_by: decidedBy,
      rule_id: ruleId,
    };
  }

  private findNeighbours(candidate: EntityCandidate): any[] {
    return this.storage.read((db: any) => {
      // Find by canonical name (case-insensitive)
      const sameName = db.prepare(`
        SELECT * FROM entities WHERE LOWER(name) = LOWER(?) ORDER BY last_seen_at DESC LIMIT 5
      `).all(candidate.name) as any[];

      // Find by alias match
      const aliasMatch = db.prepare(`
        SELECT * FROM entities WHERE aliases IS NOT NULL AND aliases LIKE ? ORDER BY last_seen_at DESC LIMIT 5
      `).all(`%"${candidate.name}"%`) as any[];

      // Combine and deduplicate
      const seen = new Set<string>();
      const combined: any[] = [];
      for (const e of [...sameName, ...aliasMatch]) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        combined.push(e);
      }
      return combined.slice(0, 5);
    });
  }

  private isNoop(candidate: EntityCandidate, incumbent: any): boolean {
    // Alias match: if candidate name matches an incumbent alias, it's a merge (not noop)
    const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
    const aliasMatch = existingAliases.some((a: string) => a.toLowerCase() === candidate.name.toLowerCase());

    // Same canonical name + type, no new info
    const sameName = incumbent.name.toLowerCase() === candidate.name.toLowerCase() || aliasMatch;
    if (!sameName) return false;
    if (incumbent.type !== candidate.type) return false;
    // No new aliases
    const newAliases = candidate.aliases.filter(a => !existingAliases.includes(a));
    if (newAliases.length > 0) return false;
    // No higher confidence
    if (candidate.confidence > incumbent.confidence) return false;
    // No new description
    if (candidate.description && candidate.description.length > (incumbent.description || '').length) return false;
    return true;
  }

  private isMerge(candidate: EntityCandidate, incumbent: any): boolean {
    // Alias match: if candidate name matches an incumbent alias, it's a merge
    const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
    const aliasMatch = existingAliases.some((a: string) => a.toLowerCase() === candidate.name.toLowerCase());

    // Same canonical name or alias match
    const sameName = incumbent.name.toLowerCase() === candidate.name.toLowerCase() || aliasMatch;
    if (!sameName) return false;
    // Different type → not a merge (different entity)
    if (incumbent.type !== candidate.type) return false;
    // New aliases or higher confidence
    const newAliases = candidate.aliases.filter(a => !existingAliases.includes(a));
    if (newAliases.length > 0) return true;
    if (candidate.confidence > incumbent.confidence) return true;
    if (candidate.description && candidate.description.length > (incumbent.description || '').length) return true;
    // Alias match itself is a merge (new mention under different name)
    if (aliasMatch && candidate.name.toLowerCase() !== incumbent.name.toLowerCase()) return true;
    return false;
  }
}