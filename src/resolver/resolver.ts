// src/resolver/resolver.ts — Resolver (06-resolver.md)

import { Storage } from '../storage/storage.js';
import { consultModel, loadApiKey } from './model-resolver.js';
import { PromotionManager } from './promotion.js';
import { uuid, nowUtc, Memory } from '../types/common.js';
import { ValidationGate, Candidate as VGCandidate } from '../validation/validation-gate.js';
import { effectiveConfidence, initialConfidence, kForSource, reinforceConfidence, getContradictionPenalty, isPromotableToActive } from '../confidence/confidence.js';

export interface Resolution {
  decision: 'ADD' | 'MERGE' | 'SUPERSEDE' | 'NOOP' | 'STAYS_CANDIDATE';
  candidate_id: string;
  target_id: string | null;
  decided_by: 'rule' | 'model';
  rule_id: string | null;
  healing_log_id: string;
}

export class Resolver {
  private storage: Storage;
  private promotionManager: PromotionManager;

  constructor(storage: Storage) {
    this.storage = storage;
    this.promotionManager = new PromotionManager(storage);
  }

  async resolve(candidate: VGCandidate): Promise<Resolution> {
    const now = nowUtc();
    const candidateId = uuid(); // The candidate doesn't have an ID yet; we'll use this for the new memory

    // Find neighbours (up to 5 active memories, same slot first)
    const neighbours = this.findNeighbours(candidate);

    // Try rules in order
    let decision: Resolution['decision'] = 'ADD';
    let targetId: string | null = null;
    let ruleId: string | null = null;
    let decidedBy: 'rule' | 'model' = 'rule';

    // Rule 5: NOOP - same slot, same subject/predicate, same value, no new evidence
    for (const n of neighbours) {
      if (this.isNoop(candidate, n)) {
        decision = 'NOOP';
        targetId = n.id;
        ruleId = 'rule_5_noop';
        break;
      }
    }

    // Rule 6: MERGE - same slot, same subject/predicate, same value, new evidence
    if (decision === 'ADD') {
      for (const n of neighbours) {
        if (this.isMerge(candidate, n)) {
          decision = 'MERGE';
          targetId = n.id;
          ruleId = 'rule_6_merge';
          break;
        }
      }
    }

    // Rule 7: SUPERSEDE - single-valued slot, different value, user_stated/edited candidate
    if (decision === 'ADD') {
      for (const n of neighbours) {
        if (this.isSupersede(candidate, n)) {
          decision = 'SUPERSEDE';
          targetId = n.id;
          ruleId = 'rule_7_supersede';
          break;
        }
      }
    }

    // Rule 9: Inference never overrides statement
    if (decision === 'ADD' || decision === 'SUPERSEDE') {
      for (const n of neighbours) {
        if (this.isInferenceOverride(candidate, n)) {
          decision = 'STAYS_CANDIDATE';
          targetId = n.id;
          ruleId = 'rule_9_inference_override';
          break;
        }
      }
    }

    // Rule 14: Decision supersession - same subject+predicate, different value, candidate is decision
    if (decision === 'ADD') {
      for (const n of neighbours) {
        if (
          candidate.kind === 'decision' &&
          n.kind === 'decision' &&
          n.subject === candidate.subject &&
          n.predicate === candidate.predicate &&
          n.value_text !== candidate.value_text
        ) {
          const candidateIsStatement = ['user_stated', 'user_confirmed', 'user_edited'].includes(candidate.source_type);
          const incumbentIsStatement = ['user_stated', 'user_confirmed', 'user_edited'].includes(n.source_type);
          if (candidateIsStatement || !incumbentIsStatement) {
            decision = 'SUPERSEDE';
            targetId = n.id;
            ruleId = 'rule_14_decision_supersede';
            break;
          } else {
            decision = 'STAYS_CANDIDATE';
            targetId = n.id;
            ruleId = 'rule_9_inference_override';
            break;
          }
        }
      }
    }

    // Model-second path (rule 12): consult model for unresolved pairs
    // An unresolved pair = same slot, different value, no deterministic rule decided
    let modelDecision: { decision: string; rationale: string } | null = null;
    if (decision === 'ADD' && neighbours.length > 0) {
      // Check if there's an incumbent with a different value in the same slot
      const unresolvedIncumbent = neighbours.find(n =>
        n.slot === candidate.slot && n.slot !== null && n.value_text !== candidate.value_text
      );
      if (unresolvedIncumbent) {
        // Rule 9 check: inference can't supersede statement
        const isInference = ['agent_inferred', 'agent_reflection'].includes(candidate.source_type);
        const isStatement = ['user_stated', 'user_confirmed', 'user_edited'].includes(unresolvedIncumbent.source_type);
        if (isInference && isStatement) {
          // Rule 9: STAYS_CANDIDATE, no model call
          decision = 'STAYS_CANDIDATE';
          targetId = unresolvedIncumbent.id;
          ruleId = 'rule_9_inference_override';
        } else {
          // Consult model
          const apiKey = loadApiKey();
          if (apiKey) {
            modelDecision = await consultModel(candidate, unresolvedIncumbent, apiKey);
            if (modelDecision) {
              const validDecisions = ['ADD', 'MERGE', 'SUPERSEDE', 'NOOP'];
              if (validDecisions.includes(modelDecision.decision)) {
                // Rule 9 validation: if inference vs statement, can't supersede
                if (modelDecision.decision === 'SUPERSEDE' && isInference && isStatement) {
                  decision = 'STAYS_CANDIDATE';
                  targetId = unresolvedIncumbent.id;
                  ruleId = 'rule_9_inference_override';
                } else {
                  decision = modelDecision.decision as any;
                  targetId = unresolvedIncumbent.id;
                  ruleId = 'model_second';
                  decidedBy = 'model';
                }
              }
            }
          }
        }
      }
    }
    // Execute the decision
    const healingLogId = uuid();
    await this.executeDecision(decision, candidate, targetId, candidateId, healingLogId, now, ruleId, decidedBy, modelDecision?.rationale);

    // Check promotion after merge (corroboration-based)
    if (decision === 'MERGE' && targetId) {
      const incumbent = this.storage.read((db: any) => db.prepare('SELECT source_type, status FROM memories WHERE id = ?').get(targetId) as { source_type: string; status: string } | undefined);
      if (incumbent && ['agent_inferred', 'agent_reflection'].includes(incumbent.source_type) && incumbent.status === 'candidate') {
        await this.promotionManager.checkPromotion(targetId);
      }
    }

    return {
      decision,
      candidate_id: candidateId,
      target_id: targetId,
      decided_by: decidedBy,
      rule_id: ruleId,
      healing_log_id: healingLogId,
    };
  }

