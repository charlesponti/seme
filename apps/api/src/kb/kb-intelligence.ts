// src/kb/kb-intelligence.ts — KB Intelligence: challenge, emerge, connect, contradictions, lint

import { Storage } from '../storage/storage.js';
import { WikiStore } from '../wiki/wiki-store.js';
import { GraphStore } from '../graph/graph-store.js';

export interface ChallengeResult {
  claim: string;
  supporting: { id: string; value_text: string; confidence: number }[];
  contradicting: { id: string; value_text: string; confidence: number }[];
  verdict: 'supported' | 'contradicted' | 'unknown' | 'insufficient';
  confidence: number;
}

export interface EmergeResult {
  patterns: { pattern: string; memories: string[]; count: number }[];
  total_memories: number;
}

export interface ConnectResult {
  topic_a: string;
  topic_b: string;
  connections: { entity: string; path: string[]; relationship: string }[];
  bridges: string[];
}

export interface Contradiction {
  memory_a: { id: string; value_text: string };
  memory_b: { id: string; value_text: string };
  slot: string;
  severity: 'high' | 'medium' | 'low';
}

export interface LintResult {
  issues: { type: string; severity: string; description: string; memory_ids?: string[] }[];
  total_issues: number;
  health_score: number;
}

export class KBIntelligence {
  private storage: Storage;
  private wikiStore: WikiStore;
  private graphStore: GraphStore;

  constructor(storage: Storage, wikiStore: WikiStore, graphStore: GraphStore) {
    this.storage = storage;
    this.wikiStore = wikiStore;
    this.graphStore = graphStore;
  }

  challenge(claim: string): ChallengeResult {
    const memories = this.storage.read((db: any) => db.prepare("SELECT id, value_text, confidence, slot FROM memories WHERE status = 'active'").all()) as any[];
    const words = claim.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const supporting: any[] = [];
    const contradicting: any[] = [];

    for (const m of memories) {
      const text = m.value_text.toLowerCase();
      const overlap = words.filter(w => text.includes(w)).length;
      if (overlap >= 2) {
        // Check for negation indicators
        const isNegation = text.includes('not') || text.includes("don't") || text.includes('never') || text.includes('no ');
        const claimHasNegation = claim.toLowerCase().includes('not') || claim.toLowerCase().includes("don't") || claim.toLowerCase().includes('never');
        if (isNegation !== claimHasNegation) {
          contradicting.push({ id: m.id, value_text: m.value_text, confidence: m.confidence });
        } else {
          supporting.push({ id: m.id, value_text: m.value_text, confidence: m.confidence });
        }
      }
    }

    let verdict: ChallengeResult['verdict'] = 'unknown';
    let confidence = 0;
    if (supporting.length > 0 && contradicting.length === 0) {
      verdict = 'supported';
      confidence = supporting.reduce((s, m) => s + m.confidence, 0) / supporting.length;
    } else if (contradicting.length > 0) {
      verdict = 'contradicted';
      confidence = contradicting.reduce((s, m) => s + m.confidence, 0) / contradicting.length;
    } else if (supporting.length === 0 && contradicting.length === 0) {
      verdict = 'insufficient';
      confidence = 0;
    }

    return { claim, supporting, contradicting, verdict, confidence };
  }

  emerge(): EmergeResult {
    const memories = this.storage.read((db: any) => db.prepare("SELECT id, value_text, kind, slot FROM memories WHERE status = 'active'").all()) as any[];
    const patterns: { pattern: string; memories: string[]; count: number }[] = [];

    // Pattern 1: Group by kind
    const byKind: Record<string, string[]> = {};
    for (const m of memories) {
      if (!byKind[m.kind]) byKind[m.kind] = [];
      byKind[m.kind].push(m.id);
    }
    for (const [kind, ids] of Object.entries(byKind)) {
      if (ids.length >= 2) {
        patterns.push({ pattern: `Multiple ${kind} memories (${ids.length})`, memories: ids, count: ids.length });
      }
    }

    // Pattern 2: Group by slot
    const bySlot: Record<string, string[]> = {};
    for (const m of memories) {
      if (!m.slot) continue;
      if (!bySlot[m.slot]) bySlot[m.slot] = [];
      bySlot[m.slot].push(m.id);
    }
    for (const [slot, ids] of Object.entries(bySlot)) {
      if (ids.length >= 2) {
        patterns.push({ pattern: `Multiple memories for slot '${slot}' (${ids.length})`, memories: ids, count: ids.length });
      }
    }

    // Pattern 3: Subject clustering
    const bySubject: Record<string, string[]> = {};
    for (const m of memories) {
      const subject = m.subject || 'unknown';
      if (!bySubject[subject]) bySubject[subject] = [];
      bySubject[subject].push(m.id);
    }
    for (const [subject, ids] of Object.entries(bySubject)) {
      if (ids.length >= 3) {
        patterns.push({ pattern: `Subject '${subject}' has ${ids.length} memories`, memories: ids, count: ids.length });
      }
    }

    return { patterns, total_memories: memories.length };
  }

