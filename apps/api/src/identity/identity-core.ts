// src/identity/identity-core.ts — Identity core (12-identity-core.md)

import { Storage } from '../storage/storage.js';
import { IdentityCore } from '../types/common.js';
import { uuid, nowUtc } from '../types/common.js';

export class IdentityCoreManager {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async seed(contentJson: Record<string, unknown>, renderedText: string): Promise<IdentityCore> {
    const id = 'singleton';
    const version = 1;
    const now = nowUtc();

    await this.storage.write((db) => {
      db.prepare(`
        INSERT INTO identity_core (id, content_json, rendered_text, version, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, 'user')
      `).run(id, JSON.stringify(contentJson), renderedText, version, now);
    });

    return {
      id,
      content_json: JSON.stringify(contentJson),
      rendered_text: renderedText,
      version,
      updated_at: now,
      updated_by: 'user',
    };
  }

  get(): IdentityCore | null {
    return this.storage.read((db) => {
      const row = db.prepare('SELECT * FROM identity_core WHERE id = ?').get('singleton') as any;
      if (!row) return null;
      return {
        id: row.id,
        content_json: row.content_json,
        rendered_text: row.rendered_text,
        version: row.version,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      };
    });
  }

  async update(contentJson: Record<string, unknown>, renderedText: string): Promise<IdentityCore> {
    const current = this.get();
    const version = current ? current.version + 1 : 1;
    const now = nowUtc();

    await this.storage.write((db) => {
      db.prepare(`
        UPDATE identity_core SET content_json = ?, rendered_text = ?, version = ?, updated_at = ?, updated_by = 'user'
        WHERE id = 'singleton'
      `).run(JSON.stringify(contentJson), renderedText, version, now);
    });

    return {
      id: 'singleton',
      content_json: JSON.stringify(contentJson),
      rendered_text: renderedText,
      version,
      updated_at: now,
      updated_by: 'user',
    };
  }

  renderText(): string {
    const core = this.get();
    return core ? core.rendered_text : '';
  }
}