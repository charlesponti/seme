#!/usr/bin/env node
// Retry extraction for document episodes that produced no memories or no
// entity links, reusing the stored turns. Sequential on purpose: the 300-article
// run hit provider rate limits when hundreds of episodes extracted at once.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'api',
);
const { Storage } = require(ROOT + '/dist/storage/storage.js');
const { IngestManager } = require(ROOT + '/dist/ingest/ingest.js');
const { ValidationGate } = require(ROOT + '/dist/validation/validation-gate.js');
const { Resolver } = require(ROOT + '/dist/resolver/resolver.js');
const { ProfileCompiler } = require(ROOT + '/dist/profile/profile-compiler.js');
const { ExtractionPipeline } = require(ROOT + '/dist/extraction/pipeline.js');

const STORAGE_DIR = process.env.SEME_STORAGE_DIR || `${process.env.HOME}/.hominem`;
const DELAY = parseInt(process.env.RETRY_DELAY_MS || '2000', 10);
const MAX = parseInt(process.env.RETRY_MAX || '0', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storage = new Storage({ storageDir: STORAGE_DIR, embeddingDim: 1024 });
const db = storage.getKysely();
const pipeline = new ExtractionPipeline(
  storage,
  new IngestManager(storage),
  new ValidationGate(storage),
  new Resolver(storage),
  new ProfileCompiler(storage),
);

async function counts(episodeId) {
  const memories = await db
    .selectFrom('memories')
    .select(({ fn }) => fn.countAll().as('c'))
    .where('source_episode_id', '=', episodeId)
    .executeTakeFirst();
  const links = await db
    .selectFrom('entity_turn_links as etl')
    .innerJoin('turns as t', 't.id', 'etl.turn_id')
    .select(({ fn }) => fn.countAll().as('c'))
    .where('t.episode_id', '=', episodeId)
    .executeTakeFirst();
  return { memories: Number(memories?.c || 0), links: Number(links?.c || 0) };
}

async function main() {
  const episodes = await db
    .selectFrom('episodes')
    .select(['id', 'session_id'])
    .where('extraction_mode', '=', 'document')
    .orderBy('started_at', 'asc')
    .execute();

  const todo = [];
  for (const ep of episodes) {
    const c = await counts(ep.id);
    if (c.memories === 0) todo.push({ ...ep, kind: 'full', ...c });
    else if (c.links === 0) todo.push({ ...ep, kind: 'entities-only', ...c });
  }
  const queue = MAX > 0 ? todo.slice(0, MAX) : todo;
  console.log(
    `retry queue: ${queue.length} (full ${queue.filter((x) => x.kind === 'full').length}, entities-only ${queue.filter((x) => x.kind === 'entities-only').length})`,
  );

  const report = [];
  let ok = 0;
  let failed = 0;

  const WORKERS = parseInt(process.env.RETRY_WORKERS || '3', 10);
  let cursor = 0;

  async function worker(workerId) {
    while (true) {
      const i = cursor++;
      if (i >= queue.length) return;
      const ep = queue[i];
      const label = `${String(i + 1).padStart(3)}/${queue.length}`;
      const before = await counts(ep.id);
      try {
        const result = await pipeline.run(ep.id, { entitiesOnly: ep.kind === 'entities-only' });
        const after = await counts(ep.id);
        ok++;
        console.log(
          `${label} w${workerId} ${ep.kind.padEnd(13)} memories ${before.memories}->${after.memories} links ${before.links}->${after.links} (${result.entities_created} ent, ${result.relationships_created} rel)`,
        );
        report.push({ episode_id: ep.id, kind: ep.kind, before, after, result });
      } catch (e) {
        failed++;
        console.log(`${label} w${workerId} FAIL ${ep.kind} ${e.message}`);
        report.push({ episode_id: ep.id, kind: ep.kind, error: e.message });
      }
      if (i < queue.length - 1) await sleep(DELAY);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(WORKERS, queue.length) }, (_, i) => worker(i + 1)),
  );

  const path = `${STORAGE_DIR}/corpus/bbc-2026-10-30/retry-report.json`;
  fs.writeFileSync(
    path,
    JSON.stringify(
      { at: new Date().toISOString(), queue: queue.length, ok, failed, report },
      null,
      2,
    ),
  );
  console.log(`\nretry done: ${ok} ok, ${failed} failed -> ${path}`);
  storage.close();
}

main().catch((e) => {
  console.error(e);
  try {
    storage.close();
  } catch {}
  process.exit(1);
});
