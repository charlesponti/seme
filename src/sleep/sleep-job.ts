// src/sleep/sleep-job.ts — Sleep job (09-sleep-job.md, V1-tonight subset)

import { Storage } from '../storage/storage.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { uuid, nowUtc } from '../types/common.js';
import { effectiveConfidence } from '../confidence/confidence.js';
import * as fs from 'node:fs';
import { GraphStore } from '../graph/graph-store.js';

export interface SleepJobResult {
  job_id: string;
  status: string;
  steps: Record<string, { status: string; detail: string }>;
  metrics: Record<string, any>;
}

export class SleepJob {
  private storage: Storage;
  private profileCompiler: ProfileCompiler;
  private graphStore: GraphStore;
  private running: boolean = false;
  private logPath: string | null = null;

  constructor(storage: Storage, profileCompiler: ProfileCompiler, logPath?: string, graphStore?: GraphStore) {
    this.storage = storage;
    this.profileCompiler = profileCompiler;
    this.graphStore = graphStore || new GraphStore(storage);
    this.logPath = logPath || null;
  }

  private logStep(entry: Record<string, any>) {
    if (!this.logPath) return;
    const line = JSON.stringify({ ts: nowUtc(), ...entry }) + '\n';
    fs.appendFileSync(this.logPath, line);
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

    // Clear log file for this run
    if (this.logPath) {
      fs.writeFileSync(this.logPath, '');
    }

    this.logStep({ event: 'job_start', job_id: jobId, trigger, started_at: startedAt });

    try {
      // Create job run record
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO sleep_job_runs (id, trigger, started_at, status)
          VALUES (?, ?, ?, 'running')
        `).run(jobId, trigger, startedAt);
      });

      // Step 1: Dedup sweep
      this.logStep({ event: 'step_start', step: 'dedup', detail: 'Starting dedup sweep...' });
      const dedupStart = Date.now();
      steps['dedup'] = await this.dedupSweep();
      this.logStep({ event: 'step_complete', step: 'dedup', duration_ms: Date.now() - dedupStart, result: steps['dedup'] });

      // Step 2: Contradiction sweep
      this.logStep({ event: 'step_start', step: 'contradiction', detail: 'Starting contradiction sweep...' });
      const contraStart = Date.now();
      steps['contradiction'] = await this.contradictionSweep();
      this.logStep({ event: 'step_complete', step: 'contradiction', duration_ms: Date.now() - contraStart, result: steps['contradiction'] });

      // Step 3: Decay sweep
      this.logStep({ event: 'step_start', step: 'decay', detail: 'Starting decay sweep...' });
      const decayStart = Date.now();
      steps['decay'] = await this.decaySweep();
      this.logStep({ event: 'step_complete', step: 'decay', duration_ms: Date.now() - decayStart, result: steps['decay'] });

      // Step 4: Profile recompilation
      this.logStep({ event: 'step_start', step: 'profile_recompile', detail: 'Starting profile recompilation...' });
      const profileStart = Date.now();
      steps['profile_recompile'] = await this.recompileProfile();
      this.logStep({ event: 'step_complete', step: 'profile_recompile', duration_ms: Date.now() - profileStart, result: steps['profile_recompile'] });

      // Step 5: Graph dedup sweep — merge entities with same canonical name + type
      this.logStep({ event: 'step_start', step: 'graph_dedup', detail: 'Starting graph dedup sweep...' });
      const graphDedupStart = Date.now();
      steps['graph_dedup'] = await this.graphDedupSweep();
      this.logStep({ event: 'step_complete', step: 'graph_dedup', duration_ms: Date.now() - graphDedupStart, result: steps['graph_dedup'] });

      // Step 6: Graph contradiction sweep — flag conflicting relationships
      this.logStep({ event: 'step_start', step: 'graph_contradiction', detail: 'Starting graph contradiction sweep...' });
      const graphContraStart = Date.now();
      steps['graph_contradiction'] = await this.graphContradictionSweep();
      this.logStep({ event: 'step_complete', step: 'graph_contradiction', duration_ms: Date.now() - graphContraStart, result: steps['graph_contradiction'] });

      // Step 7: Graph decay sweep — decay entities/relationships, archive low-confidence
      this.logStep({ event: 'step_start', step: 'graph_decay', detail: 'Starting graph decay sweep...' });
      const graphDecayStart = Date.now();
      steps['graph_decay'] = await this.graphDecaySweep();
      this.logStep({ event: 'step_complete', step: 'graph_decay', duration_ms: Date.now() - graphDecayStart, result: steps['graph_decay'] });

      // Step 8: Health metrics
      const metrics = this.computeHealthMetrics();
      this.logStep({ event: 'metrics', metrics });

      // Update job run record
      await this.storage.write((db: any) => {
        db.prepare(`
          UPDATE sleep_job_runs SET finished_at = ?, status = 'completed', steps_json = ?, metrics_json = ?
          WHERE id = ?
        `).run(nowUtc(), JSON.stringify(steps), JSON.stringify(metrics), jobId);
      });

      this.logStep({ event: 'job_complete', job_id: jobId, status: 'completed', steps, metrics });

      return { job_id: jobId, status: 'completed', steps, metrics };
    } catch (e: any) {
      await this.storage.write((db: any) => {
        db.prepare(`
          UPDATE sleep_job_runs SET finished_at = ?, status = 'failed', steps_json = ?
          WHERE id = ?
        `).run(nowUtc(), JSON.stringify(steps), jobId);
      });
      this.logStep({ event: 'job_failed', job_id: jobId, error: e.message, steps });
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

  private async graphDedupSweep(): Promise<{ status: string; detail: string }> {
    let merged = 0;
    const now = nowUtc();

    // Merge entities with same canonical name + type
    const duplicates = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT name, type, COUNT(*) as cnt
        FROM entities
        GROUP BY LOWER(name), type
        HAVING COUNT(*) > 1
      `).all() as any[];
    });

    for (const dup of duplicates) {
      const group = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT * FROM entities WHERE LOWER(name) = LOWER(?) AND type = ?
          ORDER BY mention_count DESC, confidence DESC
        `).all(dup.name, dup.type) as any[];
      });

      if (group.length < 2) continue;

      // Keep the first (highest mention_count), merge the rest
      const survivor = group[0];
      for (let i = 1; i < group.length; i++) {
        const candidate = group[i];
        await this.storage.write((db: any) => {
          // Merge aliases
          const existingAliases = survivor.aliases ? JSON.parse(survivor.aliases) : [];
          const candidateAliases = candidate.aliases ? JSON.parse(candidate.aliases) : [];
          const mergedAliases = [...new Set([...existingAliases, ...candidateAliases])];

          // Update survivor
          db.prepare(`
            UPDATE entities SET
              aliases = ?,
              mention_count = mention_count + ?,
              confidence = MAX(confidence, ?),
              last_seen_at = ?
            WHERE id = ?
          `).run(JSON.stringify(mergedAliases), candidate.mention_count, candidate.confidence, now, survivor.id);

          // Update entity_memory_links to point to survivor
          db.prepare('UPDATE entity_memory_links SET entity_id = ? WHERE entity_id = ?').run(survivor.id, candidate.id);
          // Update entity_turn_links to point to survivor
          db.prepare('UPDATE entity_turn_links SET entity_id = ? WHERE entity_id = ?').run(survivor.id, candidate.id);

          // Merge relationships: update source_id/target_id references
          db.prepare('UPDATE relationships SET source_id = ? WHERE source_id = ?').run(survivor.id, candidate.id);
          db.prepare('UPDATE relationships SET target_id = ? WHERE target_id = ?').run(survivor.id, candidate.id);

          // Delete candidate entity
          db.prepare('DELETE FROM entities WHERE id = ?').run(candidate.id);

          // Log
          db.prepare(`
            INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
            VALUES (?, ?, ?, 'merge', ?, ?, ?, ?, 1)
          `).run(
            uuid(), now, 'sleep_job',
            JSON.stringify([survivor.id, candidate.id]),
            JSON.stringify({ id: candidate.id, status: 'active' }),
            JSON.stringify({ id: candidate.id, status: 'merged' }),
            'Graph dedup: merged entity into survivor'
          );
        });
        merged++;
      }
    }

    // Merge relationships with same source+target+type
    const relDuplicates = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT source_id, target_id, relation_type, COUNT(*) as cnt
        FROM relationships
        GROUP BY source_id, target_id, relation_type
        HAVING COUNT(*) > 1
      `).all() as any[];
    });

    for (const dup of relDuplicates) {
      const group = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT * FROM relationships WHERE source_id = ? AND target_id = ? AND relation_type = ?
          ORDER BY mention_count DESC, confidence DESC
        `).all(dup.source_id, dup.target_id, dup.relation_type) as any[];
      });

      if (group.length < 2) continue;
      const survivor = group[0];
      for (let i = 1; i < group.length; i++) {
        const candidate = group[i];
        await this.storage.write((db: any) => {
          db.prepare(`
            UPDATE relationships SET
              mention_count = mention_count + ?,
              weight = 1.0 - (1.0 / (mention_count + ?)),
              confidence = MAX(confidence, ?),
              last_seen_at = ?
            WHERE id = ?
          `).run(candidate.mention_count, candidate.mention_count, candidate.confidence, now, survivor.id);

          db.prepare('DELETE FROM relationships WHERE id = ?').run(candidate.id);

          db.prepare(`
            INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
            VALUES (?, ?, ?, 'merge', ?, ?, ?, ?, 1)
          `).run(
            uuid(), now, 'sleep_job',
            JSON.stringify([survivor.id, candidate.id]),
            JSON.stringify({ id: candidate.id, status: 'active' }),
            JSON.stringify({ id: candidate.id, status: 'merged' }),
            'Graph dedup: merged relationship into survivor'
          );
        });
        merged++;
      }
    }

    return { status: 'done', detail: `Merged ${merged} graph duplicates` };
  }

  private async graphContradictionSweep(): Promise<{ status: string; detail: string }> {
    let flagged = 0;
    const now = nowUtc();

    // Find entities with conflicting relationships (same relation_type to different targets)
    const conflicts = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT source_id, relation_type, COUNT(DISTINCT target_id) as target_count
        FROM relationships
        WHERE valid_to IS NULL
        GROUP BY source_id, relation_type
        HAVING COUNT(DISTINCT target_id) > 1
      `).all() as any[];
    });

    for (const conflict of conflicts) {
      // Only flag single-valued relationship types (lives_in, works_at, etc.)
      const singleValuedTypes = ['lives_in', 'works_at', 'married_to', 'located_in'];
      if (!singleValuedTypes.includes(conflict.relation_type)) continue;

      const memories = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT r.*, e.name as entity_name
          FROM relationships r
          JOIN entities e ON e.id = r.source_id
          WHERE r.source_id = ? AND r.relation_type = ? AND r.valid_to IS NULL
          ORDER BY r.last_seen_at DESC
        `).all(conflict.source_id, conflict.relation_type) as any[];
      });

      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at)
          VALUES (?, 'contradiction', ?, ?, 'pending', ?)
        `).run(
          uuid(),
          JSON.stringify({ entity_id: conflict.source_id, relation_type: conflict.relation_type, target_count: conflict.target_count }),
          JSON.stringify(memories.map((m: any) => m.id)),
          now
        );
      });
      flagged++;
    }

    // Find entities with conflicting types
    const typeConflicts = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT name, COUNT(DISTINCT type) as type_count
        FROM entities
        GROUP BY LOWER(name)
        HAVING COUNT(DISTINCT type) > 1
      `).all() as any[];
    });

    for (const conflict of typeConflicts) {
      await this.storage.write((db: any) => {
        db.prepare(`
          INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at)
          VALUES (?, 'contradiction', ?, '[]', 'pending', ?)
        `).run(
          uuid(),
          JSON.stringify({ entity_name: conflict.name, type_count: conflict.type_count }),
          now
        );
      });
      flagged++;
    }

    return { status: 'done', detail: `Flagged ${flagged} graph contradictions` };
  }

  private async graphDecaySweep(): Promise<{ status: string; detail: string }> {
    let archived = 0;
    const now = nowUtc();
    const nowDate = new Date(now);

    // Decay entities: reduce confidence for entities not mentioned recently
    const entities = this.storage.read((db: any) => {
      return db.prepare('SELECT * FROM entities WHERE pinned = 0').all() as any[];
    });

    for (const entity of entities) {
      const anchor = entity.last_seen_at;
      const anchorTime = new Date(anchor).getTime();
      const elapsedMs = Math.max(0, nowDate.getTime() - anchorTime);
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

      // Entity decay: 90-day half-life
      const decayFactor = Math.pow(0.5, elapsedDays / 90);
      const effConf = entity.confidence * decayFactor;

      // Archive if confidence < 0.3 and mention_count < 2
      if (effConf < 0.3 && entity.mention_count < 2) {
        await this.storage.write((db: any) => {
          // Delete links first
          db.prepare('DELETE FROM entity_memory_links WHERE entity_id = ?').run(entity.id);
          db.prepare('DELETE FROM entity_turn_links WHERE entity_id = ?').run(entity.id);
          // Delete relationships involving this entity
          db.prepare('DELETE FROM relationships WHERE source_id = ? OR target_id = ?').run(entity.id, entity.id);
          // Delete entity
          db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);
        });
        archived++;
      }
    }

    // Decay relationships: reduce weight for relationships not mentioned recently
    const relationships = this.storage.read((db: any) => {
      return db.prepare('SELECT * FROM relationships').all() as any[];
    });

    for (const rel of relationships) {
      const anchor = rel.last_seen_at;
      const anchorTime = new Date(anchor).getTime();
      const elapsedMs = Math.max(0, nowDate.getTime() - anchorTime);
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

      // Relationship decay: 60-day half-life
      const decayFactor = Math.pow(0.5, elapsedDays / 60);
      const effConf = rel.confidence * decayFactor;

      // Archive if confidence < 0.2
      if (effConf < 0.2) {
        await this.storage.write((db: any) => {
          db.prepare('DELETE FROM relationships WHERE id = ?').run(rel.id);
        });
        archived++;
      }
    }

    return { status: 'done', detail: `Archived ${archived} graph entities/relationships` };
  }

  isRunning(): boolean {
    return this.running;
  }
}