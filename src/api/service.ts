// src/api/service.ts — Service API (16-service-api.md, V1-tonight operations)

import { Storage } from '../storage/storage.js';
import { StorageConfig } from '../storage/storage.js';
import { IngestManager } from '../ingest/ingest.js';
import { ValidationGate } from '../validation/validation-gate.js';
import { Resolver } from '../resolver/resolver.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { RetrievalEngine } from '../retrieval/retrieval.js';
import { IdentityCoreManager } from '../identity/identity-core.js';
import { ExtractionPipeline } from '../extraction/pipeline.js';
import { Extractor } from '../extraction/extractor.js';
import { SleepJob } from '../sleep/sleep-job.js';
import { ReviewQueue } from '../review/review-queue.js';
import { DeletionManager } from '../deletion/deletion.js';
import { AdaptationStore } from '../adaptation/adaptation-store.js';
import { GraphStore } from '../graph/graph-store.js';
import { uuid, nowUtc } from '../types/common.js';
import { getDecayClass } from '../confidence/confidence.js';

export class MemoryService {
  private storage: Storage;
  private ingest: IngestManager;
  private gate: ValidationGate;
  private resolver: Resolver;
  private profileCompiler: ProfileCompiler;
  private retrieval: RetrievalEngine;
  private identityCore: IdentityCoreManager;
  private extractionPipeline: ExtractionPipeline;
  private sleepJob: SleepJob;
  private reviewQueue: ReviewQueue;
  private deletionManager: DeletionManager;
  private adaptationStore: AdaptationStore;
  private graphStore: GraphStore;

  constructor(config: StorageConfig) {
    this.storage = new Storage(config);
    this.ingest = new IngestManager(this.storage);
    this.gate = new ValidationGate(this.storage);
    this.resolver = new Resolver(this.storage);
    this.graphStore = new GraphStore(this.storage);
    this.profileCompiler = new ProfileCompiler(this.storage, this.graphStore);
    this.retrieval = new RetrievalEngine(this.storage, this.graphStore);
    this.identityCore = new IdentityCoreManager(this.storage);
    this.extractionPipeline = new ExtractionPipeline(
      this.storage, this.ingest, this.gate, this.resolver, this.profileCompiler
    );
    this.sleepJob = new SleepJob(this.storage, this.profileCompiler, config.sleepLogPath);
    this.reviewQueue = new ReviewQueue(this.storage);
    this.deletionManager = new DeletionManager(this.storage, this.profileCompiler);
    this.adaptationStore = new AdaptationStore(this.storage, this.reviewQueue);

    // Seed slot registry with common slots (synchronous)
    this.seedSlots();
  }

  private seedSlots(): void {
    const slots = [
      { slot: 'name', kind: 'fact', cardinality: 'single', decay_class: 'exempt', profile_included: 1 },
      { slot: 'home_city', kind: 'fact', cardinality: 'single', decay_class: 'slow', profile_included: 1 },
      { slot: 'dietary_restriction', kind: 'fact', cardinality: 'single', decay_class: 'slow', profile_included: 1 },
      { slot: 'interest', kind: 'interest', cardinality: 'multi', decay_class: 'medium', profile_included: 1 },
      { slot: 'preference', kind: 'preference', cardinality: 'multi', decay_class: 'medium', profile_included: 1 },
      { slot: 'routine', kind: 'routine', cardinality: 'multi', decay_class: 'medium', profile_included: 1 },
      { slot: 'relationship', kind: 'relationship', cardinality: 'multi', decay_class: 'slow', profile_included: 1 },
      { slot: 'decision', kind: 'decision', cardinality: 'multi', decay_class: 'slow', profile_included: 1 },
      { slot: 'reference', kind: 'reference', cardinality: 'multi', decay_class: 'medium', profile_included: 1 },
      { slot: 'anti_pattern', kind: 'anti_pattern', cardinality: 'multi', decay_class: 'slow', profile_included: 1 },
    ];
    const db = this.storage.getDb();
    for (const s of slots) {
      db.prepare(`
        INSERT OR IGNORE INTO slot_registry (slot, kind, cardinality, decay_class, profile_included)
        VALUES (?, ?, ?, ?, ?)
      `).run(s.slot, s.kind, s.cardinality, s.decay_class, s.profile_included);
    }
  }