  private findNeighbours(candidate: VGCandidate): Memory[] {
    // Get active memories, same slot first, then by similarity
    return this.storage.read((db) => {
      let query = 'SELECT * FROM memories WHERE status = ?';
      const params: any[] = ['active'];

      if (candidate.slot) {
        // Same slot first
        const sameSlot = db.prepare(`${query} AND slot = ? ORDER BY recorded_at DESC LIMIT 5`).all('active', candidate.slot) as any[];
        const otherSlot = db.prepare(`${query} AND (slot IS NULL OR slot != ?) ORDER BY recorded_at DESC LIMIT 5`).all('active', candidate.slot) as any[];
        return [...sameSlot, ...otherSlot].slice(0, 5).map(this.rowToMemory);
      }

      return db.prepare(`${query} ORDER BY recorded_at DESC LIMIT 5`).all('active').map(this.rowToMemory);
    });
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      kind: row.kind,
      slot: row.slot,
      subject: row.subject,
      predicate: row.predicate,
      value_text: row.value_text,
      value_json: row.value_json,
      evidence_quote: row.evidence_quote,
      source_turn_id: row.source_turn_id,
      source_episode_id: row.source_episode_id,
      source_type: row.source_type,
      modality: row.modality,
      confidence: row.confidence,
      importance: row.importance,
      pinned: row.pinned,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      observed_at: row.observed_at,
      recorded_at: row.recorded_at,
      superseded_at: row.superseded_at,
      superseded_by_id: row.superseded_by_id,
      supersedes_id: row.supersedes_id,
      last_reinforced_at: row.last_reinforced_at,
      last_accessed_at: row.last_accessed_at,
      reinforcement_count: row.reinforcement_count,
      access_count: row.access_count,
      status: row.status,
      extractor_version: row.extractor_version,
      decay_class: row.decay_class,
    };
  }

  private isNoop(candidate: VGCandidate, incumbent: Memory): boolean {
    if (candidate.slot !== incumbent.slot) return false;
    if (candidate.subject !== incumbent.subject) return false;
    if (candidate.predicate !== incumbent.predicate) return false;
    if (candidate.value_text !== incumbent.value_text) return false;
    // Same value, no new evidence episode
    if (candidate.source_episode_id === incumbent.source_episode_id) return true;
    return false;
  }

  private isMerge(candidate: VGCandidate, incumbent: Memory): boolean {
    if (candidate.slot !== incumbent.slot) return false;
    if (candidate.subject !== incumbent.subject) return false;
    if (candidate.predicate !== incumbent.predicate) return false;
    if (candidate.value_text !== incumbent.value_text) return false;
    // Same value, new evidence episode
    if (candidate.source_episode_id !== incumbent.source_episode_id) return true;
    return false;
  }

  private isSupersede(candidate: VGCandidate, incumbent: Memory): boolean {
    if (!candidate.slot) return false;
    // Check slot cardinality
    const slot = this.storage.read((db) => {
      return db.prepare('SELECT cardinality FROM slot_registry WHERE slot = ?').get(candidate.slot) as { cardinality: string } | undefined;
    });
    if (!slot || slot.cardinality !== 'single') return false;
    if (candidate.value_text === incumbent.value_text) return false; // same value = not supersede
    if (!['user_stated', 'user_edited'].includes(candidate.source_type)) return false;
    return true;
  }

  private isInferenceOverride(candidate: VGCandidate, incumbent: Memory): boolean {
    if (!candidate.slot) return false;
    const slot = this.storage.read((db) => {
      return db.prepare('SELECT cardinality FROM slot_registry WHERE slot = ?').get(candidate.slot) as { cardinality: string } | undefined;
    });
    if (!slot || slot.cardinality !== 'single') return false;
    if (candidate.value_text === incumbent.value_text) return false;
    if (!['agent_inferred', 'agent_reflection'].includes(candidate.source_type)) return false;
    if (!['user_stated', 'user_confirmed', 'user_edited'].includes(incumbent.source_type)) return false;
    return true;
  }

  private async executeDecision(
    decision: Resolution['decision'],
    candidate: VGCandidate,
    targetId: string | null,
    newId: string,
    healingLogId: string,
    now: string,
    ruleId: string | null,
    decidedBy: 'rule' | 'model',
    rationale?: string
  ): Promise<void> {
    const actionMap: Record<string, string> = {
      ADD: 'add',
      MERGE: 'merge',
      SUPERSEDE: 'supersede',
      NOOP: 'noop',
      STAYS_CANDIDATE: 'noop',
    };

    await this.storage.write((db) => {
      if (decision === 'ADD') {
        // Insert new memory
        db.prepare(`
          INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
            source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
            valid_from, valid_to, observed_at, recorded_at, reinforcement_count, access_count,
            status, extractor_version, decay_class)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId, candidate.kind, candidate.slot, candidate.subject, candidate.predicate,
          candidate.value_text, (typeof candidate.value_json === 'string' ? candidate.value_json : (candidate.value_json ? JSON.stringify(candidate.value_json) : null)), candidate.evidence_quote,
          candidate.source_turn_id, candidate.source_episode_id, candidate.source_type,
          candidate.modality, initialConfidence(candidate.source_type as any), candidate.importance,
          0, candidate.valid_from || null, null, candidate.observed_at || now, now,
          0, 0, 'active', candidate.extractor_version || 'v1', candidate.decay_class
        );

        // Update FTS
        db.prepare('INSERT INTO memories_fts (memory_id, value_text, subject, predicate) VALUES (?, ?, ?, ?)').run(
          newId, candidate.value_text, candidate.subject, candidate.predicate
        );

        // Update vec (placeholder - would need embedding)
        // db.prepare('INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)').run(newId, embedding);

      } else if (decision === 'SUPERSEDE' && targetId) {
        // Supersede: insert new first, then update incumbent (FK order)
        const incumbent = db.prepare('SELECT * FROM memories WHERE id = ?').get(targetId) as any;
        if (incumbent) {
          const validTo = candidate.valid_from || candidate.observed_at || now;

          // Insert new memory first (supersedes_id references existing targetId)
          db.prepare(`
            INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
              source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
              valid_from, valid_to, observed_at, recorded_at, supersedes_id, reinforcement_count, access_count,
              status, extractor_version, decay_class)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newId, candidate.kind, candidate.slot, candidate.subject, candidate.predicate,
            candidate.value_text, (typeof candidate.value_json === 'string' ? candidate.value_json : (candidate.value_json ? JSON.stringify(candidate.value_json) : null)), candidate.evidence_quote,
            candidate.source_turn_id, candidate.source_episode_id, candidate.source_type,
            candidate.modality, initialConfidence(candidate.source_type as any), candidate.importance,
            0, candidate.valid_from || null, null, candidate.observed_at || now, now,
            targetId, 0, 0, 'active', candidate.extractor_version || 'v1', candidate.decay_class
          );

          // Update FTS for new memory
          db.prepare('INSERT INTO memories_fts (memory_id, value_text, subject, predicate) VALUES (?, ?, ?, ?)').run(
            newId, candidate.value_text, candidate.subject, candidate.predicate
          );

          // Now update incumbent (superseded_by_id references newId, which now exists)
          db.prepare(`
            UPDATE memories SET valid_to = ?, status = 'superseded', superseded_at = ?, superseded_by_id = ?
            WHERE id = ?
          `).run(validTo, now, newId, targetId);

          // Remove incumbent from FTS and vec
          db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(targetId);
          db.prepare('DELETE FROM memories_vec WHERE memory_id = ?').run(targetId);
        }
      } else if (decision === 'MERGE' && targetId) {
        // Merge: reinforce incumbent
        const incumbent = db.prepare('SELECT * FROM memories WHERE id = ?').get(targetId) as any;
        if (incumbent) {
          const k = kForSource(candidate.source_type as any);
          const currentEff = effectiveConfidence(incumbent, now);
          const newConf = (candidate.source_type === 'agent_reflection') ? incumbent.confidence : reinforceConfidence(currentEff, k);
          const lastReinforced = incumbent.last_reinforced_at && new Date(incumbent.last_reinforced_at) > new Date(candidate.observed_at || now)
            ? incumbent.last_reinforced_at
            : (candidate.observed_at || now);

          if (candidate.source_type !== 'agent_reflection') {
            db.prepare(`
              UPDATE memories SET reinforcement_count = reinforcement_count + 1,
                confidence = ?, last_reinforced_at = ?
              WHERE id = ?
            `).run(newConf, lastReinforced, targetId);
          }
        }
      }
      // NOOP and STAYS_CANDIDATE: no memory changes

      // Write healing_log entry
      const memoryIds = decision === 'ADD' ? [newId] : (targetId ? [targetId] : []);
      if (decision === 'SUPERSEDE' && targetId) memoryIds.push(newId);

      db.prepare(`
      INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
      healingLogId, now, 'resolver', actionMap[decision],
      JSON.stringify(memoryIds), null, null,
      rationale || `${ruleId || 'model'}: ${decision} for candidate`, decision === 'SUPERSEDE' ? 1 : 0
      );
    });
  }
}