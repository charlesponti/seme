// src/types/common.ts — Shared types and enums for the self-healing memory system

export type MemoryStatus = 'candidate' | 'active' | 'superseded' | 'archived' | 'quarantined' | 'deleted';
export type SourceType = 'user_stated' | 'user_confirmed' | 'agent_inferred' | 'agent_reflection' | 'user_edited' | 'document_stated';
export type ExtractionMode = 'user' | 'document';
export type Modality = 'stated' | 'hypothetical' | 'negated' | 'joking' | 'quoted';
export type MemoryKind = 'fact' | 'preference' | 'routine' | 'boundary' | 'relationship' | 'interest' | 'trait_inference'
  | 'decision' | 'reference' | 'anti_pattern' | 'observation';
export type DecayClass = 'exempt' | 'slow' | 'medium' | 'fast' | 'session';
export type HealingAction = 'merge' | 'supersede' | 'archive' | 'quarantine' | 'promote' | 'demote' | 'repair' | 'delete' | 'profile_recompile' | 'add' | 'noop';
export type TurnRole = 'user' | 'assistant' | 'system';
export type ProceduralPriority = 'boundary' | 'preference' | 'style';
export type ProceduralStatus = 'active' | 'superseded' | 'archived';
export type Cardinality = 'single' | 'multi';
export type SignalType = 'explicit_rating' | 'correction' | 'compliment_specific' | 're_engagement' | 'disengagement' | 'user_edit';
export type FeedbackTarget = 'avatar' | 'register' | 'topic' | 'pacing' | 'persona' | 'other';
export type ReviewItemKind = 'contradiction' | 'held_profile' | 'digest' | 'quarantine' | 'repair_proposal' | 'adaptation_proposal';
export type ReviewItemStatus = 'pending' | 'resolved' | 'dismissed';
export type AdaptationStatus = 'proposed' | 'active' | 'reverted';
export type SleepJobTrigger = 'scheduled' | 'idle' | 'session_count' | 'manual';
export type SleepJobStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface Memory {
  id: string;
  kind: MemoryKind;
  slot: string | null;
  subject: string;
  predicate: string;
  value_text: string;
  value_json: string | null;
  evidence_quote: string;
  source_turn_id: string;
  source_episode_id: string;
  source_type: SourceType;
  modality: Modality;
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
  status: MemoryStatus;
  extractor_version: string;
  decay_class: DecayClass;
}

export interface Turn {
  id: string;
  episode_id: string;
  session_id: string;
  role: TurnRole;
  content: string;
  ts: string;
}

export interface Episode {
  id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  summary_version: number | null;
  user_affect_tags: string | null;
  agent_behaviour_tags: string | null;
  extractor_version: string | null;
  extraction_mode: ExtractionMode;
}

export interface SlotRegistryEntry {
  slot: string;
  kind: MemoryKind;
  cardinality: Cardinality;
  decay_class: DecayClass;
  profile_included: number;
}

export interface IdentityCore {
  id: string;
  content_json: string;
  rendered_text: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface ProceduralRule {
  id: string;
  rule_text: string;
  source_memory_ids: string;
  priority: ProceduralPriority;
  status: ProceduralStatus;
  created_from: 'sleep_job' | 'user';
  user_approved: number;
  created_at: string;
  superseded_at: string | null;
}

export interface Profile {
  id: string;
  rendered_text: string;
  source_memory_ids: string;
  version: number;
  updated_at: string;
}

export interface ProfileVersion {
  id: string;
  version: number;
  status: 'published' | 'held';
  rendered_text: string;
  diff_text: string | null;
  reason: string;
  triggering_memory_ids: string;
  created_at: string;
}

export interface HealingLogEntry {
  id: string;
  ts: string;
  job: string;
  action: HealingAction;
  memory_ids: string;
  before_json: string | null;
  after_json: string | null;
  rationale: string;
  reversible: number;
}

export interface SleepJobRun {
  id: string;
  trigger: SleepJobTrigger;
  started_at: string;
  finished_at: string | null;
  status: SleepJobStatus;
  steps_json: string | null;
  metrics_json: string | null;
}

export interface ReviewItem {
  id: string;
  kind: ReviewItemKind;
  payload_json: string;
  memory_ids: string;
  status: ReviewItemStatus;
  resolution_json: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FeedbackEvent {
  id: string;
  ts: string;
  episode_id: string | null;
  signal_type: SignalType;
  target: FeedbackTarget;
  detail_json: string;
}

export interface AdaptationState {
  dimension: string;
  current_value: string;
  strength: number;
  status: AdaptationStatus;
  user_locked: number;
  updated_at: string;
}

export interface AdaptationVersion {
  id: string;
  dimension: string;
  value: string;
  ts: string;
  reason: string;
  feedback_event_ids: string;
  superseded_at: string | null;
}

export interface SchemaMeta {
  key: string;
  value: string;
}

export interface SchemaMigration {
  version: number;
  name: string;
  applied_at: string;
  checksum: string;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseJson<T>(s: string | null): T | null {
  if (s === null) return null;
  return JSON.parse(s) as T;
}

export function toJson(obj: unknown): string {
  return JSON.stringify(obj);
}