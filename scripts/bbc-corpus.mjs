#!/usr/bin/env node
// Fetch BBC RSS articles once and save a local, re-ingestable corpus.
//
//   node scripts/bbc-corpus.mjs --limit 400
//   node scripts/bbc-corpus.mjs --out ~/.hominem/corpus/bbc-2026-10-30 --concurrency 4
//   node scripts/bbc-corpus.mjs --out <dir> --resume        # keep what's saved, fetch the rest
//
// Writes articles.jsonl (one JSON object per article, in feed order) and manifest.json.
// Re-ingest with scripts/bbc-load.mjs --dir <out>.
//
// Politeness: at most --concurrency article requests in flight, --delay ms after each one.
// Throttled (429) and server-error (5xx) responses are retried with backoff, honoring Retry-After.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { once } from 'node:events';

const FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/uk/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://feeds.bbci.co.uk/news/politics/rss.xml',
  'https://feeds.bbci.co.uk/news/health/rss.xml',
  'https://feeds.bbci.co.uk/news/education/rss.xml',
  'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
];

const UA = 'SemeMemorySeeder/1.0 (+local research; contact: owner)';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const int = (name, fallback) => {
  const n = parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
};

const LIMIT = int('limit', 400);
const DELAY = int('delay', 250);
const CONCURRENCY = Math.max(1, int('concurrency', 3));
const TIMEOUT_MS = int('timeout', 20000);
const RETRIES = int('retries', 3);
const RESUME = flag('resume');
const OUT = path.resolve(
  arg(
    'out',
    path.join(os.homedir(), '.hominem', 'corpus', `bbc-${new Date().toISOString().slice(0, 10)}`),
  ),
);
const FEED_LIST = args('feed').length ? args('feed') : FEEDS;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#34': '"',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, k) => ENTITIES[k] ?? m);
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const i = xml.indexOf('<' + name);
  if (i === -1) return '';
  const openEnd = xml.indexOf('>', i);
  const close = xml.indexOf('</' + name + '>', openEnd);
  if (openEnd === -1 || close === -1) return '';
  let out = xml.slice(openEnd + 1, close).trim();
  if (out.startsWith('<![CDATA[')) out = out.slice(9);
  if (out.endsWith(']]>')) out = out.slice(0, -3);
  return out.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt, retryAfter) {
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 60) * 1000;
  return Math.min(8000, 500 * 2 ** attempt);
}

/** GET with a timeout. Retries network errors and RETRYABLE statuses; anything else throws at once. */
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt >= RETRIES) throw new Error(e.message, { cause: e });
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) return res;
    await res.body?.cancel();
    if (!RETRYABLE.has(res.status) || attempt >= RETRIES) throw new Error(`HTTP ${res.status}`);
    await sleep(backoffMs(attempt, res.headers.get('retry-after')));
  }
}

function parseFeedXml(xml, feed) {
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return items.map((raw) => {
    let link = decodeEntities(tag(raw, 'link') || tag(raw, 'guid'));
    try {
      const u = new URL(link);
      for (const k of Array.from(u.searchParams.keys())) {
        if (/^at_/i.test(k)) u.searchParams.delete(k);
      }
      link = u.toString();
    } catch {
      /* leave as-is */
    }
    return {
      title: decodeEntities(tag(raw, 'title')),
      link,
      description: stripTags(tag(raw, 'description')),
      pubDate: tag(raw, 'pubDate'),
      feed,
    };
  });
}

async function parseFeed(url) {
  const res = await get(url);
  return parseFeedXml(await res.text(), url);
}

async function articleText(url) {
  let html;
  try {
    html = await (await get(url)).text();
  } catch (e) {
    return { text: null, error: e.message };
  }

  const articleMatch = /<article[\s\S]*?<\/article>/i.exec(html);
  const scope = articleMatch ? articleMatch[0] : html;
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 60 && !/^(share|follow|listen|sign up|read more)/i.test(t));

  const text = paras.join('\n\n').slice(0, 12000);
  return { text: text.length > 200 ? text : null, error: null };
}

/** Links already saved in an earlier run, so --resume can skip them without refetching. */
async function savedLinks(file) {
  const links = new Set();
  if (!fs.existsSync(file)) return links;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const { link } = JSON.parse(line);
      if (link) links.add(link);
    } catch {
      /* a torn last line from an interrupted run: ignore it */
    }
  }
  return links;
}

