// src/identity/self-entity.ts — the one entity that is the user themself.
//
// The extractor keeps emitting `user` for first-person statements. This module
// owns the entity those statements should resolve to: one `is_self` row, always
// pinned (so the sleep job never decays it), with name + aliases kept in sync
// with identity_core. The aliases always carry the speaker words, so alias
// lookups (relationship resolver, entity resolver) land on this row.

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';

export const SPEAKER_ALIASES = ['user', 'the user', 'I', 'me', 'myself', 'speaker'];

interface SelfRow {
  id: string;
  name: string;
  aliases: string | null;
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

// Case-insensitive de-dupe that keeps the first spelling.
function uniqueAliases(list: string[], exclude: string): string[] {
  const seen = new Set<string>([exclude.toLowerCase()]);
  const out: string[] = [];
  for (const a of list) {
    const trimmed = a.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

// Pulls the display name and extra aliases out of identity content_json.
export function identityNames(contentJson: string | null | undefined): {
  name: string;
  aliases: string[];
} {
  let name = 'User';
  let aliases: string[] = [];
  if (contentJson) {
    try {
      const parsed = JSON.parse(contentJson) as { name?: unknown; aliases?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim();
      if (Array.isArray(parsed.aliases)) {
        aliases = parsed.aliases.filter((a): a is string => typeof a === 'string');
      }
    } catch {
      // bad JSON: fall back to the placeholder name
    }
  }
  return { name, aliases };
}

/**
 * Make sure exactly one self entity exists and that its name/aliases match
 * identity. Order: reuse the `is_self` row, else promote an existing `user`
 * person entity, else insert a fresh one. Returns the entity id.
 */
export async function syncSelfEntity(
  storage: Storage,
  contentJson: string | null | undefined,
): Promise<string> {
  const { name, aliases: extra } = identityNames(contentJson);

  return storage.write((db) => {
    let row = db.prepare('SELECT id, name, aliases FROM entities WHERE is_self = 1').get() as
      | SelfRow
      | undefined;

    if (!row) {
      // Promote a pre-existing `user` person (oldest first) rather than make a duplicate.
      row = db
        .prepare(
          `SELECT id, name, aliases FROM entities
           WHERE LOWER(name) = 'user' AND type = 'person' AND is_self = 0
           ORDER BY first_seen_at ASC LIMIT 1`,
        )
        .get() as SelfRow | undefined;
    }

    const now = nowUtc();
    const existingAliases = row ? parseAliases(row.aliases) : [];
    // The old name (e.g. `user` before the name is set) stays findable as an alias.
    const previousName = row && row.name.toLowerCase() !== name.toLowerCase() ? [row.name] : [];
    const aliases = uniqueAliases(
      [...extra, ...SPEAKER_ALIASES, ...previousName, ...existingAliases],
      name,
    );

    if (row) {
      db.prepare(
        `UPDATE entities
         SET name = ?, aliases = ?, type = 'person', pinned = 1, is_self = 1
         WHERE id = ?`,
      ).run(name, JSON.stringify(aliases), row.id);
      return row.id;
    }

    const id = uuid();
    db.prepare(
      `INSERT INTO entities
         (id, name, type, aliases, description, first_seen_at, last_seen_at,
          mention_count, confidence, source_type, profile_included, pinned, is_self)
       VALUES (?, ?, 'person', ?, NULL, ?, ?, 0, 1.0, 'user_stated', 1, 1, 1)`,
    ).run(id, name, JSON.stringify(aliases), now, now);
    return id;
  });
}
