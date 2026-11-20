// src/identity/learn-self-name.ts — learn the user's name from an explicit introduction.
//
// "My name is Charles" / "call me Charles" in a user turn means Charles is the speaker.
// A looser "I'm Charles" also needs a person candidate called Charles in the same chunk. We save that as a self alias
// (or the name itself when it's still the placeholder) so the resolver folds the person
// into the self entity. A bare mention ("my coworker Charles") never matches the patterns.
// Wrong merges are expensive, so every guard errs toward learning nothing.

import { Storage } from '../storage/storage.js';
import { nowUtc } from '../types/common.js';
import { identityNames, syncSelfEntity } from './self-entity.js';

const NAME = String.raw`([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*)?)`;
// Not followed by 's: "I'm Charles's brother" is about someone else.
const TAIL = String.raw`(?!['’]s\b)`;
// Explicit: unambiguous about being a name, so no person candidate is needed.
const EXPLICIT_PATTERNS = [
  new RegExp(String.raw`\b[Mm]y name(?:'s|’s| is)\s+${NAME}${TAIL}`, 'gu'),
  new RegExp(String.raw`\b[Cc]all me\s+${NAME}${TAIL}`, 'gu'),
];
// Loose: "I'm Tired" isn't a name, so these only count when a person candidate agrees.
const LOOSE_PATTERNS = [
  new RegExp(String.raw`\b(?:I'm|I’m|I am)(?: called| named)?\s+${NAME}${TAIL}`, 'gu'),
];
const INTRO_PATTERNS = [...EXPLICIT_PATTERNS, ...LOOSE_PATTERNS];

interface CandidateLike {
  name: string;
  type: string;
  aliases?: string[];
}

interface TurnLike {
  role: string;
  content: string;
}

// Every name a first-person intro in this text claims, in order of appearance.
export function findSelfIntros(text: string, patterns = INTRO_PATTERNS): string[] {
  const found: string[] = [];
  // Words inside quotation marks are someone else's, not the speaker introducing themselves.
  const unquoted = text.replace(/"[^"]*"|“[^”]*”/g, ' ');
  for (const pattern of patterns) {
    for (const m of unquoted.matchAll(pattern)) found.push(m[1].trim());
  }
  return found;
}

// An intro name counts only if a person candidate in the chunk is that name.
// "I'm Charles Ponti" matches a candidate named "Charles" and the other way round.
function matchCandidate(introName: string, candidates: CandidateLike[]): string | null {
  const intro = introName.toLowerCase();
  const first = intro.split(/\s+/)[0];
  for (const c of candidates) {
    if (c.type !== 'person') continue;
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    if (names.includes(intro) || names.includes(first)) return c.name;
  }
  return null;
}

/**
 * Looks at the user turns of a chunk and, if one introduces the speaker by a name that a
 * person candidate also carries, records that name on the identity and the self entity.
 * Returns the learned name, or null when nothing was learned.
 */
export async function learnSelfName(
  storage: Storage,
  turns: TurnLike[],
  candidates: CandidateLike[],
): Promise<string | null> {
  const people = candidates.filter((c) => c.type === 'person');
  const userTexts = turns.filter((t) => t.role === 'user').map((t) => t.content);

  const explicit = userTexts.flatMap((t) => findSelfIntros(t, EXPLICIT_PATTERNS));
  const loose = userTexts.flatMap((t) => findSelfIntros(t, LOOSE_PATTERNS));
  const names = [
    ...explicit,
    ...loose.map((i) => matchCandidate(i, people)).filter((n): n is string => !!n),
  ];
  const matched = [...new Set(names.map((n) => n.toLowerCase()))].map(
    (lower) => names.find((n) => n.toLowerCase() === lower) as string,
  );
  // Two different intros in one chunk (a quoted conversation, say) is too murky to trust.
  if (matched.length !== 1) return null;
  const learned = matched[0];

  const row = storage.read(
    (db: any) =>
      db.prepare("SELECT content_json FROM identity_core WHERE id = 'singleton'").get() as
        | { content_json: string }
        | undefined,
  );
  const { name, aliases } = identityNames(row?.content_json);
  const known = [name, ...aliases].map((n) => n.toLowerCase());
  if (known.includes(learned.toLowerCase())) return null;

  // If someone else already owns this name, an intro can't tell us it's the same person.
  const taken = storage.read(
    (db: any) =>
      db
        .prepare(
          `SELECT 1 FROM entities
            WHERE is_self = 0 AND type = 'person' AND LOWER(name) = ?
            LIMIT 1`,
        )
        .get(learned.toLowerCase()) as unknown,
  );
  if (taken) return null;

  const placeholder = name.toLowerCase() === 'user';
  const next: Record<string, unknown> = {
    ...safeParse(row?.content_json),
    name: placeholder ? learned : name,
    aliases: placeholder ? aliases : [...aliases, learned],
  };
  const contentJson = JSON.stringify(next);
  await storage.write((db) => {
    const now = nowUtc();
    const hit = db
      .prepare(
        `UPDATE identity_core SET content_json = ?, version = version + 1, updated_at = ?, updated_by = 'user'
          WHERE id = 'singleton'`,
      )
      .run(contentJson, now);
    if (hit.changes === 0) {
      db.prepare(
        `INSERT INTO identity_core (id, content_json, rendered_text, version, updated_at, updated_by)
         VALUES ('singleton', ?, ?, 1, ?, 'user')`,
      ).run(contentJson, `The user is ${next.name}.`, now);
    }
  });
  await syncSelfEntity(storage, contentJson);
  return learned;
}

function safeParse(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
