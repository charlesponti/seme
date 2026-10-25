// src/procedures/procedure-store.ts — Saved SOPs, playbooks, and prompts

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface Procedure {
  id: string;
  title: string;
  description: string | null;
  procedure_type: 'sop' | 'playbook' | 'ui_walkthrough' | 'prompt';
  trigger_pattern: string | null;
  steps: { step: number; action: string; description?: string }[];
  guards: { condition: string; description?: string }[];
  confidence: number;
  status: 'active' | 'archived' | 'draft';
  created_at: string;
  updated_at: string;
}

export class ProcedureStore {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  create(params: { title: string; description?: string; procedure_type: string; trigger_pattern?: string; steps?: any[]; guards?: any[]; confidence?: number; status?: string }): string {
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO procedures (id, title, description, procedure_type, trigger_pattern, steps_json, guards_json, confidence, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.title, params.description || null, params.procedure_type, params.trigger_pattern || null, JSON.stringify(params.steps || []), JSON.stringify(params.guards || []), params.confidence || 0.8, params.status || 'active', now, now);
    return id;
  }

  get(id: string): Procedure | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM procedures WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToProcedure(row);
  }

  list(params?: { procedure_type?: string; status?: string; trigger?: string; limit?: number; offset?: number }): { procedures: Procedure[]; total: number } {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM procedures WHERE 1=1';
      const conditions: string[] = [];
      const vals: any[] = [];
      if (params?.procedure_type) { conditions.push('procedure_type = ?'); vals.push(params.procedure_type); }
      if (params?.status) { conditions.push('status = ?'); vals.push(params.status); }
      if (params?.trigger) { conditions.push('trigger_pattern LIKE ?'); vals.push(`%${params.trigger}%`); }
      if (conditions.length) query += ' AND ' + conditions.join(' AND ');
      const total = (db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...vals) as { c: number }).c;
      query += ' ORDER BY created_at DESC';
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      query += ` LIMIT ${limit} OFFSET ${offset}`;
      const rows = db.prepare(query).all(...vals) as any[];
      return { procedures: rows.map((r: any) => this.rowToProcedure(r)), total };
    });
  }

  update(id: string, params: { title?: string; description?: string; procedure_type?: string; trigger_pattern?: string; steps?: any[]; guards?: any[]; confidence?: number; status?: string }): Procedure | null {
    const proc = this.get(id);
    if (!proc) return null;
    const now = nowUtc();
    this.storage.getDb().prepare(`
      UPDATE procedures SET title = ?, description = ?, procedure_type = ?, trigger_pattern = ?, steps_json = ?, guards_json = ?, confidence = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(
      params.title || proc.title,
      params.description !== undefined ? params.description : proc.description,
      params.procedure_type || proc.procedure_type,
      params.trigger_pattern !== undefined ? params.trigger_pattern : proc.trigger_pattern,
      params.steps ? JSON.stringify(params.steps) : JSON.stringify(proc.steps),
      params.guards ? JSON.stringify(params.guards) : JSON.stringify(proc.guards),
      params.confidence !== undefined ? params.confidence : proc.confidence,
      params.status || proc.status,
      now, id
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const proc = this.get(id);
    if (!proc) return false;
    this.storage.getDb().prepare('DELETE FROM procedures WHERE id = ?').run(id);
    return true;
  }

  findMatching(trigger: string): Procedure[] {
    return this.storage.read((db: any) => {
      const rows = db.prepare("SELECT * FROM procedures WHERE status = 'active' AND trigger_pattern IS NOT NULL AND trigger_pattern != ''").all() as any[];
      return rows
        .map((r: any) => this.rowToProcedure(r))
        .filter(p => p.trigger_pattern && new RegExp(p.trigger_pattern, 'i').test(trigger));
    });
  }

  private rowToProcedure(row: any): Procedure {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      procedure_type: row.procedure_type,
      trigger_pattern: row.trigger_pattern,
      steps: row.steps_json ? JSON.parse(row.steps_json) : [],
      guards: row.guards_json ? JSON.parse(row.guards_json) : [],
      confidence: row.confidence,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
