// src/extraction/pipeline.ts — Extraction pipeline orchestration

import { Storage } from '../storage/storage.js';
import { IngestManager } from '../ingest/ingest.js';
import { ValidationGate } from '../validation/validation-gate.js';
import { Resolver } from '../resolver/resolver.js';
import { ProfileCompiler } from '../profile/profile-compiler.js';
import { Extractor, ExtractInput, ExtractOutput } from './extractor.js';
import { EntityExtractor, EntityExtractOutput } from './entity-extractor.js';
import { createSkillRouter } from '../skills/router.js';
import { EntityResolver } from '../resolver/entity-resolver.js';
import { RelationshipResolver } from '../resolver/relationship-resolver.js';
import { sql } from 'kysely';
import { uuid, nowUtc } from '../types/common.js';

/** Phases of one extraction run, reported live so the UI can show real progress. */
export type ExtractionStage =
  | 'extracting_memories'
  | 'saving_memories'
  | 'extracting_entities'
  | 'resolving_entities'
  | 'linking'
  | 'compiling_profile';

export interface StageDetail {
  total?: number;
  done?: number;
}

export class ExtractionPipeline {
  private storage: Storage;
  private ingest: IngestManager;
  private gate: ValidationGate;
  private resolver: Resolver;
  private profileCompiler: ProfileCompiler;
  private extractor: Extractor;
  private entityExtractor: EntityExtractor;
  private entityResolver: EntityResolver;
  private relationshipResolver: RelationshipResolver;

  constructor(
    storage: Storage,
    ingest: IngestManager,
    gate: ValidationGate,
    resolver: Resolver,
    profileCompiler: ProfileCompiler,
    extractor?: Extractor,
    entityExtractor?: EntityExtractor,
    entityResolver?: EntityResolver,
    relationshipResolver?: RelationshipResolver,
  ) {
    this.storage = storage;
    this.ingest = ingest;
    this.gate = gate;
    this.resolver = resolver;
    this.profileCompiler = profileCompiler;
    this.extractor = extractor || new Extractor(storage);
    this.entityExtractor =
      entityExtractor ||
      new EntityExtractor(storage, undefined, undefined, createSkillRouter(storage));
    this.entityResolver = entityResolver || new EntityResolver(storage);
    this.relationshipResolver = relationshipResolver || new RelationshipResolver(storage);
  }

