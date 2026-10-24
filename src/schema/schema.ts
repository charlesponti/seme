// src/schema/schema.ts — All DDL from 02-data-model.md (single migration)

export const SCHEMA_SQL = `
-- turns
CREATE TABLE IF NOT EXISTS turns (
    id         TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    ts         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_episode_ts ON turns(episode_id, ts);
CREATE INDEX IF NOT EXISTS idx_turns_session_ts ON turns(session_id, ts);

-- episodes
CREATE TABLE IF NOT EXISTS episodes (
    id                    TEXT PRIMARY KEY,
    session_id            TEXT NOT NULL,
    started_at            TEXT NOT NULL,
    ended_at              TEXT,
    summary               TEXT,
    summary_version       INTEGER,
    user_affect_tags      TEXT,
    agent_behaviour_tags  TEXT,
    extractor_version     TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id, started_at);

-- slot_registry
CREATE TABLE IF NOT EXISTS slot_registry (
    slot             TEXT PRIMARY KEY,
    kind             TEXT NOT NULL CHECK (kind IN (
                        'fact', 'preference', 'routine', 'boundary',
                        'relationship', 'interest', 'trait_inference')),
    cardinality      TEXT NOT NULL CHECK (cardinality IN ('single', 'multi')),
    decay_class      TEXT NOT NULL CHECK (decay_class IN (
                        'exempt', 'slow', 'medium', 'fast', 'session')),
    profile_included INTEGER NOT NULL DEFAULT 0 CHECK (profile_included IN (0, 1))
);

-- memories
CREATE TABLE IF NOT EXISTS memories (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL CHECK (kind IN (
                            'fact', 'preference', 'routine', 'boundary',
                            'relationship', 'interest', 'trait_inference')),
    slot                TEXT REFERENCES slot_registry(slot),
    subject             TEXT NOT NULL,
    predicate           TEXT NOT NULL,
    value_text          TEXT NOT NULL,
    value_json          TEXT,
    evidence_quote      TEXT NOT NULL,
    source_turn_id      TEXT NOT NULL REFERENCES turns(id),
    source_episode_id   TEXT NOT NULL REFERENCES episodes(id),
    source_type         TEXT NOT NULL CHECK (source_type IN (
                            'user_stated', 'user_confirmed', 'agent_inferred',
                            'agent_reflection', 'user_edited')),
    modality            TEXT NOT NULL CHECK (modality IN (
                            'stated', 'hypothetical', 'negated', 'joking', 'quoted')),
    confidence          REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    importance          REAL NOT NULL CHECK (importance >= 0.0 AND importance <= 1.0),
    pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    valid_from          TEXT,
    valid_to            TEXT,
    observed_at         TEXT NOT NULL,
    recorded_at         TEXT NOT NULL,
    superseded_at       TEXT,
    superseded_by_id    TEXT REFERENCES memories(id),
    supersedes_id       TEXT REFERENCES memories(id),
    last_reinforced_at  TEXT,
    last_accessed_at    TEXT,
    reinforcement_count INTEGER NOT NULL DEFAULT 0 CHECK (reinforcement_count >= 0),
    access_count        INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    status              TEXT NOT NULL CHECK (status IN (
                            'candidate', 'active', 'superseded', 'archived',
                            'quarantined', 'deleted')),
    extractor_version   TEXT NOT NULL,
    decay_class         TEXT NOT NULL CHECK (decay_class IN (
                            'exempt', 'slow', 'medium', 'fast', 'session'))
);
CREATE INDEX IF NOT EXISTS idx_memories_status_slot   ON memories(status, slot);
CREATE INDEX IF NOT EXISTS idx_memories_status_decay  ON memories(status, decay_class, last_reinforced_at);
CREATE INDEX IF NOT EXISTS idx_memories_episode       ON memories(source_episode_id);
CREATE INDEX IF NOT EXISTS idx_memories_turn          ON memories(source_turn_id);
CREATE INDEX IF NOT EXISTS idx_memories_slot_valid    ON memories(slot, valid_to);
CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by_id);

-- memories_vec (virtual table, embedding_dim substituted at runtime)
-- Created separately with the correct dimension

-- memories_fts
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    memory_id UNINDEXED,
    value_text,
    subject,
    predicate
);

-- profile
CREATE TABLE IF NOT EXISTS profile (
    id                TEXT PRIMARY KEY CHECK (id = 'singleton'),
    rendered_text     TEXT NOT NULL,
    source_memory_ids TEXT NOT NULL,
    version           INTEGER NOT NULL CHECK (version >= 1),
    updated_at        TEXT NOT NULL
);

-- profile_versions
CREATE TABLE IF NOT EXISTS profile_versions (
    id                    TEXT PRIMARY KEY,
    version               INTEGER NOT NULL UNIQUE,
    status                TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'held')),
    rendered_text         TEXT NOT NULL,
    diff_text             TEXT,
    reason                TEXT NOT NULL,
    triggering_memory_ids TEXT NOT NULL,
    created_at            TEXT NOT NULL
);

-- procedural_rules
CREATE TABLE IF NOT EXISTS procedural_rules (
    id                TEXT PRIMARY KEY,
    rule_text         TEXT NOT NULL,
    source_memory_ids TEXT NOT NULL,
    priority          TEXT NOT NULL CHECK (priority IN ('boundary', 'preference', 'style')),
    status            TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived')),
    created_from      TEXT NOT NULL CHECK (created_from IN ('sleep_job', 'user')),
    user_approved     INTEGER NOT NULL DEFAULT 0 CHECK (user_approved IN (0, 1)),
    created_at        TEXT NOT NULL,
    superseded_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_rules_status_priority ON procedural_rules(status, priority);

-- healing_log
CREATE TABLE IF NOT EXISTS healing_log (
    id          TEXT PRIMARY KEY,
    ts          TEXT NOT NULL,
    job         TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN (
                    'merge', 'supersede', 'archive', 'quarantine', 'promote',
                    'demote', 'repair', 'delete', 'profile_recompile',
                    'add', 'noop')),
    memory_ids  TEXT NOT NULL,
    before_json TEXT,
    after_json  TEXT,
    rationale   TEXT NOT NULL,
    reversible  INTEGER NOT NULL CHECK (reversible IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_healing_log_ts ON healing_log(ts);

-- sleep_job_runs
CREATE TABLE IF NOT EXISTS sleep_job_runs (
    id           TEXT PRIMARY KEY,
    trigger      TEXT NOT NULL CHECK (trigger IN ('scheduled', 'idle', 'session_count', 'manual')),
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
    steps_json   TEXT,
    metrics_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sleep_job_runs_started ON sleep_job_runs(started_at);

-- review_items
CREATE TABLE IF NOT EXISTS review_items (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN (
                        'contradiction', 'held_profile', 'digest', 'quarantine',
                        'repair_proposal', 'adaptation_proposal')),
    payload_json    TEXT NOT NULL,
    memory_ids      TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
    resolution_json TEXT,
    created_at      TEXT NOT NULL,
    resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_items_status ON review_items(status, kind);

-- feedback_events
CREATE TABLE IF NOT EXISTS feedback_events (
    id          TEXT PRIMARY KEY,
    ts          TEXT NOT NULL,
    episode_id  TEXT REFERENCES episodes(id),
    signal_type TEXT NOT NULL CHECK (signal_type IN (
                    'explicit_rating', 'correction', 'compliment_specific',
                    're_engagement', 'disengagement', 'user_edit')),
    target      TEXT NOT NULL CHECK (target IN (
                    'avatar', 'register', 'topic', 'pacing', 'persona', 'other')),
    detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_episode ON feedback_events(episode_id, ts);
CREATE INDEX IF NOT EXISTS idx_feedback_target  ON feedback_events(target, ts);

-- adaptation_state
CREATE TABLE IF NOT EXISTS adaptation_state (
    dimension     TEXT PRIMARY KEY,
    current_value TEXT NOT NULL,
    strength      REAL NOT NULL CHECK (strength >= 0.0 AND strength <= 1.0),
    status        TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'reverted')),
    user_locked   INTEGER NOT NULL DEFAULT 0 CHECK (user_locked IN (0, 1)),
    updated_at    TEXT NOT NULL
);

-- adaptation_versions
CREATE TABLE IF NOT EXISTS adaptation_versions (
    id                TEXT PRIMARY KEY,
    dimension         TEXT NOT NULL REFERENCES adaptation_state(dimension),
    value             TEXT NOT NULL,
    ts                TEXT NOT NULL,
    reason            TEXT NOT NULL,
    feedback_event_ids TEXT NOT NULL,
    superseded_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_adaptation_versions_dim ON adaptation_versions(dimension, ts);

-- identity_core
CREATE TABLE IF NOT EXISTS identity_core (
    id            TEXT PRIMARY KEY CHECK (id = 'singleton'),
    content_json  TEXT NOT NULL,
    rendered_text TEXT NOT NULL,
    version       INTEGER NOT NULL CHECK (version >= 1),
    updated_at    TEXT NOT NULL,
    updated_by    TEXT NOT NULL CHECK (updated_by = 'user')
);
`;

