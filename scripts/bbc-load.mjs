#!/usr/bin/env node
// Ingest a saved BBC corpus (scripts/bbc-corpus.mjs) into a running Seme API.
//
//   node scripts/bbc-load.mjs --dir ~/.hominem/corpus/bbc-2026-10-30 --api http://localhost:3100
//   node scripts/bbc-load.mjs --dir <dir> --concurrency 4 --limit 50
//
// The corpus is the source of truth: no network fetch is performed here, so a
// failed ingest can be replayed without re-crawling BBC.
//
// How it works:
//   - Streams articles.jsonl line by line; nothing is loaded whole.
//   - Posts each article to /ingest/source with --concurrency requests in flight.
//     Each submission is its own closed episode, so no session end call is needed.
//   - Waits on each episode's own status (/ingest/episodes/:id/status) until extraction
//     finishes, instead of guessing from stable counts.
//   - Reads totals from the cheap limit=1 list endpoints; /sources is read only at start and end.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
const int = (name, fallback) => {
  const n = parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
};

const DIR = path.resolve(arg('dir', ''));
const API = arg('api', 'http://localhost:3100').replace(/\/$/, '');
const CONCURRENCY = Math.max(1, int('concurrency', 3));
const DELAY = int('delay', 0);
const LIMIT = int('limit', 0);
const SKIP_EXISTING = flag('skip-existing');
const TIMEOUT_MS = int('timeout', 60000);
const RETRIES = int('retries', 3);
const DRAIN_TIMEOUT_MS = int('drain-timeout-min', 60) * 60_000;
const POLL_MS = int('poll', 2000);
const API_KEY = process.env.SEME_API_KEY || '';
const SESSION = `bbc-${Date.now().toString(36)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt, retryAfter) {
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 60) * 1000;
  return Math.min(8000, 500 * 2 ** attempt);
}

/**
 * One API call. Retries only what is safe to retry:
 *  - GET: network errors, timeouts, and 429/5xx.
 *  - POST: only 429/503, which mean the server did not accept the request.
 * A POST that times out or drops is NOT retried, because the server may already have stored
 * the source and a retry would store it twice.
 */
async function call(method, pathname, body) {
  const headers = {
    'content-type': 'application/json',
    ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (method !== 'GET' || attempt >= RETRIES)
        throw new Error(`${method} ${pathname}: ${e.message}`, { cause: e });
      await sleep(backoffMs(attempt));
      continue;
    }
    const retryable = method === 'GET' ? [429, 500, 502, 503, 504] : [429, 503];
    if (retryable.includes(res.status) && attempt < RETRIES) {
      await res.body?.cancel();
      await sleep(backoffMs(attempt, res.headers.get('retry-after')));
      continue;
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 300) };
    }
    return { status: res.status, data };
  }
}

/** Runs fn over items with at most `limit` in flight. Results keep the input order. */
async function mapLimit(items, limit, fn) {
  const out = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Totals for the summary. The list endpoints return `total` at limit=1, so no full scan. */
async function counts() {
  const [m, e, r, s] = await Promise.all([
    call('GET', '/memories?limit=1'),
    call('GET', '/entities?limit=1'),
    call('GET', '/relationships?limit=1'),
    call('GET', '/sources?limit=100000'),
  ]);
  return {
    memories: m.data?.total ?? 0,
    entities: e.data?.total ?? 0,
    relationships: r.data?.total ?? 0,
    sources: Array.isArray(s.data) ? s.data.length : 0,
  };
}

async function existingTitles() {
  const s = await call('GET', '/sources?limit=100000');
  return new Set(
    (Array.isArray(s.data) ? s.data : []).map((x) =>
      String(x.title || '')
        .trim()
        .toLowerCase(),
    ),
  );
}

/** Lines of articles.jsonl, parsed one at a time. A torn or malformed line is skipped. */
async function* corpusRecords(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      /* skipped: partial line from an interrupted corpus run */
    }
  }
}

/**
 * Waits until every episode has finished extraction. Polls the per-episode status, a few at a
 * time. A 404 means the API restarted and lost that progress, so the episode is counted as unknown.
 */
async function drain(episodeIds) {
  const pending = new Set(episodeIds);
  const outcome = { done: 0, failed: 0, unknown: 0, timed_out: 0 };
  const failures = [];
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    const ids = [...pending];
    await mapLimit(ids, 8, async (id) => {
      const res = await call('GET', `/ingest/episodes/${id}/status`);
      if (res.status === 404) {
        pending.delete(id);
        outcome.unknown++;
      } else if (res.data?.state === 'done') {
        pending.delete(id);
        outcome.done++;
      } else if (res.data?.state === 'failed') {
        pending.delete(id);
        outcome.failed++;
        failures.push({ episode_id: id, error: res.data.error });
      }
    });
    if (pending.size > 0) {
      process.stdout.write(
        `\r  extracting: ${pending.size} left, ${outcome.done} done, ${outcome.failed} failed   `,
      );
      await sleep(POLL_MS);
    }
  }
  outcome.timed_out = pending.size;
  process.stdout.write('\n');
  return { outcome, failures };
}

async function main() {
  if (!DIR || DIR === path.resolve('')) throw new Error('--dir is required');
  const file = path.join(DIR, 'articles.jsonl');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const started = Date.now();

  const existing = SKIP_EXISTING ? await existingTitles() : new Set();
  const before = await counts();
  console.log(
    `before: ${before.sources} sources · ${before.memories} memories · ${before.entities} entities · ${before.relationships} relationships`,
  );
  console.log(`loading ${file} -> ${API} (${CONCURRENCY} in flight, session ${SESSION})\n`);

  // Pick the articles to send. Streamed, so a large corpus never sits in memory whole.
  const selected = [];
  let corpusCount = 0;
  let usable = 0;
  let skippedExisting = 0;
  for await (const r of corpusRecords(file)) {
    corpusCount++;
    if (!((r.status === 'ok' || r.status === 'fallback') && r.text && r.text.length >= 80))
      continue;
    usable++;
    if (
      existing.has(
        String(r.title || '')
          .trim()
          .toLowerCase(),
      )
    ) {
      skippedExisting++;
      continue;
    }
    selected.push(r);
    if (LIMIT > 0 && selected.length >= LIMIT) break;
  }
  console.log(
    `corpus: ${corpusCount} records, ${usable} usable, ${selected.length} to ingest (skipped existing: ${skippedExisting})\n`,
  );

  const ingestStart = Date.now();
  let ok = 0;
  let failed = 0;
  const episodeIds = [];
  const report = [];

  await mapLimit(selected, CONCURRENCY, async (r, i) => {
    const label = `${String(i + 1).padStart(4)}/${selected.length}`;
    const text = `${r.title}\n\n${r.text}`;
    try {
      const res = await call('POST', '/ingest/source', {
        text,
        title: r.title,
        session_id: SESSION,
        source_type: 'rss',
      });
      const ing = res.data;
      if (res.status >= 300 || ing?.error || !ing?.episode_id) {
        throw new Error(ing?.error?.message || `HTTP ${res.status}`);
      }
      ok++;
      episodeIds.push(ing.episode_id);
      console.log(
        `${label} ok    ${r.title.slice(0, 72)} (${ing.chunks} chunk${ing.chunks === 1 ? '' : 's'})`,
      );
      report.push({
        title: r.title,
        url: r.link,
        status: 'ok',
        chunks: ing.chunks,
        episode_id: ing.episode_id,
      });
    } catch (e) {
      failed++;
      console.log(`${label} FAIL  ${r.title.slice(0, 60)} — ${e.message}`);
      report.push({ title: r.title, url: r.link, status: 'failed', error: e.message });
    }
    if (DELAY > 0) await sleep(DELAY);
  });
  const ingestS = Math.round((Date.now() - ingestStart) / 100) / 10;

  console.log(`\nposted ${ok} in ${ingestS}s, waiting for extraction…`);
  const drainStart = Date.now();
  const { outcome, failures } = await drain(episodeIds);
  const drainS = Math.round((Date.now() - drainStart) / 100) / 10;

  const after = await counts();
  const summary = {
    at: new Date().toISOString(),
    dir: DIR,
    api: API,
    session_id: SESSION,
    corpus_records: corpusCount,
    usable,
    skipped_existing: skippedExisting,
    ingested: ok,
    failed,
    concurrency: CONCURRENCY,
    timings_s: {
      ingest: ingestS,
      extraction: drainS,
      total: Math.round((Date.now() - started) / 100) / 10,
    },
    extraction: { ...outcome, failures },
    before,
    after,
    delta: {
      sources: after.sources - before.sources,
      memories: after.memories - before.memories,
      entities: after.entities - before.entities,
      relationships: after.relationships - before.relationships,
    },
    articles: report,
  };
  fs.writeFileSync(path.join(DIR, 'load-report.json'), JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(64));
  console.log(`ingested : ${ok} (${failed} failed)`);
  console.log(
    `extracted: ${outcome.done} done, ${outcome.failed} failed, ${outcome.unknown} unknown, ${outcome.timed_out} timed out`,
  );
  console.log(`time     : ingest ${ingestS}s, extraction ${drainS}s`);
  console.log(`sources  : ${before.sources} → ${after.sources}  (+${summary.delta.sources})`);
  console.log(`memories : ${before.memories} → ${after.memories}  (+${summary.delta.memories})`);
  console.log(`entities : ${before.entities} → ${after.entities}  (+${summary.delta.entities})`);
  console.log(
    `relations: ${before.relationships} → ${after.relationships}  (+${summary.delta.relationships})`,
  );
  console.log(`report   → ${path.join(DIR, 'load-report.json')}`);
  console.log('='.repeat(64));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
