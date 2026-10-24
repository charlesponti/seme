// src/retrieval/retrieval.ts — Retrieval (08-retrieval.md, improved)

import { Storage } from '../storage/storage.js';
import { effectiveConfidence } from '../confidence/confidence.js';

export interface RetrievalContext {
  identity_core_ref: string;
  profile_text: string;
  procedural_rules: { id: string; rule_text: string; priority: string }[];
  memories: {
    id: string; kind: string; slot: string | null; value_text: string;
    source_type: string; confidence: number; observed_at: string;
    valid_from: string; valid_to: string | null;
  }[];
  episodes: { id: string; summary: string; started_at: string }[];
  abstain: boolean;
}

const RELEVANCE_FLOOR = 0.15;

export class RetrievalEngine {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  retrieve(sessionId: string, userMessage: string, timeRangeHint?: { from?: string; to?: string; historical?: boolean }): RetrievalContext {
    const now = new Date().toISOString();
    const isHistorical = timeRangeHint?.historical === true;

    // Identity core
    const identityCore = this.storage.read((db: any) => {
      return db.prepare('SELECT id, rendered_text FROM identity_core WHERE id = ?').get('singleton') as { id: string; rendered_text: string } | undefined;
    });

    // Profile
    const profile = this.storage.read((db: any) => {
      return db.prepare('SELECT rendered_text FROM profile WHERE id = ?').get('singleton') as { rendered_text: string } | undefined;
    });

    // Procedural rules (active, ordered by priority)
    const rules = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT * FROM procedural_rules WHERE status = 'active'
        ORDER BY CASE priority WHEN 'boundary' THEN 1 WHEN 'preference' THEN 2 WHEN 'style' THEN 3 END
      `).all() as any[];
    });

    // All active memories
    const allActive = this.storage.read((db: any) => {
      return db.prepare(`SELECT * FROM memories WHERE status = 'active'`).all() as any[];
    });

    // Hybrid retrieval: FTS5 + exact keyword match
    const candidateIds = new Set<string>();

    // 1. FTS5 keyword search
    try {
      const ftsResults = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT memory_id FROM memories_fts
          WHERE memories_fts MATCH ?
          LIMIT 20
        `).all(userMessage) as { memory_id: string }[];
      });
      for (const r of ftsResults) candidateIds.add(r.memory_id);
    } catch {
      // FTS5 query syntax error — fall through to keyword matching
    }

    // 2. Exact keyword match
    const words = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const m of allActive) {
      const text = `${m.subject} ${m.predicate} ${m.value_text}`.toLowerCase();
      if (words.some(w => text.includes(w))) {
        candidateIds.add(m.id);
      }
    }

    // 3. Fallback: if no candidates and short query, return all active
    if (candidateIds.size === 0 && allActive.length > 0 && userMessage.split(/\s+/).length <= 3) {
      for (const m of allActive) candidateIds.add(m.id);
    }

    // Fetch candidate memories
    const candidateMemories = allActive.filter(m => candidateIds.has(m.id));

    // Filter by relevance floor (effective confidence)
    const relevantMemories = candidateMemories.filter(m => {
      const effConf = effectiveConfidence(m, now);
      return effConf >= RELEVANCE_FLOOR;
    });

    // Filter by validity: exclude superseded unless historical
    const filteredMemories = relevantMemories.filter(m => {
      if (m.valid_to !== null && !isHistorical) return false;
      return true;
    });

    // Historical: include superseded memories
    if (isHistorical) {
      const supersededMemories = this.storage.read((db: any) => {
        return db.prepare(`SELECT * FROM memories WHERE status = 'superseded' ORDER BY superseded_at DESC LIMIT 10`).all() as any[];
      });
      for (const m of supersededMemories) {
        if (!filteredMemories.some(fm => fm.id === m.id)) {
          filteredMemories.push(m);
        }
      }
    }

    // Sort by effective confidence (desc), then reinforcement count
    filteredMemories.sort((a, b) => {
      const effA = effectiveConfidence(a, now);
      const effB = effectiveConfidence(b, now);
      if (effB !== effA) return effB - effA;
      return (b.reinforcement_count || 0) - (a.reinforcement_count || 0);
    });

    const topMemories = filteredMemories.slice(0, 20);

    // Episodic recall
    let episodes: { id: string; summary: string; started_at: string }[] = [];
    if (timeRangeHint?.from || timeRangeHint?.to) {
      episodes = this.storage.read((db: any) => {
        let query = 'SELECT id, summary, started_at FROM episodes WHERE summary IS NOT NULL';
        const params: any[] = [];
        if (timeRangeHint.from) { query += ' AND started_at >= ?'; params.push(timeRangeHint.from); }
        if (timeRangeHint.to) { query += ' AND started_at <= ?'; params.push(timeRangeHint.to); }
        query += ' ORDER BY started_at DESC LIMIT 5';
        return db.prepare(query).all(...params) as any[];
      });
    }

    // Access logging
    if (topMemories.length > 0) {
      this.storage.write((db: any) => {
        const stmt = db.prepare('UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?');
        for (const m of topMemories) stmt.run(now, m.id);
      });
    }

    const abstain = topMemories.length === 0;

    return {
      identity_core_ref: identityCore?.id || '',
      profile_text: profile?.rendered_text || '',
      procedural_rules: rules.map((r: any) => ({ id: r.id, rule_text: r.rule_text, priority: r.priority })),
      memories: topMemories.map((m: any) => ({
        id: m.id, kind: m.kind, slot: m.slot, value_text: m.value_text,
        source_type: m.source_type, confidence: m.confidence, observed_at: m.observed_at,
        valid_from: m.valid_from || m.observed_at, valid_to: m.valid_to,
      })),
      episodes: episodes.map((e: any) => ({ id: e.id, summary: e.summary, started_at: e.started_at })),
      abstain,
    };
  }
}
