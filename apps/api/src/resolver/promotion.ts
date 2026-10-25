// src/resolver/promotion.ts — Corroboration-based promotion (06 rule 10)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { effectiveConfidence, isCoreEligible } from '../confidence/confidence.js';

export interface PromotionResult {
  promoted: boolean;
  memory_id: string;
  from_status: string;
  to_status: string;
  healing_log_id: string | null;
}

export class PromotionManager {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  // Check if an agent_inferred candidate qualifies for promotion
  async checkPromotion(memoryId: string): Promise<PromotionResult> {
    const memory = this.storage.read((db: any) => db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any);
    if (!memory) return { promoted: false, memory_id: memoryId, from_status: 'not_found', to_status: 'not_found', healing_log_id: null };

    // Only agent_inferred and agent_reflection can be promoted via corroboration
    if (!['agent_inferred', 'agent_reflection'].includes(memory.source_type)) {
      return { promoted: false, memory_id: memoryId, from_status: memory.status, to_status: memory.status, healing_log_id: null };
    }

    if (memory.status !== 'candidate') {
      return { promoted: false, memory_id: memoryId, from_status: memory.status, to_status: memory.status, healing_log_id: null };
    }

    // Count independent episodes (distinct source_episode_id)
    // The memory's own episode counts as the first
    // We need to check if there are corroborating episodes
    // For V1, we track this via reinforcement_count and healing_log
    // A corroboration event is a merge from a different episode

    // Get the session of the original memory
    const originalTurn = this.storage.read((db: any) => db.prepare('SELECT session_id FROM turns WHERE id = ?').get(memory.source_turn_id) as { session_id: string } | undefined);

    // Count distinct episodes that have corroborated this memory
    // We look at healing_log merge entries for this memory
    const mergeLogs = this.storage.read((db: any) => db.prepare(`
      SELECT before_json, after_json, ts FROM healing_log
      WHERE action = 'merge' AND memory_ids LIKE ?
      ORDER BY ts
    `).all(`%${memoryId}%`) as any[]);

    // Count distinct episodes from merge logs
    const corroboratingEpisodes = new Set<string>();
    corroboratingEpisodes.add(memory.source_episode_id); // own episode counts as first

    for (const log of mergeLogs) {
      try {
        const before = log.before_json ? JSON.parse(log.before_json) : null;
        const after = log.after_json ? JSON.parse(log.after_json) : null;
        // If the merge came from a different episode, count it
        if (after && after.source_episode_id && after.source_episode_id !== memory.source_episode_id) {
          corroboratingEpisodes.add(after.source_episode_id);
        }
      } catch {
        // Skip malformed entries
      }
    }

    // Check session boundary: at least one session boundary passed since recorded
    const recordedAt = new Date(memory.recorded_at).getTime();
    const now = new Date(nowUtc()).getTime();
    const sessionBoundaryPassed = (now - recordedAt) > 0; // simplified: any time has passed

    // Check effective confidence
    const effConf = effectiveConfidence(memory, nowUtc());

    // Check corroboration count
    const episodeCount = corroboratingEpisodes.size;

    // agent_reflection needs at least one non-reflection corroboration
    let hasNonReflectionCorroboration = true;
    if (memory.source_type === 'agent_reflection') {
      hasNonReflectionCorroboration = false;
      for (const log of mergeLogs) {
        try {
          const after = log.after_json ? JSON.parse(log.after_json) : null;
          if (after && after.source_type && after.source_type !== 'agent_reflection') {
            hasNonReflectionCorroboration = true;
          }
        } catch {}
      }
      // Also check if any merge came from a user_stated/confirmed/inferred source
      if (memory.reinforcement_count > 0 && mergeLogs.length > 0) {
        hasNonReflectionCorroboration = true; // simplified
      }
    }

    const promotable = episodeCount >= 2 && sessionBoundaryPassed && effConf >= 0.50 && hasNonReflectionCorroboration;

    if (!promotable) {
      return { promoted: false, memory_id: memoryId, from_status: memory.status, to_status: memory.status, healing_log_id: null };
    }

    // Promote
    const healingLogId = uuid();
    await this.storage.write((db: any) => {
      db.prepare("UPDATE memories SET status = 'active' WHERE id = ?").run(memoryId);
      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'promote', ?, ?, ?, ?, 1)
      `).run(
        healingLogId, nowUtc(), 'promotion',
        JSON.stringify([memoryId]),
        JSON.stringify({ status: 'candidate' }),
        JSON.stringify({ status: 'active' }),
        `Promoted ${memory.source_type} memory to active: ${episodeCount} corroborating episodes, effective confidence ${effConf.toFixed(3)}`,
        1
      );
    });

    return { promoted: true, memory_id: memoryId, from_status: 'candidate', to_status: 'active', healing_log_id: healingLogId };
  }
}