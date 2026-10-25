// src/wiki/wiki-store.ts — Knowledge Wiki CRUD and versioning

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface WikiPage {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  title: string;
  content: string;
  page_type: string;
  maturity: 'draft' | 'stable' | 'canonical';
  version: number;
  source_memory_ids: string[];
  status: 'active' | 'deprecated' | 'archived';
  conflict_ids: string[];
  created_at: string;
  updated_at: string;
  updated_by: 'system' | 'user';
}

export interface WikiPageVersion {
  id: string;
  page_id: string;
  version: number;
  content: string;
  maturity: string;
  reason: string;
  created_at: string;
  created_by: 'system' | 'user';
}

export class WikiStore {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  createPage(params: {
    entity_id?: string | null;
    entity_name?: string | null;
    title: string;
    content: string;
    page_type: string;
    maturity?: string;
    source_memory_ids?: string[];
    updated_by?: 'system' | 'user';
  }): string {
    const id = uuid();
    const now = nowUtc();
    const maturity = params.maturity || 'draft';
    const sourceIds = params.source_memory_ids || [];
    this.storage.getDb().prepare(`
      INSERT INTO wiki_pages (id, entity_id, entity_name, title, content, page_type, maturity, version, source_memory_ids, status, conflict_ids, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.entity_id || null, params.entity_name || null, params.title, params.content,
      params.page_type, maturity, 1, JSON.stringify(sourceIds), 'active', '[]', now, now,
      params.updated_by || 'system'
    );
    // Create version 1
    this.createVersion(id, 1, params.content, maturity, 'Initial creation', params.updated_by || 'system');
    return id;
  }

  getPage(id: string): WikiPage | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToPage(row);
  }

  getPageByEntity(entityId: string, pageType?: string): WikiPage | null {
    const row = this.storage.read((db: any) => {
      if (pageType) {
        return db.prepare('SELECT * FROM wiki_pages WHERE entity_id = ? AND page_type = ? AND status = ? ORDER BY version DESC LIMIT 1').get(entityId, pageType, 'active') as any;
      }
      return db.prepare('SELECT * FROM wiki_pages WHERE entity_id = ? AND status = ? ORDER BY version DESC LIMIT 1').get(entityId, 'active') as any;
    });
    if (!row) return null;
    return this.rowToPage(row);
  }

  listPages(params?: { entity_id?: string; page_type?: string; maturity?: string; status?: string; search?: string; limit?: number; offset?: number }): { pages: WikiPage[]; total: number } {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM wiki_pages WHERE 1=1';
      const conditions: string[] = [];
      const params_: any[] = [];

      if (params?.entity_id) { conditions.push('entity_id = ?'); params_.push(params.entity_id); }
      if (params?.page_type) { conditions.push('page_type = ?'); params_.push(params.page_type); }
      if (params?.maturity) { conditions.push('maturity = ?'); params_.push(params.maturity); }
      if (params?.status) { conditions.push('status = ?'); params_.push(params.status); }
      if (params?.search) { conditions.push('(title LIKE ? OR content LIKE ? OR entity_name LIKE ?)'); params_.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`); }

      if (conditions.length > 0) query += ' AND ' + conditions.join(' AND ');

      const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as c');
      const total = (db.prepare(countQuery).get(...params_) as { c: number }).c;

      query += ' ORDER BY updated_at DESC';
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      query += ` LIMIT ${limit} OFFSET ${offset}`;

      const rows = db.prepare(query).all(...params_) as any[];
      return { pages: rows.map((r: any) => this.rowToPage(r)), total };
    });
  }

  updatePage(id: string, params: { title?: string; content?: string; maturity?: string; status?: string; updated_by?: 'system' | 'user'; reason?: string }): WikiPage | null {
    const page = this.getPage(id);
    if (!page) return null;

    const now = nowUtc();
    const newTitle = params.title || page.title;
    const newContent = params.content || page.content;
    const newMaturity = params.maturity || page.maturity;
    const newStatus = params.status || page.status;
    const updatedBy = params.updated_by || 'user';
    const newVersion = page.version + 1;

    this.storage.getDb().prepare(`
      UPDATE wiki_pages SET title = ?, content = ?, maturity = ?, status = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?
    `).run(newTitle, newContent, newMaturity, newStatus, newVersion, now, updatedBy, id);

    // Create version record
    this.createVersion(id, newVersion, newContent, newMaturity, params.reason || 'Updated', updatedBy);

    return this.getPage(id);
  }

  deprecatePage(id: string, reason: string): WikiPage | null {
    return this.updatePage(id, { status: 'deprecated', reason });
  }

  deletePage(id: string): boolean {
    const page = this.getPage(id);
    if (!page) return false;
    this.storage.getDb().prepare('DELETE FROM wiki_page_versions WHERE page_id = ?').run(id);
    this.storage.getDb().prepare('DELETE FROM wiki_pages WHERE id = ?').run(id);
    return true;
  }

  getVersions(pageId: string): WikiPageVersion[] {
    return this.storage.read((db: any) => {
      const rows = db.prepare('SELECT * FROM wiki_page_versions WHERE page_id = ? ORDER BY version DESC').all(pageId) as any[];
      return rows.map((r: any) => ({
        id: r.id,
        page_id: r.page_id,
        version: r.version,
        content: r.content,
        maturity: r.maturity,
        reason: r.reason,
        created_at: r.created_at,
        created_by: r.created_by,
      }));
    });
  }

  searchPages(query: string, limit: number = 20): WikiPage[] {
    return this.storage.read((db: any) => {
      const rows = db.prepare(`
        SELECT * FROM wiki_pages
        WHERE status = 'active' AND (title LIKE ? OR content LIKE ? OR entity_name LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
      return rows.map((r: any) => this.rowToPage(r));
    });
  }

  private createVersion(pageId: string, version: number, content: string, maturity: string, reason: string, createdBy: 'system' | 'user'): void {
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO wiki_page_versions (id, page_id, version, content, maturity, reason, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, pageId, version, content, maturity, reason, now, createdBy);
  }

  private rowToPage(row: any): WikiPage {
    return {
      id: row.id,
      entity_id: row.entity_id,
      entity_name: row.entity_name,
      title: row.title,
      content: row.content,
      page_type: row.page_type,
      maturity: row.maturity,
      version: row.version,
      source_memory_ids: row.source_memory_ids ? JSON.parse(row.source_memory_ids) : [],
      status: row.status,
      conflict_ids: row.conflict_ids ? JSON.parse(row.conflict_ids) : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    };
  }
}