async function buildRecord(it) {
  const fetchedAt = new Date().toISOString();
  const fetched = await articleText(it.link);
  const body = fetched.text ?? it.description;
  return {
    ...it,
    text: body ?? '',
    chars: (body ?? '').length,
    status: fetched.text ? 'ok' : body && body.length >= 80 ? 'fallback' : 'skipped',
    error: fetched.error,
    fetched_at: fetchedAt,
  };
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  const jsonlPath = path.join(OUT, 'articles.jsonl');
  const manifestPath = path.join(OUT, 'manifest.json');

  const alreadySaved = RESUME ? await savedLinks(jsonlPath) : new Set();

  // Feeds in parallel; results are merged in feed order so the output is deterministic.
  const feedResults = await Promise.allSettled(FEED_LIST.map(parseFeed));
  const feedStats = [];
  const seen = new Set();
  const items = [];
  feedResults.forEach((r, idx) => {
    const feed = FEED_LIST[idx];
    if (r.status === 'rejected') {
      feedStats.push({ feed, error: r.reason.message });
      console.log(`  ${feed} -> ${r.reason.message}`);
      return;
    }
    let added = 0;
    for (const it of r.value) {
      if (items.length >= LIMIT) break;
      if (!it.link || seen.has(it.link) || alreadySaved.has(it.link)) continue;
      seen.add(it.link);
      items.push(it);
      added++;
    }
    feedStats.push({ feed, items: r.value.length, added });
    console.log(`  ${feed.split('/').slice(-2)[0].padEnd(28)} ${r.value.length} items, +${added}`);
  });

  console.log(
    `\ncollected ${items.length} new articles${alreadySaved.size ? ` (${alreadySaved.size} already saved)` : ''} -> ${OUT}`,
  );
  console.log(`fetching with ${Math.min(CONCURRENCY, items.length)} in flight\n`);

  // An interrupted run can leave a partial last line. End it, so the next record starts clean.
  if (RESUME && fs.existsSync(jsonlPath)) {
    const size = fs.statSync(jsonlPath).size;
    if (size > 0) {
      const fd = fs.openSync(jsonlPath, 'r');
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      fs.closeSync(fd);
      if (last[0] !== 0x0a) fs.appendFileSync(jsonlPath, '\n');
    }
  }
  const stream = fs.createWriteStream(jsonlPath, { flags: RESUME ? 'a' : 'w' });
  const slots = Array.from({ length: items.length });
  let nextToWrite = 0;
  let flushChain = Promise.resolve();

  // Writes records in feed order as soon as the next one is ready, so memory stays bounded.
  const flush = async () => {
    while (nextToWrite < items.length && slots[nextToWrite] !== undefined) {
      const line = JSON.stringify(slots[nextToWrite]) + '\n';
      slots[nextToWrite] = undefined;
      nextToWrite++;
      if (!stream.write(line)) await once(stream, 'drain');
    }
  };
  const enqueue = (i, record) => {
    slots[i] = record;
    flushChain = flushChain.then(flush);
  };

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let chars = 0;
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      const record = await buildRecord(it);
      if (record.status === 'ok' || record.status === 'fallback') saved++;
      else skipped++;
      if (record.error) failed++;
      chars += record.chars;
      enqueue(i, record);
      done++;
      console.log(
        `${String(done).padStart(4)}/${items.length} ${record.status.padEnd(8)} ${it.title.slice(0, 70)} (${record.chars} chars)`,
      );
      if (DELAY > 0) await sleep(DELAY);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  await flushChain;
  await new Promise((resolve) => stream.end(resolve));

  const manifest = {
    generated_at: new Date().toISOString(),
    out: OUT,
    feeds: feedStats,
    collected: items.length,
    saved,
    skipped,
    fetch_errors: failed,
    total_chars: chars,
    resumed_from: RESUME ? alreadySaved.size : 0,
    concurrency: Math.min(CONCURRENCY, Math.max(items.length, 1)),
    elapsed_s: Math.round((Date.now() - started) / 100) / 10,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n' + '='.repeat(64));
  console.log(
    `saved ${saved} articles (${skipped} skipped, ${failed} fetch errors) in ${manifest.elapsed_s}s -> ${jsonlPath}`,
  );
  console.log(`manifest -> ${manifestPath}`);
  console.log('='.repeat(64));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
