// src/retrieval/retrieval.ts — Retrieval (08-retrieval.md, improved)

import { Storage } from '../storage/storage.js';
import { effectiveConfidence } from '../confidence/confidence.js';
import { GraphStore } from '../graph/graph-store.js';

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
  graph_summary?: {
    entities: { name: string; type: string; mention_count: number }[];
    relationships: { source: string; relation_type: string; target: string }[];
  };
}

const RELEVANCE_FLOOR = 0.15;

export class RetrievalEngine {
  private storage: Storage;
  private graphStore: GraphStore;

  constructor(storage: Storage, graphStore?: GraphStore) {
    this.storage = storage;
    this.graphStore = graphStore || new GraphStore(storage);
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
      const sanitized = userMessage.replace(/[?*"()]/g, ' ').trim();
      const ftsResults = this.storage.read((db: any) => {
        return db.prepare(`
          SELECT memory_id FROM memories_fts
          WHERE memories_fts MATCH ?
          LIMIT 20
        `).all(sanitized) as { memory_id: string }[];
      });
      for (const r of ftsResults) candidateIds.add(r.memory_id);
    } catch {
      // FTS5 query syntax error — fall through to keyword matching
    }

    // 2. Exact keyword match (strip punctuation)
    const words = userMessage.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    for (const m of allActive) {
      const text = `${m.subject} ${m.predicate} ${m.value_text}`.toLowerCase();
      if (words.some(w => text.includes(w))) {
        candidateIds.add(m.id);
      }
    }

    // 3. Graph-aware search: entity lookup + traversal
    const graphMatchedMemoryIds = new Map<string, number>();
    let graphEntities: { name: string; type: string; mention_count: number }[] = [];
    let graphRelationships: { source: string; relation_type: string; target: string }[] = [];

    try {
      const allEntities = this.graphStore.listEntities(undefined, undefined, 1000, 0).entities;
      const queryLower = userMessage.toLowerCase();
      const matchedEntities = [];

      for (const entity of allEntities) {
        const nameLower = entity.name.toLowerCase();
        if (queryLower.includes(nameLower) && nameLower.length > 2) {
          matchedEntities.push(entity);
        }
        for (const alias of entity.aliases) {
          if (queryLower.includes(alias.toLowerCase()) && alias.length > 2) {
            matchedEntities.push(entity);
            break;
          }
        }
      }

      const seenEntityIds = new Set();
      const uniqueMatched = matchedEntities.filter(e => {
        if (seenEntityIds.has(e.id)) return false;
        seenEntityIds.add(e.id);
        return true;
      });

      const visitedEntityIds = new Set();
      const entityHopMap = new Map();

      for (const entity of uniqueMatched) {
        if (visitedEntityIds.has(entity.id)) continue;
        visitedEntityIds.add(entity.id);
        entityHopMap.set(entity.id, 0);
      }

      for (const entity of uniqueMatched) {
        const neigh = this.graphStore.getNeighborhood(entity.id, 1);
        for (const n of neigh.entities) {
          if (!visitedEntityIds.has(n.id)) {
            visitedEntityIds.add(n.id);
            entityHopMap.set(n.id, 1);
          }
        }
      }

      for (const entity of uniqueMatched) {
        const neigh = this.graphStore.getNeighborhood(entity.id, 2);
        for (const n of neigh.entities) {
          if (!visitedEntityIds.has(n.id)) {
            visitedEntityIds.add(n.id);
            entityHopMap.set(n.id, 2);
          }
        }
      }

      for (const [entityId, hop] of entityHopMap.entries()) {
        const links = this.storage.read((db: any) => {
          return db.prepare('SELECT memory_id FROM entity_memory_links WHERE entity_id = ?').all(entityId) as { memory_id: string }[];
        });
        const score = hop === 0 ? 1.0 : hop === 1 ? 0.7 : 0.4;
        for (const link of links) {
          const existing = graphMatchedMemoryIds.get(link.memory_id);
          if (existing === undefined || score > existing) {
            graphMatchedMemoryIds.set(link.memory_id, hop);
          }
        }
      }

      for (const memId of graphMatchedMemoryIds.keys()) {
        candidateIds.add(memId);
      }

      graphEntities = (Array.from(visitedEntityIds) as string[]).map((id: string) => {
        const e = this.graphStore.getEntity(id);
        return e ? { name: e.name, type: e.type, mention_count: e.mention_count } : null;
      }).filter((e): e is { name: string; type: string; mention_count: number } => e !== null);

      const snapshot = this.graphStore.getGraphSnapshot();
      graphRelationships = snapshot.relationships
        .filter(r => visitedEntityIds.has(r.source_id) && visitedEntityIds.has(r.target_id))
        .map(r => {
          const src = snapshot.entities.find(e => e.id === r.source_id);
          const tgt = snapshot.entities.find(e => e.id === r.target_id);
          return {
            source: src ? src.name : r.source_id,
            relation_type: r.relation_type,
            target: tgt ? tgt.name : r.target_id,
          };
        });
    } catch {
      // Graph search failed — fall through
    }

    // 4. Fallback: if no candidates and single-word query, return all active
    if (candidateIds.size === 0 && allActive.length > 0 && userMessage.trim().split(/\s+/).length <= 1) {
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
      graph_summary: graphEntities.length > 0 ? { entities: graphEntities, relationships: graphRelationships } : undefined,
    };
  }
}
