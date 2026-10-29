> **DESIGN DIRECTION SUPERSEDED (Charlie, 2026-10-29):** the aesthetic in this brief (ricord.ai, dark theme, gradients) is dead. The authoritative design spec is `docs/ui-redesign-spec.md` — white/monotone, Vercel/shadcn register, Geist family, graph-first. This brief still owns repo state, commit history and the remaining-features list; the spec owns all design decisions.

# Seme UI Redesign — Handover to Pi

Hermes is being shut down permanently; the Seme UI redesign work continues in a Pi session.
Read this file first, then survey repo state before acting — do not redo finished work.

## Goal (as Charlie stated it)

Charlie's words (Oct 22): "i wnat to make our webpage look more cool like @url:https://ricord.ai/".
Reference aesthetic: ricord.ai — dark, gradient hero text, gradient stat cards, feature sections,
modern polish. Target is the Seme web dashboard (apps/web), not the soapbox site.

## Design direction / decisions agreed

- Dark theme: near-black background (hsl 0 0% 4%), zinc/gray text, gradient accents.
  Gradient logo badge blue→purple; stat cards blue→cyan, purple→pink, emerald→teal, orange→red.
- Tailwind v4 + shadcn/ui primitives: Button, Card, Badge (initial), then Dialog, Table, Tabs, Toast.
- Hero section with gradient text ("Seme Memory Dashboard"), status badge, quick-action cards.
- Graph visualization route (/graph) with dependency-free force-directed SVG (drag, focus, neighborhood).
- Search page uses the real hybrid retrieval shape: memories / profile / graph / rules tabs.
- Dark tokens applied across all pages (memories, entities, wiki, search, tasks, submit).
- Password gate screen added in Seme styling (minimal; no redesign of anything else).

## What has already been done (files changed, pages built)

Commit 2aabf2b "Redesign Seme web dashboard: dark theme, gradient stat cards, hero section, quick actions" (3 files):
- apps/web/src/styles.css — dark theme vars + gradient-text utility
- apps/web/src/routes/__root.tsx — dark sticky header, gradient logo, pill nav
- apps/web/src/routes/index.tsx — hero, gradient stat cards, quick actions, recent lists

Commit 6629fc6 "feat(web): graph visualization, dark theme across pages, table/tabs/dialog/toast primitives" (18 files):
- src/components/GraphView.tsx — force-directed SVG graph (drag, focus, neighborhood, legend)
- src/components/ui/{dialog,table,tabs,toast}.tsx — new primitives
- src/routes/graph.tsx — new /graph route
- Dark tokens applied to memories, entities, wiki, search, tasks, submit
- search.tsx now uses real hybrid retrieval shape (memories/profile/graph/rules tabs)
- src/lib/api.ts extended: graph, retrieve, relationships, submitUrl; search endpoint fixed
- src/routes/__root.tsx: +Graph nav link, ToastProvider

Commit 73660fe "feat(api,web): gate deployed Seme behind shared password" (touched web):
- src/lib/api.ts + src/routes/__root.tsx: PasswordGate screen, sessionStorage key, 401 handling

Pages built (8 routes): Dashboard (/), Memories, Entities, Graph, Wiki, Search, Tasks, Submit.
UI primitives: button, card, badge, dialog, table, tabs, toast.
API client methods: health, memories, entities, wiki, tasks, search, submitText, submitUrl,
endSession, stats, profile, graph, retrieve, relationships.

## What remains / next steps

- Memory editing (edit/delete individual memories from the dashboard).
- Wiki browser in the UI (read/compile wiki pages; currently API-only).
- Further ricord.ai-style polish (feature sections, testimonials, etc.) — only dashboard + primitives done.
- More animated diagrams on the Seme side (entity extraction, auto-deprecation, etc.).
- Redeploy web to Fly (seme-web) after UI changes.
- Re-run Seme vs Mem0 benchmark with hybrid search to measure retrieval accuracy.
- Keep dark theme consistent; password gate styling already matches.

## Constraints Charlie set

- Reference aesthetic: ricord.ai (dark, gradient hero, stat cards, feature sections).
- Cost-conscious with paid APIs; shortest path to a working result; push back on spend used for diagnosis.
- When a task says "don't redesign" (e.g. password gate), keep Seme styling as-is and change nothing else.
- Professional practice / industry best practices; answer "is that on purpose?" with intended design.
- Publishing infrastructure detail (providers, regions, hostnames, DB topology, credentials) must never be
  written into repo/docs/commits/PRs — flag and stop.
- Skills must stay portable/dependency-free (Node 24, no npm deps) — standing convention.
- Deploy+seed run finished 05:08; both apps live (seme-api, seme-web on Fly); 100 BBC articles ingested
  (99 ok, 959 entities, 745 relationships, 2 memories).

## Repo state

HEAD 6908470 feat(api): document-mode extraction for ingested sources; working tree clean; branch main.
Password gate live (SEME_API_KEY on seme-api only); gate password at ~/.seme-gate-password (chmod 600).
