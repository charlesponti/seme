// src/scripts/seed-rss.ts — seed the memory system from RSS feeds.
//
// Pulls items from one or more RSS feeds, fetches each article's readable text,
// ingests it (POST /ingest/source), then ends the session so extraction runs.
// Prints a per-article and aggregate report.
//
// Usage:
//   tsx src/scripts/seed-rss.ts --limit 100 --api http://localhost:3100
//   tsx src/scripts/seed-rss.ts --limit 100 --api https://seme-api.fly.dev \
//        --feed https://feeds.bbci.co.uk/news/rss.xml \
//        --feed https://feeds.bbci.co.uk/news/technology/rss.xml
//
// Flags:
//   --limit N        max articles total (default 100)
//   --api URL        Seme base URL (default http://localhost:3000)
//   --feed URL       repeatable; defaults to five BBC feeds
//   --delay MS       pause between article fetches (default 900)
//   --wait MS        time to let extraction finish per article (default 0 = poll)
//   --dry-run        list what would be ingested, no writes
//   --out PATH       write a JSON report

type FeedItem = { title: string; link: string; description: string; pubDate: string; feed: string };

const DEFAULT_FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
];

const UA = 'SemeMemorySeeder/1.0 (+local research; contact: owner)';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const LIMIT = parseInt(arg('limit', '100')!, 10);
const API = (arg('api', 'http://localhost:3000')!).replace(/\/$/, '');
const DELAY = parseInt(arg('delay', '900')!, 10);
const WAIT = parseInt(arg('wait', '0')!, 10);
const DRY = flag('dry-run');
const OUT = arg('out');
const FEEDS = args('feed').length ? args('feed') : DEFAULT_FEEDS;
const API_KEY = process.env.SEME_API_KEY || '';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, k) => ENTITIES[k as keyof typeof ENTITIES] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

