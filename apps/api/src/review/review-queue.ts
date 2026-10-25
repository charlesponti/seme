// src/review/review-queue.ts — Review queue (13-review-ui.md)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface ReviewItem {
  item_id: string;
  item_type: string;
  created_at: string;
  summary: string;
  memory_ids: string[];
  healing_log_id: string | null;
}

export class ReviewQueue {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  list(limit: number = 50, offset: number = 0, itemType?: string): { items: ReviewItem[]; total: number } {
    return this.storage.read((db: any) => {
      let query = "SELECT * FROM review_items WHERE status = 'pending'";
      const params: any[] = [];
      if (itemType) {
        query += ' AND kind = ?';
        params.push(itemType);
      }
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params) as any[];
      const total = (db.prepare("SELECT COUNT(*) as c FROM review_items WHERE status = 'pending'" + (itemType ? ' AND kind = ?' : '')).get(...(itemType ? [itemType] : [])) as { c: number }).c;

      const items: ReviewItem[] = rows.map((r: any) => ({
        item_id: r.id,
        item_type: r.kind,
        created_at: r.created_at,
        summary: this.buildSummary(r),
        memory_ids: JSON.parse(r.memory_ids || '[]'),
        healing_log_id: null,
      }));

      return { items, total };
    });
  }

  private buildSummary(row: any): string {
    try {
      const payload = JSON.parse(row.payload_json);
      switch (row.kind) {
        case 'contradiction':
          return `Contradiction in slot: ${payload.slot || 'unknown'} (${payload.memory_count || 0} memories)`;
        case 'held_profile':
          return `Profile change held for review (v${payload.version || '?'})`;
        case 'digest':
          return payload.summary || 'Weekly digest';
        case 'quarantine':
          return `Quarantined memory: ${payload.reason || 'unknown reason'}`;
        case 'repair_proposal':
          return payload.summary || 'Repair proposal';
        case 'adaptation_proposal':
          return payload.summary || 'Adaptation proposal';
        default:
          return 'Review item';
      }
    } catch {
      return 'Review item';
    }
  }

  async resolve(itemId: string, decision: string, chosenMemoryId?: string, editedValueText?: string): Promise<{ item_id: string; resolved: boolean; affected_memory_ids: string[] }> {
    const item = this.storage.read((db: any) => {
      return db.prepare('SELECT * FROM review_items WHERE id = ?').get(itemId) as any;
    });

    if (!item) throw new Error('ERR_NOT_FOUND: Review item not found');
    if (item.status !== 'pending') throw new Error('ERR_CONFLICT: Item already resolved');

    const affectedIds: string[] = JSON.parse(item.memory_ids || '[]');

    await this.storage.write((db: any) => {
      db.prepare(`
        UPDATE review_items SET status = 'resolved', resolution_json = ?, resolved_at = ?
        WHERE id = ?
      `).run(JSON.stringify({ decision, chosen_memory_id: chosenMemoryId, edited_value_text: editedValueText }), nowUtc(), itemId);
    });

    return { item_id: itemId, resolved: true, affected_memory_ids: affectedIds };
  }

  createItem(kind: string, payload: any, memoryIds: string[] = []): string {
    const id = uuid();
    this.storage.write((db: any) => {
      db.prepare(`
        INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).run(id, kind, JSON.stringify(payload), JSON.stringify(memoryIds), nowUtc());
    });
    return id;
  }
}