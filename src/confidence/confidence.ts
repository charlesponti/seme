// src/confidence/confidence.ts — Confidence, decay, and promotion (10-confidence-decay.md)

import { Memory, MemoryStatus, SourceType, DecayClass } from '../types/common.js';

// Source-strength table (initial confidence by source_type)
export const SOURCE_STRENGTH: Record<SourceType, number> = {
  user_stated: 0.90,
  user_edited: 0.90,
  user_confirmed: 0.75,
  agent_inferred: 0.40,
  agent_reflection: 0.25,
};

// Half-lives in days by decay class
export const HALF_LIVES: Record<DecayClass, number | null> = {
  exempt: null,   // no decay
  slow: 180,
  medium: 30,
  fast: 7,
  session: 1,
};

// Decay class defaults by kind
export const KIND_DECAY_DEFAULTS: Record<string, DecayClass> = {
  boundary: 'exempt',
  fact: 'slow',
  relationship: 'slow',
  routine: 'medium',
  interest: 'medium',
  preference: 'medium',
  trait_inference: 'fast',
};

export function getDecayClass(memory: { kind: string; slot: string | null; pinned: number }, slotDecayClass?: DecayClass | null): DecayClass {
  // Assignment precedence: pinned → slot_registry.decay_class → default by kind
  if (memory.pinned === 1) return 'exempt';
  if (slotDecayClass) return slotDecayClass;
  return KIND_DECAY_DEFAULTS[memory.kind] || 'medium';
}

export function isExempt(memory: { decay_class: DecayClass; kind: string; pinned: number; slot: string | null }, slotDecayClass?: DecayClass | null): boolean {
  if (memory.decay_class === 'exempt') return true;
  if (memory.kind === 'boundary') return true;
  if (slotDecayClass === 'exempt') return true;
  if (memory.pinned === 1) return true;
  return false;
}

export function decayFactor(memory: { decay_class: DecayClass; kind: string; pinned: number; slot: string | null }, anchorTime: string, now: string, slotDecayClass?: DecayClass | null): number {
  if (isExempt(memory, slotDecayClass)) return 1.0;

  const halfLife = HALF_LIVES[memory.decay_class];
  if (halfLife === null) return 1.0;

  const anchor = new Date(anchorTime).getTime();
  const currentTime = new Date(now).getTime();
  const elapsedMs = Math.max(0, currentTime - anchor);
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  return Math.pow(0.5, elapsedDays / halfLife);
}

export function effectiveConfidence(memory: { confidence: number; decay_class: DecayClass; kind: string; pinned: number; slot: string | null; last_reinforced_at: string | null; recorded_at: string }, now: string, slotDecayClass?: DecayClass | null): number {
  const anchor = memory.last_reinforced_at || memory.recorded_at;
  const factor = decayFactor(memory, anchor, now, slotDecayClass);
  return memory.confidence * factor;
}

export function reinforceConfidence(currentEffective: number, k: number): number {
  // confidence = min(0.99, e + (1 - e) * k)
  return Math.min(0.99, currentEffective + (1 - currentEffective) * k);
}

export function contradictionPenalty(currentEffective: number, p: number): number {
  // confidence = max(0.05, effective - p)
  return Math.max(0.05, currentEffective - p);
}

export function getContradictionPenalty(memorySourceType: SourceType, contradictingSourceType: SourceType): number {
  const strengthOrder: Record<SourceType, number> = {
    user_stated: 5,
    user_edited: 5,
    user_confirmed: 4,
    agent_inferred: 3,
    agent_reflection: 2,
  };

  const memStrength = strengthOrder[memorySourceType] || 0;
  const conStrength = strengthOrder[contradictingSourceType] || 0;

  if (conStrength > memStrength) return 0.30;
  if (conStrength === memStrength) return 0.20;
  return 0.10;
}

export function isPromotableToActive(memory: {
  source_type: SourceType;
  status: string;
}, corroborationEpisodes: number, sessionBoundaryPassed: boolean, effectiveConf: number): boolean {
  if (memory.source_type === 'user_stated' || memory.source_type === 'user_edited') return true;
  if (memory.source_type === 'user_confirmed') return true;
  if (memory.source_type === 'agent_inferred' || memory.source_type === 'agent_reflection') {
    if (corroborationEpisodes < 2) return false;
    if (!sessionBoundaryPassed) return false;
    if (effectiveConf < 0.50) return false;
    // agent_reflection needs at least one non-reflection corroboration
    return true; // caller must verify the corroboration source
  }
  return false;
}

export function isCoreEligible(memory: {
  confidence: number;
  reinforcement_count: number;
  source_type: SourceType;
}): boolean {
  if (memory.confidence < 0.85) return false;
  if (memory.reinforcement_count < 3) return false;
  if (memory.source_type === 'agent_reflection') return false; // unless user-confirmed (caller checks)
  return true;
}

export function shouldArchive(memory: {
  effective_confidence: number;
  decay_class: DecayClass;
  kind: string;
  pinned: number;
  slot: string | null;
}, slotDecayClass?: DecayClass | null, daysSinceRecorded?: number): boolean {
  if (isExempt({ decay_class: memory.decay_class, kind: memory.kind, pinned: memory.pinned, slot: memory.slot }, slotDecayClass)) return false;

  // Candidate with no corroboration for 90 days
  if (daysSinceRecorded !== undefined && daysSinceRecorded >= 90) return true;

  // Effective confidence below 0.15
  if (memory.effective_confidence < 0.15) return true;

  return false;
}

export function initialConfidence(sourceType: SourceType): number {
  return SOURCE_STRENGTH[sourceType];
}

export function kForSource(sourceType: SourceType): number {
  if (sourceType === 'user_stated' || sourceType === 'user_edited' || sourceType === 'user_confirmed') return 0.25;
  if (sourceType === 'agent_inferred') return 0.15;
  return 0; // agent_reflection produces no reinforcement
}