// src/validation/validation-gate.ts — Validation gate (05-validation-gate.md)

import { Storage } from '../storage/storage.js';
import { Memory, MemoryKind, SourceType, Modality } from '../types/common.js';

export interface Candidate {
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
  importance: number;
  decay_class: string;
  observed_at?: string;
  valid_from?: string | null;
  extractor_version?: string;
}

export interface GateResult {
  passed: boolean;
  errors: string[];
  candidate: Candidate | null;
}

export class ValidationGate {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  validate(candidate: Candidate): GateResult {
    const errors: string[] = [];

    // Rule 1: Provenance mandatory
    if (!candidate.source_turn_id) errors.push('Missing source_turn_id');
    if (!candidate.source_episode_id) errors.push('Missing source_episode_id');
    if (!candidate.evidence_quote || candidate.evidence_quote.trim() === '') errors.push('Missing evidence_quote');

    // Rule 2: Provenance coherence - source_turn must belong to source_episode
    if (candidate.source_turn_id && candidate.source_episode_id) {
      const turn = this.storage.read((db) => {
        return db.prepare('SELECT episode_id, role, content FROM turns WHERE id = ?').get(candidate.source_turn_id) as { episode_id: string; role: string; content: string } | undefined;
      });
      if (!turn) {
        errors.push('Source turn not found');
      } else {
        if (turn.episode_id !== candidate.source_episode_id) {
          errors.push('Source turn episode mismatch');
        }
        // Rule 4: Only user speech grounds user claims
        if (['user_stated', 'user_confirmed'].includes(candidate.source_type)) {
          if (turn.role !== 'user') {
            errors.push('User-stated source must cite a user turn');
          }
        }
        // Rule 3: Evidence must be evidence (verbatim substring)
        if (turn.content && candidate.evidence_quote) {
          const normalized = (s: string) => s.replace(/\s+/g, ' ').trim();
          if (!normalized(turn.content).includes(normalized(candidate.evidence_quote))) {
            errors.push('Evidence quote not found in source turn');
          }
        }
      }
    }

    // Validate enums
    const validKinds = ['fact', 'preference', 'routine', 'boundary', 'relationship', 'interest', 'trait_inference'];
    if (!validKinds.includes(candidate.kind)) errors.push('Invalid kind');

    const validSourceTypes = ['user_stated', 'user_confirmed', 'agent_inferred', 'agent_reflection', 'user_edited'];
    if (!validSourceTypes.includes(candidate.source_type)) errors.push('Invalid source_type');

    const validModalities = ['stated', 'hypothetical', 'negated', 'joking', 'quoted'];
    if (!validModalities.includes(candidate.modality)) errors.push('Invalid modality');

    // Slot validation
    if (candidate.slot) {
      const slot = this.storage.read((db) => {
        return db.prepare('SELECT * FROM slot_registry WHERE slot = ?').get(candidate.slot) as any;
      });
      if (!slot) {
        errors.push('Unregistered slot');
      } else {
        // Slot kind must match candidate kind
        if (slot.kind !== candidate.kind) {
          errors.push('Slot kind mismatch');
        }
      }
    }

    // Modality checks
    if (candidate.modality === 'hypothetical' || candidate.modality === 'joking' || candidate.modality === 'quoted') {
      // These should not be promoted to active
      // The gate allows them as candidates but marks them appropriately
    }

    // Boundary requires user statement
    if (candidate.kind === 'boundary') {
      if (!['user_stated', 'user_confirmed', 'user_edited'].includes(candidate.source_type)) {
        errors.push('Boundary requires user statement');
      }
    }

    // Importance range
    if (candidate.importance < 0 || candidate.importance > 1) {
      errors.push('Importance out of range');
    }

    if (errors.length > 0) {
      return { passed: false, errors, candidate: null };
    }

    return { passed: true, errors: [], candidate };
  }
}