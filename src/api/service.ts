// src/api/service.ts — Service API (16-service-api.md, V1-tonight operations)

import { Storage } from '../storage/storage.js';
import { StorageConfig } from '../storage/storage.js';
import { IngestManager } from '../ingest/ingest.js';
import { ValidationGate } from '../validation/validation-gate.js';
import { Resolver } from '../resolver/resolver.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { RetrievalEngine } from '../retrieval/retrieval.js';
import { IdentityCoreManager } from '../identity/identity-core.js';
import { uuid, nowUtc } from '../types/common.js';

export class MemoryService {
  private storage: Storage;
  private ingest: IngestManager;
  private gate: ValidationGate;
  private resolver: Resolver;
  private profileCompiler: ProfileCompiler;
  private retrieval: RetrievalEngine;
  private identityCore: IdentityCoreManager;

  constructor(config: StorageConfig) {
    this.storage = new Storage(config);
    this.ingest = new IngestManager(this.storage);
    this.gate = new ValidationGate(this.storage);
    this.resolver = new Resolver(this.storage);
    this.profileCompiler = new ProfileCompiler(this.storage);
    this.retrieval = new RetrievalEngine(this.storage);
    this.identityCore = new IdentityCoreManager(this.storage);
  }

  // 1. record_turn
  async recordTurn(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, ts?: string, turnId?: string) {
    return this.ingest.recordTurn(sessionId, role, content, ts, turnId);
  }

  // 2. end_session
  async endSession(sessionId: string, endedAt?: string) {
    return this.ingest.endSession(sessionId, endedAt);
  }

  // 3. retrieve_context
  retrieveContext(sessionId: string, userMessage: string, timeRangeHint?: { from?: string; to?: string; historical?: boolean }) {
    return this.retrieval.retrieve(sessionId, userMessage);
  }

  // 4. remember_command
  async rememberCommand(sessionId: string, content: string, sourceTurnId?: string, kindHint?: string) {
    // Find or create a turn for this content
    let turnId = sourceTurnId;
    if (!turnId) {
      const result = await this.ingest.recordTurn(sessionId, 'user', content);
      turnId = result.turn_id;
    }

    const episode = this.ingest.getOpenEpisode(sessionId);
    if (!episode) throw new Error('ERR_NOT_FOUND: No open episode');

    const candidate: any = {
      kind: (kindHint || 'fact') as any,
      slot: null,
      subject: 'user',
      predicate: 'stated',
      value_text: content,
      value_json: null,
      evidence_quote: content,
      source_turn_id: turnId,
      source_episode_id: episode.id,
      source_type: 'user_stated' as const,
      modality: 'stated' as const,
      importance: 0.7,
      decay_class: 'medium',
      observed_at: nowUtc(),
    };

    const gateResult = this.gate.validate(candidate);
    if (!gateResult.passed) {
      throw new Error(`ERR_VALIDATION: ${gateResult.errors.join(', ')}`);
    }

    const resolution = await this.resolver.resolve(candidate);
    const memoryId = resolution.candidate_id;

    // Compile profile
    await this.profileCompiler.compile('remember_command', [memoryId]);

    return { memory_id: memoryId, status: 'active' as const, slot: null };
  }

  // 5. forget_command
  async forgetCommand(scope: string, memoryId?: string, slot?: string, topic?: string, episodeId?: string, confirmedIrreversible?: boolean) {
    if (scope === 'memory' && memoryId) {
      // Cascade delete
      await this.storage.write((db) => {
        // Delete from FTS and vec
        db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(memoryId);
        db.prepare('DELETE FROM memories_vec WHERE memory_id = ?').run(memoryId);
        // Set to deleted with empty content
        db.prepare(`
          UPDATE memories SET status = 'deleted', value_text = '', value_json = NULL, evidence_quote = ''
          WHERE id = ?
        `).run(memoryId);
        // Write healing_log
        db.prepare(`
          INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
          VALUES (?, ?, ?, 'delete', ?, ?, NULL, ?, 0)
        `).run(uuid(), nowUtc(), 'forget_command', JSON.stringify([memoryId]), JSON.stringify({ id: memoryId }), 'User forget request');
      });

      // Recompile profile
      await this.profileCompiler.compile('forget_command', [memoryId]);

      return { completed_at: nowUtc(), profile_recompiled: true };
    }

    throw new Error('ERR_VALIDATION: Unsupported scope or missing required field');
  }

  // 6. boundary_command
  async boundaryCommand(sessionId: string, content: string, sourceTurnId?: string) {
    let turnId = sourceTurnId;
    if (!turnId) {
      const result = await this.ingest.recordTurn(sessionId, 'user', content);
      turnId = result.turn_id;
    }

    const episode = this.ingest.getOpenEpisode(sessionId);
    if (!episode) throw new Error('ERR_NOT_FOUND: No open episode');

    const candidate: any = {
      kind: 'boundary' as const,
      slot: null,
      subject: 'user',
      predicate: 'boundary',
      value_text: content,
      value_json: null,
      evidence_quote: content,
      source_turn_id: turnId,
      source_episode_id: episode.id,
      source_type: 'user_stated' as const,
      modality: 'stated' as const,
      importance: 1.0,
      decay_class: 'exempt',
      observed_at: nowUtc(),
    };

    const gateResult = this.gate.validate(candidate);
    if (!gateResult.passed) {
      throw new Error(`ERR_VALIDATION: ${gateResult.errors.join(', ')}`);
    }

    // Boundary as a simple memory without a slot
    candidate.slot = null;

    const resolution = await this.resolver.resolve(candidate);
    const memoryId = resolution.candidate_id;

    // Create procedural rule
    const ruleId = uuid();
    await this.storage.write((db) => {
      db.prepare(`
        INSERT INTO procedural_rules (id, rule_text, source_memory_ids, priority, status, created_from, user_approved, created_at)
        VALUES (?, ?, ?, 'boundary', 'active', 'user', 1, ?)
      `).run(ruleId, content, JSON.stringify([memoryId]), nowUtc());
    });

    await this.profileCompiler.compile('boundary_command', [memoryId]);

    return { memory_id: memoryId, procedural_rule_id: ruleId, priority: 'boundary' as const };
  }

  // 7. get_profile
  getProfile() {
    return this.profileCompiler.getProfile();
  }

  // Identity core
  async seedIdentityCore(contentJson: Record<string, unknown>, renderedText: string) {
    return this.identityCore.seed(contentJson, renderedText);
  }

  getIdentityCore() {
    return this.identityCore.get();
  }

  // Storage access for tests
  getStorage() {
    return this.storage;
  }

  close() {
    this.storage.close();
  }
}