  async run(
    episodeId: string,
    options: {
      entitiesOnly?: boolean;
      onStage?: (stage: ExtractionStage, detail?: StageDetail) => void;
    } = {},
  ): Promise<{
    candidates_processed: number;
    memories_created: number;
    feedback_events_created: number;
    entities_created: number;
    relationships_created: number;
  }> {
    const episode = this.ingest.getEpisode(episodeId);
    if (!episode) throw new Error('ERR_NOT_FOUND: Episode not found');

    const turns = this.ingest.getEpisodeTurns(episodeId);
    if (turns.length === 0) {
      // Empty episode — no extraction needed
      return {
        candidates_processed: 0,
        memories_created: 0,
        feedback_events_created: 0,
        entities_created: 0,
        relationships_created: 0,
      };
    }

    // Build extract input
    const mode: 'user' | 'document' = episode.extraction_mode === 'document' ? 'document' : 'user';
    const recentMessages = turns.slice(-5); // last m turns (m=5 for V1)
    const input: ExtractInput = {
      episode_id: episodeId,
      turns: turns.map((t) => ({ id: t.id, role: t.role, content: t.content, ts: t.ts })),
      rolling_summary: episode.summary,
      recent_messages: recentMessages.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        ts: t.ts,
      })),
      mode,
    };

    // Entities-only retries skip the memory call entirely; the existing
    // memories for the episode are reused for entity→memory links.
    let output: ExtractOutput = {
      extractor_version: options.entitiesOnly ? 'entities-only' : 'unknown',
      memory_candidates: [],
      feedback_event_candidates: [],
    };
    if (!options.entitiesOnly) {
      options.onStage?.('extracting_memories');
      // Extract (with retry on invalid_output)
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
            return {
              candidates_processed: 0,
              memories_created: 0,
              feedback_events_created: 0,
              entities_created: 0,
              relationships_created: 0,
            };
          }
        } else {
          // Unavailable — defer
          console.error('Extractor unavailable for episode', episodeId);
          return {
            candidates_processed: 0,
            memories_created: 0,
            feedback_events_created: 0,
            entities_created: 0,
            relationships_created: 0,
          };
        }
      }
    }

    // Update episode extractor_version
    await this.storage.write((db) => {
      db.prepare('UPDATE episodes SET extractor_version = ? WHERE id = ?').run(
        output.extractor_version,
        episodeId,
      );
    });

    let memoriesCreated = 0;
    const triggeringMemoryIds: string[] = [];

    if (options.entitiesOnly) {
      const existing = this.storage.read(
        (db: any) =>
          db.prepare('SELECT id FROM memories WHERE source_episode_id = ?').all(episodeId) as {
            id: string;
          }[],
      );
      for (const row of existing) triggeringMemoryIds.push(row.id);
    }

    // Process memory candidates through gate + resolver
    const memoryCandidates = options.entitiesOnly ? [] : output.memory_candidates;
    for (const [index, candidate] of memoryCandidates.entries()) {
      options.onStage?.('saving_memories', { total: memoryCandidates.length, done: index });
      try {
        const gateResult = this.gate.validate(candidate as any);
        if (!gateResult.passed) {
          // Gate failed — candidate is quarantined (log it)
          await this.storage.write((db) => {
            db.prepare(`
              INSERT INTO healing_log (id, ts, job, action, memory_ids, before_json, after_json, rationale, reversible)
              VALUES (?, ?, ?, 'quarantine', ?, ?, NULL, ?, 0)
            `).run(
              uuid(),
              nowUtc(),
              'extraction',
              JSON.stringify([]),
              JSON.stringify(candidate),
              `Gate failed: ${gateResult.errors.join(', ')}`,
            );
          });
          continue;
        }

        const resolution = await this.resolver.resolve(gateResult.candidate!);
        if (
          resolution.decision === 'ADD' ||
          resolution.decision === 'SUPERSEDE' ||
          resolution.decision === 'MERGE'
        ) {
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

    // === Entity/Relationship Extraction (Knowledge Graph) ===
    let entitiesCreated = 0;
    let relationshipsCreated = 0;
    try {
      const entityInput = {
        episode_id: episodeId,
        mode,
        turns: turns.map((t) => ({
          id: t.id,
          role: t.role,
          content: t.content,
          ts: t.ts,
          source_id: (t as any).source_id ?? null,
        })),
      };

      options.onStage?.('extracting_entities');
      let entityOutput: EntityExtractOutput;
      try {
        entityOutput = await this.entityExtractor.extract(entityInput);
      } catch (e: any) {
        if (e.message === 'invalid_output') {
          try {
            entityOutput = await this.entityExtractor.extract(entityInput);
          } catch {
            console.error('Entity extraction failed twice for episode', episodeId);
            entityOutput = {
              extractor_version: 'unknown',
              entity_candidates: [],
              relationship_candidates: [],
            };
          }
        } else {
          console.error('Entity extractor unavailable for episode', episodeId);
          entityOutput = {
            extractor_version: 'unknown',
            entity_candidates: [],
            relationship_candidates: [],
          };
        }
      }

      // Resolve entities
      const entityNameToId = new Map<string, string>();
      const entityCandidates = entityOutput.entity_candidates;
      for (const [index, ec] of entityCandidates.entries()) {
        options.onStage?.('resolving_entities', { total: entityCandidates.length, done: index });
        const resolution = await this.entityResolver.resolve(ec);
        const entityId = resolution.entity_id;
        entityNameToId.set(ec.name.toLowerCase(), entityId);
        if (resolution.decision === 'ADD' || resolution.decision === 'MERGE') {
          entitiesCreated++;
        }
      }

      // Resolve relationships and record every piece of evidence, not just the
      // first one: a relationship is deduplicated across mentions and sources.
      options.onStage?.('linking');
      for (const rc of entityOutput.relationship_candidates) {
        // The graph stores what was stated as fact. Hypothetical, joking, negated
        // or quoted links would read as facts here, since edges carry no modality.
        if (rc.modality !== 'stated') continue;
        const resolution = await this.relationshipResolver.resolve(rc, episodeId);
        if (resolution.decision === 'ADD' || resolution.decision === 'MERGE') {
          relationshipsCreated++;
          await this.storage
            .getKysely()
            .insertInto('relationship_sources')
            .values({
              relationship_id: resolution.relationship_id,
              turn_id: rc.source_turn_id,
              source_id: rc.source_id,
              evidence_quote: rc.evidence_quote,
              created_at: nowUtc(),
            })
            .onConflict((oc) => oc.columns(['relationship_id', 'turn_id']).doNothing())
            .execute();
        }
      }

      // Link entities to every turn they were mentioned in, with the source
      // document and the verbatim span that supports the mention.
      for (const ec of entityOutput.entity_candidates) {
        const entityId = entityNameToId.get(ec.name.toLowerCase());
        if (!entityId) continue;
        const mentions =
          ec.mentions && ec.mentions.length > 0
            ? ec.mentions
            : [
                {
                  source_turn_id: ec.source_turn_id,
                  source_id: ec.source_id,
                  evidence_quote: ec.evidence_quote,
                  mention_text: ec.name,
                },
              ];
        for (const mention of mentions) {
          await this.storage
            .getKysely()
            .insertInto('entity_turn_links')
            .values({
              entity_id: entityId,
              turn_id: mention.source_turn_id,
              mention_text: mention.mention_text,
              role: 'subject',
              source_id: mention.source_id,
              evidence_quote: mention.evidence_quote,
              created_at: nowUtc(),
            })
            .onConflict((oc) =>
              oc.columns(['entity_id', 'turn_id']).doUpdateSet({
                mention_text: mention.mention_text,
                source_id: sql`COALESCE(excluded.source_id, entity_turn_links.source_id)`,
                evidence_quote: sql`COALESCE(excluded.evidence_quote, entity_turn_links.evidence_quote)`,
              }),
            )
            .execute();
        }
      }

      // Link entities to memories, but only when the entity is actually
      // mentioned in that memory. Co-occurrence inside an episode is not
      // evidence: an article about a budget mentions twenty entities, and
      // blindly pairing them with every memory in the episode produced wiki
      // pages where unrelated entities shared identical "facts".
      if (triggeringMemoryIds.length > 0) {
        const memoryText = new Map<string, string>();
        for (const memId of triggeringMemoryIds) {
          const row = this.storage.read(
            (db: any) =>
              db
                .prepare('SELECT value_text, evidence_quote, subject FROM memories WHERE id = ?')
                .get(memId) as
                | { value_text: string; evidence_quote: string | null; subject: string | null }
                | undefined,
          );
          if (!row) continue;
          memoryText.set(
            memId,
            `${row.value_text} ${row.evidence_quote ?? ''} ${row.subject ?? ''}`.toLowerCase(),
          );
        }

        /** Word-boundary aware containment test for an entity name. */
        const mentions = (haystack: string, needle: string): boolean => {
          const n = needle.trim().toLowerCase();
          if (n.length < 2) return false;
          const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // \b fails on names that start/end with punctuation, so guard it.
          try {
            return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
          } catch {
            return haystack.includes(n);
          }
        };

        for (const ec of entityOutput.entity_candidates) {
          const entityId = entityNameToId.get(ec.name.toLowerCase());
          if (!entityId) continue;
          for (const memId of triggeringMemoryIds) {
            const haystack = memoryText.get(memId);
            if (!haystack || !mentions(haystack, ec.name)) continue;
            await this.storage.write((db) => {
              db.prepare(`
                INSERT OR IGNORE INTO entity_memory_links (entity_id, memory_id, role, created_at)
                VALUES (?, ?, ?, ?)
              `).run(entityId, memId, 'mentioned', nowUtc());
            });
          }
        }
      }

      if (entitiesCreated > 0 || relationshipsCreated > 0) {
        console.log(
          `Entity extraction for ${episodeId}: ${entitiesCreated} entities, ${relationshipsCreated} relationships`,
        );
      }
    } catch (e: any) {
      console.error('Entity extraction failed for episode', episodeId, ':', e.message);
    }

    // Recompile profile if any memories were created. Document episodes skip
    // this: a news fact must never rewrite the user's profile.
    if (memoriesCreated > 0 && mode !== 'document') {
      options.onStage?.('compiling_profile');
      await this.profileCompiler.compile('extraction', triggeringMemoryIds);
    }

    return {
      candidates_processed:
        output.memory_candidates.length + output.feedback_event_candidates.length,
      memories_created: memoriesCreated,
      feedback_events_created: feedbackCreated,
      entities_created: entitiesCreated,
      relationships_created: relationshipsCreated,
    };
  }
}
