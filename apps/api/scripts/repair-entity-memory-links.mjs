#!/usr/bin/env node
// Repair entity↔memory links that were created before links required textual
// evidence. For every existing link, keep it only when the entity's name (or an
// alias) actually appears in the memory's value_text, evidence_quote or subject.
//
// Safe to re-run. Reports counts and never touches rows it keeps.
//
// Usage:
//   node scripts/repair-entity-memory-links.mjs [--db /data/memory.db] [--dry-run]

import Database from 'better-sqlite3'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1] ?? fallback
}
const DB_PATH = arg('db', process.env.SEME_STORAGE_DIR ? `${process.env.SEME_STORAGE_DIR}/memory.db` : '/data/memory.db')
const DRY = argv.includes('--dry-run')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 10000')

const rows = db
  .prepare(
    `SELECT l.entity_id, l.memory_id, e.name, e.aliases,
            m.value_text, m.evidence_quote, m.subject
       FROM entity_memory_links l
       JOIN entities e ON e.id = l.entity_id
       JOIN memories m ON m.id = l.memory_id`
  )
  .all()

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const appears = (haystack, needle) => {
  const n = (needle || '').trim().toLowerCase()
  if (n.length < 2) return false
  try {
    return new RegExp(`(^|[^a-z0-9])${escape(n)}([^a-z0-9]|$)`, 'i').test(haystack)
  } catch {
    return haystack.includes(n)
  }
}

const del = db.prepare('DELETE FROM entity_memory_links WHERE entity_id = ? AND memory_id = ?')
let removed = 0
let kept = 0

const tx = db.transaction(() => {
  for (const r of rows) {
    const haystack = `${r.value_text ?? ''} ${r.evidence_quote ?? ''} ${r.subject ?? ''}`.toLowerCase()
    let names = [r.name]
    try {
      const parsed = r.aliases ? JSON.parse(r.aliases) : []
      if (Array.isArray(parsed)) names = names.concat(parsed)
    } catch {
      /* aliases not JSON — ignore */
    }
    const ok = names.some((n) => appears(haystack, n))
    if (ok) {
      kept++
    } else {
      removed++
      if (!DRY) del.run(r.entity_id, r.memory_id)
    }
  }
})
tx()

console.log(
  `${DRY ? '[dry-run] ' : ''}links checked: ${rows.length} · kept: ${kept} · removed: ${removed}`
)

// Optional: delete wiki pages whose entity has no remaining linked memories.
// Compilation requires memories, so such a page can no longer be regenerated —
// it is residue from evidence that has since been disproved.
if (argv.includes('--purge-orphan-wiki')) {
  const orphans = db
    .prepare(
      `SELECT w.id, w.title
         FROM wiki_pages w
        WHERE NOT EXISTS (
          SELECT 1 FROM entity_memory_links l WHERE l.entity_id = w.entity_id
        )`
    )
    .all()
  if (!DRY) {
    const delPage = db.prepare('DELETE FROM wiki_page_versions WHERE page_id = ?')
    const delRow = db.prepare('DELETE FROM wiki_pages WHERE id = ?')
    const tx2 = db.transaction(() => {
      for (const p of orphans) {
        delPage.run(p.id)
        delRow.run(p.id)
      }
    })
    tx2()
  }
  console.log(
    `${DRY ? '[dry-run] ' : ''}orphan wiki pages ${DRY ? 'found' : 'deleted'}: ${orphans.length}` +
      (orphans.length ? ` (${orphans.map((p) => p.title).join(', ')})` : '')
  )
}

db.close()
