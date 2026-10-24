// src/sleep/sleep-job.ts — Sleep job (09-sleep-job.md, V1-tonight subset)

import { Storage } from '../storage/storage.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { uuid, nowUtc } from '../types/common.js';
import { effectiveConfidence } from '../confidence/confidence.js';

export interface SleepJobResult {
  job_id: string;
  status: string;
  steps: Record<string, { status: string; detail: string }>;
  metrics: Record<string, any>;
}

export class SleepJob {
  private storage: Storage;
  private profileCompiler: ProfileCompiler;
  private running: boolean = false;

  constructor(storage: Storage, profileCompiler: ProfileCompiler) {
    this.storage = storage;
    this.profileCompiler = profileCompiler;
  }

  async run(trigger: 'scheduled' | 'idle' | 'session_count' | 'manual' = 'manual'): Promise<SleepJobResult> {
    // Single-instance guard
    if (this.running) {
      throw new Error('ERR_CONFLICT: A sleep job is already running');
    }
    this.running = true;

    const jobId = uuid();
    const startedAt = nowUtc();
    const steps: Record<string, { status: string; detail: string }> = {};

    try {
      // Create job run record
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO sleep_job_runs (id, trigger, started_at, status)
          VALUES (?, ?, ?, 'running')
        `).run(jobId, trigger, startedAt);
      });

      // Step 1: Dedup sweep — merge exact duplicates
      steps['dedup'] = await this.dedupSweep();

      // Step 2: Contradiction sweep — flag conflicts for review
      steps['contradiction'] = await this.contradictionSweep();

      // Step 3: Decay sweep — archive memories below threshold
      steps['decay'] = await this.decaySweep();

      // Step 4: Profile recompilation
      steps['profile_recompile'] = await this.recompileProfile();

      // Step 8: Health metrics
      const metrics = this.computeHealthMetrics();

      // Update job run record
      await this.storage.write((db: any) => {
        db.prepare(`
          UPDATE sleep_job_runs SET finished_at = ?, status = 'completed', steps_json = ?, metrics_json = ?
          WHERE id = ?
        `).run(nowUtc(), JSON.stringify(steps), JSON.stringify(metrics), jobId);
      });

      return { job_id: jobId, status: 'completed', steps, metrics };
    } catch (e: any) {
      await this.storage.write((db: any) => {
        db.prepare(`
          UPDATE sleep_job_runs SET finished_at = ?, status = 'failed', steps_json = ?
          WHERE id = ?
        `).run(nowUtc(), JSON.stringify(steps), jobId);
      });
      throw e;
    } finally {
      this.running = false;
    }
  }

  private async dedupSweep(): Promise<{ status: string; detail: string }> {
    let merged = 0;
    const now = nowUtc();

    // Find active memories with same slot + subject + predicate + value
    const duplicates = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT slot, subject, predicate, value_text, COUNT(*) as cnt
        FROM memories
        WHERE status = 'active' AND slot IS NOT NULL
        GROUP BY slot, subject, predicate, value_text
        HAVING COUNT(*) > 1
      `).all() as any[];
    });

    for (const dup of duplicates) {
      // Get all memories in this group
      const group = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT * FROM memories
          WHERE status = 'active' AND slot = ? AND subject = ? AND predicate = ? AND value_text = ?
          ORDER BY recorded_at ASC
        `).all(dup.slot, dup.subject, dup.predicate, dup.value_text) as any[];
      });

      if (group.length < 2) continue;

      // Keep the first (oldest), merge the rest
      const survivor = group[0];
      for (let i = 1; i < group.length; i++) {
        const candidate = group[i];
        await this.storage.write((db: any) => {
          // Reinforce survivor
          db.prepare(`
            UPDATE memories SET reinforcement_count = reinforcement_count + 1,
              last_reinforced_at = ?
            WHERE id = ?
          `).run(now, survivor.id);

          // Supersede the duplicate
          db.prepare(`
            UPDATE memories SET status = 'superseded', valid_to = ?, superseded_at = ?, superseded_by_id = ?
            WHERE id = ?
          `).run(now, now, survivor.id, candidate.id);

          // Remove from FTS
          db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(candidate.id);

          // Log
          db.prepare(`
            INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
            VALUES (?, ?, ?, 'merge', ?, ?, ?, ?, 1)
          `).run(
            uuid(), now, 'sleep_job',
            JSON.stringify([survivor.id, candidate.id]),
            JSON.stringify({ id: candidate.id, status: 'active' }),
            JSON.stringify({ id: candidate.id, status: 'superseded' }),
            'Dedup sweep: merged duplicate into survivor',
            1
          );
        });
        merged++;
      }
    }

    // Also check slotless exact duplicates
    const slotlessDups = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT subject, predicate, value_text, COUNT(*) as cnt
        FROM memories
        WHERE status = 'active' AND slot IS NULL
        GROUP BY subject, predicate, value_text
        HAVING COUNT(*) > 1
      `).all() as any[];
    });

    for (const dup of slotlessDups) {
      const group = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT * FROM memories
          WHERE status = 'active' AND slot IS NULL AND subject = ? AND predicate = ? AND value_text = ?
          ORDER BY recorded_at ASC
        `).all(dup.subject, dup.predicate, dup.value_text) as any[];
      });

      if (group.length < 2) continue;
      const survivor = group[0];
      for (let i = 1; i < group.length; i++) {
        const candidate = group[i];
        await this.storage.write((db: any) => {
          db.prepare(`
            UPDATE memories SET status = 'superseded', valid_to = ?, superseded_at = ?, superseded_by_id = ?
            WHERE id = ?
          `).run(now, now, survivor.id, candidate.id);
          db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(candidate.id);
          db.prepare(`
            INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
            VALUES (?, ?, ?, 'merge', ?, ?, ?, ?, 1)
          `).run(
            uuid(), now, 'sleep_job',
            JSON.stringify([survivor.id, candidate.id]),
            JSON.stringify({ id: candidate.id, status: 'active' }),
            JSON.stringify({ id: candidate.id, status: 'superseded' }),
            'Dedup sweep: merged slotless duplicate',
            1
          );
        });
        merged++;
      }
    }

    return { status: 'done', detail: `Merged ${merged} duplicates` };
  }

  private async contradictionSweep(): Promise<{ status: string; detail: string }> {
    let flagged = 0;
    const now = nowUtc();

    // Find single-valued slots with multiple active memories (inconsistency)
    const conflicts = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT m.slot, COUNT(*) as cnt
        FROM memories m
        JOIN slot_registry s ON m.slot = s.slot
        WHERE m.status = 'active' AND s.cardinality = 'single'
        GROUP BY m.slot
        HAVING COUNT(*) > 1
      `).all() as any[];
    });

    for (const conflict of conflicts) {
      const memories = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT * FROM memories WHERE status = 'active' AND slot = ?
          ORDER BY recorded_at DESC
        `).all(conflict.slot) as any[];
      });

      // Create review item for contradiction
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at)
          VALUES (?, 'contradiction', ?, ?, 'pending', ?)
        `).run(
          uuid(),
          JSON.stringify({ slot: conflict.slot, memory_count: conflict.cnt }),
          JSON.stringify(memories.map((m: any) => m.id)),
          now
        );
      });
      flagged++;
    }

    return { status: 'done', detail: `Flagged ${flagged} contradictions` };
  }

  private async decaySweep(): Promise<{ status: string; detail: string }> {
    let archived = 0;
    const now = nowUtc();
    const nowDate = new Date(now);

    // Get all active/candidate memories
    const memories = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT m.*, s.decay_class as slot_decay_class
        FROM memories m
        LEFT JOIN slot_registry s ON m.slot = s.slot
        WHERE m.status IN ('active', 'candidate')
      `).all() as any[];
    });

    for (const mem of memories) {
      // Check exemptions
      const isExempt = mem.decay_class === 'exempt' || mem.kind === 'boundary' || mem.pinned === 1 || (mem.slot_decay_class === 'exempt');
      if (isExempt) continue;

      // Compute effective confidence
      const anchor = mem.last_reinforced_at || mem.recorded_at;
      const halfLife = this.getHalfLife(mem.decay_class);
      if (halfLife === null) continue;

      const anchorTime = new Date(anchor).getTime();
      const elapsedMs = Math.max(0, nowDate.getTime() - anchorTime);
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
      const decayFactor = Math.pow(0.5, elapsedDays / halfLife);
      const effConf = mem.confidence * decayFactor;

      // Check archive threshold
      const shouldArchive = effConf < 0.15;

      // Check 90-day no-corroboration for candidates
      const recordedAt = new Date(mem.recorded_at).getTime();
      const daysSinceRecorded = (nowDate.getTime() - recordedAt) / (1000 * 60 * 60 * 24);
      const noCorroborationArchive = mem.status === 'candidate' && mem.reinforcement_count === 0 && daysSinceRecorded >= 90;

      if (shouldArchive || noCorroborationArchive) {
        await this.storage.write((db: any) => {
          db.prepare(`
            UPDATE memories SET status = 'archived' WHERE id = ?
          `).run(mem.id);

          // Remove from FTS
          db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(mem.id);

          db.prepare(`
            INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
            VALUES (?, ?, ?, 'archive', ?, ?, ?, ?, 1)
          `).run(
            uuid(), now, 'sleep_job',
            JSON.stringify([mem.id]),
            JSON.stringify({ id: mem.id, status: mem.status, confidence: mem.confidence }),
            JSON.stringify({ id: mem.id, status: 'archived' }),
            `Decay sweep: effective confidence ${effConf.toFixed(3)} below 0.15 threshold`,
            1
          );
        });
        archived++;
      }
    }

    return { status: 'done', detail: `Archived ${archived} memories` };
  }

  private async recompileProfile(): Promise<{ status: string; detail: string }> {
    try {
      const result = await this.profileCompiler.compile('sleep_job', []);
      return { status: 'done', detail: `Profile recompiled (v${result.version}, ${result.status})` };
    } catch (e: any) {
      return { status: 'failed', detail: e.message };
    }
  }

  private computeHealthMetrics(): Record<string, any> {
    return this.storage.read((db: any) => {
      const countsByStatus: Record<string, number> = {};
      const statusRows = db.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all() as any[];
      for (const r of statusRows) countsByStatus[r.status] = r.c;

      const quarantineCount = db.prepare("SELECT COUNT(*) as c FROM memories WHERE status = 'quarantined'").get() as { c: number };
      const totalMemories = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
      const provenanceComplete = db.prepare("SELECT COUNT(*) as c FROM memories WHERE source_turn_id IS NOT NULL AND source_episode_id IS NOT NULL AND evidence_quote != ''").get() as { c: number };

      return {
        counts_by_status: countsByStatus,
        quarantine_count: quarantineCount.c,
        provenance_complete_percent: totalMemories.c > 0 ? (provenanceComplete.c / totalMemories.c) * 100 : 100,
        total_memories: totalMemories.c,
        last_sleep_job_at: nowUtc(),
      };
    });
  }

  private getHalfLife(decayClass: string): number | null {
    const halfLives: Record<string, number | null> = {
      exempt: null,
      slow: 180,
      medium: 30,
      fast: 7,
      session: 1,
    };
    return halfLives[decayClass] ?? 30;
  }

  isRunning(): boolean {
    return this.running;
  }
}