// memories_vec is created separately with the correct embedding dimension
export function getVecTableSql(dim: number): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding FLOAT[${dim}])`;
}

export const SCHEMA_VERSION = 3;
export const SCHEMA_NAME = 'self-healing-memory/3';

export function getSchemaSql(embeddingDim: number): string {
  return SCHEMA_SQL + '\n' + getVecTableSql(embeddingDim);
}

/**
 * Migration v2: expand memory kinds with decision, reference, anti_pattern, observation.
 * Recreates slot_registry and memories tables with expanded CHECK constraints.
 * Must run with foreign_keys = OFF (handled by the migration runner).
 */
export function getSchemaSqlV2(): string {
  return `
-- 1. Recreate slot_registry with new kinds
ALTER TABLE slot_registry RENAME TO slot_registry_old;
CREATE TABLE slot_registry (
    slot             TEXT PRIMARY KEY,
    kind             TEXT NOT NULL CHECK (kind IN (
                        'fact', 'preference', 'routine', 'boundary',
                        'relationship', 'interest', 'trait_inference',
                        'decision', 'reference', 'anti_pattern', 'observation')),
    cardinality      TEXT NOT NULL CHECK (cardinality IN ('single', 'multi')),
    decay_class      TEXT NOT NULL CHECK (decay_class IN (
                        'exempt', 'slow', 'medium', 'fast', 'session')),
    profile_included INTEGER NOT NULL DEFAULT 0 CHECK (profile_included IN (0, 1))
);
INSERT INTO slot_registry SELECT * FROM slot_registry_old;
DROP TABLE slot_registry_old;

