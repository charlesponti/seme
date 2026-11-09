// src/provenance/provenance-store.ts — Where an entity or relationship came from.
//
// An entity is deduplicated across mentions, and a relationship is deduplicated
// across mentions and documents, so provenance cannot live on the entity row
// alone. It is read from the mention/evidence tables and joined back to turns
// and ingested sources.

import type { Storage } from '../storage/storage.js';

export interface ProvenanceSource {
  id: string;
  title: string;
  url: string | null;
  source_type: string;
  created_at: string;
}

export interface EntityMentionProvenance {
  entity_id: string;
  turn_id: string;
  mention_text: string;
  role: string;
  evidence_quote: string | null;
  turn_ts: string;
  episode_id: string;
  extraction_mode: string;
  source: ProvenanceSource | null;
  turn_excerpt: string;
}

export interface RelationshipEvidenceProvenance {
  relationship_id: string;
  turn_id: string;
  evidence_quote: string | null;
  turn_ts: string;
  episode_id: string;
  extraction_mode: string;
  source: ProvenanceSource | null;
}

export interface RelationshipWithProvenance {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
  mention_count: number;
  confidence: number;
  source_type: string;
  first_seen_at: string;
  last_seen_at: string;
  evidence: RelationshipEvidenceProvenance[];
}

export interface EntityProvenance {
  entity_id: string;
  mentions: EntityMentionProvenance[];
  relationships: RelationshipWithProvenance[];
}

export class ProvenanceStore {
  constructor(private storage: Storage) {}

  private get db() {
    return this.storage.getKysely();
  }

  async forEntity(entityId: string): Promise<EntityProvenance> {
    const mentions = await this.db
      .selectFrom('entity_turn_links as etl')
      .innerJoin('turns as t', 't.id', 'etl.turn_id')
      .leftJoin('episodes as e', 'e.id', 't.episode_id')
      .leftJoin('sources as s', 's.id', 't.source_id')
      .where('etl.entity_id', '=', entityId)
      .select([
        'etl.entity_id as entity_id',
        'etl.turn_id as turn_id',
        'etl.mention_text as mention_text',
        'etl.role as role',
        'etl.evidence_quote as evidence_quote',
        't.ts as turn_ts',
        't.episode_id as episode_id',
        't.content as turn_content',
        'e.extraction_mode as extraction_mode',
        's.id as source_id',
        's.title as source_title',
        's.url as source_url',
        's.source_type as source_type',
        's.created_at as source_created_at',
      ])
      .orderBy('t.ts', 'desc')
      .execute();

    const relationships = await this.relationshipsForEntity(entityId);

    return {
      entity_id: entityId,
      mentions: mentions.map((row) => ({
        entity_id: row.entity_id,
        turn_id: row.turn_id,
        mention_text: row.mention_text,
        role: row.role,
        evidence_quote: row.evidence_quote ?? null,
        turn_ts: row.turn_ts,
        episode_id: row.episode_id,
        extraction_mode: row.extraction_mode ?? 'user',
        source: row.source_id
          ? {
              id: row.source_id,
              title: row.source_title ?? '',
              url: row.source_url ?? null,
              source_type: row.source_type ?? '',
              created_at: row.source_created_at ?? '',
            }
          : null,
        turn_excerpt: String(row.turn_content ?? '').slice(0, 280),
      })),
      relationships,
    };
  }

  async forRelationship(relationshipId: string): Promise<RelationshipEvidenceProvenance[]> {
    const rows = await this.db
      .selectFrom('relationship_sources as rs')
      .innerJoin('turns as t', 't.id', 'rs.turn_id')
      .leftJoin('episodes as e', 'e.id', 't.episode_id')
      .leftJoin('sources as s', 's.id', 't.source_id')
      .where('rs.relationship_id', '=', relationshipId)
      .select([
        'rs.relationship_id as relationship_id',
        'rs.turn_id as turn_id',
        'rs.evidence_quote as evidence_quote',
        't.ts as turn_ts',
        't.episode_id as episode_id',
        'e.extraction_mode as extraction_mode',
        's.id as source_id',
        's.title as source_title',
        's.url as source_url',
        's.source_type as source_type',
        's.created_at as source_created_at',
      ])
      .orderBy('t.ts', 'desc')
      .execute();

    return rows.map((row) => this.toEvidence(row));
  }

