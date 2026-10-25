// src/adaptation/adaptation-store.ts — Adaptation store (11-adaptation-store.md, Phase 2)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { ReviewQueue } from '../review/review-queue.js';

export interface AdaptationSignal {
  signal_type: string;
  target: string;
  detail_json: string;
  episode_id: string | null;
}

export interface AdaptationProposal {
  dimension: string;
  proposed_value: string;
  reason: string;
  feedback_event_ids: string[];
  strength: number;
}

export class AdaptationStore {
  private storage: Storage;
  private reviewQueue: ReviewQueue;

  constructor(storage: Storage, reviewQueue: ReviewQueue) {
    this.storage = storage;
    this.reviewQueue = reviewQueue;
  }

  // Ingest a feedback event
  async ingestFeedback(signal: AdaptationSignal): Promise<string> {
    const id = uuid();
    await this.storage.write((db: any) => {
      db.prepare(`
        INSERT INTO feedback_events (id, ts, episode_id, signal_type, target, detail_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, nowUtc(), signal.episode_id, signal.signal_type, signal.target, signal.detail_json);
    });
    return id;
  }

  // Get current adaptation state for a dimension
  getState(dimension: string): { dimension: string; current_value: string; strength: number; status: string; user_locked: number } | null {
    return this.storage.read((db: any) => {
      const row = db.prepare('SELECT * FROM adaptation_state WHERE dimension = ?').get(dimension) as any;
      if (!row) return null;
      return {
        dimension: row.dimension,
        current_value: row.current_value,
        strength: row.strength,
        status: row.status,
        user_locked: row.user_locked,
      };
    });
  }

  // Get all adaptation states
  getAllStates(): { dimension: string; current_value: string; strength: number; status: string; user_locked: number }[] {
    return this.storage.read((db: any) => {
      return db.prepare('SELECT * FROM adaptation_state').all() as any[];
    }).map((r: any) => ({
      dimension: r.dimension,
      current_value: r.current_value,
      strength: r.strength,
      status: r.status,
      user_locked: r.user_locked,
    }));
  }

  // Propose an adaptation change
  async proposeAdaptation(proposal: AdaptationProposal): Promise<string> {
    const dimension = proposal.dimension;

    // Check if user-locked
    const state = this.getState(dimension);
    if (state?.user_locked === 1) {
      throw new Error('ERR_LOCKED: Dimension is user-locked');
    }

    // Create review item for the proposal
    const itemId = this.reviewQueue.createItem('adaptation_proposal', {
      dimension,
      proposed_value: proposal.proposed_value,
      reason: proposal.reason,
      strength: proposal.strength,
    }, []);

    // Store adaptation version
    await this.storage.write((db: any) => {
      // Upsert adaptation_state
      const existing = db.prepare('SELECT dimension FROM adaptation_state WHERE dimension = ?').get(dimension);
      if (existing) {
        db.prepare(`
          UPDATE adaptation_state SET current_value = ?, strength = ?, status = 'proposed', updated_at = ?
          WHERE dimension = ?
        `).run(proposal.proposed_value, proposal.strength, nowUtc(), dimension);
      } else {
        db.prepare(`
          INSERT INTO adaptation_state (dimension, current_value, strength, status, user_locked, updated_at)
          VALUES (?, ?, ?, 'proposed', 0, ?)
        `).run(dimension, proposal.proposed_value, proposal.strength, nowUtc());
      }

      // Record version
      db.prepare(`
        INSERT INTO adaptation_versions (id, dimension, value, ts, reason, feedback_event_ids, superseded_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `).run(uuid(), dimension, proposal.proposed_value, nowUtc(), proposal.reason, JSON.stringify(proposal.feedback_event_ids));
    });

    return itemId;
  }

  // Apply an approved adaptation (called after review resolution)
  async applyAdaptation(dimension: string): Promise<void> {
    await this.storage.write((db: any) => {
      db.prepare(`
        UPDATE adaptation_state SET status = 'active', updated_at = ?
        WHERE dimension = ?
      `).run(nowUtc(), dimension);
    });
  }

  // Revert an adaptation
  async revertAdaptation(dimension: string): Promise<void> {
    await this.storage.write((db: any) => {
      db.prepare(`
        UPDATE adaptation_state SET status = 'reverted', updated_at = ?
        WHERE dimension = ?
      `).run(nowUtc(), dimension);
    });
  }

  // Lock/unlock a dimension
  async lockDimension(dimension: string, locked: boolean): Promise<void> {
    await this.storage.write((db: any) => {
      db.prepare(`
        UPDATE adaptation_state SET user_locked = ?, updated_at = ?
        WHERE dimension = ?
      `).run(locked ? 1 : 0, nowUtc(), dimension);
    });
  }

  // Aggregate feedback and generate proposals
  // Called by sleep job or manually
  async aggregateAndPropose(minSignals: number = 5, minSessions: number = 3): Promise<AdaptationProposal[]> {
    const proposals: AdaptationProposal[] = [];

    // Get feedback events grouped by target
    const events = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT * FROM feedback_events
        ORDER BY ts DESC
      `).all() as any[];
    });

    // Group by target
    const byTarget: Record<string, any[]> = {};
    for (const e of events) {
      if (!byTarget[e.target]) byTarget[e.target] = [];
      byTarget[e.target].push(e);
    }

    // For each target with enough signals, generate a proposal
    for (const [target, targetEvents] of Object.entries(byTarget)) {
      if (targetEvents.length < minSignals) continue;

      // Check distinct sessions
      const sessions = new Set(targetEvents.map((e: any) => e.episode_id).filter(Boolean));
      if (sessions.size < minSessions) continue;

      // Generate proposal based on signal types
      const signalTypes = targetEvents.map((e: any) => e.signal_type);
      const hasCompliments = signalTypes.includes('compliment_specific');
      const hasCorrections = signalTypes.includes('correction');

      let proposedValue = 'neutral';
      let reason = `Aggregated ${targetEvents.length} signals across ${sessions.size} sessions`;

      if (hasCompliments && !hasCorrections) {
        proposedValue = 'positive';
        reason = `Positive feedback pattern: ${targetEvents.length} compliments across ${sessions.size} sessions`;
      } else if (hasCorrections) {
        proposedValue = 'adjusted';
        reason = `Correction pattern: ${targetEvents.length} corrections across ${sessions.size} sessions`;
      }

      proposals.push({
        dimension: `persona.${target}`,
        proposed_value: proposedValue,
        reason,
        feedback_event_ids: targetEvents.map((e: any) => e.id),
        strength: Math.min(1.0, targetEvents.length / 10),
      });
    }

    // Create proposals via review queue
    for (const proposal of proposals) {
      try {
        await this.proposeAdaptation(proposal);
      } catch (e: any) {
        if (!e.message.includes('ERR_LOCKED')) {
          console.error('Adaptation proposal failed:', e.message);
        }
      }
    }

    return proposals;
  }

  // Delete all adaptation data (for delete_all)
  async deleteAll(): Promise<void> {
    await this.storage.write((db: any) => {
      db.prepare('DELETE FROM adaptation_versions').run();
      db.prepare('DELETE FROM adaptation_state').run();
      db.prepare('DELETE FROM feedback_events').run();
    });
  }
}