async function parseFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`feed ${url} → ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return items.map((raw) => {
    // RSS links are often entity-escaped and carry tracking params.
    let link = decodeEntities(tag(raw, 'link') || tag(raw, 'guid'));
    try {
      const u = new URL(link);
      for (const k of [...u.searchParams.keys()]) {
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
      feed: url,
    };
  });
}

/** Pull readable paragraphs from an article page. */
async function articleText(url: string): Promise<string | null> {
  let html: string;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Prefer the article container when present.
  const articleMatch = /<article[\s\S]*?<\/article>/i.exec(html);
  const scope = articleMatch ? articleMatch[0] : html;

  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 60 && !/^(share|follow|listen|sign up|read more)/i.test(t));

  const text = paras.join('\n\n').slice(0, 12000);
  return text.length > 200 ? text : null;
}

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200), status: res.status };
  }
}

async function counts(): Promise<{ memories: number; entities: number; relationships: number }> {
  const [m, e, r] = await Promise.all([api('/memories?limit=1'), api('/entities?limit=1'), api('/relationships?limit=1')]);
  return { memories: m?.total ?? 0, entities: e?.total ?? 0, relationships: r?.total ?? 0 };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Seme RSS seeder → ${API}`);
  console.log(`feeds: ${FEEDS.length} · limit: ${LIMIT} · dry-run: ${DRY}`);

  const before = DRY ? { memories: 0, entities: 0, relationships: 0 } : await counts();
  console.log(`before: ${before.memories} memories · ${before.entities} entities · ${before.relationships} relationships\n`);

  // 1. Collect items across feeds, de-duplicating by link.
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const feed of FEEDS) {
    try {
      const parsed = await parseFeed(feed);
      let added = 0;
      for (const it of parsed) {
        if (!it.link || seen.has(it.link)) continue;
        seen.add(it.link);
        items.push(it);
        added++;
        if (items.length >= LIMIT) break;
      }
      console.log(`  ${feed.split('/').slice(-1)[0].padEnd(28)} ${parsed.length} items, +${added}`);
    } catch (e) {
      console.log(`  ${feed} → ${(e as Error).message}`);
    }
    if (items.length >= LIMIT) break;
  }

  if (items.length === 0) {
    console.error('no feed items found');
    process.exit(1);
  }
  console.log(`\ncollected ${items.length} unique articles\n`);

  if (DRY) {
    items.forEach((it, i) => console.log(`${String(i + 1).padStart(3)}. ${it.title}\n     ${it.link}`));
    return;
  }

  // 2. Ingest each article, then end its session so extraction runs.
  const report: any[] = [];
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const label = `${String(i + 1).padStart(3)}/${items.length}`;

    const body = (await articleText(it.link)) ?? it.description;
    if (!body || body.length < 80) {
      console.log(`${label} skip  ${it.title.slice(0, 70)} (no readable text)`);
      report.push({ ...it, status: 'skipped' });
      failed++;
      continue;
    }

    const text = `${it.title}\n\n${body}`;
    const sessionId = `rss-${i + 1}-${Date.now().toString(36)}`;

    try {
      const ing = await api('/ingest/source', {
        text,
        title: it.title,
        session_id: sessionId,
        source_type: 'rss',
      });
      if (ing?.error) throw new Error(ing.error.message ?? 'ingest failed');

      await api(`/sessions/${sessionId}/end`, {});

      // Give the background pipeline a moment, then poll for this session's effect.
      if (WAIT > 0) {
        await sleep(WAIT);
      } else {
        // extraction is async; poll lightly so we do not outrun the queue
        await sleep(1500);
      }

      ok++;
      console.log(`${label} ok    ${it.title.slice(0, 70)}  (${ing.chunks} chunk${ing.chunks === 1 ? '' : 's'})`);
      report.push({ ...it, status: 'ok', chunks: ing.chunks, chars: text.length, session_id: sessionId });
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      console.log(`${label} FAIL  ${it.title.slice(0, 60)} — ${msg}`);
      report.push({ ...it, status: 'failed', error: msg });
    }

    await sleep(DELAY);
  }

  // 3. Let the extraction queue drain. Memory extraction and entity extraction
  // run as separate stages, so wait for ALL counters to stop moving.
  console.log('\nwaiting for extraction to drain…');
  let last = await counts();
  let stable = 0;
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const now = await counts();
    const same =
      now.memories === last.memories &&
      now.entities === last.entities &&
      now.relationships === last.relationships;
    last = now;
    stable = same ? stable + 1 : 0;
    process.stdout.write(
      `\r  ${now.memories} memories · ${now.entities} entities · ${now.relationships} relationships   `
    );
    // two consecutive stable readings, and never less than ~15s of waiting
    if (stable >= 2 && i >= 5) break;
  }
  const after = last;
  console.log('');

  const summary = {
    at: new Date().toISOString(),
    api: API,
    feeds: FEEDS,
    requested: LIMIT,
    collected: items.length,
    ingested: ok,
    failed,
    before,
    after,
    delta: {
      memories: after.memories - before.memories,
      entities: after.entities - before.entities,
      relationships: after.relationships - before.relationships,
    },
    articles: report,
  };

  console.log('\n' + '='.repeat(64));
  console.log(`articles ingested : ${ok} (${failed} failed/skipped)`);
  console.log(`memories          : ${before.memories} → ${after.memories}  (+${summary.delta.memories})`);
  console.log(`entities          : ${before.entities} → ${after.entities}  (+${summary.delta.entities})`);
  console.log(`relationships     : ${before.relationships} → ${after.relationships}  (+${summary.delta.relationships})`);
  if (after.memories > before.memories) {
    console.log(`yield             : ${(summary.delta.memories / Math.max(1, ok)).toFixed(1)} memories/article`);
    console.log(`entities per 100  : ${((summary.delta.entities / Math.max(1, ok)) * 100).toFixed(0)}`);
  }
  console.log('='.repeat(64));

  if (OUT) {
    const fs = await import('node:fs');
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    console.log(`report → ${OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
