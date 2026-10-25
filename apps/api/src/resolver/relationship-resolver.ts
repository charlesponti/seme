// src/resolver/relationship-resolver.ts — Relationship resolution (KG-4)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { RelationshipCandidate } from '../extraction/entity-extractor.js';

export interface RelationshipResolution {
  decision: 'ADD' | 'MERGE' | 'NOOP';
  relationship_id: string;
  target_id: string | null;
  decided_by: 'rule' | 'model';
  rule_id: string | null;
}

export class RelationshipResolver {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async resolve(candidate: RelationshipCandidate, sourceEpisodeId?: string): Promise<RelationshipResolution> {
    const now = nowUtc();
    const relationshipId = uuid();

    // Resolve entity names to IDs
    const sourceEntity = this.findEntity(candidate.source_entity_name);
    const targetEntity = this.findEntity(candidate.target_entity_name);

    if (!sourceEntity || !targetEntity) {
      // Entities not found — cannot create relationship
      return {
        decision: 'ADD',
        relationship_id: relationshipId,
        target_id: null,
        decided_by: 'rule',
        rule_id: 'rule_0_entities_not_found',
      };
    }

    const sourceId = sourceEntity.id;
    const targetId = targetEntity.id;

    // Find existing relationships: same source_id + target_id + relation_type
    const neighbours = this.findNeighbours(sourceId, targetId, candidate.relation_type);

    // Try rules in order
    let decision: RelationshipResolution['decision'] = 'ADD';
    let targetRelationshipId: string | null = null;
    let ruleId: string | null = null;
    let decidedBy: 'rule' | 'model' = 'rule';

    // Rule 1: NOOP — same source, target, type, no new info
    for (const n of neighbours) {
      if (this.isNoop(candidate, n)) {
        decision = 'NOOP';
        targetRelationshipId = n.id;
        ruleId = 'rule_1_noop';
        break;
      }
    }

    // Rule 2: MERGE — same source, target, type, new evidence
    if (decision === 'ADD') {
      for (const n of neighbours) {
        if (this.isMerge(candidate, n)) {
          decision = 'MERGE';
          targetRelationshipId = n.id;
          ruleId = 'rule_2_merge';
          break;
        }
      }
    }

    // Rule 3: ADD — new relationship (different source/target/type) — default

    // Execute decision
    if (decision === 'ADD') {
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO relationships (id, source_id, target_id, relation_type, description, weight, first_seen_at, last_seen_at, mention_count, confidence, source_type, source_turn_id, source_episode_id, valid_from, valid_to)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          relationshipId, sourceId, targetId, candidate.relation_type, candidate.description,
          1.0, now, now, 1, candidate.confidence, candidate.source_type, candidate.source_turn_id,
          sourceEpisodeId || '', now, null
        );
      });
    } else if (decision === 'MERGE' && targetRelationshipId) {
      await this.storage.write((db: any) => {
        const incumbent = db.prepare('SELECT * FROM relationships WHERE id = ?').get(targetRelationshipId) as any;
        if (incumbent) {
          const newMentionCount = incumbent.mention_count + 1;
          // Weight calculation: 1.0 - (1.0 / mention_count)
          const newWeight = Math.min(1.0, 1.0 - (1.0 / newMentionCount));
          const newConfidence = Math.max(incumbent.confidence, candidate.confidence);
          const newDescription = candidate.description && candidate.description.length > (incumbent.description || '').length
            ? candidate.description
            : incumbent.description;

          db.prepare(`
            UPDATE relationships SET
              description = ?,
              last_seen_at = ?,
              mention_count = ?,
              weight = ?,
              confidence = ?
            WHERE id = ?
          `).run(newDescription, now, newMentionCount, newWeight, newConfidence, targetRelationshipId);
        }
      });
    }
    // NOOP: do nothing

    return {
      decision,
      relationship_id: decision === 'ADD' ? relationshipId : (targetRelationshipId || relationshipId),
      target_id: targetRelationshipId,
      decided_by: decidedBy,
      rule_id: ruleId,
    };
  }

  private findEntity(name: string): any {
    return this.storage.read((db: any) => {
      // Find by canonical name (case-insensitive)
      const byName = db.prepare('SELECT * FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1').get(name) as any;
      if (byName) return byName;
      // Find by alias match
      const byAlias = db.prepare('SELECT * FROM entities WHERE aliases IS NOT NULL AND aliases LIKE ? LIMIT 1').get(`%"${name}"%`) as any;
      return byAlias || null;
    });
  }

  private findNeighbours(sourceId: string, targetId: string, relationType: string): any[] {
    return this.storage.read((db: any) => {
      return db.prepare(`
        SELECT * FROM relationships
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
        ORDER BY last_seen_at DESC LIMIT 5
      `).all(sourceId, targetId, relationType) as any[];
    });
  }

  private isNoop(candidate: RelationshipCandidate, incumbent: any): boolean {
    // Same source, target, type, no new info
    if (incumbent.relation_type !== candidate.relation_type) return false;
    // No new description
    if (candidate.description && candidate.description.length > (incumbent.description || '').length) return false;
    // No higher confidence
    if (candidate.confidence > incumbent.confidence) return false;
    return true;
  }

  private isMerge(candidate: RelationshipCandidate, incumbent: any): boolean {
    // Same source, target, type, new evidence
    if (incumbent.relation_type !== candidate.relation_type) return false;
    // New description or higher confidence
    if (candidate.description && candidate.description.length > (incumbent.description || '').length) return true;
    if (candidate.confidence > incumbent.confidence) return true;
    return false;
  }
}