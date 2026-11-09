// src/resolver/entity-resolver.ts — Entity resolution (KG-3)

import { sql, type SqlBool } from 'kysely';
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

    const neighbours = await this.findNeighbours(candidate);

    let decision: EntityResolution['decision'] = 'ADD';
    let targetId: string | null = null;
    let ruleId: string | null = null;
    const decidedBy: 'rule' | 'model' = 'rule';

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

    if (decision === 'ADD') {
      await this.storage
        .getKysely()
        .insertInto('entities')
        .values({
          id: entityId,
          name: candidate.name,
          type: candidate.type,
          aliases: JSON.stringify(candidate.aliases),
          description: candidate.description,
          first_seen_at: now,
          last_seen_at: now,
          mention_count: 1,
          confidence: candidate.confidence,
          source_type: candidate.source_type,
          profile_included: 0,
          pinned: 0,
          first_seen_turn_id: candidate.source_turn_id,
          first_seen_source_id: candidate.source_id,
        })
        .execute();
    } else if (decision === 'MERGE' && targetId) {
      await this.storage.transact(async (trx) => {
        const incumbent = await trx
          .selectFrom('entities')
          .selectAll()
          .where('id', '=', targetId!)
          .executeTakeFirst();
        if (!incumbent) return;

        const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
        const newAliases = [...new Set([...existingAliases, ...candidate.aliases])];
        const newMentionCount = incumbent.mention_count + 1;
        const newConfidence = Math.max(incumbent.confidence, candidate.confidence);
        const newDescription =
          candidate.description &&
          candidate.description.length > (incumbent.description || '').length
            ? candidate.description
            : incumbent.description;

        await trx
          .updateTable('entities')
          .set({
            aliases: JSON.stringify(newAliases),
            description: newDescription,
            last_seen_at: now,
            mention_count: newMentionCount,
            confidence: newConfidence,
            first_seen_turn_id: incumbent.first_seen_turn_id ?? candidate.source_turn_id,
            first_seen_source_id: incumbent.first_seen_source_id ?? candidate.source_id,
          })
          .where('id', '=', targetId!)
          .execute();
      });
    }
    // NOOP: do nothing

    return {
      decision,
      entity_id: decision === 'ADD' ? entityId : targetId || entityId,
      target_id: targetId,
      decided_by: decidedBy,
      rule_id: ruleId,
    };
  }

  private async findNeighbours(candidate: EntityCandidate): Promise<any[]> {
    const db = this.storage.getKysely();
    const sameName = await db
      .selectFrom('entities')
      .selectAll()
      .where(sql<SqlBool>`LOWER(name) = LOWER(${candidate.name})`)
      .orderBy('last_seen_at', 'desc')
      .limit(5)
      .execute();

    const aliasMatch = await db
      .selectFrom('entities')
      .selectAll()
      .where('aliases', 'like', `%"${candidate.name}"%`)
      .orderBy('last_seen_at', 'desc')
      .limit(5)
      .execute();

    const seen = new Set<string>();
    const combined: any[] = [];
    for (const e of [...sameName, ...aliasMatch]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      combined.push(e);
    }
    return combined.slice(0, 5);
  }

  private isNoop(candidate: EntityCandidate, incumbent: any): boolean {
    const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
    const aliasMatch = existingAliases.some(
      (a: string) => a.toLowerCase() === candidate.name.toLowerCase(),
    );

    const sameName = incumbent.name.toLowerCase() === candidate.name.toLowerCase() || aliasMatch;
    if (!sameName) return false;
    if (incumbent.type !== candidate.type) return false;
    const newAliases = candidate.aliases.filter((a) => !existingAliases.includes(a));
    if (newAliases.length > 0) return false;
    if (candidate.confidence > incumbent.confidence) return false;
    if (
      candidate.description &&
      candidate.description.length > (incumbent.description || '').length
    )
      return false;
    return true;
  }

  private isMerge(candidate: EntityCandidate, incumbent: any): boolean {
    const existingAliases = incumbent.aliases ? JSON.parse(incumbent.aliases) : [];
    const aliasMatch = existingAliases.some(
      (a: string) => a.toLowerCase() === candidate.name.toLowerCase(),
    );

    const sameName = incumbent.name.toLowerCase() === candidate.name.toLowerCase() || aliasMatch;
    if (!sameName) return false;
    if (incumbent.type !== candidate.type) return false;
    const newAliases = candidate.aliases.filter((a) => !existingAliases.includes(a));
    if (newAliases.length > 0) return true;
    if (candidate.confidence > incumbent.confidence) return true;
    if (
      candidate.description &&
      candidate.description.length > (incumbent.description || '').length
    )
      return true;
    if (aliasMatch && candidate.name.toLowerCase() !== incumbent.name.toLowerCase()) return true;
    return false;
  }
}
