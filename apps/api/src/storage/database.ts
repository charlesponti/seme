// src/storage/database.ts — Kysely table types for the Seme SQLite schema.
//
// These interfaces mirror the migration chain in schema/schema.ts (v12).
// Keep them in sync when a migration adds or renames a column: Kysely turns
// any drift into a compile error at the query site, which is the point.

export interface TurnsTable {
  id: string;
  episode_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
  source_id: string | null;
}

export interface EpisodesTable {
  id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  summary_version: number | null;
  user_affect_tags: string | null;
  agent_behaviour_tags: string | null;
  extractor_version: string | null;
  extraction_mode: 'user' | 'document';
}

export interface SlotRegistryTable {
  slot: string;
  kind: string;
  cardinality: 'single' | 'multi';
  decay_class: string;
  profile_included: number;
}

export interface MemoriesTable {
  id: string;
  kind: string;
  slot: string | null;
  subject: string;
  predicate: string;
  value_text: string;
  value_json: string | null;
  evidence_quote: string;
  source_turn_id: string;
  source_episode_id: string;
  source_type: string;
  modality: string;
  confidence: number;
  importance: number;
  pinned: number;
  valid_from: string | null;
  valid_to: string | null;
  observed_at: string;
  recorded_at: string;
  superseded_at: string | null;
  superseded_by_id: string | null;
  supersedes_id: string | null;
  last_reinforced_at: string | null;
  last_accessed_at: string | null;
  reinforcement_count: number;
  access_count: number;
  status: string;
  extractor_version: string;
  decay_class: string;
}

export interface ProfileTable {
  id: string;
  rendered_text: string;
  source_memory_ids: string;
  version: number;
  updated_at: string;
}

export interface ProfileVersionsTable {
  id: string;
  version: number;
  status: 'published' | 'held';
  rendered_text: string;
  diff_text: string | null;
  reason: string;
  triggering_memory_ids: string;
  created_at: string;
}

export interface ProceduralRulesTable {
  id: string;
  rule_text: string;
  source_memory_ids: string;
  priority: string;
  status: string;
  created_from: string;
  user_approved: number;
  created_at: string;
  superseded_at: string | null;
}

export interface HealingLogTable {
  id: string;
  ts: string;
  job: string;
  action: string;
  memory_ids: string;
  before_json: string | null;
  after_json: string | null;
  rationale: string;
  reversible: number;
}

export interface SleepJobRunsTable {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  steps_json: string | null;
  metrics_json: string | null;
}

export interface ReviewItemsTable {
  id: string;
  kind: string;
  payload_json: string;
  memory_ids: string;
  status: string;
  resolution_json: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FeedbackEventsTable {
  id: string;
  ts: string;
  episode_id: string | null;
  signal_type: string;
  target: string;
  detail_json: string;
}

export interface AdaptationStateTable {
  dimension: string;
  current_value: string;
  strength: number;
  status: string;
  user_locked: number;
  updated_at: string;
}

export interface AdaptationVersionsTable {
  id: string;
  dimension: string;
  value: string;
  ts: string;
  reason: string;
  feedback_event_ids: string;
  superseded_at: string | null;
}

export interface IdentityCoreTable {
  id: string;
  content_json: string;
  rendered_text: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface EntitiesTable {
  id: string;
  name: string;
  type: string;
  aliases: string | null;
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
  mention_count: number;
  confidence: number;
  source_type: string;
  profile_included: number;
  pinned: number;
  first_seen_turn_id: string | null;
  first_seen_source_id: string | null;
}

export interface RelationshipsTable {
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
  source_document_id: string | null;
  evidence_quote: string | null;
}

export interface EntityMemoryLinksTable {
  entity_id: string;
  memory_id: string;
  role: 'subject' | 'object' | 'context' | 'mentioned';
  created_at: string;
}

export interface EntityTurnLinksTable {
  entity_id: string;
  turn_id: string;
  mention_text: string;
  role: 'subject' | 'object';
  source_id: string | null;
  evidence_quote: string | null;
  created_at: string;
}

export interface RelationshipSourcesTable {
  relationship_id: string;
  turn_id: string;
  source_id: string | null;
  evidence_quote: string | null;
  created_at: string;
}

export interface WikiPagesTable {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  title: string;
  content: string;
  page_type: string;
  maturity: string;
  version: number;
  source_memory_ids: string;
  status: string;
  conflict_ids: string;
  created_at: string;
  updated_at: string;
  updated_by: 'system' | 'user';
}

export interface WikiPageVersionsTable {
  id: string;
  page_id: string;
  version: number;
  content: string;
  maturity: string;
  reason: string;
  created_at: string;
  created_by: string;
}

export interface SourcesTable {
  id: string;
  title: string;
  url: string | null;
  source_type: string;
  content_length: number;
  created_at: string;
}

export interface KbTasksTable {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  memory_ids: string;
  entity_ids: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProceduresTable {
  id: string;
  title: string;
  description: string | null;
  procedure_type: string;
  trigger_pattern: string | null;
  steps_json: string;
  guards_json: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationsTable {
  id: string;
  service_name: string;
  display_name: string;
  status: string;
  auth_type: string;
  credentials: string | null;
  scopes: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface SchemaMetaTable {
  key: string;
  value: string;
}

export interface DB {
  turns: TurnsTable;
  episodes: EpisodesTable;
  slot_registry: SlotRegistryTable;
  memories: MemoriesTable;
  profile: ProfileTable;
  profile_versions: ProfileVersionsTable;
  procedural_rules: ProceduralRulesTable;
  healing_log: HealingLogTable;
  sleep_job_runs: SleepJobRunsTable;
  review_items: ReviewItemsTable;
  feedback_events: FeedbackEventsTable;
  adaptation_state: AdaptationStateTable;
  adaptation_versions: AdaptationVersionsTable;
  identity_core: IdentityCoreTable;
  entities: EntitiesTable;
  relationships: RelationshipsTable;
  entity_memory_links: EntityMemoryLinksTable;
  entity_turn_links: EntityTurnLinksTable;
  relationship_sources: RelationshipSourcesTable;
  wiki_pages: WikiPagesTable;
  wiki_page_versions: WikiPageVersionsTable;
  sources: SourcesTable;
  kb_tasks: KbTasksTable;
  procedures: ProceduresTable;
  integrations: IntegrationsTable;
  schema_migrations: SchemaMigrationsTable;
  schema_meta: SchemaMetaTable;
}