  connect(topicA: string, topicB: string): ConnectResult {
    const entitiesA = this.storage.read((db: any) => db.prepare("SELECT * FROM entities WHERE name LIKE ? OR aliases LIKE ?").all(`%${topicA}%`, `%${topicA}%`)) as any[];
    const entitiesB = this.storage.read((db: any) => db.prepare("SELECT * FROM entities WHERE name LIKE ? OR aliases LIKE ?").all(`%${topicB}%`, `%${topicB}%`)) as any[];

    const connections: { entity: string; path: string[]; relationship: string }[] = [];
    const bridges: string[] = [];

    // Find entities that connect both topics (shared neighbors)
    for (const ea of entitiesA) {
      for (const eb of entitiesB) {
        if (ea.id === eb.id) continue;
        const path = this.graphStore.findPath(ea.id, eb.id);
        if (path) {
          connections.push({
            entity: `${ea.name} → ${eb.name}`,
            path: path.path.map((e: any) => e.name),
            relationship: path.relationships.map((r: any) => r.relation_type).join(', '),
          });
        }
      }
    }

    // Find bridge entities (entities connected to both)
    const neighborsA = new Set<string>();
    const neighborsB = new Set<string>();
    for (const ea of entitiesA) {
      const n = this.graphStore.getNeighborhood(ea.id, 2);
      for (const e of n.entities) neighborsA.add(e.id);
    }
    for (const eb of entitiesB) {
      const n = this.graphStore.getNeighborhood(eb.id, 2);
      for (const e of n.entities) neighborsB.add(e.id);
    }
    const shared = [...neighborsA].filter(id => neighborsB.has(id));
    for (const id of shared) {
      const entity = this.graphStore.getEntity(id);
      if (entity) bridges.push(entity.name);
    }

    return { topic_a: topicA, topic_b: topicB, connections, bridges };
  }

  contradictions(): Contradiction[] {
    const memories = this.storage.read((db: any) => db.prepare("SELECT id, value_text, slot, confidence FROM memories WHERE status = 'active'").all()) as any[];
    const result: Contradiction[] = [];

    const bySlot: Record<string, any[]> = {};
    for (const m of memories) {
      if (!m.slot) continue;
      if (!bySlot[m.slot]) bySlot[m.slot] = [];
      bySlot[m.slot].push(m);
    }

    for (const slot of Object.keys(bySlot)) {
      const items = bySlot[slot];
      if (items.length < 2) continue;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (items[i].value_text !== items[j].value_text) {
            const severity = (items[i].confidence > 0.8 && items[j].confidence > 0.8) ? 'high' :
                             (items[i].confidence > 0.5 || items[j].confidence > 0.5) ? 'medium' : 'low';
            result.push({
              memory_a: { id: items[i].id, value_text: items[i].value_text },
              memory_b: { id: items[j].id, value_text: items[j].value_text },
              slot,
              severity,
            });
          }
        }
      }
    }

    return result;
  }

  lint(): LintResult {
    const issues: LintResult['issues'] = [];
    const memories = this.storage.read((db: any) => db.prepare("SELECT id, value_text, kind, slot, confidence, status, source_type FROM memories").all()) as any[];

    // Check 1: Low confidence active memories
    const lowConf = memories.filter(m => m.status === 'active' && m.confidence < 0.5);
    if (lowConf.length > 0) {
      issues.push({ type: 'low_confidence', severity: 'medium', description: `${lowConf.length} active memories with confidence < 0.5`, memory_ids: lowConf.map(m => m.id) });
    }

    // Check 2: Memories without slots
    const noSlot = memories.filter(m => m.status === 'active' && !m.slot);
    if (noSlot.length > 5) {
      issues.push({ type: 'missing_slot', severity: 'low', description: `${noSlot.length} active memories without a slot`, memory_ids: noSlot.map(m => m.id) });
    }

    // Check 3: Duplicate value_text
    const seen = new Map<string, string[]>();
    for (const m of memories.filter(m => m.status === 'active')) {
      const key = m.value_text.toLowerCase().trim();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(m.id);
    }
    const dupes = [...seen.entries()].filter(([_, ids]) => ids.length > 1);
    if (dupes.length > 0) {
      issues.push({ type: 'duplicate', severity: 'medium', description: `${dupes.length} duplicate memory values found`, memory_ids: dupes.flatMap(([_, ids]) => ids) });
    }

    // Check 4: Orphaned entities (no relationships)
    const orphaned = this.storage.read((db: any) => {
      return db.prepare("SELECT e.id, e.name FROM entities e LEFT JOIN relationships r ON r.source_id = e.id OR r.target_id = e.id WHERE r.id IS NULL").all() as any[];
    });
    if (orphaned.length > 0) {
      issues.push({ type: 'orphaned_entity', severity: 'low', description: `${orphaned.length} entities with no relationships`, memory_ids: orphaned.map((e: any) => e.id) });
    }

    // Check 5: Deprecated wiki pages
    const deprecatedPages = this.storage.read((db: any) => db.prepare("SELECT COUNT(*) as c FROM wiki_pages WHERE status = 'deprecated'").get() as { c: number });
    if (deprecatedPages.c > 0) {
      issues.push({ type: 'deprecated_pages', severity: 'low', description: `${deprecatedPages.c} deprecated wiki pages` });
    }

    const healthScore = Math.max(0, 1 - (issues.length * 0.1));
    return { issues, total_issues: issues.length, health_score: Math.round(healthScore * 100) / 100 };
  }
}
