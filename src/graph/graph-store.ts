// src/graph/graph-store.ts — Knowledge Graph CRUD and traversal (KG-6)

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface GraphEntity {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
  mention_count: number;
  confidence: number;
  source_type: string;
  profile_included: number;
  pinned: number;
}

export interface GraphRelationship {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
  weight: number;
  first_seen_at: string;
  last_seen_at: string;
  mention_count: number;
  confidence: number;
  source_type: string;
  source_turn_id: string;
  source_episode_id: string;
  valid_from: string | null;
  valid_to: string | null;
}

export class GraphStore {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  // --- Entity CRUD ---

  createEntity(name: string, type: string, aliases: string[] = [], description: string | null = null, sourceType: string = 'user_stated', confidence: number = 0.9): string {
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO entities (id, name, type, aliases, description, first_seen_at, last_seen_at, mention_count, confidence, source_type, profile_included, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(aliases), description, now, now, 1, confidence, sourceType, 0, 0);
    return id;
  }

  getEntity(id: string): GraphEntity | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  getEntityByName(name: string): GraphEntity | null {
    const row = this.storage.read((db: any) => {
      // Match by canonical name or alias
      const byName = db.prepare('SELECT * FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1').get(name) as any;
      if (byName) return byName;
      const byAlias = db.prepare('SELECT * FROM entities WHERE aliases IS NOT NULL AND aliases LIKE ? LIMIT 1').get(`%"${name}"%`) as any;
      return byAlias || null;
    });
    if (!row) return null;
    return this.rowToEntity(row);
  }

