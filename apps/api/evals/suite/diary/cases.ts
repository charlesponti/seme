// Diary suite: a stratified sample of the five-year timeline, one entry per case.
//
// Each year gets the same number of entries, and about 40% of them carry a hard
// feature (correction, negation, hypothetical, third-party claim, pronoun follow-up).
// Every case is a single day's entry, ingested in a fresh store, so the answer key
// is per entry and no case depends on another.

import type { Case, GoldEntity } from '../dataset.js';
import { buildTimeline, mulberry32, timelineStats, type Entry, type Rng } from './timeline.js';

const USER: GoldEntity = {
  name: 'user',
  type: 'person',
  aliases: ['user', 'the user', 'i', 'me', 'speaker', 'myself'],
};

const PER_YEAR = 25;
const HARD_SHARE = 0.4;
const SAMPLE_SEED = 7;

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function sampleEntries(entries: Entry[], perYear = PER_YEAR, seed = SAMPLE_SEED): Entry[] {
  const rng = mulberry32(seed);
  const years = [...new Set(entries.map((e) => e.year))].sort();
  const picked: Entry[] = [];
  for (const year of years) {
    const inYear = entries.filter((e) => e.year === year);
    const hard = shuffle(
      rng,
      inYear.filter((e) => e.hard.length > 0),
    );
    const plain = shuffle(
      rng,
      inYear.filter((e) => e.hard.length === 0),
    );
    const hardN = Math.min(hard.length, Math.round(perYear * HARD_SHARE));
    const plainN = Math.min(plain.length, perYear - hardN);
    picked.push(...hard.slice(0, hardN), ...plain.slice(0, plainN));
  }
  return picked.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function toCase(e: Entry): Case {
  return {
    id: `diary-${e.date}`,
    category: 'diary',
    mode: 'text',
    input: e.text,
    tags: ['diary', ...e.domains.map((d) => `domain-${d}`), ...e.hard.map((h) => `hard-${h}`)],
    expect: {
      entities: [USER, ...e.gold.entities],
      relations: e.gold.relations,
      memories: e.gold.memories,
      forbidden_entities: e.gold.forbiddenEntities,
      forbidden_relations: e.gold.forbiddenRelations,
      forbidden_memories: e.gold.forbiddenMemories,
      exhaustive: true,
      relation_scope: 'gold-entities',
    },
    notes: `Diary entry ${e.date}`,
  };
}

/** The full five-year timeline, kept for stats and for longitudinal probes later. */
export const DIARY_TIMELINE: Entry[] = buildTimeline();

export const DIARY_CASES: Case[] = sampleEntries(DIARY_TIMELINE).map(toCase);

/** Every entry that touches people, across all five years. The people-and-relationships suite. */
export const PEOPLE_CASES: Case[] = DIARY_TIMELINE.filter((e) => e.domains.includes('people'))
  .sort((a, b) => (a.date < b.date ? -1 : 1))
  .map(toCase);

export const DIARY_STATS = timelineStats(DIARY_TIMELINE);
