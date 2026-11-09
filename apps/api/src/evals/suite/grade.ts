// Deterministic graders for the extraction suite. No model calls here: every
// check is a pure function of the expected labels and what the engine stored.

import type { Case, GoldMemory, GoldEntity, GoldRelation, Alt, Modality } from './dataset.js';

// ── What the engine produced for one case run ─────────────────────────────

export interface PredEntity {
  name: string;
  type: string;
  evidence_quote: string | null;
  turn_id: string | null;
}

export interface PredRelation {
  source: string;
  target: string;
  relation_type: string;
  evidence_quote: string | null;
  turn_id: string | null;
}

export interface PredMemory {
  predicate: string;
  subject: string;
  kind: string;
  modality: string;
  value_text: string;
  evidence_quote: string;
  turn_id: string;
  episode_id: string;
}

export interface SourceTurn {
  id: string;
  role: string;
  content: string;
}

export interface PredOutput {
  entities: PredEntity[];
  relations: PredRelation[];
  memories: PredMemory[];
  feedback_events: number;
  turns: SourceTurn[];
  episode_id: string;
}

// ── Normalisation and matching ────────────────────────────────────────────

const DETERMINERS = /^(the|a|an|my|our|your|his|her|their)\s+/;

/** Lowercase, drop possessives and leading determiners, strip punctuation. */
export function normName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(DETERMINERS, '');
}

