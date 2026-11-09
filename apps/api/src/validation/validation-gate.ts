// src/validation/validation-gate.ts — Validation gate (05-validation-gate.md)

import { Storage } from '../storage/storage.js';
import { Memory, MemoryKind, SourceType, Modality } from '../types/common.js';

/** Capitalised words that aren't names: sentence starters and pronouns. */
const FUNCTION_WORDS = new Set([
  'the',
  'this',
  'that',
  'they',
  'their',
  'there',
  'then',
  'these',
  'those',
  'what',
  'when',
  'where',
  'which',
  'with',
  'from',
  'for',
  'and',
  'but',
  'not',
  'yes',
  'you',
  'she',
  'his',
  'her',
  'its',
  'our',
  'user',
  'they',
  'also',
  'after',
  'before',
  'about',
  'into',
  'over',
  'under',
  'once',
  'some',
  'many',
  'such',
]);

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

  /**
   * Capitalised terms in the memory text that occur in the episode's assistant
   * turns but in none of its user turns. Sentence-initial function words are
   * ignored so "The user…" doesn't count as a term.
   */
  private assistantOnlyTerms(candidate: Candidate): string[] {
    const turns = this.storage.read(
      (db) =>
        db
          .prepare('SELECT role, content FROM turns WHERE episode_id = ?')
          .all(candidate.source_episode_id) as { role: string; content: string }[],
    );
    if (turns.length === 0) return [];
    const userText = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join('\n')
      .toLowerCase();
    const assistantText = turns
      .filter((t) => t.role === 'assistant')
      .map((t) => t.content)
      .join('\n')
      .toLowerCase();
    if (!assistantText) return [];

    const terms = (candidate.value_text.match(/\b[A-Z][A-Za-z0-9+#.-]{2,}\b/g) ?? []).filter(
      (t) => !FUNCTION_WORDS.has(t.toLowerCase()),
    );
    const found = new Set<string>();
    for (const term of terms) {
      const needle = term.toLowerCase();
      if (userText.includes(needle)) continue;
      if (assistantText.includes(needle)) found.add(term);
    }
    return [...found];
  }

  validate(candidate: Candidate): GateResult {
    const errors: string[] = [];

    // Rule 1: Provenance mandatory
    if (!candidate.source_turn_id) errors.push('Missing source_turn_id');
    if (!candidate.source_episode_id) errors.push('Missing source_episode_id');
    if (!candidate.evidence_quote || candidate.evidence_quote.trim() === '')
      errors.push('Missing evidence_quote');

    // A memory with no text, subject or predicate says nothing. Reject it outright.
    if (!candidate.value_text || candidate.value_text.trim() === '')
      errors.push('Empty value_text');
    if (!candidate.subject || candidate.subject.trim() === '') errors.push('Missing subject');
    if (!candidate.predicate || candidate.predicate.trim() === '') errors.push('Missing predicate');

    // Terms that only the assistant used are not the user's: a memory can't name
    // them, however it words the claim. Generic: no list of topics or products.
    const assistantOnly = this.assistantOnlyTerms(candidate);
    if (assistantOnly.length > 0)
      errors.push(`Names assistant-only term: ${assistantOnly.join(', ')}`);

    // Rule 2: Provenance coherence - source_turn must belong to source_episode
    if (candidate.source_turn_id && candidate.source_episode_id) {
      const turn = this.storage.read((db) => {
        return db
          .prepare('SELECT episode_id, role, content FROM turns WHERE id = ?')
          .get(candidate.source_turn_id) as
          | { episode_id: string; role: string; content: string }
          | undefined;
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
        // Rule 4b: Document claims ground only on document-mode episodes
        if (candidate.source_type === 'document_stated') {
          const episode = this.storage.read((db) => {
            return db
              .prepare('SELECT extraction_mode FROM episodes WHERE id = ?')
              .get(candidate.source_episode_id) as { extraction_mode: string } | undefined;
          });
          if (!episode || episode.extraction_mode !== 'document') {
            errors.push('Document-stated source requires a document episode');
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
    const validKinds = [
      'fact',
      'preference',
      'routine',
      'boundary',
      'relationship',
      'interest',
      'trait_inference',
      'decision',
      'reference',
      'anti_pattern',
      'observation',
    ];
    if (!validKinds.includes(candidate.kind)) errors.push('Invalid kind');

    const validSourceTypes = [
      'user_stated',
      'user_confirmed',
      'agent_inferred',
      'agent_reflection',
      'user_edited',
      'document_stated',
    ];
    if (!validSourceTypes.includes(candidate.source_type)) errors.push('Invalid source_type');

    // Document memories describe the document's entities, never the reader, and
    // never occupy a user-profile slot.
    if (candidate.source_type === 'document_stated') {
      const subject = (candidate.subject || '').trim().toLowerCase();
      if (['user', 'the user', 'i', 'me', 'my', 'we', 'us'].includes(subject)) {
        errors.push('Document memory subject must be a document entity, not the user');
      }
      if (candidate.slot) {
        errors.push('Document memory must not use a user slot');
      }
    }

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
    if (
      candidate.modality === 'hypothetical' ||
      candidate.modality === 'joking' ||
      candidate.modality === 'quoted'
    ) {
      // These should not be promoted to active
      // The gate allows them as candidates but marks them appropriately
    }

    // Boundary requires user statement
    if (candidate.kind === 'boundary') {
      if (!['user_stated', 'user_confirmed', 'user_edited'].includes(candidate.source_type)) {
        errors.push('Boundary requires user statement');
      }
    }

    // Anti-pattern requires user statement
    if (candidate.kind === 'anti_pattern') {
      if (!['user_stated', 'user_confirmed', 'user_edited'].includes(candidate.source_type)) {
        errors.push('Anti-pattern requires user statement');
      }
    }

    // Observation requires agent inference
    if (candidate.kind === 'observation') {
      if (!['agent_inferred', 'agent_reflection'].includes(candidate.source_type)) {
        errors.push('Observation requires agent inference');
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
