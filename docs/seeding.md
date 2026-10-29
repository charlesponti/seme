# Seeding Strategy: news as a memory corpus

How to load a large, real-world corpus into Seme and what it tells you about the
extraction pipeline.

## Why RSS news

News is close to a worst case for a personal-memory system and therefore a good
stress test:

- **Dense named entities** — people, organisations, places and topics in almost
  every sentence, with almost no repetition between articles.
- **Zero first-person framing** — the memory extractor is tuned for facts about
  *the user*; news has none. If the graph still fills up, entity extraction is
  genuinely working rather than riding on the memory extractor.
- **Messy, real HTML** — paywalls, cookie banners, live blogs, inline video
  captions, entity-escaped feeds and tracking parameters in links.
- **Free, structured, no auth** — RSS gives stable titles, links and timestamps,
  so the corpus is reproducible across runs.

## Pipeline

```
RSS feed(s) ──► dedupe by link ──► fetch article ──► readable text
                                                        │
                                     fallback: RSS description
                                                        │
                              POST /ingest/source  (source_type=rss)
                                                        │
                              paragraph chunking → turns (chunk ≈ 2000 chars)
                                                        │
                              POST /sessions/:id/end  ← triggers extraction
                                                        │
                        ┌───────────────────────────────┴──────────────┐
                        │                                              │
              memory extraction                          entity + relationship extraction
              (facts about the user)                     (typed nodes, edges)
                        │                                              │
                        └─────────────► SQLite + FTS5 + vec0 ◄──────────┘
```

Two details matter:

1. **Ingestion does not extract.** `POST /ingest/source` writes a source row,
   chunks the text into turns and opens an episode. Extraction only runs when the
   session is ended. A seeder that forgets `/end` produces turns and nothing else.
2. **Extraction is asynchronous and staged.** Memory extraction finishes before
   entity and relationship extraction. Any drain loop that watches only the
   memory counter will exit early and under-report the graph by an order of
   magnitude. Watch all three counters.

## Running it

```bash
# preview what would be ingested, no writes
npx tsx src/scripts/seed-rss.ts --dry-run --limit 20

# small validation run
npx tsx src/scripts/seed-rss.ts --api $SEME_API --limit 5 --delay 900

# the full corpus
npx tsx src/scripts/seed-rss.ts --api $SEME_API --limit 100 --delay 800 \
  --out seed-report.json
```

Flags: `--feed` (repeatable, defaults to five BBC feeds), `--limit`,
`--delay` (pause between article fetches), `--wait`, `--dry-run`, `--out`.

## Metrics that matter

| Metric | What it tells you |
|---|---|
| memories / article | whether the fact extractor generalises beyond conversation |
| entities / article | whether NER copes with unfamiliar, dense domains |
| relationships / article | whether relation extraction survives long text |
| chunks / article | whether chunking is splitting sensibly (2–6 is healthy) |
| failed articles | fetch or parse weakness, not model weakness |
| extraction latency | whether the queue drains or backs up |

## Results

Filled in from the full run — see `seed-report.json` for per-article detail.

### Full run — 100 BBC articles

Five feeds, deduplicated by link, one article per session.

| Metric | Value |
|---|---|
| Feed items collected | 100 |
| Articles ingested | 99 (1 skipped — no readable body text) |
| Skipped reason | article page had < 80 chars of extractable prose |
| Chunks created | 299 (avg 3.0, max 7 per article) |
| Average article size | ~4,900 characters |
| **Memories created** | **2** |
| **Entities created** | **959** (9.7 per article) |
| **Relationships created** | **745** (7.5 per article) |
| Orphaned entities | 115 (12%) |

Entity types produced (free-form, no dictionary):

| Type | Count |
|---|---|
| person | 318 |
| organization | 295 |
| place | 178 |
| concept | 55 |
| topic | 30 |
| tool | 26 |
| other | 26 |
| project | 24 |
| animal | 7 |

Relationship types:

| Relation | Count |
|---|---|
| related_to | 395 (53%) |
| located_in | 117 |
| works_at | 114 |
| uses | 26 |
| created | 24 |
| is_a | 21 |
| lives_in | 19 |
| knows | 14 |
| moved_to | 8 |
| married_to | 4 |
| likes / prefers | 3 |

Most-mentioned entities: John Healey (6), BBC (6), United States (6), UK (5),
Andy Burnham (4), Office for Budget Responsibility (4), Madrid (4), Anthropic (4),
PHP (4), Kemi Badenoch (3), Rachel Reeves (3), Keir Starmer (3), Spain (3),
Pedro Sánchez (3), Renfe (3).

## Findings

**1. Entity and relationship extraction generalise; memory extraction does not.**
99 articles produced 959 entities and 745 relationships — roughly 9.7 nodes and
7.5 edges per article — but only **2 memories** in total, and both came from a
single first-person article ("I earn £30,000"). The memory extractor is
deliberately tuned to facts *about the user*; a news corpus contains none, so it
correctly declines to invent any. News is therefore a graph-seeding corpus, not a
memory-seeding one.

**2. Free-form entity types held up.** With no dictionary, the model produced
coherent categories for an unfamiliar domain — 318 people, 295 organisations, 178
places — and even split `tool` (PHP, Anthropic) from `project` and `animal`
(Renfe's horses, a dog in a human-interest piece). A hardcoded enum would have
collapsed most of this into `other`.

**3. Half the edges are untyped.** 53% of relationships are the generic
`related_to`. The relation vocabulary is under-specified: when the model cannot
name the link it falls back to `related_to`, which is navigable but carries no
semantics. A closed relation set (or a post-pass that merges generic edges into
typed ones where a pattern exists) would materially improve the graph.

**4. Two defects were found by this run and fixed.** Both are recorded here
because they are the kind of thing a seeding exercise exists to surface:

- `entity_memory_links` was populated as a **cartesian product**: every entity in
  an episode was linked to every memory created in that episode. Twenty entities
  × two memories = 40 links, with no textual evidence. Wiki pages then showed
  identical, unrelated facts on every entity page. Fixed by requiring the entity
  name to actually appear in the memory's text, evidence quote or subject.
- `POST /wiki/compile/:entityId` defaulted `entity_name` to the **entity id**, so
  page titles were UUIDs and the "memories that mention this entity" lookup could
  never match. Fixed by resolving the stored entity name.

## Recommended next steps

1. **Document-mode extraction.** Add an extraction mode for ingested documents
   that emits entity-centric facts — `subject = <entity>`, `predicate`, `object`
   — instead of user-frame facts. That is the single change that turns a news
   corpus into usable memories; today the graph is rich and the memory store is
   empty by design.
2. **Constrain relation types.** Replace the free-form relation with a small
   closed set plus a mapping for long-tail cases, and re-run this corpus to see
   `related_to` fall below ~10%.
3. **Compile the wiki after seeding** (with the link fix in place) so the graph
   is browsable as prose. `POST /wiki/compile-all` exists but costs one model call
   per entity — at 959 entities, target the top N by mention count first.
4. **Track orphans as a metric.** 12% of entities have no relationship at all;
   a rising orphan rate is an early signal that relationship extraction is
   degrading on a new domain.

