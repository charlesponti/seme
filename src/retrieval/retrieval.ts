// src/retrieval/retrieval.ts — Retrieval (08-retrieval.md)

import { Storage } from '../storage/storage.js';
import { Memory, ProceduralRule } from '../types/common.js';
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

export class RetrievalEngine {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  retrieve(sessionId: string, userMessage: string): RetrievalContext {
    const now = new Date().toISOString();

    // Identity core
    const identityCore = this.storage.read((db) => {
      return db.prepare('SELECT id, rendered_text FROM identity_core WHERE id = ?').get('singleton') as { id: string; rendered_text: string } | undefined;
    });

    // Profile
    const profile = this.storage.read((db) => {
      return db.prepare('SELECT rendered_text FROM profile WHERE id = ?').get('singleton') as { rendered_text: string } | undefined;
    });

    // Procedural rules (active, ordered by priority)
    const rules = this.storage.read((db) => {
      return db.prepare(`
        SELECT * FROM procedural_rules WHERE status = 'active'
        ORDER BY CASE priority WHEN 'boundary' THEN 1 WHEN 'preference' THEN 2 WHEN 'style' THEN 3 END
      `).all() as any[];
    });

    // Active memories (ranked by effective confidence)
    const activeMemories = this.storage.read((db) => {
      return db.prepare(`
        SELECT * FROM memories WHERE status = 'active'
        ORDER BY confidence DESC, reinforcement_count DESC
        LIMIT 20
      `).all() as any[];
    });

    // Filter by relevance (simple keyword match for V1)
    // If no keyword match, return all active memories (don't abstain if memories exist)
    let relevantMemories = activeMemories.filter(m => {
      const text = `${m.subject} ${m.predicate} ${m.value_text}`.toLowerCase();
      const query = userMessage.toLowerCase();
      const words = query.split(/\s+/).filter(w => w.length > 3);
      if (words.length === 0) return true;
      return words.some(w => text.includes(w));
    });

    if (relevantMemories.length === 0 && activeMemories.length > 0) {
      relevantMemories = activeMemories.slice(0, 10);
    }

    // Determine abstain
    const abstain = relevantMemories.length === 0;

    return {
      identity_core_ref: identityCore?.id || '',
      profile_text: profile?.rendered_text || '',
      procedural_rules: rules.map(r => ({
        id: r.id,
        rule_text: r.rule_text,
        priority: r.priority,
      })),
      memories: relevantMemories.map(m => ({
        id: m.id,
        kind: m.kind,
        slot: m.slot,
        value_text: m.value_text,
        source_type: m.source_type,
        confidence: m.confidence,
        observed_at: m.observed_at,
        valid_from: m.valid_from || m.observed_at,
        valid_to: m.valid_to,
      })),
      episodes: [],
      abstain,
    };
  }
}