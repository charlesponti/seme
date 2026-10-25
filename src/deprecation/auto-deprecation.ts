// src/deprecation/auto-deprecation.ts — Auto-deprecation of stale facts

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface DeprecationResult {
  deprecated: { id: string; value_text: string; reason: string }[];
  total_deprecated: number;
}

export class AutoDeprecation {
  private storage: Storage;
  private thresholds: Record<string, number>; // decay_class → days

  constructor(storage: Storage, thresholds?: Record<string, number>) {
    this.storage = storage;
    this.thresholds = thresholds || {
      session: 1,
      fast: 7,
      medium: 30,
      slow: 90,
      exempt: 365,
    };
  }

  /**
   * Run auto-deprecation: find stale facts and deprecate them.
   */
  run(): DeprecationResult {
    const now = new Date();
    const deprecated: DeprecationResult['deprecated'] = [];

    const memories = this.storage.read((db: any) => {
      return db.prepare("SELECT * FROM memories WHERE status = 'active'").all() as any[];
    });

    for (const m of memories) {
      const threshold = this.thresholds[m.decay_class] || 30;
      const lastReinforced = m.last_reinforced_at || m.observed_at || m.recorded_at;
      if (!lastReinforced) continue;

      const lastDate = new Date(lastReinforced);
      const daysSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSince > threshold) {
        const reason = `Auto-deprecated: not reinforced in ${Math.floor(daysSince)} days (threshold: ${threshold} days for ${m.decay_class} decay)`;
        this.storage.getDb().prepare("UPDATE memories SET status = 'archived', superseded_at = ? WHERE id = ?").run(now.toISOString(), m.id);
        deprecated.push({ id: m.id, value_text: m.value_text, reason });
      }
    }


    return { deprecated, total_deprecated: deprecated.length };
  }

  /**
   * Get deprecation thresholds.
   */
  getThresholds(): Record<string, number> {
    return { ...this.thresholds };
  }

  /**
   * Update thresholds.
   */
  setThresholds(thresholds: Record<string, number>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}