  async relationshipsForEntity(entityId: string): Promise<RelationshipWithProvenance[]> {
    const relationships = await this.db
      .selectFrom('relationships')
      .selectAll()
      .where((eb) => eb.or([eb('source_id', '=', entityId), eb('target_id', '=', entityId)]))
      .orderBy('last_seen_at', 'desc')
      .execute();

    if (relationships.length === 0) return [];
    const ids = relationships.map((r) => r.id);

    const evidenceRows = await this.db
      .selectFrom('relationship_sources as rs')
      .innerJoin('turns as t', 't.id', 'rs.turn_id')
      .leftJoin('episodes as e', 'e.id', 't.episode_id')
      .leftJoin('sources as s', 's.id', 't.source_id')
      .where('rs.relationship_id', 'in', ids)
      .select([
        'rs.relationship_id as relationship_id',
        'rs.turn_id as turn_id',
        'rs.evidence_quote as evidence_quote',
        't.ts as turn_ts',
        't.episode_id as episode_id',
        'e.extraction_mode as extraction_mode',
        's.id as source_id',
        's.title as source_title',
        's.url as source_url',
        's.source_type as source_type',
        's.created_at as source_created_at',
      ])
      .orderBy('t.ts', 'desc')
      .execute();

    const byRelationship = new Map<string, RelationshipEvidenceProvenance[]>();
    for (const row of evidenceRows) {
      const list = byRelationship.get(row.relationship_id) ?? [];
      list.push(this.toEvidence(row));
      byRelationship.set(row.relationship_id, list);
    }

    return relationships.map((r) => ({
      id: r.id,
      source_id: r.source_id,
      target_id: r.target_id,
      relation_type: r.relation_type,
      description: r.description,
      mention_count: r.mention_count,
      confidence: r.confidence,
      source_type: r.source_type,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      evidence: byRelationship.get(r.id) ?? [],
    }));
  }

  /** Sources with the number of turns, entities and relationships extracted. */
  async listSourcesWithCounts(limit = 1000) {
    const sources = await this.db
      .selectFrom('sources as s')
      .leftJoin('turns as t', 's.id', 't.source_id')
      .select(({ fn }) => [
        's.id as id',
        's.title as title',
        's.url as url',
        's.source_type as source_type',
        's.content_length as content_length',
        's.created_at as created_at',
        fn.count<number>('t.id').distinct().as('turn_count'),
      ])
      .groupBy(['s.id', 's.title', 's.url', 's.source_type', 's.content_length', 's.created_at'])
      .orderBy('s.created_at', 'desc')
      .limit(limit)
      .execute();

    if (sources.length === 0) return [];

    const ids = sources.map((s) => s.id);
    const entityCounts = await this.db
      .selectFrom('entity_turn_links as etl')
      .innerJoin('turns as t', 't.id', 'etl.turn_id')
      .where('t.source_id', 'in', ids)
      .select(({ fn }) => [
        't.source_id as source_id',
        fn.count<number>('etl.entity_id').distinct().as('entity_count'),
      ])
      .groupBy('t.source_id')
      .execute();

    const relationshipCounts = await this.db
      .selectFrom('relationship_sources as rs')
      .innerJoin('turns as t', 't.id', 'rs.turn_id')
      .where('t.source_id', 'in', ids)
      .select(({ fn }) => [
        't.source_id as source_id',
        fn.count<number>('rs.relationship_id').distinct().as('relationship_count'),
      ])
      .groupBy('t.source_id')
      .execute();

    const entityMap = new Map(entityCounts.map((r) => [r.source_id, Number(r.entity_count)]));
    const relationshipMap = new Map(
      relationshipCounts.map((r) => [r.source_id, Number(r.relationship_count)]),
    );

    return sources.map((s) => ({
      ...s,
      turn_count: Number(s.turn_count),
      entity_count: entityMap.get(s.id) ?? 0,
      relationship_count: relationshipMap.get(s.id) ?? 0,
    }));
  }

  private toEvidence(row: {
    relationship_id: string;
    turn_id: string;
    evidence_quote: string | null;
    turn_ts: string;
    episode_id: string;
    extraction_mode: string | null;
    source_id: string | null;
    source_title: string | null;
    source_url: string | null;
    source_type: string | null;
    source_created_at: string | null;
  }): RelationshipEvidenceProvenance {
    return {
      relationship_id: row.relationship_id,
      turn_id: row.turn_id,
      evidence_quote: row.evidence_quote ?? null,
      turn_ts: row.turn_ts,
      episode_id: row.episode_id,
      extraction_mode: row.extraction_mode ?? 'user',
      source: row.source_id
        ? {
            id: row.source_id,
            title: row.source_title ?? '',
            url: row.source_url ?? null,
            source_type: row.source_type ?? '',
            created_at: row.source_created_at ?? '',
          }
        : null,
    };
  }
}
