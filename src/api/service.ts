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
import { uuid, nowUtc } from '../types/common.js';

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

  constructor(config: StorageConfig) {
    this.storage = new Storage(config);
    this.ingest = new IngestManager(this.storage);
    this.gate = new ValidationGate(this.storage);
    this.resolver = new Resolver(this.storage);
    this.profileCompiler = new ProfileCompiler(this.storage);
    this.retrieval = new RetrievalEngine(this.storage);
    this.identityCore = new IdentityCoreManager(this.storage);
    this.extractionPipeline = new ExtractionPipeline(
      this.storage, this.ingest, this.gate, this.resolver, this.profileCompiler
    );
    this.sleepJob = new SleepJob(this.storage, this.profileCompiler);
    this.reviewQueue = new ReviewQueue(this.storage);
    this.deletionManager = new DeletionManager(this.storage, this.profileCompiler);

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
    ];
    const db = this.storage.getDb();
    for (const s of slots) {
      db.prepare(`
        INSERT OR IGNORE INTO slot_registry (slot, kind, cardinality, decay_class, profile_included)
        VALUES (?, ?, ?, ?, ?)
      `).run(s.slot, s.kind, s.cardinality, s.decay_class, s.profile_included);
    }
  }

  // 1. record_turn
  async recordTurn(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, ts?: string, turnId?: string) {
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

  // Storage access for tests
  getStorage() {
    return this.storage;
  }

  close() {
    this.storage.close();
  }
}