// src/evals/provenance-eval.ts — Deterministic provenance checks (no model).
//
// Creates a document episode backed by a real `sources` row, resolves entities
// and a relationship through the production resolvers, records mentions the way
// the extraction pipeline does, and asserts that ProvenanceStore can name the
// article and quote the supporting span for both.

import * as fs from 'node:fs';
import { Storage } from '../storage/storage.js';
import { EntityResolver } from '../resolver/entity-resolver.js';
import { RelationshipResolver } from '../resolver/relationship-resolver.js';
import { ProvenanceStore } from '../provenance/provenance-store.js';
import type { EntityCandidate, RelationshipCandidate } from '../extraction/entity-extractor.js';

const EMBEDDING_DIM = 1024;
const BASE_DIR = '/tmp/scratchpad/seme-provenance-eval';

async function main() {
  const dir = `${BASE_DIR}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(dir, { recursive: true });

  const checks: { ok: boolean; text: string }[] = [];
  const check = (ok: boolean, text: string) => checks.push({ ok, text });

  let storage: Storage | null = null;
  try {
    storage = new Storage({ storageDir: dir, embeddingDim: EMBEDDING_DIM });
    const db = storage.getKysely();

    const sourceId = 'source-bbc-budget';
    const episodeId = 'episode-bbc-budget';
    const turnId = 'turn-bbc-budget-1';
    const quoteReeves = 'Rachel Reeves has announced an extra £2bn for the NHS';
    const quoteTreasury = 'The Treasury is based in Westminster, London.';
    const relationshipQuote =
      'Rachel Reeves has announced an extra £2bn for the NHS in her autumn Budget, the Treasury said on Tuesday.';

    await db
      .insertInto('sources')
      .values({
        id: sourceId,
        title: 'Budget 2026: Reeves announces extra NHS funding',
        url: 'https://www.bbc.co.uk/news/budget-2026',
        source_type: 'url',
        content_length: 900,
        created_at: '2026-10-29T08:00:00Z',
      })
      .execute();

    await db
      .insertInto('episodes')
      .values({
        id: episodeId,
        session_id: 'session-bbc',
        started_at: '2026-10-29T08:00:00Z',
        ended_at: '2026-10-29T08:00:01Z',
        extraction_mode: 'document',
      })
      .execute();

    await db
      .insertInto('turns')
      .values({
        id: turnId,
        episode_id: episodeId,
        session_id: 'session-bbc',
        role: 'user',
        content: `[Source: Budget 2026: Reeves announces extra NHS funding (https://www.bbc.co.uk/news/budget-2026)] ${relationshipQuote} ${quoteTreasury}`,
        ts: '2026-10-29T08:00:00Z',
        source_id: sourceId,
      })
      .execute();

    const entityResolver = new EntityResolver(storage);
    const relationshipResolver = new RelationshipResolver(storage);

    const reeves: EntityCandidate = {
      name: 'Rachel Reeves',
      type: 'person',
      aliases: [],
      description: 'Chancellor of the Exchequer',
      source_turn_id: turnId,
      source_id: sourceId,
      evidence_quote: quoteReeves,
      mentions: [
        {
          source_turn_id: turnId,
          source_id: sourceId,
          evidence_quote: quoteReeves,
          mention_text: 'Rachel Reeves',
        },
      ],
      source_type: 'document_stated',
      modality: 'stated',
      importance: 0.7,
      confidence: 0.92,
    };

    const treasury: EntityCandidate = {
      name: 'Treasury',
      type: 'organization',
      aliases: [],
      description: 'UK finance ministry',
      source_turn_id: turnId,
      source_id: sourceId,
      evidence_quote: quoteTreasury,
      mentions: [
        {
          source_turn_id: turnId,
          source_id: sourceId,
          evidence_quote: quoteTreasury,
          mention_text: 'Treasury',
        },
      ],
      source_type: 'document_stated',
      modality: 'stated',
      importance: 0.6,
      confidence: 0.9,
    };

    const reevesResolution = await entityResolver.resolve(reeves);
    const treasuryResolution = await entityResolver.resolve(treasury);

    for (const [entityId, candidate] of [
      [reevesResolution.entity_id, reeves],
      [treasuryResolution.entity_id, treasury],
    ] as const) {
      await db
        .insertInto('entity_turn_links')
        .values({
          entity_id: entityId,
          turn_id: candidate.source_turn_id,
          mention_text: candidate.name,
          role: 'subject',
          source_id: candidate.source_id,
          evidence_quote: candidate.evidence_quote,
          created_at: '2026-10-29T08:00:02Z',
        })
        .execute();
    }

    const relationship: RelationshipCandidate = {
      source_entity_name: 'Rachel Reeves',
      target_entity_name: 'Treasury',
      relation_type: 'related_to',
      description: 'Reeves announced NHS funding; the Treasury confirmed it',
      source_turn_id: turnId,
      source_id: sourceId,
      evidence_quote: relationshipQuote,
      source_type: 'document_stated',
      modality: 'stated',
      importance: 0.6,
      confidence: 0.88,
    };

    const relResolution = await relationshipResolver.resolve(relationship, episodeId);
    await db
      .insertInto('relationship_sources')
      .values({
        relationship_id: relResolution.relationship_id,
        turn_id: relationship.source_turn_id,
        source_id: relationship.source_id,
        evidence_quote: relationship.evidence_quote,
        created_at: '2026-10-29T08:00:02Z',
      })
      .execute();

    const store = new ProvenanceStore(storage);
    const provenance = await store.forEntity(reevesResolution.entity_id);

    check(
      provenance.mentions.length === 1,
      `Entity has 1 recorded mention (got ${provenance.mentions.length})`,
    );
    check(
      provenance.mentions[0]?.source?.title === 'Budget 2026: Reeves announces extra NHS funding',
      `Mention names its source article (got ${provenance.mentions[0]?.source?.title ?? 'null'})`,
    );
    check(
      provenance.mentions[0]?.source?.url === 'https://www.bbc.co.uk/news/budget-2026',
      'Mention carries the source URL',
    );
    check(
      provenance.mentions[0]?.evidence_quote === quoteReeves,
      `Mention keeps the verbatim quote (got ${provenance.mentions[0]?.evidence_quote ?? 'null'})`,
    );
    check(
      provenance.mentions[0]?.extraction_mode === 'document',
      'Mention is marked as document-mode extraction',
    );

    const storedEntity = await db
      .selectFrom('entities')
      .selectAll()
      .where('id', '=', reevesResolution.entity_id)
      .executeTakeFirst();
    check(storedEntity?.source_type === 'document_stated', 'Entity source_type is document_stated');
    check(storedEntity?.first_seen_source_id === sourceId, 'Entity records first_seen_source_id');
    check(storedEntity?.first_seen_turn_id === turnId, 'Entity records first_seen_turn_id');

    const storedRelationship = await db
      .selectFrom('relationships')
      .selectAll()
      .where('id', '=', relResolution.relationship_id)
      .executeTakeFirst();
    check(
      storedRelationship?.source_document_id === sourceId,
      'Relationship records source_document_id',
    );
    check(
      storedRelationship?.evidence_quote === relationshipQuote,
      'Relationship records first evidence quote',
    );

    check(
      provenance.relationships.length === 1,
      `Entity has 1 relationship with provenance (got ${provenance.relationships.length})`,
    );
    check(
      provenance.relationships[0]?.evidence[0]?.source?.title ===
        'Budget 2026: Reeves announces extra NHS funding',
      'Relationship evidence names the source article',
    );
    check(
      provenance.relationships[0]?.evidence[0]?.evidence_quote === relationshipQuote,
      'Relationship evidence keeps the verbatim quote',
    );

    const relationshipEvidence = await store.forRelationship(relResolution.relationship_id);
    check(
      relationshipEvidence.length === 1,
      `forRelationship returns evidence (got ${relationshipEvidence.length})`,
    );

    const sources = await store.listSourcesWithCounts();
    check(sources.length === 1, `Source list has 1 row (got ${sources.length})`);
    check(
      Number(sources[0]?.turn_count) === 1,
      `Source counts 1 turn (got ${sources[0]?.turn_count})`,
    );
    check(
      Number(sources[0]?.entity_count) === 2,
      `Source counts 2 entities (got ${sources[0]?.entity_count})`,
    );
    check(
      Number(sources[0]?.relationship_count) === 1,
      `Source counts 1 relationship (got ${sources[0]?.relationship_count})`,
    );
  } finally {
    try {
      storage?.close();
    } catch {
      /* already closed */
    }
    try {
      fs.rmSync(dir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  let passed = 0;
  for (const c of checks) {
    if (c.ok) passed++;
    console.log(`${c.ok ? '✓' : '✗'} ${c.text}`);
  }
  console.log(`\nTOTAL: ${passed}/${checks.length} checks`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