/** Lowercased, whitespace-collapsed text for verbatim checks. */
export function squash(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Does a single alternative appear in the text? */
function altHit(text: string, alt: Alt): boolean {
  const options = Array.isArray(alt) ? alt : [alt];
  return options.some((o) => text.includes(o.toLowerCase()));
}

/** Maps any surface form of a gold entity to its canonical key. */
export class EntityIndex {
  private keyOf = new Map<string, string>();

  constructor(gold: GoldEntity[] = []) {
    for (const g of gold) {
      const key = normName(g.name);
      for (const alias of [g.name, ...(g.aliases ?? [])]) this.keyOf.set(normName(alias), key);
    }
  }

  /** Canonical key for a predicted name: the gold entity it matches, or its own normalised form. */
  resolve(name: string): string {
    const n = normName(name);
    return this.keyOf.get(n) ?? n;
  }

  goldKeys(gold: GoldEntity[]): string[] {
    return gold.map((g) => normName(g.name));
  }
}

// ── Per-case grading ──────────────────────────────────────────────────────

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CaseGrade {
  id: string;
  category: string;
  tags: string[];
  pass: boolean;
  checks: Check[];
  counts: {
    entity_gold: number;
    entity_pred: number;
    entity_tp: number;
    entity_type_checked: number;
    entity_type_ok: number;
    relation_gold: number;
    relation_pred: number;
    relation_tp: number;
    memory_gold: number;
    memory_hit: number;
    memory_pred: number;
    memory_precise: number;
    memory_precision_scored: boolean;
    precision_scored: boolean;
    entity_unexpected: number;
    relation_unexpected: number;
    forbidden_hits: number;
    provenance_checked: number;
    provenance_bad: number;
  };
  /** Ids (index into pred) of memories that matched no gold claim, for the judge and the report. */
  unmatched_memory_idx: number[];
  /** Gold memory claims that no prediction matched, for the judge. */
  missed_claims: string[];
}

export function memoryText(m: PredMemory): string {
  return `${m.value_text} ${m.predicate.replace(/_/g, ' ')}`.toLowerCase();
}

/** Does a predicted memory satisfy a gold memory's tokens and filters? */
export function memoryMatches(m: PredMemory, g: GoldMemory): boolean {
  const text = memoryText(m);
  if (!g.must.every((alt) => altHit(text, alt))) return false;
  if (g.kinds && !g.kinds.includes(m.kind)) return false;
  if (g.modality && !g.modality.includes(m.modality as Modality)) return false;
  return true;
}

// A memory that says the thing did NOT happen is not a violation of "the user went to X".
const NEGATED =
  /\b(not|never|no longer|didn't|did not|don't|doesn't|wasn't|won't|decided against|cancel+ed|instead of)\b|n't\b/;

/**
 * Forbidden-memory match. Checks the value text only (the predicate is a label, not a claim,
 * so "planned_trip" must not trip a "went to" pattern), and ignores negated memories.
 */
export function forbiddenMatches(m: PredMemory, g: GoldMemory): boolean {
  if (NEGATED.test(m.value_text.toLowerCase())) return false;
  const text = m.value_text.toLowerCase();
  if (!g.must.every((alt) => altHit(text, alt))) return false;
  if (g.kinds && !g.kinds.includes(m.kind)) return false;
  if (g.modality && !g.modality.includes(m.modality as Modality)) return false;
  return true;
}

function provenanceOk(evidence: string | null, turn: SourceTurn | undefined): boolean {
  if (!evidence || !turn) return false;
  return squash(turn.content).includes(squash(evidence));
}

/** Does a predicted (resolved) endpoint pair satisfy a gold relation, primary or alternative, either way if symmetric? */
export function goldRelationMatches(
  ps: string,
  pt: string,
  g: GoldRelation,
  index: EntityIndex,
): boolean {
  return [g, ...(g.alternatives ?? [])].some((a) => {
    const s = index.resolve(normName(a.subject));
    const t = index.resolve(normName(a.object));
    return (ps === s && pt === t) || (a.symmetric === true && ps === t && pt === s);
  });
}

export function gradeCase(c: Case, pred: PredOutput): CaseGrade {
  const checks: Check[] = [];
  const e = c.expect;
  const turnById = new Map(pred.turns.map((t) => [t.id, t]));
  const index = new EntityIndex(e.entities ?? []);

  // Provenance: every evidence quote is verbatim in the turn it cites.
  let provChecked = 0;
  let provBad = 0;
  const badProv: string[] = [];
  for (const m of pred.memories) {
    provChecked++;
    if (!provenanceOk(m.evidence_quote, turnById.get(m.turn_id))) {
      provBad++;
      badProv.push(`memory "${m.value_text.slice(0, 60)}"`);
    }
  }
  for (const en of pred.entities) {
    if (!en.evidence_quote) continue; // entities without a quote are counted by the entity checks
    provChecked++;
    if (!provenanceOk(en.evidence_quote, turnById.get(en.turn_id ?? ''))) {
      provBad++;
      badProv.push(`entity "${en.name}"`);
    }
  }
  for (const r of pred.relations) {
    provChecked++;
    if (!provenanceOk(r.evidence_quote, turnById.get(r.turn_id ?? ''))) {
      provBad++;
      badProv.push(`relation ${r.source} → ${r.target}`);
    }
  }
  checks.push({
    name: 'provenance',
    pass: provBad === 0,
    detail:
      provBad === 0 ? `${provChecked} quotes verbatim` : `not verbatim: ${badProv.join(', ')}`,
  });

  // Entities: one-to-one greedy match against gold.
  const goldEntities = e.entities ?? [];
  const usedEntity = new Set<number>();
  let entityTp = 0;
  let typeChecked = 0;
  let typeOk = 0;
  const predEntityKeys = pred.entities.map((p) => index.resolve(p.name));
  goldEntities.forEach((g) => {
    const key = normName(g.name);
    const hit = predEntityKeys.findIndex((k, i) => !usedEntity.has(i) && k === key);
    if (hit >= 0) {
      usedEntity.add(hit);
      entityTp++;
      if (g.type) {
        typeChecked++;
        if (pred.entities[hit].type.toLowerCase() === g.type.toLowerCase()) typeOk++;
      }
    }
  });
  const missingEntities = goldEntities.filter(
    (g) => !predEntityKeys.some((k) => k === normName(g.name)),
  );
  if (e.entities) {
    checks.push({
      name: 'entities',
      pass: missingEntities.length === 0,
      detail:
        missingEntities.length === 0
          ? `${entityTp}/${goldEntities.length} gold entities found`
          : `missing: ${missingEntities.map((g) => g.name).join(', ')}`,
    });
  }
  // Entity precision, for exhaustive cases: every predicted entity must be a gold entity.
  const goldKeys = new Set(goldEntities.map((g) => normName(g.name)));
  const unexpectedEntities = pred.entities.filter((p) => !goldKeys.has(index.resolve(p.name)));
  if (e.exhaustive) {
    checks.push({
      name: 'entity_precision',
      pass: unexpectedEntities.length === 0,
      detail:
        unexpectedEntities.length === 0
          ? `${pred.entities.length}/${pred.entities.length} predicted entities are gold`
          : `unexpected: ${unexpectedEntities.map((p) => p.name).join(', ')}`,
    });
  }

  if (e.forbidden_entities) {
    const bad = e.forbidden_entities.filter((f) => predEntityKeys.includes(normName(f)));
    checks.push({
      name: 'forbidden_entities',
      pass: bad.length === 0,
      detail: bad.length === 0 ? 'none present' : `present: ${bad.join(', ')}`,
    });
  }
  if (e.max_entities !== undefined) {
    checks.push({
      name: 'max_entities',
      pass: pred.entities.length <= e.max_entities,
      detail: `${pred.entities.length} (max ${e.max_entities})`,
    });
  }

  // Relations: endpoints must match a gold pair, direction-aware unless symmetric.
  const goldRelations = e.relations ?? [];
  const predRelKeys = pred.relations.map(
    (r) => [index.resolve(r.source), index.resolve(r.target)] as const,
  );
  // A gold relation is satisfied by its primary pair or any alternative; symmetric flips the direction.
  const satisfies = (ps: string, pt: string, g: GoldRelation) =>
    goldRelationMatches(ps, pt, g, index);
  const requiredRel = goldRelations.filter((g) => !g.optional);
  const missingRel = requiredRel.filter(
    (g) => !predRelKeys.some(([ps, pt]) => satisfies(ps, pt, g)),
  );
  if (e.relations) {
    checks.push({
      name: 'relations',
      pass: missingRel.length === 0,
      detail:
        missingRel.length === 0
          ? `${requiredRel.length}/${requiredRel.length} gold relations found`
          : `missing: ${missingRel.map((g) => `${g.subject} → ${g.object}`).join(', ')}`,
    });
  }
  if (e.forbidden_relations) {
    const bad = e.forbidden_relations.filter((f) =>
      predRelKeys.some(
        ([ps, pt]) =>
          ps === index.resolve(normName(f.subject)) && pt === index.resolve(normName(f.object)),
      ),
    );
    checks.push({
      name: 'forbidden_relations',
      pass: bad.length === 0,
      detail:
        bad.length === 0
          ? 'none present'
          : `present: ${bad.map((f) => `${f.subject} → ${f.object}`).join(', ')}`,
    });
  }

  // Relation precision, for exhaustive cases: every predicted relation must be a gold relation.
  // Optional (implied) and alternative pairs count as gold, so a valid edge is never penalised.
  const isGoldPair = (ps: string, pt: string) => goldRelations.some((g) => satisfies(ps, pt, g));
  // 'gold-entities' scope: an edge to an incidental object (a laptop, a rent payment) is not a
  // gold-relation miss, so only edges between two known endpoints count against precision.
  const knownKeys = new Set((e.entities ?? []).map((en) => index.resolve(en.name)));
  const inScope = ([ps, pt]: readonly [string, string]) =>
    e.relation_scope !== 'gold-entities' || (knownKeys.has(ps) && knownKeys.has(pt));
  const unexpectedRelations = predRelKeys.filter((p) => inScope(p) && !isGoldPair(p[0], p[1]));
  if (e.exhaustive) {
    checks.push({
      name: 'relation_precision',
      pass: unexpectedRelations.length === 0,
      detail:
        unexpectedRelations.length === 0
          ? `${pred.relations.length}/${pred.relations.length} predicted relations are gold`
          : `unexpected: ${unexpectedRelations.map(([ps, pt]) => `${ps} → ${pt}`).join(', ')}`,
    });
  }

  // Memories: every gold claim must be matched by some prediction.
  const goldMemories = e.memories ?? [];
  const missedClaims: string[] = [];
  let memoryHit = 0;
  for (const g of goldMemories) {
    if (pred.memories.some((m) => memoryMatches(m, g))) memoryHit++;
    else missedClaims.push(g.claim ?? g.must.map((a) => (Array.isArray(a) ? a[0] : a)).join(' '));
  }
  if (e.memories) {
    checks.push({
      name: 'memories',
      pass: missedClaims.length === 0,
      detail:
        missedClaims.length === 0
          ? `${memoryHit}/${goldMemories.length} gold claims recalled`
          : `missed: ${missedClaims.join('; ')}`,
    });
  }

  // Forbidden memories: none may match a forbidden pattern.
  let forbiddenHits = 0;
  const forbiddenDetail: string[] = [];
  for (const f of e.forbidden_memories ?? []) {
    const hits = pred.memories.filter((m) => forbiddenMatches(m, f));
    if (hits.length > 0) {
      forbiddenHits += hits.length;
      forbiddenDetail.push(hits.map((h) => `"${h.value_text.slice(0, 70)}"`).join(', '));
    }
  }
  if (e.forbidden_memories) {
    checks.push({
      name: 'forbidden_memories',
      pass: forbiddenHits === 0,
      detail: forbiddenHits === 0 ? 'none present' : `present: ${forbiddenDetail.join('; ')}`,
    });
  }

  // Memory precision, for exhaustive cases: every predicted memory must match a gold claim.
  const unmatched: number[] = [];
  let memoryPrecise = 0;
  pred.memories.forEach((m, i) => {
    if (goldMemories.some((g) => memoryMatches(m, g))) memoryPrecise++;
    else unmatched.push(i);
  });
  if (e.exhaustive) {
    checks.push({
      name: 'memory_precision',
      pass: unmatched.length === 0,
      detail:
        unmatched.length === 0
          ? `${pred.memories.length}/${pred.memories.length} predicted memories supported by gold`
          : `unexpected: ${unmatched.map((i) => `"${pred.memories[i].value_text.slice(0, 70)}"`).join('; ')}`,
    });
  }

  if (e.max_memories !== undefined) {
    checks.push({
      name: 'max_memories',
      pass: pred.memories.length <= e.max_memories,
      detail: `${pred.memories.length} (max ${e.max_memories})`,
    });
  }

  if (e.feedback) {
    const ok = e.feedback === 'some' ? pred.feedback_events >= 1 : pred.feedback_events === 0;
    checks.push({
      name: 'feedback',
      pass: ok,
      detail: `${pred.feedback_events} feedback event(s), expected ${e.feedback}`,
    });
  }

  checks.push({
    name: 'run',
    pass: true,
    detail: pred.episode_id ? 'episode extracted' : 'no episode',
  });

  const pass = checks.every((ch) => ch.pass);
  return {
    id: c.id,
    category: c.category,
    tags: c.tags,
    pass,
    checks,
    counts: {
      entity_gold: goldEntities.length,
      entity_pred: pred.entities.length,
      entity_tp: entityTp,
      entity_type_checked: typeChecked,
      entity_type_ok: typeOk,
      relation_gold: goldRelations.length,
      relation_pred: pred.relations.length,
      relation_tp: requiredRel.length - missingRel.length,
      memory_gold: goldMemories.length,
      memory_hit: memoryHit,
      memory_pred: pred.memories.length,
      memory_precise: memoryPrecise,
      memory_precision_scored: e.exhaustive === true,
      precision_scored: e.exhaustive === true,
      entity_unexpected: unexpectedEntities.length,
      relation_unexpected: unexpectedRelations.length,
      forbidden_hits: forbiddenHits,
      provenance_checked: provChecked,
      provenance_bad: provBad,
    },
    unmatched_memory_idx: unmatched,
    missed_claims: missedClaims,
  };
}