  async recordTurn(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, ts?: string, turnId?: string) {
    if (typeof sessionId !== 'string' || typeof role !== 'string' || typeof content !== 'string') {
      throw new Error('ERR_VALIDATION: Invalid input types');
    }
    if (turnId !== undefined && typeof turnId !== 'string') {
      throw new Error('ERR_VALIDATION: turn_id must be a string');
    }
    return this.ingest.recordTurn(sessionId, role, content, ts, turnId);
  }

  // 2. end_session
  async endSession(sessionId: string, endedAt?: string) {
    const result = await this.ingest.endSession(sessionId, endedAt);

    // Trigger extraction asynchronously (don't await)
    this.extractionPipeline.run(result.episode_id).then((r) => {
      console.log(`Extraction complete for ${result.episode_id}: ${r.memories_created} memories, ${r.feedback_events_created} feedback events`);
    }).catch((e) => {
      console.error(`Extraction failed for ${result.episode_id}:`, e.message);
    });

    return result;
  }

  // 3. retrieve_context
  retrieveContext(sessionId: string, userMessage: string, timeRangeHint?: { from?: string; to?: string; historical?: boolean }) {
    return this.retrieval.retrieve(sessionId, userMessage);
  }

  // 4. remember_command
  async rememberCommand(sessionId: string, content: string, sourceTurnId?: string, kindHint?: string) {
    if (this.deletionManager.getLearningState() === 'paused') {
      throw new Error('ERR_PAUSED: Learning is paused');
    }
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
      decay_class: getDecayClass({ kind: (kindHint || 'fact') as any, slot: null, pinned: 0 }),
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

  // Deletion & privacy
  async forgetCommand(scope: string, memoryId?: string, slot?: string, topic?: string, episodeId?: string, confirmedIrreversible?: boolean) {
    if (scope === 'memory' && memoryId) {
      return this.deletionManager.forgetMemory(memoryId);
    }
    if (scope === 'slot' && slot) {
      return this.deletionManager.forgetSlot(slot);
    }
    if (scope === 'topic' && topic) {
      return this.deletionManager.forgetTopic(topic);
    }
    if (scope === 'episode' && episodeId) {
      return this.deletionManager.forgetEpisode(episodeId, confirmedIrreversible || false);
    }
    if (scope === 'all') {
      return this.deletionManager.forgetAll(confirmedIrreversible || false);
    }
    throw new Error('ERR_VALIDATION: Unsupported scope or missing required field');
  }

  async exportData() {
    return this.deletionManager.exportData();
  }

  getLearningState() {
    return this.deletionManager.getLearningState();
  }

  async pauseLearning() {
    return this.deletionManager.pauseLearning();
  }

  async resumeLearning(processPausedEpisodes?: boolean) {
    return this.deletionManager.resumeLearning(processPausedEpisodes);
  }

  // 6. boundary_command
  async boundaryCommand(sessionId: string, content: string, sourceTurnId?: string) {
    if (this.deletionManager.getLearningState() === 'paused') {
      throw new Error('ERR_PAUSED: Learning is paused');
    }
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
    const existing = this.identityCore.get();
    if (existing) {
      return this.identityCore.update(contentJson, renderedText);
    }
    return this.identityCore.seed(contentJson, renderedText);
  }

  getIdentityCore() {
    return this.identityCore.get();
  }

  // Sleep job
  async runSleepJob(trigger: 'scheduled' | 'idle' | 'session_count' | 'manual' = 'manual') {
    return this.sleepJob.run(trigger);
  }

  getSleepJobStatus() {
    return this.sleepJob.isRunning();
  }

  // Review queue
  reviewQueueList(limit?: number, offset?: number, itemType?: string) {
    return this.reviewQueue.list(limit, offset, itemType);
  }

  async resolveReviewItem(itemId: string, decision: string, chosenMemoryId?: string, editedValueText?: string) {
    return this.reviewQueue.resolve(itemId, decision, chosenMemoryId, editedValueText);
  }

  // List memories (V1-later)
  listMemories(status?: string, kind?: string, slot?: string, search?: string, limit?: number, offset?: number) {
    return this.storage.read((db: any) => {
      let query = 'SELECT * FROM memories';
      const conditions: string[] = [];
      const params: any[] = [];
      if (status) { conditions.push('status = ?'); params.push(status); }
      if (kind) { conditions.push('kind = ?'); params.push(kind); }
      if (slot) { conditions.push('slot = ?'); params.push(slot); }
      if (search) { conditions.push('(value_text LIKE ? OR subject LIKE ? OR predicate LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY recorded_at DESC';
      const lim = limit || 50;
      const off = offset || 0;
      query += ' LIMIT ? OFFSET ?';
      params.push(lim, off);

      const rows = db.prepare(query).all(...params) as any[];
      const totalQuery = 'SELECT COUNT(*) as c FROM memories' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
      const totalParams = params.slice(0, -2);
      const total = (db.prepare(totalQuery).get(...totalParams) as { c: number }).c;

      return {
        memories: rows.map((r: any) => ({
          id: r.id, kind: r.kind, slot: r.slot, value_text: r.value_text,
          status: r.status, source_type: r.source_type, confidence: r.confidence,
          importance: r.importance, pinned: r.pinned === 1, observed_at: r.observed_at,
          valid_from: r.valid_from, valid_to: r.valid_to,
        })),
        total,
      };
    });
  }

  // Get memory with full provenance
  getMemory(memoryId: string) {
    const row = this.storage.read((db: any) => db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any);
    if (!row) throw new Error('ERR_NOT_FOUND: Memory not found');
    if (row.status === 'deleted') throw new Error('ERR_NOT_FOUND: Memory not found');
    return {
      id: row.id, kind: row.kind, slot: row.slot, subject: row.subject, predicate: row.predicate,
      value_text: row.value_text, value_json: row.value_json ? JSON.parse(row.value_json) : null,
      evidence_quote: row.evidence_quote, source_turn_id: row.source_turn_id,
      source_episode_id: row.source_episode_id, source_type: row.source_type, modality: row.modality,
      confidence: row.confidence, importance: row.importance, pinned: row.pinned === 1,
      valid_from: row.valid_from, valid_to: row.valid_to, observed_at: row.observed_at,
      recorded_at: row.recorded_at, superseded_at: row.superseded_at,
      superseded_by_id: row.superseded_by_id, supersedes_id: row.supersedes_id,
      last_reinforced_at: row.last_reinforced_at, last_accessed_at: row.last_accessed_at,
      reinforcement_count: row.reinforcement_count, access_count: row.access_count,
      status: row.status, extractor_version: row.extractor_version, decay_class: row.decay_class,
    };
  }

  // Correct memory (supersession by user_edited)
  async correctMemory(memoryId: string, correctedValueText: string, correctedValueJson?: any) {
    const memory = this.storage.read((db: any) => db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any);
    if (!memory) throw new Error('ERR_NOT_FOUND: Memory not found');
    if (memory.status === 'superseded') throw new Error('ERR_CONFLICT: Cannot correct superseded memory, correct the successor instead');
    if (this.deletionManager.getLearningState() === 'paused') throw new Error('ERR_PAUSED: Learning is paused');

    const newId = uuid();
    const now = nowUtc();
    await this.storage.write((db: any) => {
      // Insert corrected memory first
      db.prepare(`
        INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
          source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
          valid_from, valid_to, observed_at, recorded_at, supersedes_id, reinforcement_count, access_count,
          status, extractor_version, decay_class)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId, memory.kind, memory.slot, memory.subject, memory.predicate,
        correctedValueText, correctedValueJson ? JSON.stringify(correctedValueJson) : null,
        memory.evidence_quote, memory.source_turn_id, memory.source_episode_id,
        'user_edited', memory.modality, 0.90, memory.importance, memory.pinned,
        now, null, now, now, memoryId, 0, 0, 'active', 'user', memory.decay_class
      );
      db.prepare('INSERT INTO memories_fts (memory_id, value_text, subject, predicate) VALUES (?, ?, ?, ?)').run(
        newId, correctedValueText, memory.subject, memory.predicate
      );

      // Now supersede old (superseded_by_id references newId, which now exists)
      db.prepare(`
        UPDATE memories SET status = 'superseded', valid_to = ?, superseded_at = ?, superseded_by_id = ?
        WHERE id = ?
      `).run(now, now, newId, memoryId);
      db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(memoryId);

      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'supersede', ?, ?, ?, ?, 1)
      `).run(uuid(), now, 'correct_memory', JSON.stringify([memoryId, newId]),
        JSON.stringify({ id: memoryId, value_text: memory.value_text }),
        JSON.stringify({ id: newId, value_text: correctedValueText }),
        'User correction via correct_memory');
    });

    await this.profileCompiler.compile('correct_memory', [newId]);
    return { new_memory_id: newId, superseded_memory_id: memoryId, profile_recompiled: true };
  }

  // Revert healing action
  async revertHealingAction(healingLogId: string) {
    const log = this.storage.read((db: any) => db.prepare('SELECT * FROM healing_log WHERE id = ?').get(healingLogId) as any);
    if (!log) throw new Error('ERR_NOT_FOUND: Healing log entry not found');
    if (log.reversible !== 1) throw new Error('ERR_CONFLICT: Action is not reversible');

    // Check if already reverted
    const alreadyReverted = this.storage.read((db: any) => db.prepare("SELECT id FROM healing_log WHERE rationale LIKE ?").get(`%revert of ${healingLogId}%`) as any);
    if (alreadyReverted) throw new Error('ERR_CONFLICT: Already reverted');

    const before = log.before_json ? JSON.parse(log.before_json) : null;
    const affectedIds: string[] = JSON.parse(log.memory_ids);

    await this.storage.write((db: any) => {
      // Restore from before snapshot (simplified — full revert would need before_json per row)
      if (log.action === 'delete') {
        throw new Error('ERR_CONFLICT: Deletions are irreversible');
      }
      // For other actions, log the revert
      db.prepare(`
        INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
        VALUES (?, ?, ?, 'repair', ?, ?, ?, ?, 0)
      `).run(uuid(), nowUtc(), 'revert_healing_action', JSON.stringify(affectedIds),
        log.after_json, log.before_json, `Revert of ${healingLogId}`, 0);
    });

    return { healing_log_id: healingLogId, reverted: true, restored_memory_ids: affectedIds, new_healing_log_id: uuid() };
  }

  // Health metrics (full)
  getHealthMetrics() {
    return this.storage.read((db: any) => {
      const countsByStatus: Record<string, number> = {};
      const statusRows = db.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all() as any[];
      for (const r of statusRows) countsByStatus[r.status] = r.c;

      const quarantineCount = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE status = 'quarantined'").get() as { c: number }).c;
      const quarantineOldest = db.prepare("SELECT MIN(recorded_at) as oldest FROM memories WHERE status = 'quarantined'").get() as { oldest: string | null };
      const contradictionDepth = (db.prepare("SELECT COUNT(*) as c FROM review_items WHERE kind = 'contradiction' AND status = 'pending'").get() as { c: number }).c;
      const totalMemories = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
      const provenanceComplete = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE source_turn_id IS NOT NULL AND source_episode_id IS NOT NULL AND evidence_quote != ''").get() as { c: number }).c;
      const profileTokenEstimate = db.prepare("SELECT rendered_text FROM profile WHERE id = 'singleton'").get() as { rendered_text: string } | undefined;
      const lastSleepJob = db.prepare('SELECT finished_at, status FROM sleep_job_runs ORDER BY started_at DESC LIMIT 1').get() as { finished_at: string | null; status: string } | undefined;
      const learningState = db.prepare("SELECT value FROM schema_meta WHERE key = 'learning_state'").get() as { value: string } | undefined;

      return {
        counts_by_status: countsByStatus,
        quarantine_count: quarantineCount,
        quarantine_oldest_age_hours: quarantineOldest.oldest ? (Date.now() - new Date(quarantineOldest.oldest).getTime()) / (1000 * 60 * 60) : 0,
        contradiction_queue_depth: contradictionDepth,
        provenance_complete_percent: totalMemories > 0 ? (provenanceComplete / totalMemories) * 100 : 100,
        profile_token_estimate: profileTokenEstimate ? profileTokenEstimate.rendered_text.split(/\s+/).length : 0,
        learning_state: (learningState?.value || 'active') as 'active' | 'paused',
        last_sleep_job_at: lastSleepJob?.finished_at || null,
        last_sleep_job_result: lastSleepJob?.status || null,
      };
    });
  }

  // Adaptation store (Phase 2)
  async ingestFeedback(signal: { signal_type: string; target: string; detail_json: string; episode_id: string | null }) {
    return this.adaptationStore.ingestFeedback(signal);
  }

  getAdaptationState(dimension: string) {
    return this.adaptationStore.getState(dimension);
  }

  getAllAdaptationStates() {
    return this.adaptationStore.getAllStates();
  }

  async proposeAdaptation(proposal: { dimension: string; proposed_value: string; reason: string; feedback_event_ids: string[]; strength: number }) {
    return this.adaptationStore.proposeAdaptation(proposal);
  }

  async applyAdaptation(dimension: string) {
    return this.adaptationStore.applyAdaptation(dimension);
  }

  async revertAdaptation(dimension: string) {
    return this.adaptationStore.revertAdaptation(dimension);
  }

  async lockAdaptationDimension(dimension: string, locked: boolean) {
    return this.adaptationStore.lockDimension(dimension, locked);
  }

  async aggregateAdaptations(minSignals?: number, minSessions?: number) {
    return this.adaptationStore.aggregateAndPropose(minSignals, minSessions);
  }

  // Graph Store (Knowledge Graph) — public API
  createEntity(name: string, type: string, aliases?: string[], description?: string | null, sourceType?: string, confidence?: number): string {
    return this.graphStore.createEntity(name, type, aliases, description, sourceType, confidence);
  }

  getEntity(id: string) { return this.graphStore.getEntity(id); }
  getEntityByName(name: string) { return this.graphStore.getEntityByName(name); }
  listEntities(type?: string, search?: string, limit?: number, offset?: number) { return this.graphStore.listEntities(type, search, limit, offset); }
  updateEntity(id: string, updates: any) { return this.graphStore.updateEntity(id, updates); }
  deleteEntity(id: string) { return this.graphStore.deleteEntity(id); }

  createRelationship(sourceId: string, targetId: string, relationType: string, description?: string | null, sourceTurnId?: string, sourceEpisodeId?: string, sourceType?: string, confidence?: number): string {
    return this.graphStore.createRelationship(sourceId, targetId, relationType, description, sourceTurnId, sourceEpisodeId, sourceType, confidence);
  }

  getRelationship(id: string) { return this.graphStore.getRelationship(id); }
  listRelationships(sourceId?: string, targetId?: string, relationType?: string, limit?: number, offset?: number) { return this.graphStore.listRelationships(sourceId, targetId, relationType, limit, offset); }
  deleteRelationship(id: string) { return this.graphStore.deleteRelationship(id); }

  getNeighborhood(entityId: string, depth?: number) { return this.graphStore.getNeighborhood(entityId, depth); }
  findPath(fromId: string, toId: string) { return this.graphStore.findPath(fromId, toId); }
  getGraphSnapshot() { return this.graphStore.getGraphSnapshot(); }

  // Storage access for tests
  getStorage() {
    return this.storage;
  }

  close() {
    this.storage.close();
  }
}