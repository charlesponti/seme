// src/integrations/integration-store.ts — External service integration framework

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export interface Integration {
  id: string;
  service_name: string;
  display_name: string;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  auth_type: 'oauth2' | 'api_key' | 'none';
  credentials: string | null;
  scopes: string[];
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export class IntegrationStore {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  // Known services
  static readonly KNOWN_SERVICES = [
    { name: 'gmail', display: 'Gmail', auth_type: 'oauth2', scopes: ['gmail.readonly', 'gmail.send'] },
    { name: 'slack', display: 'Slack', auth_type: 'oauth2', scopes: ['chat:write', 'channels:read'] },
    { name: 'notion', display: 'Notion', auth_type: 'oauth2', scopes: ['read_content', 'update_content'] },
    { name: 'github', display: 'GitHub', auth_type: 'oauth2', scopes: ['repo', 'read:user'] },
    { name: 'google_calendar', display: 'Google Calendar', auth_type: 'oauth2', scopes: ['calendar.readonly'] },
    { name: 'linear', display: 'Linear', auth_type: 'api_key', scopes: ['read', 'write'] },
  ];

  list(): Integration[] {
    return this.storage.read((db: any) => {
      const rows = db.prepare('SELECT * FROM integrations ORDER BY created_at DESC').all() as any[];
      return rows.map((r: any) => this.rowToIntegration(r));
    });
  }

  get(id: string): Integration | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as any);
    if (!row) return null;
    return this.rowToIntegration(row);
  }

  getByName(serviceName: string): Integration | null {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM integrations WHERE service_name = ?').get(serviceName) as any);
    if (!row) return null;
    return this.rowToIntegration(row);
  }

  connect(serviceName: string, authType: string = 'oauth2', scopes: string[] = []): string {
    const existing = this.getByName(serviceName);
    if (existing) {
      const now = nowUtc();
      this.storage.getDb().prepare('UPDATE integrations SET status = ?, updated_at = ? WHERE id = ?').run('pending', now, existing.id);
      return existing.id;
    }

    const known = IntegrationStore.KNOWN_SERVICES.find(s => s.name === serviceName);
    const displayName = known?.display || serviceName;
    const id = uuid();
    const now = nowUtc();
    this.storage.getDb().prepare(`
      INSERT INTO integrations (id, service_name, display_name, status, auth_type, scopes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, serviceName, displayName, 'pending', authType, JSON.stringify(scopes.length ? scopes : (known?.scopes || [])), now, now);
    return id;
  }

  setStatus(id: string, status: Integration['status'], credentials?: string): boolean {
    const integration = this.get(id);
    if (!integration) return false;
    const now = nowUtc();
    this.storage.getDb().prepare('UPDATE integrations SET status = ?, credentials = ?, updated_at = ? WHERE id = ?').run(status, credentials || integration.credentials, now, id);
    return true;
  }

  disconnect(id: string): boolean {
    const integration = this.get(id);
    if (!integration) return false;
    const now = nowUtc();
    this.storage.getDb().prepare('UPDATE integrations SET status = ?, credentials = NULL, updated_at = ? WHERE id = ?').run('disconnected', now, id);
    return true;
  }

  delete(id: string): boolean {
    const integration = this.get(id);
    if (!integration) return false;
    this.storage.getDb().prepare('DELETE FROM integrations WHERE id = ?').run(id);
    return true;
  }

  listKnownServices(): typeof IntegrationStore.KNOWN_SERVICES {
    return IntegrationStore.KNOWN_SERVICES;
  }

  private rowToIntegration(row: any): Integration {
    return {
      id: row.id,
      service_name: row.service_name,
      display_name: row.display_name,
      status: row.status,
      auth_type: row.auth_type,
      credentials: row.credentials,
      scopes: row.scopes ? JSON.parse(row.scopes) : [],
      last_synced_at: row.last_synced_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