  listEntities(type?: string, search?: string, limit: number = 50, offset: number = 0): { entities: GraphEntity[]; total: number } {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM entities';
      const conditions: string[] = [];
      const params: any[] = [];
      if (type) { conditions.push('type = ?'); params.push(type); }
      if (search) { conditions.push('(LOWER(name) LIKE ? OR aliases LIKE ?)'); params.push(`%${search.toLowerCase()}%`, `%${search}%`); }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY mention_count DESC, confidence DESC';
      const countQuery = 'SELECT COUNT(*) as c FROM entities' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
      const total = (db.prepare(countQuery).get(...params) as { c: number }).c;
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const rows = db.prepare(query).all(...params) as any[];
      return { entities: rows.map((r: any) => this.rowToEntity(r)), total };
    });
  }

  updateEntity(id: string, updates: { name?: string; type?: string; aliases?: string[]; description?: string; profile_included?: number; pinned?: number }): void {
    this.storage.getDb().transaction(() => {
      const sets: string[] = [];
      const params: any[] = [];
      if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
      if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type); }
      if (updates.aliases !== undefined) { sets.push('aliases = ?'); params.push(JSON.stringify(updates.aliases)); }
      if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
      if (updates.profile_included !== undefined) { sets.push('profile_included = ?'); params.push(updates.profile_included); }
      if (updates.pinned !== undefined) { sets.push('pinned = ?'); params.push(updates.pinned); }
      if (sets.length === 0) return;
      sets.push('last_seen_at = ?');
      params.push(nowUtc());
      params.push(id);
      this.storage.getDb().prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    })();
  }

  deleteEntity(id: string): void {
    this.storage.getDb().transaction(() => {
      // Delete relationships involving this entity
      this.storage.getDb().prepare('DELETE FROM relationships WHERE source_id = ? OR target_id = ?').run(id, id);
      // Delete links
      this.storage.getDb().prepare('DELETE FROM entity_memory_links WHERE entity_id = ?').run(id);
      this.storage.getDb().prepare('DELETE FROM entity_turn_links WHERE entity_id = ?').run(id);
      // Delete entity
      this.storage.getDb().prepare('DELETE FROM entities WHERE id = ?').run(id);
    })();
  }

  // --- Relationship CRUD ---

  createRelationship(sourceId: string, targetId: string, relationType: string, description: string | null = null, sourceTurnId: string = '', sourceEpisodeId: string = '', sourceType: string = 'user_stated', confidence: number = 0.9): string {
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO relationships (id, source_id, target_id, relation_type, description, weight, first_seen_at, last_seen_at, mention_count, confidence, source_type, source_turn_id, source_episode_id, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, targetId, relationType, description, 1.0, now, now, 1, confidence, sourceType, sourceTurnId, sourceEpisodeId, now, null);
    return id;
  }

  getRelationship(id: string): GraphRelationship | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM relationships WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToRelationship(row);
  }

  listRelationships(sourceId?: string, targetId?: string, relationType?: string, limit: number = 50, offset: number = 0): { relationships: GraphRelationship[]; total: number } {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM relationships';
      const conditions: string[] = [];
      const params: any[] = [];
      if (sourceId) { conditions.push('source_id = ?'); params.push(sourceId); }
      if (targetId) { conditions.push('target_id = ?'); params.push(targetId); }
      if (relationType) { conditions.push('relation_type = ?'); params.push(relationType); }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY last_seen_at DESC';
      const countQuery = 'SELECT COUNT(*) as c FROM relationships' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
      const total = (db.prepare(countQuery).get(...params) as { c: number }).c;
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const rows = db.prepare(query).all(...params) as any[];
      return { relationships: rows.map((r: any) => this.rowToRelationship(r)), total };
    });
  }

  deleteRelationship(id: string): void {
    this.storage.getDb().prepare('DELETE FROM relationships WHERE id = ?').run(id);
  }

  // --- Graph Traversal ---

  getNeighborhood(entityId: string, depth: number = 2): { entities: GraphEntity[]; relationships: GraphRelationship[] } {
    return this.storage.read((db: any) => {
      // Recursive CTE for N-hop traversal
      const traversal = db.prepare(`
        WITH RECURSIVE traversal(entity_id, depth, path) AS (
          SELECT id, 0, id FROM entities WHERE id = ?
          UNION ALL
          SELECT r.target_id, t.depth + 1, t.path || ',' || r.target_id
          FROM traversal t
          JOIN relationships r ON r.source_id = t.entity_id
          WHERE t.depth < ? AND t.path NOT LIKE '%' || r.target_id || '%'
        )
        SELECT DISTINCT entity_id, depth FROM traversal
      `).all(entityId, depth) as { entity_id: string; depth: number }[];

      const entityIds = [...new Set(traversal.map(t => t.entity_id))];
      if (entityIds.length === 0) return { entities: [], relationships: [] };

      const placeholders = entityIds.map(() => '?').join(',');
      const entities = db.prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`).all(...entityIds) as any[];
      const relationships = db.prepare(`
        SELECT * FROM relationships
        WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
      `).all(...entityIds, ...entityIds) as any[];

      return {
        entities: entities.map((r: any) => this.rowToEntity(r)),
        relationships: relationships.map((r: any) => this.rowToRelationship(r)),
      };
    });
  }

  findPath(fromId: string, toId: string): { path: GraphEntity[]; relationships: GraphRelationship[] } | null {
    return this.storage.read((db: any) => {
      // BFS via recursive CTE
      const result = db.prepare(`
        WITH RECURSIVE path_search(entity_id, depth, path, rel_path) AS (
          SELECT id, 0, id, '' FROM entities WHERE id = ?
          UNION ALL
          SELECT r.target_id, ps.depth + 1, ps.path || ',' || r.target_id, ps.rel_path || ',' || r.id
          FROM path_search ps
          JOIN relationships r ON r.source_id = ps.entity_id
          WHERE ps.depth < 10 AND ps.path NOT LIKE '%' || r.target_id || '%'
        )
        SELECT path, rel_path FROM path_search WHERE entity_id = ? ORDER BY depth LIMIT 1
      `).get(fromId, toId) as { path: string; rel_path: string } | undefined;

      if (!result) return null;

      const entityIds = result.path.split(',');
      const relIds = result.rel_path.split(',').filter(Boolean);

      const entities = db.prepare(`SELECT * FROM entities WHERE id IN (${entityIds.map(() => '?').join(',')})`).all(...entityIds) as any[];
      const relationships = relIds.length > 0
        ? db.prepare(`SELECT * FROM relationships WHERE id IN (${relIds.map(() => '?').join(',')})`).all(...relIds) as any[]
        : [];

      return {
        path: entities.map((r: any) => this.rowToEntity(r)),
        relationships: relationships.map((r: any) => this.rowToRelationship(r)),
      };
    });
  }

  getGraphSnapshot(): { entities: GraphEntity[]; relationships: GraphRelationship[] } {
    return this.storage.read((db: any) => {
      const entities = db.prepare('SELECT * FROM entities ORDER BY mention_count DESC, confidence DESC').all() as any[];
      const relationships = db.prepare('SELECT * FROM relationships ORDER BY last_seen_at DESC').all() as any[];
      return {
        entities: entities.map((r: any) => this.rowToEntity(r)),
        relationships: relationships.map((r: any) => this.rowToRelationship(r)),
      };
    });
  }

  // --- Helpers ---

  private rowToEntity(row: any): GraphEntity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      aliases: row.aliases ? JSON.parse(row.aliases) : [],
      description: row.description,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      mention_count: row.mention_count,
      confidence: row.confidence,
      source_type: row.source_type,
      profile_included: row.profile_included,
      pinned: row.pinned,
    };
  }

  private rowToRelationship(row: any): GraphRelationship {
    return {
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      relation_type: row.relation_type,
      description: row.description,
      weight: row.weight,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      mention_count: row.mention_count,
      confidence: row.confidence,
      source_type: row.source_type,
      source_turn_id: row.source_turn_id,
      source_episode_id: row.source_episode_id,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
    };
  }
}