-- 2. Recreate memories with new kinds
ALTER TABLE memories RENAME TO memories_old;
CREATE TABLE memories (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL CHECK (kind IN (
                            'fact', 'preference', 'routine', 'boundary',
                            'relationship', 'interest', 'trait_inference',
                            'decision', 'reference', 'anti_pattern', 'observation')),
    slot                TEXT REFERENCES slot_registry(slot),
    subject             TEXT NOT NULL,
    predicate           TEXT NOT NULL,
    value_text          TEXT NOT NULL,
    value_json          TEXT,
    evidence_quote      TEXT NOT NULL,
    source_turn_id      TEXT NOT NULL REFERENCES turns(id),
    source_episode_id   TEXT NOT NULL REFERENCES episodes(id),
    source_type         TEXT NOT NULL CHECK (source_type IN (
                            'user_stated', 'user_confirmed', 'agent_inferred',
                            'agent_reflection', 'user_edited')),
    modality            TEXT NOT NULL CHECK (modality IN (
                            'stated', 'hypothetical', 'negated', 'joking', 'quoted')),
    confidence          REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    importance          REAL NOT NULL CHECK (importance >= 0.0 AND importance <= 1.0),
    pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    valid_from          TEXT,
    valid_to            TEXT,
    observed_at         TEXT NOT NULL,
    recorded_at         TEXT NOT NULL,
    superseded_at       TEXT,
    superseded_by_id    TEXT REFERENCES memories(id),
    supersedes_id       TEXT REFERENCES memories(id),
    last_reinforced_at  TEXT,
    last_accessed_at    TEXT,
    reinforcement_count INTEGER NOT NULL DEFAULT 0 CHECK (reinforcement_count >= 0),
    access_count        INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    status              TEXT NOT NULL CHECK (status IN (
                            'candidate', 'active', 'superseded', 'archived',
                            'quarantined', 'deleted')),
    extractor_version   TEXT NOT NULL,
    decay_class         TEXT NOT NULL CHECK (decay_class IN (
                            'exempt', 'slow', 'medium', 'fast', 'session'))
);
INSERT INTO memories SELECT * FROM memories_old;
DROP TABLE memories_old;

