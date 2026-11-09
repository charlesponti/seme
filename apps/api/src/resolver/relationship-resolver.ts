// src/resolver/relationship-resolver.ts — Relationship resolution (KG-4)

import { sql, type SqlBool } from 'kysely';
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

  async resolve(
    candidate: RelationshipCandidate,
    sourceEpisodeId?: string,
  ): Promise<RelationshipResolution> {
    const now = nowUtc();
    const relationshipId = uuid();

    const sourceEntity = await this.findEntity(candidate.source_entity_name);
    const targetEntity = await this.findEntity(candidate.target_entity_name);

    if (!sourceEntity || !targetEntity) {
      // Entities not found — nothing can be created (never report a phantom ADD)
      return {
        decision: 'NOOP',
        relationship_id: relationshipId,
        target_id: null,
        decided_by: 'rule',
        rule_id: 'rule_0_entities_not_found',
      };
    }

    const sourceId = sourceEntity.id;
    const targetId = targetEntity.id;

    const neighbours = await this.findNeighbours(sourceId, targetId, candidate.relation_type);

    let decision: RelationshipResolution['decision'] = 'ADD';
    let targetRelationshipId: string | null = null;
    let ruleId: string | null = null;
    const decidedBy: 'rule' | 'model' = 'rule';

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

    if (decision === 'ADD') {
      await this.storage
        .getKysely()
        .insertInto('relationships')
        .values({
          id: relationshipId,
          source_id: sourceId,
          target_id: targetId,
          relation_type: candidate.relation_type,
          description: candidate.description,
          weight: 1.0,
          first_seen_at: now,
          last_seen_at: now,
          mention_count: 1,
          confidence: candidate.confidence,
          source_type: candidate.source_type,
          source_turn_id: candidate.source_turn_id,
          source_episode_id: sourceEpisodeId || '',
          valid_from: now,
          valid_to: null,
          source_document_id: candidate.source_id,
          evidence_quote: candidate.evidence_quote,
        })
        .execute();
    } else if (decision === 'MERGE' && targetRelationshipId) {
      await this.storage.transact(async (trx) => {
        const incumbent = await trx
          .selectFrom('relationships')
          .selectAll()
          .where('id', '=', targetRelationshipId!)
          .executeTakeFirst();
        if (!incumbent) return;

        const newMentionCount = incumbent.mention_count + 1;
        const newWeight = Math.min(1.0, 1.0 - 1.0 / newMentionCount);
        const newConfidence = Math.max(incumbent.confidence, candidate.confidence);
        const newDescription =
          candidate.description &&
          candidate.description.length > (incumbent.description || '').length
            ? candidate.description
            : incumbent.description;

        await trx
          .updateTable('relationships')
          .set({
            description: newDescription,
            last_seen_at: now,
            mention_count: newMentionCount,
            weight: newWeight,
            confidence: newConfidence,
            source_document_id: incumbent.source_document_id ?? candidate.source_id,
            evidence_quote: incumbent.evidence_quote ?? candidate.evidence_quote,
          })
          .where('id', '=', targetRelationshipId!)
          .execute();
      });
    }
    // NOOP: do nothing

    return {
      decision,
      relationship_id: decision === 'ADD' ? relationshipId : targetRelationshipId || relationshipId,
      target_id: targetRelationshipId,
      decided_by: decidedBy,
      rule_id: ruleId,
    };
  }

  private async findEntity(name: string): Promise<any> {
    const db = this.storage.getKysely();
    const byName = await db
      .selectFrom('entities')
      .selectAll()
      .where(sql<SqlBool>`LOWER(name) = LOWER(${name})`)
      .limit(1)
      .executeTakeFirst();
    if (byName) return byName;

    return (
      (await db
        .selectFrom('entities')
        .selectAll()
        .where('aliases', 'like', `%"${name}"%`)
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  }

  private async findNeighbours(
    sourceId: string,
    targetId: string,
    relationType: string,
  ): Promise<any[]> {
    return this.storage
      .getKysely()
      .selectFrom('relationships')
      .selectAll()
      .where('source_id', '=', sourceId)
      .where('target_id', '=', targetId)
      .where('relation_type', '=', relationType)
      .orderBy('last_seen_at', 'desc')
      .limit(5)
      .execute();
  }

  private isNoop(candidate: RelationshipCandidate, incumbent: any): boolean {
    if (incumbent.relation_type !== candidate.relation_type) return false;
    if (
      candidate.description &&
      candidate.description.length > (incumbent.description || '').length
    )
      return false;
    if (candidate.confidence > incumbent.confidence) return false;
    return true;
  }

  private isMerge(candidate: RelationshipCandidate, incumbent: any): boolean {
    if (incumbent.relation_type !== candidate.relation_type) return false;
    if (
      candidate.description &&
      candidate.description.length > (incumbent.description || '').length
    )
      return true;
    if (candidate.confidence > incumbent.confidence) return true;
    return false;
  }
}
