# Seme Feature Analysis: What's Missing from the Website

## Currently Documented on Website (index.html)

The website documents these 16 features:
1. Fact Extraction
2. Conflict Resolution
3. Profile Compilation
4. Decay & Compaction
5. Validation Gate
6. Self-Healing
7. Abstention Logic
8. Pause & Resume
9. Deletion & Privacy
10. Review Queue
11. Adaptation Store
12. Identity Core
13. Boundary Rules
14. Health Metrics
15. Sub-millisecond Performance
16. Sleep Job (step by step)

## NOT Documented on Website (implemented but missing)

### Core System Features
1. **Knowledge Graph** — Entities, relationships, N-hop traversal, shortest path, entity resolution, graph-augmented retrieval
2. **Knowledge Wiki** — Auto-generated per-entity pages, maturity levels (draft→stable→canonical), versioning, conflict detection
3. **MCP Server** — 14 tools via JSON-RPC over stdio (save, recall, get_context, correct, forget, graph_stats, wiki_search, wiki_recall, profile, list_memories, list_entities, sleep, pause, resume)
4. **Source Ingestion** — URL fetching, PDF text extraction, YouTube transcripts, text chunking, provenance tracking
5. **Hybrid Search** — Cross-layer search (turns + memories + wiki + graph), unified LLM-ready context, scoring/ranking, abstention
6. **KB Intelligence** — Challenge claims, surface patterns (emerge), bridge topics (connect), find contradictions, lint knowledge base
7. **KB Tasks** — Task management (create/read/update/delete), priority, due dates, status tracking, memory/entity linking
8. **Temporal Queries** — since/before/asOf filtering, observed_at range filtering, "as of" snapshots
9. **Auto-deprecation** — Stale fact detection, configurable thresholds per decay class, archived status
10. **Procedures** — SOPs, playbooks, prompts with trigger patterns, guards, steps, confidence scoring
11. **Per-memory Feedback** — Confidence adjustment, reinforcement tracking, feedback events per memory
12. **Data Import** — Restore from export bundle, skip/overwrite/merge strategies, GDPR-compliant
13. **Composio Integrations** — External service connections (Gmail, Slack, Notion, GitHub, etc.)

### Performance Improvements
14. **SQLite 64MB page cache** — Increased cache_size pragma for faster DB reads
15. **Parallel entity extraction** — Promise.all for chunked LLM calls (Nx speedup)
16. **Chunked entity extraction** — 6 turns per LLM call to avoid output truncation
17. **Markdown fence stripping** — Both extractors now strip ```json fences from LLM responses
18. **Removed hardcoded entity types** — Open-ended type system, no validation dictionary
19. **Haiku-only** — Removed Gemini support, Haiku is 7.5x cheaper and more reliable

### Architecture Improvements
20. **Monorepo structure** — apps/api + apps/web + shared docs
21. **TanStack Start web app** — React dashboard with shadcn/ui
22. **CORS middleware** — Restricted to known hosts
23. **Knowledge Wiki maturity levels** — draft → stable → canonical
24. **Entity type normalization** — Lowercase, trim, any string accepted

## Essay Topics (to be written)

Each essay should cover:
- The underlying computer science concepts
- The mechanisms and algorithms used
- The architecture and data flow
- Performance characteristics
- Trade-offs and design decisions

### Priority 1 (Core system)
1. Knowledge Graph — Entity resolution, graph traversal (BFS/DFS), pathfinding, graph-augmented retrieval
2. Hybrid Search — Cross-layer retrieval, scoring/ranking, abstention logic
3. Entity Extraction — LLM-based NER, chunking, validation, resolution
4. Auto-deprecation — Decay classes, staleness detection, threshold-based archiving

### Priority 2 (Advanced features)
5. Source Ingestion — Content extraction, chunking, provenance tracking
6. KB Intelligence — Pattern emergence, contradiction detection, topic bridging
7. Temporal Queries — Time-range filtering, asOf snapshots, bi-temporal modeling
8. Procedures — Trigger matching, guard evaluation, step execution
9. Knowledge Wiki — Page compilation, maturity levels, versioning
10. MCP Server — JSON-RPC protocol, tool exposure, client integration

### Priority 3 (Infrastructure)
11. Data Import/Export — Conflict resolution strategies, GDPR compliance
12. Composio Integrations — OAuth flows, service connection framework
13. Performance Optimizations — SQLite tuning, parallel extraction, caching
14. Per-memory Feedback — Confidence adjustment, reinforcement learning