-- 3. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_memories_status_slot   ON memories(status, slot);
CREATE INDEX IF NOT EXISTS idx_memories_status_decay  ON memories(status, decay_class, last_reinforced_at);
CREATE INDEX IF NOT EXISTS idx_memories_episode       ON memories(source_episode_id);
CREATE INDEX IF NOT EXISTS idx_memories_turn          ON memories(source_turn_id);
CREATE INDEX IF NOT EXISTS idx_memories_slot_valid    ON memories(slot, valid_to);
CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by_id);
`;
}

/**
 * Migration v3: Knowledge Graph tables (entities, relationships, links).
 * Creates 4 new tables with type CHECK constraints and indexes.
 * Does not modify existing tables.
 */
export function getSchemaSqlV3(): string {
  return `
-- entities
CREATE TABLE IF NOT EXISTS entities (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN (
                        'person', 'place', 'organization', 'project',
                        'tool', 'concept', 'topic', 'preference', 'other')),
    aliases         TEXT,
    description     TEXT,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    mention_count   INTEGER NOT NULL DEFAULT 1,
    confidence      REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    source_type     TEXT NOT NULL CHECK (source_type IN (
                        'user_stated', 'user_confirmed', 'agent_inferred',
                        'agent_reflection', 'user_edited')),
    profile_included INTEGER NOT NULL DEFAULT 0 CHECK (profile_included IN (0, 1)),
    pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

-- relationships
CREATE TABLE IF NOT EXISTS relationships (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES entities(id),
    target_id       TEXT NOT NULL REFERENCES entities(id),
    relation_type   TEXT NOT NULL,
    description     TEXT,
    weight          REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    mention_count   INTEGER NOT NULL DEFAULT 1,
    confidence      REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    source_type     TEXT NOT NULL CHECK (source_type IN (
                        'user_stated', 'user_confirmed', 'agent_inferred',
                        'agent_reflection', 'user_edited')),
    source_turn_id  TEXT NOT NULL REFERENCES turns(id),
    source_episode_id TEXT NOT NULL REFERENCES episodes(id),
    valid_from      TEXT,
    valid_to        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(relation_type);

-- entity_memory_links
CREATE TABLE IF NOT EXISTS entity_memory_links (
    entity_id   TEXT NOT NULL REFERENCES entities(id),
    memory_id   TEXT NOT NULL REFERENCES memories(id),
    role        TEXT NOT NULL CHECK (role IN ('subject', 'object', 'context', 'mentioned')),
    created_at  TEXT NOT NULL,
    PRIMARY KEY (entity_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_e_m_links_entity ON entity_memory_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_e_m_links_memory ON entity_memory_links(memory_id);

-- entity_turn_links
CREATE TABLE IF NOT EXISTS entity_turn_links (
    entity_id    TEXT NOT NULL REFERENCES entities(id),
    turn_id      TEXT NOT NULL REFERENCES turns(id),
    mention_text TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('subject', 'object')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (entity_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_e_t_links_entity ON entity_turn_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_e_t_links_turn ON entity_turn_links(turn_id);
`;
}
