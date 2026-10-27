# Memory System Benchmark: Seme vs Mem0

**Date**: October 27, 2026
**Seme version**: 0.1.0 (8 schema migrations, 40+ endpoints)
**Mem0 version**: 2.2.1 (OSS, Qdrant vector store)
**LLM**: Claude Haiku 4.5 (via OpenRouter) for both systems
**Embeddings**: OpenAI text-embedding-3-small (via OpenRouter)

## Test Setup

5 conversation turns, each containing 3-5 facts about a user named Charles:
1. "My name is Charles and I live in London. I work at Ponti Studios building iOS apps."
2. "I have a dog named Cyndi. She's a golden retriever. I also use TypeScript for all my projects."
3. "My partner Sarah works at Google. We moved to Edinburgh last month from London."
4. "I prefer dark mode in all my apps. I use Tailwind CSS and shadcn/ui for styling. My favorite editor is VS Code."
5. "I'm building a memory system called Seme. It uses SQLite for storage and Hono for the API. The frontend is TanStack Start with React."

Each turn was followed by 2 retrieval queries (10 total queries).

## Results

### Extraction

| Metric | Seme | Mem0 |
|--------|------|------|
| Total facts extracted | 44 | ~20 (5 turns × ~4 facts) |
| Total entities extracted | 28 | N/A (no entity graph) |
| Relationships extracted | 12 | N/A |
| Avg extraction time | ~0.0s (async) | ~4.0s (sync) |
| Entity types | Free-form (no dictionary) | Categories (personal_info, etc.) |

### Retrieval Accuracy

| Metric | Seme | Mem0 |
|--------|------|------|
| Correct / Total | 5/10 (50%) | 10/10 (100%) |
| Avg retrieval time | 0.003s | 0.958s |
| Retrieval method | FTS5 keyword + graph traversal | Vector similarity (Qdrant) |

### Missed Queries (Seme)

| Query | Expected | Why Missed |
|-------|----------|------------|
| Where does the user live now? | Edinburgh | FTS5 matched "live" but returned London (older fact) |
| What CSS framework does the user use? | Tailwind | Query doesn't contain "Tailwind" or "CSS" |
| What editor does the user use? | VS Code | Query doesn't contain "VS Code" or "editor" |
| What is the user building? | Seme | FTS5 matched "building" but returned different memory |
| What database does Seme use? | SQLite | Query contains "Seme" but FTS5 didn't match "SQLite" |

### Architecture Comparison

| Feature | Seme | Mem0 |
|---------|------|------|
| Storage | SQLite (single file) | Qdrant (vector DB) |
| Search | FTS5 + graph traversal + keyword | Vector similarity (cosine) |
| Knowledge graph | Yes (entities, relationships, paths) | No (vector-only) |
| Temporal queries | Yes (since/before/asOf) | No |
| Auto-deprecation | Yes (decay classes) | No |
| Source ingestion | Yes (URLs, PDFs, YouTube) | No |
| Wiki compilation | Yes (LLM-synthesized pages) | No |
| MCP server | Yes | Yes |
| Self-hosting | Yes (single binary) | Yes (requires Qdrant) |
| Cost per extraction | ~$0.001 (Haiku) | ~$0.001 (Haiku) |

## Analysis

### Seme Strengths
1. **Richer data model**: Entities, relationships, knowledge graph, wiki pages, temporal queries
2. **Faster retrieval**: 0.003s vs 0.958s (300x faster) — SQLite FTS5 vs vector DB
3. **Single-file storage**: No external database needed
4. **More features**: Auto-deprecation, source ingestion, KB intelligence, temporal queries
5. **Lower infrastructure**: No Qdrant, no Neo4j, just SQLite

### Seme Weaknesses
1. **Lower retrieval accuracy on semantic queries**: 50% vs 100% — FTS5 keyword matching misses semantic paraphrases
2. **No vector search**: Cannot find "Tailwind" when query says "CSS framework"
3. **Async extraction**: Returns immediately, may not be complete when queried

### Mem0 Strengths
1. **Higher retrieval accuracy**: 100% — vector similarity handles semantic queries
2. **Simpler API**: 4 lines to get started
3. **Mature ecosystem**: Large community, extensive docs

### Mem0 Weaknesses
1. **No knowledge graph**: Cannot traverse entity relationships
2. **No temporal queries**: Cannot ask "what did we know in March?"
3. **No auto-deprecation**: Stale facts accumulate
4. **Requires Qdrant**: Additional infrastructure
5. **Slower retrieval**: ~1s per query (vector DB overhead)

## Recommendations

1. **Add vector search to Seme**: Hybrid retrieval (FTS5 + vector similarity) would combine Seme's speed with Mem0's accuracy. Use SQLite's built-in vector extension or a lightweight embedding store.

2. **Improve FTS5 query expansion**: Add synonym expansion or query rewriting to handle semantic paraphrases.

3. **Make extraction synchronous option**: Add a `sync` flag to end_session for benchmarks and testing.

4. **Benchmark on standard datasets**: Run on LongMemEval or LoCoMo for comparable numbers with published results.