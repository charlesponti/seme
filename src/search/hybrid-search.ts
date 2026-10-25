// src/search/hybrid-search.ts — Cross-layer hybrid search

import { Storage } from '../storage/storage.js';
import { WikiStore } from '../wiki/wiki-store.js';
import { GraphStore } from '../graph/graph-store.js';

export interface HybridSearchResult {
  query: string;
  context: string;
  layers: {
    turns: { id: string; content: string; score: number }[];
    memories: { id: string; value_text: string; kind: string; score: number }[];
    wiki: { id: string; title: string; content: string; score: number }[];
    graph: { entities: any[]; relationships: any[] };
  };
  total_results: number;
  abstain: boolean;
}

export class HybridSearch {
  private storage: Storage;
  private wikiStore: WikiStore;
  private graphStore: GraphStore;

  constructor(storage: Storage, wikiStore: WikiStore, graphStore: GraphStore) {
    this.storage = storage;
    this.wikiStore = wikiStore;
    this.graphStore = graphStore;
  }

  search(query: string, options?: { limit?: number; include_turns?: boolean; include_memories?: boolean; include_wiki?: boolean; include_graph?: boolean }): HybridSearchResult {
    const limit = options?.limit || 20;
    const includeTurns = options?.include_turns !== false;
    const includeMemories = options?.include_memories !== false;
    const includeWiki = options?.include_wiki !== false;
    const includeGraph = options?.include_graph !== false;

    const result: HybridSearchResult = {
      query,
      context: '',
      layers: { turns: [], memories: [], wiki: [], graph: { entities: [], relationships: [] } },
      total_results: 0,
      abstain: true,
    };

    // 1. Search turns (FTS)
    if (includeTurns) {
      try {
        const turns = this.storage.read((db: any) => {
          return db.prepare(`
            SELECT t.id, t.content, t.role, t.ts
            FROM turns t
            JOIN turns_fts ON turns_fts.rowid = t.rowid
            WHERE turns_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(query, limit) as any[];
        });
        result.layers.turns = turns.map((t: any, i: number) => ({
          id: t.id,
          content: t.content,
          score: 1 - (i / Math.max(turns.length, 1)),
        }));
      } catch {
        // FTS not available or no matches
      }
    }

    // 2. Search memories (FTS)
    if (includeMemories) {
      try {
        const mems = this.storage.read((db: any) => {
          return db.prepare(`
            SELECT m.id, m.value_text, m.kind, m.subject, m.predicate
            FROM memories m
            JOIN memories_fts ON memories_fts.memory_id = m.id
            WHERE memories_fts MATCH ? AND m.status = 'active'
            ORDER BY rank
            LIMIT ?
          `).all(query, limit) as any[];
        });
        result.layers.memories = mems.map((m: any, i: number) => ({
          id: m.id,
          value_text: m.value_text,
          kind: m.kind,
          score: 1 - (i / Math.max(mems.length, 1)),
        }));
      } catch {
        // Fallback: keyword search
        const allMems = this.storage.read((db: any) => db.prepare("SELECT id, value_text, kind FROM memories WHERE status = 'active'").all()) as any[];
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        result.layers.memories = allMems
          .filter((m: any) => words.some(w => m.value_text.toLowerCase().includes(w)))
          .slice(0, limit)
          .map((m: any, i: number) => ({
            id: m.id,
            value_text: m.value_text,
            kind: m.kind,
            score: 1 - (i / Math.max(allMems.length, 1)),
          }));
      }
    }

    // 3. Search wiki pages
    if (includeWiki) {
      const wikiPages = this.wikiStore.searchPages(query, limit);
      result.layers.wiki = wikiPages.map((p: any, i: number) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        score: 1 - (i / Math.max(wikiPages.length, 1)),
      }));
    }

    // 4. Search graph (entity name matching)
    if (includeGraph) {
      const entities = this.storage.read((db: any) => {
        return db.prepare("SELECT * FROM entities WHERE name LIKE ? OR aliases LIKE ?").all(`%${query}%`, `%${query}%`) as any[];
      });
      if (entities.length > 0) {
        const entityIds = entities.map((e: any) => e.id);
        const relationships = this.storage.read((db: any) => {
          const placeholders = entityIds.map(() => '?').join(',');
          return db.prepare(`SELECT * FROM relationships WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`).all(...entityIds, ...entityIds) as any[];
        });
        result.layers.graph = {
          entities: entities.map((e: any) => ({ id: e.id, name: e.name, type: e.type })),
          relationships: relationships.map((r: any) => ({ id: r.id, source_id: r.source_id, target_id: r.target_id, relation_type: r.relation_type })),
        };
      }
    }

    // Calculate total results
    result.total_results = result.layers.turns.length + result.layers.memories.length + result.layers.wiki.length + result.layers.graph.entities.length;

    // Build LLM-ready context string
    const contextParts: string[] = [];
    if (result.layers.memories.length > 0) {
      contextParts.push('## Memories');
      for (const m of result.layers.memories) {
        contextParts.push(`- [${m.kind}] ${m.value_text}`);
      }
    }
    if (result.layers.wiki.length > 0) {
      contextParts.push('## Wiki Pages');
      for (const w of result.layers.wiki) {
        contextParts.push(`### ${w.title}\n${w.content.substring(0, 500)}`);
      }
    }
    if (result.layers.graph.entities.length > 0) {
      contextParts.push('## Knowledge Graph');
      for (const e of result.layers.graph.entities) {
        contextParts.push(`- ${e.name} (${e.type})`);
      }
      for (const r of result.layers.graph.relationships) {
        contextParts.push(`  - ${r.relation_type}: ${r.source_id} → ${r.target_id}`);
      }
    }
    if (result.layers.turns.length > 0) {
      contextParts.push('## Relevant Turns');
      for (const t of result.layers.turns) {
        contextParts.push(`- ${t.content.substring(0, 200)}`);
      }
    }

    result.context = contextParts.join('\n');
    result.abstain = result.total_results === 0;

    return result;
  }
}
