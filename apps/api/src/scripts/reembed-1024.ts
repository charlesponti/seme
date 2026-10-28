// Re-embed all memories at 1024 dimensions (Ollama qwen3-embedding:0.6b)
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = process.env.SEME_DB || `${process.env.HOME}/.hominem/memory.db`;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b';
const DIM = 1024;

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);

  // 1. Verify ollama
  const probe = await embed(['probe']);
  if (probe[0].length !== DIM) {
    throw new Error(`Model returned ${probe[0].length} dims, expected ${DIM}`);
  }
  console.log(`✓ Ollama ready (${MODEL}, ${DIM} dims)`);

  // 2. Read all active memories needing vectors
  const memories = db
    .prepare("SELECT id, value_text FROM memories WHERE status = 'active' OR status = 'superseded'")
    .all() as { id: string; value_text: string }[];
  console.log(`Found ${memories.length} memories to embed`);

  if (memories.length === 0) {
    console.log('Nothing to embed.');
    db.close();
    return;
  }

  // 3. Drop and recreate the vec table at 1024 dims
  db.prepare('DROP TABLE IF EXISTS memories_vec').run();
  db.prepare(
    `CREATE VIRTUAL TABLE memories_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding FLOAT[${DIM}])`
  ).run();
  console.log('✓ Recreated memories_vec at 1024 dims');

  // 4. Embed in batches of 32
  const BATCH = 32;
  let done = 0;
  for (let i = 0; i < memories.length; i += BATCH) {
    const batch = memories.slice(i, i + BATCH);
    const vectors = await embed(batch.map((m) => m.value_text));
    const insert = db.prepare('INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)');
    const txn = db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        insert.run(batch[j].id, new Float32Array(vectors[j]));
      }
    });
    txn();
    done += batch.length;
    process.stdout.write(`\r  embedded ${done}/${memories.length}`);
  }
  console.log('\n✓ Embedded all memories');

  // 5. Update schema_meta so the storage layer accepts 1024
  const hasMeta = db.prepare("SELECT value FROM schema_meta WHERE key = 'embedding_dim'").get();
  if (hasMeta) {
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'embedding_dim'").run(String(DIM));
  } else {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('embedding_dim', ?)").run(String(DIM));
  }
  console.log('✓ Updated schema_meta.embedding_dim = 1024');

  // 6. Verify
  const count = (db.prepare('SELECT COUNT(*) as c FROM memories_vec').get() as { c: number }).c;
  console.log(`✓ memories_vec now holds ${count} vectors`);

  db.close();
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});