// src/extraction/pipeline.ts — Extraction pipeline orchestration

import { Storage } from '../storage/storage.js';
import { IngestManager } from '../ingest/ingest.js';
import { ValidationGate } from '../validation/validation-gate.js';
import { Resolver } from '../resolver/resolver.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { Extractor, ExtractInput, ExtractOutput } from './extractor.js';
import { uuid, nowUtc } from '../types/common.js';

export class ExtractionPipeline {
  private storage: Storage;
  private ingest: IngestManager;
  private gate: ValidationGate;
  private resolver: Resolver;
  private profileCompiler: ProfileCompiler;
  private extractor: Extractor;

  constructor(
    storage: Storage,
    ingest: IngestManager,
    gate: ValidationGate,
    resolver: Resolver,
    profileCompiler: ProfileCompiler,
    extractor?: Extractor
  ) {
    this.storage = storage;
    this.ingest = ingest;
    this.gate = gate;
    this.resolver = resolver;
    this.profileCompiler = profileCompiler;
    this.extractor = extractor || new Extractor(storage);
  }

  async run(episodeId: string): Promise<{ candidates_processed: number; memories_created: number; feedback_events_created: number }> {
    const episode = this.ingest.getEpisode(episodeId);
    if (!episode) throw new Error('ERR_NOT_FOUND: Episode not found');

    const turns = this.ingest.getEpisodeTurns(episodeId);
    if (turns.length === 0) {
      // Empty episode — no extraction needed
      return { candidates_processed: 0, memories_created: 0, feedback_events_created: 0 };
    }

    // Build extract input
    const recentMessages = turns.slice(-5); // last m turns (m=5 for V1)
    const input: ExtractInput = {
      episode_id: episodeId,
      turns: turns.map(t => ({ id: t.id, role: t.role, content: t.content, ts: t.ts })),
      rolling_summary: episode.summary,
      recent_messages: recentMessages.map(t => ({ id: t.id, role: t.role, content: t.content, ts: t.ts })),
    };

    // Extract (with retry on invalid_output)
    let output: ExtractOutput;
    try {
      output = await this.extractor.extract(input);
    } catch (e: any) {
      if (e.message === 'invalid_output') {
        // Retry once
        try {
          output = await this.extractor.extract(input);
        } catch {
          // Second failure — leave episode unextracted
          console.error('Extraction failed twice for episode', episodeId);
          return { candidates_processed: 0, memories_created: 0, feedback_events_created: 0 };
        }
      } else {
        // Unavailable — defer
        console.error('Extractor unavailable for episode', episodeId);
        return { candidates_processed: 0, memories_created: 0, feedback_events_created: 0 };
      }
    }

    // Update episode extractor_version
    await this.storage.write((db) => {
      db.prepare('UPDATE episodes SET extractor_version = ? WHERE id = ?').run(output.extractor_version, episodeId);
    });

    let memoriesCreated = 0;
    const triggeringMemoryIds: string[] = [];

    // Process memory candidates through gate + resolver
    for (const candidate of output.memory_candidates) {
      try {
        const gateResult = this.gate.validate(candidate as any);
        if (!gateResult.passed) {
          // Gate failed — candidate is quarantined (log it)
          await this.storage.write((db) => {
            db.prepare(`
              INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
              VALUES (?, ?, ?, 'quarantine', ?, ?, NULL, ?, 0)
            `).run(uuid(), nowUtc(), 'extraction', JSON.stringify([]), JSON.stringify(candidate), `Gate failed: ${gateResult.errors.join(', ')}`);
          });
          continue;
        }

        const resolution = await this.resolver.resolve(gateResult.candidate!);
        if (resolution.decision === 'ADD' || resolution.decision === 'SUPERSEDE' || resolution.decision === 'MERGE') {
          memoriesCreated++;
          triggeringMemoryIds.push(resolution.candidate_id);
        }
      } catch (e: any) {
        console.error('Candidate processing error:', e.message);
      }
    }

    // Process feedback event candidates
    let feedbackCreated = 0;
    for (const fb of output.feedback_event_candidates) {
      await this.storage.write((db) => {
        db.prepare(`
          INSERT INTO feedback_events (id, ts, episode_id, signal_type, target, detail_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuid(), nowUtc(), episodeId, fb.signal_type, fb.target, fb.detail_json);
      });
      feedbackCreated++;
    }

    // Recompile profile if any memories were created
    if (memoriesCreated > 0) {
      await this.profileCompiler.compile('extraction', triggeringMemoryIds);
    }

    return {
      candidates_processed: output.memory_candidates.length + output.feedback_event_candidates.length,
      memories_created: memoriesCreated,
      feedback_events_created: feedbackCreated,
    };
  }
}