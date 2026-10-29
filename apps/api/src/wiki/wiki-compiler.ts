// src/wiki/wiki-compiler.ts — Auto-generate wiki pages from memories per entity

import { WikiStore, WikiPage } from './wiki-store.js';
import { Storage } from '../storage/storage.js';

export interface WikiCompileResult {
  page_id: string;
  entity_name: string;
  page_type: string;
  maturity: string;
  memories_used: number;
}

export class WikiCompiler {
  private storage: Storage;
  private wikiStore: WikiStore;

  constructor(storage: Storage, wikiStore: WikiStore) {
    this.storage = storage;
    this.wikiStore = wikiStore;
  }

  /**
   * Compile a wiki page for an entity from its linked memories.
   * If a page already exists, update it with new memories.
   */
  compileForEntity(entityId: string, entityName: string): WikiCompileResult | null {
    const memories = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT m.* FROM memories m
        JOIN entity_memory_links eml ON eml.memory_id = m.id
        WHERE eml.entity_id = ? AND m.status = 'active'
        ORDER BY m.observed_at DESC
      `).all(entityId) as any[];
    });

    // Also get memories that mention the entity name in value_text
    const nameMemories = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT * FROM memories WHERE status = 'active' AND (value_text LIKE ? OR subject LIKE ?)
        ORDER BY observed_at DESC
      `).all(`%${entityName}%`, `%${entityName}%`) as any[];
    });

    // Merge and deduplicate
    const allMemories = [...memories, ...nameMemories];
    const seen = new Set<string>();
    const unique = allMemories.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    if (unique.length === 0) return null;

    // Determine page type from memory kinds
    const kinds = new Set(unique.map(m => m.kind));
    let pageType = 'fact';
    if (kinds.has('decision')) pageType = 'decision';
    else if (kinds.has('reference')) pageType = 'reference';
    else if (kinds.has('anti_pattern')) pageType = 'anti_pattern';
    else if (kinds.has('observation')) pageType = 'observation';
    else if (kinds.has('preference')) pageType = 'preference';

    // Determine maturity based on confidence and evidence count
    const avgConfidence = unique.reduce((sum, m) => sum + m.confidence, 0) / unique.length;
    const maturity = avgConfidence >= 0.9 && unique.length >= 3 ? 'stable' :
                     avgConfidence >= 0.7 ? 'draft' : 'draft';

    // Generate content
    const content = this.generateContent(entityName, unique, pageType);

    // Check if page already exists
    const existing = this.wikiStore.getPageByEntity(entityId, pageType);

    const memoryIds = unique.map(m => m.id);

    if (existing) {
      // Update existing page. Title and entity_name are refreshed too: pages
      // created before the entity-name lookup was fixed still carry a UUID as
      // their title, and a recompile is the natural place to heal that.
      this.wikiStore.updatePage(existing.id, {
        title: entityName,
        content,
        maturity,
        updated_by: 'system',
        reason: `Recompiled from ${unique.length} memories`,
      });
      // Update source_memory_ids
      const db = this.storage.getDb();
      db.prepare('UPDATE wiki_pages SET source_memory_ids = ?, entity_name = ? WHERE id = ?').run(
        JSON.stringify(memoryIds),
        entityName,
        existing.id
      );
      return { page_id: existing.id, entity_name: entityName, page_type: pageType, maturity, memories_used: unique.length };
    } else {
      // Create new page
      const pageId = this.wikiStore.createPage({
        entity_id: entityId,
        entity_name: entityName,
        title: entityName,
        content,
        page_type: pageType,
        maturity,
        source_memory_ids: memoryIds,
        updated_by: 'system',
      });
      return { page_id: pageId, entity_name: entityName, page_type: pageType, maturity, memories_used: unique.length };
    }
  }

  /**
   * Compile wiki pages for all entities that have linked memories.
   */
  compileAll(): WikiCompileResult[] {
    const entities = this.storage.read((db: any) => {
      return db.prepare('SELECT id, name FROM entities').all() as { id: string; name: string }[];
    });

    const results: WikiCompileResult[] = [];
    for (const entity of entities) {
      const result = this.compileForEntity(entity.id, entity.name);
      if (result) results.push(result);
    }
    return results;
  }

  /**
   * Generate markdown content from memories.
   */
  private generateContent(entityName: string, memories: any[], pageType: string): string {
    const lines: string[] = [];
    lines.push(`# ${entityName}`);
    lines.push('');
    lines.push(`> Auto-generated wiki page. Type: ${pageType}. Memories: ${memories.length}.`);
    lines.push('');

    // Group memories by kind
    const byKind: Record<string, any[]> = {};
    for (const m of memories) {
      if (!byKind[m.kind]) byKind[m.kind] = [];
      byKind[m.kind].push(m);
    }

    const kindOrder = ['fact', 'preference', 'decision', 'reference', 'interest', 'routine', 'relationship', 'observation', 'anti_pattern', 'trait_inference'];
    for (const kind of kindOrder) {
      const items = byKind[kind];
      if (!items || items.length === 0) continue;

      const heading = kind.charAt(0).toUpperCase() + kind.slice(1) + 's';
      lines.push(`## ${heading}`);
      lines.push('');
      for (const m of items) {
        lines.push(`- ${m.value_text}`);
        if (m.evidence_quote) {
          lines.push(`  > "${m.evidence_quote}"`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`*Last compiled: ${new Date().toISOString()}*`);
    lines.push(`*Source memories: ${memories.length}*`);

    return lines.join('\n');
  }

  /**
   * Detect conflicts between memories for an entity.
   * Returns pairs of memory IDs that contradict each other.
   */
  detectConflicts(entityId: string): string[][] {
    const memories = this.storage.read((db: any) => {
      return db.prepare(`
        SELECT m.* FROM memories m
        JOIN entity_memory_links eml ON eml.memory_id = m.id
        WHERE eml.entity_id = ? AND m.status = 'active'
      `).all(entityId) as any[];
    });

    const conflicts: string[][] = [];
    // Simple conflict detection: same slot, different value_text
    const bySlot: Record<string, any[]> = {};
    for (const m of memories) {
      if (!m.slot) continue;
      if (!bySlot[m.slot]) bySlot[m.slot] = [];
      bySlot[m.slot].push(m);
    }

    for (const slot of Object.keys(bySlot)) {
      const items = bySlot[slot];
      if (items.length < 2) continue;
      // Check for different values
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (items[i].value_text !== items[j].value_text) {
            conflicts.push([items[i].id, items[j].id]);
          }
        }
      }
    }

    return conflicts;
  }
}
