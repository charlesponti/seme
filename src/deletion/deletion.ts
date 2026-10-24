// src/deletion/deletion.ts — Deletion & privacy (14-deletion-privacy.md)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';

export interface ForgetResult {
  scope: string;
  deleted_count: number;
  profile_recompiled: boolean;
  completed_at: string;
}

export class DeletionManager {
  private storage: Storage;
  private profileCompiler: ProfileCompiler;

  constructor(storage: Storage, profileCompiler: ProfileCompiler) {
    this.storage = storage;
    this.profileCompiler = profileCompiler;
  }

  async forgetMemory(memoryId: string): Promise<ForgetResult> {
    // Check memory exists
    const memory = this.storage.read((db: any) => db.prepare('SELECT id FROM memories WHERE id = ?').get(memoryId) as any);
    if (!memory) throw new Error('ERR_NOT_FOUND: Memory not found');

    await this.storage.write((db: any) => {
      // Delete from FTS and vec
      db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(memoryId);
      db.prepare('DELETE FROM memories_vec WHERE memory_id = ?').run(memoryId);

      // Set to deleted with empty content
      db.prepare(`
        UPDATE memories SET status = 'deleted', value_text = '', value_json = NULL, evidence_quote = ''
        WHERE id = ?
      `).run(memoryId);

      // Write healing_log
      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'delete', ?, ?, NULL, ?, 0)
      `).run(uuid(), nowUtc(), 'forget_command', JSON.stringify([memoryId]), JSON.stringify({ id: memoryId }), 'User forget request');
    });

    // Recompile profile
    await this.profileCompiler.compile('forget_command', [memoryId]);

    return { scope: 'memory', deleted_count: 1, profile_recompiled: true, completed_at: nowUtc() };
  }

  async forgetSlot(slot: string): Promise<ForgetResult> {
    const memories = this.storage.read((db: any) => db.prepare("SELECT id FROM memories WHERE slot = ? AND status != 'deleted'").all(slot) as any[]);
    let count = 0;
    for (const m of memories) {
      await this.forgetMemory(m.id);
      count++;
    }
    return { scope: 'slot', deleted_count: count, profile_recompiled: count > 0, completed_at: nowUtc() };
  }

  async forgetTopic(topic: string): Promise<ForgetResult> {
    // Find memories whose value_text or subject contains the topic
    const memories = this.storage.read((db: any) => db.prepare("SELECT id FROM memories WHERE (value_text LIKE ? OR subject LIKE ?) AND status != 'deleted'").all(`%${topic}%`, `%${topic}%`) as any[]);
    let count = 0;
    for (const m of memories) {
      await this.forgetMemory(m.id);
      count++;
    }
    return { scope: 'topic', deleted_count: count, profile_recompiled: count > 0, completed_at: nowUtc() };
  }

  async forgetEpisode(episodeId: string, confirmedIrreversible: boolean): Promise<ForgetResult> {
    if (!confirmedIrreversible) throw new Error('ERR_VALIDATION: confirmed_irreversible required for episode deletion');

    const memories = this.storage.read((db: any) => db.prepare("SELECT id FROM memories WHERE source_episode_id = ? AND status != 'deleted'").all(episodeId) as any[]);
    let count = 0;
    for (const m of memories) {
      await this.forgetMemory(m.id);
      count++;
    }

    // Delete turns and episode
    await this.storage.write((db: any) => {
      db.prepare('DELETE FROM turns WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId);
    });

    return { scope: 'episode', deleted_count: count, profile_recompiled: count > 0, completed_at: nowUtc() };
  }

  async forgetAll(confirmedIrreversible: boolean): Promise<ForgetResult> {
    if (!confirmedIrreversible) throw new Error('ERR_VALIDATION: confirmed_irreversible required for delete_all');

    const memories = this.storage.read((db: any) => db.prepare("SELECT id FROM memories WHERE status != 'deleted'").all() as any[]);
    let count = 0;
    for (const m of memories) {
      await this.storage.write((db: any) => {
        db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(m.id);
        db.prepare('DELETE FROM memories_vec WHERE memory_id = ?').run(m.id);
        db.prepare('DELETE FROM memories WHERE id = ?').run(m.id);  // Hard delete for delete_all
        db.prepare(`
          INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
          VALUES (?, ?, ?, 'delete', ?, ?, NULL, ?, 0)
        `).run(uuid(), nowUtc(), 'delete_all', JSON.stringify([m.id]), JSON.stringify({ id: m.id }), 'User delete_all');
      });
      count++;
    }

    // Delete all turns and episodes
    await this.storage.write((db: any) => {
      db.prepare('DELETE FROM turns').run();
      db.prepare('DELETE FROM episodes').run();
      db.prepare('DELETE FROM profile').run();
      db.prepare('DELETE FROM profile_versions').run();
      db.prepare('DELETE FROM procedural_rules').run();
    });

    // VACUUM
    this.storage.getDb().exec('VACUUM');

    return { scope: 'all', deleted_count: count, profile_recompiled: true, completed_at: nowUtc() };
  }

  async exportData(): Promise<{ export_id: string; created_at: string; tables_included: string[]; memory_count: number }> {
    // Check no incomplete deletions (all deleted rows have empty content)
    const incomplete = this.storage.read((db: any) => db.prepare("SELECT COUNT(*) as c FROM memories WHERE status = 'deleted' AND value_text != ''").get() as { c: number });
    if (incomplete.c > 0) throw new Error('ERR_CONFLICT: Incomplete deletion cascade');

    const exportId = uuid();
    const createdAt = nowUtc();
    const tables = ['turns', 'episodes', 'memories', 'profile', 'profile_versions', 'procedural_rules', 'healing_log', 'slot_registry', 'identity_core'];
    const memoryCount = this.storage.read((db: any) => (db.prepare("SELECT COUNT(*) as c FROM memories WHERE status != 'deleted'").get() as { c: number }).c);

    return { export_id: exportId, created_at: createdAt, tables_included: tables, memory_count: memoryCount };
  }

  getLearningState(): string {
    return this.storage.read((db: any) => {
      const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'learning_state'").get() as { value: string } | undefined;
      return row?.value || 'active';
    });
  }

  async pauseLearning(): Promise<{ learning_state: string; paused_at: string }> {
    const pausedAt = nowUtc();
    this.storage.write((db: any) => {
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('learning_state', 'paused')").run();
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('paused_at', ?)").run(pausedAt);
    });
    return { learning_state: 'paused', paused_at: pausedAt };
  }

  async resumeLearning(processPausedEpisodes: boolean = false): Promise<{ learning_state: string; resumed_at: string; paused_episodes_pending: number }> {
    const resumedAt = nowUtc();
    this.storage.write((db: any) => {
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('learning_state', 'active')").run();
      db.prepare("DELETE FROM schema_meta WHERE key = 'paused_at'").run();
    });
    return { learning_state: 'active', resumed_at: resumedAt, paused_episodes_pending: 0 };
  }
}