// src/ingest/ingest.ts — Episode ingest (03-episode-ingest.md)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc, Turn, Episode } from '../types/common.js';

export class IngestManager {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async startSession(sessionId?: string): Promise<string> {
    const sid = sessionId || uuid();
    // Create an open episode
    const episodeId = uuid();
    const now = nowUtc();
    await this.storage.write((db) => {
      db.prepare(`
        INSERT INTO episodes (id, session_id, started_at, ended_at, summary, summary_version, extractor_version)
        VALUES (?, ?, ?, NULL, NULL, NULL, NULL)
      `).run(episodeId, sid, now);
    });
    return sid;
  }

  async recordTurn(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, ts?: string, turnId?: string): Promise<{ turn_id: string; episode_id: string; recorded_at: string }> {
    const turnTs = ts || nowUtc();
    const id = turnId || uuid();
    const recordedAt = nowUtc();

    // Idempotency check
    const existing = this.storage.read((db) => {
      return db.prepare('SELECT id, content FROM turns WHERE id = ?').get(id) as { id: string; content: string } | undefined;
    });

    if (existing) {
      if (existing.content !== content) {
        throw new Error('ERR_CONFLICT: Same turn_id with different content');
      }
      // Return original result
      const ep = this.storage.read((db) => {
        return db.prepare('SELECT episode_id FROM turns WHERE id = ?').get(id) as { episode_id: string };
      });
      return { turn_id: id, episode_id: ep.episode_id, recorded_at: recordedAt };
    }

    // Find open episode for this session
    let episode = this.storage.read((db) => {
      return db.prepare('SELECT id FROM episodes WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(sessionId) as { id: string } | undefined;
    });

    if (!episode) {
      // Auto-create an episode for this session
      const episodeId = uuid();
      const now = nowUtc();
      await this.storage.write((db) => {
        db.prepare(`
          INSERT INTO episodes (id, session_id, started_at, ended_at, summary, summary_version, extractor_version)
          VALUES (?, ?, ?, NULL, NULL, NULL, NULL)
        `).run(episodeId, sessionId, now);
      });
      episode = { id: episodeId };
    }

    // Validate role
    if (!['user', 'assistant', 'system'].includes(role)) {
      throw new Error('ERR_VALIDATION: Invalid role');
    }

    if (!content || content.trim() === '') {
      throw new Error('ERR_VALIDATION: Empty content');
    }

    await this.storage.write((db) => {
      db.prepare(`
        INSERT INTO turns (id, episode_id, session_id, role, content, ts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, episode.id, sessionId, role, content, turnTs);
    });

    return { turn_id: id, episode_id: episode.id, recorded_at: recordedAt };
  }

  async endSession(sessionId: string, endedAt?: string): Promise<{ episode_id: string; accepted: boolean; pipeline_job_id: string }> {
    const endTs = endedAt || nowUtc();

    // Find open episode
    const episode = this.storage.read((db) => {
      return db.prepare('SELECT id, ended_at FROM episodes WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(sessionId) as { id: string; ended_at: string | null } | undefined;
    });

    if (!episode) {
      // Check if already ended
      const ended = this.storage.read((db) => {
        return db.prepare('SELECT id, ended_at FROM episodes WHERE session_id = ? ORDER BY started_at DESC LIMIT 1').get(sessionId) as { id: string; ended_at: string | null } | undefined;
      });
      if (ended && ended.ended_at) {
        if (ended.ended_at === endTs) {
          return { episode_id: ended.id, accepted: true, pipeline_job_id: `job-${ended.id}` };
        }
        throw new Error('ERR_CONFLICT: Session already ended with different timestamp');
      }
      throw new Error('ERR_NOT_FOUND: Unknown session');
    }

    const pipelineJobId = `job-${episode.id}`;

    await this.storage.write((db) => {
      db.prepare('UPDATE episodes SET ended_at = ? WHERE id = ?').run(endTs, episode.id);
    });

    return { episode_id: episode.id, accepted: true, pipeline_job_id: pipelineJobId };
  }

  getEpisodeTurns(episodeId: string): Turn[] {
    return this.storage.read((db) => {
      return db.prepare('SELECT * FROM turns WHERE episode_id = ? ORDER BY ts').all(episodeId) as Turn[];
    });
  }

  getOpenEpisode(sessionId: string): Episode | null {
    return this.storage.read((db) => {
      const row = db.prepare('SELECT * FROM episodes WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(sessionId) as any;
      if (!row) return null;
      return {
        id: row.id,
        session_id: row.session_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        summary: row.summary,
        summary_version: row.summary_version,
        user_affect_tags: row.user_affect_tags,
        agent_behaviour_tags: row.agent_behaviour_tags,
        extractor_version: row.extractor_version,
      };
    });
  }

  getEpisode(episodeId: string): Episode | null {
    return this.storage.read((db) => {
      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as any;
      if (!row) return null;
      return {
        id: row.id,
        session_id: row.session_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        summary: row.summary,
        summary_version: row.summary_version,
        user_affect_tags: row.user_affect_tags,
        agent_behaviour_tags: row.agent_behaviour_tags,
        extractor_version: row.extractor_version,
      };
    });
  }
}