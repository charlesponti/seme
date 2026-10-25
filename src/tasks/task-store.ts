// src/tasks/task-store.ts — KB Task management

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface KBTask {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  memory_ids: string[];
  entity_ids: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class TaskStore {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  create(params: { title: string; description?: string; priority?: string; due_date?: string; memory_ids?: string[]; entity_ids?: string[] }): string {
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO kb_tasks (id, title, description, status, priority, due_date, memory_ids, entity_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.title, params.description || null, 'pending', params.priority || 'medium', params.due_date || null, JSON.stringify(params.memory_ids || []), JSON.stringify(params.entity_ids || []), now, now);
    return id;
  }

  get(id: string): KBTask | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM kb_tasks WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToTask(row);
  }

  list(params?: { status?: string; priority?: string; limit?: number; offset?: number }): { tasks: KBTask[]; total: number } {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM kb_tasks WHERE 1=1';
      const conditions: string[] = [];
      const vals: any[] = [];
      if (params?.status) { conditions.push('status = ?'); vals.push(params.status); }
      if (params?.priority) { conditions.push('priority = ?'); vals.push(params.priority); }
      if (conditions.length) query += ' AND ' + conditions.join(' AND ');
      const total = (db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...vals) as { c: number }).c;
      query += ' ORDER BY created_at DESC';
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      query += ` LIMIT ${limit} OFFSET ${offset}`;
      const rows = db.prepare(query).all(...vals) as any[];
      return { tasks: rows.map((r: any) => this.rowToTask(r)), total };
    });
  }

  update(id: string, params: { title?: string; description?: string; status?: string; priority?: string; due_date?: string; memory_ids?: string[]; entity_ids?: string[] }): KBTask | null {
    const task = this.get(id);
    if (!task) return null;
    const now = nowUtc();
    const newStatus = params.status || task.status;
    const completedAt = newStatus === 'done' ? now : task.completed_at;
    this.storage.getDb().prepare(`
      UPDATE kb_tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, memory_ids = ?, entity_ids = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `).run(
      params.title || task.title,
      params.description !== undefined ? params.description : task.description,
      newStatus,
      params.priority || task.priority,
      params.due_date !== undefined ? params.due_date : task.due_date,
      params.memory_ids ? JSON.stringify(params.memory_ids) : JSON.stringify(task.memory_ids),
      params.entity_ids ? JSON.stringify(params.entity_ids) : JSON.stringify(task.entity_ids),
      now, completedAt, id
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const task = this.get(id);
    if (!task) return false;
    this.storage.getDb().prepare('DELETE FROM kb_tasks WHERE id = ?').run(id);
    return true;
  }

  private rowToTask(row: any): KBTask {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      memory_ids: row.memory_ids ? JSON.parse(row.memory_ids) : [],
      entity_ids: row.entity_ids ? JSON.parse(row.entity_ids) : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }
}
