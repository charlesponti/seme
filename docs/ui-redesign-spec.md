# Seme Web — Redesign Spec (authoritative)

Status: APPROVED DIRECTION, Charlie, 2026-10-29. This spec supersedes the design
direction in `docs/pi-handover-ui-redesign.md`. That brief's repo state, commit
history and remaining-features list still stand; its aesthetic (ricord.ai, dark
theme, gradient hero, gradient stat cards) is DEAD and must not be preserved
or carried forward. If this spec and any existing code disagree, this spec wins.

Scope: `apps/web` only. No backend or API changes.

## 0. What this is

Seme's dashboard is the observatory for an AI memory engine: the place a
developer inspects what the engine remembers, verifies where a memory came
from, and explores the entity graph the memories form. The register is a
precision developer tool — Vercel / shadcn minimalism. Restraint is the
brand: hairlines and typography do the work that color and shadow do
elsewhere. The graph is the centerpiece and must feel like a map of a
memory, not a diagram.

## 1. Design system — monotone light

### Color (complete palette — nothing outside this list)

- Background: `#ffffff`
- Subtle background (table stripes, skeleton, inset areas): `#fafafa`
- Hover background: `#f5f5f5`
- Border (hairline, default): `#eaeaea`
- Border strong (inputs, emphasized dividers): `#d4d4d4`
- Text primary: `#171717`
- Text secondary: `#666666`
- Text tertiary (metadata, placeholders): `#888888`
- Black (selection, primary buttons, key emphasis): `#000000`
- Faded graph elements: `#e5e5e5`

Rules: white background on every route. NO color hues anywhere — no blue
links, no green/red status, no accent color. Status is expressed in
grayscale plus words/icons. NO CSS gradients anywhere in the app (the string
`gradient` must not appear in web styles). NO dark mode this pass — the
existing dark theme tokens are deleted, not toggled. Shadows: none on cards
or panels; only floating overlays (dropdowns, tooltips, toasts) may use
`0 4px 16px rgba(0,0,0,0.08)`.

### Typography — Geist family, self-hosted

Load Geist Sans, Geist Mono and Geist Serif from the `geist` npm package (or
bundled font files in the repo). No Google Fonts or any external font CDN at
runtime.

- **Geist Sans** — all UI chrome: nav, buttons, table text, labels, forms.
- **Geist Mono** — data: IDs, timestamps, counts and stats numerals, code,
  graph node labels, metadata rows. Always `font-variant-numeric: tabular-nums`
  for numerals anywhere (any family).
- **Geist Serif** — reading surfaces and display type: page display headings,
  memory content in detail views, the wiki reading pane, the dashboard title.
  Memory is literature; chrome is sans, content is serif.

Scale (px / line-height): display 32/40 (serif, letter-spacing -0.02em),
h1 24/32 (serif on content pages, sans-medium on tool pages — pick per route
below), body 14/20, small 12/16, mono-data 12/18. Headings weight 500–600,
never 700+. Body text never pure black except emphasis — primary text is
`#171717`.

### Geometry and motion

Radius: 6px controls, 8px panels/cards. Borders 1px hairlines. Spacing on a
4px grid (4/8/12/16/24/32/48). Content max-width 1200px centered, 24px page
gutters — EXCEPT the graph route, which is full-bleed. Motion: 120–200ms
ease-out, opacity/transform only; no bounce, no spring, no parallax.
`prefers-reduced-motion` disables non-essential transitions.

### Chrome (all routes)

Top bar only, no sidebar: white, 1px bottom hairline. Left: wordmark "Seme"
(Geist Serif, 18px) + nav links (Dashboard, Memories, Entities, Graph, Wiki,
Search, Tasks, Submit) in 14px sans, `#666` inactive, `#000` + weight 500
active. Right: API status (small gray dot + "API" label; unreachable = hollow
dot + "API offline" text — grayscale, never red) and total memory/entity
counts in mono. The bar is 48px tall, not sticky-blurred — plain white,
sticky position allowed.

## 2. The graph (route /graph) — the centerpiece, spec'd hard

Data reality: 959 entities / 745 relationships today (seeded dataset).
Design and acceptance target: **5,000 nodes / 10,000 edges**.

### Rendering

- Canvas 2D or WebGL renderer. DOM/SVG node rendering (current
  `GraphView.tsx`) does not meet the performance bar and is replaced.
  A single graph library dependency is permitted if it is the shortest path
  (e.g. sigma.js); a hand-rolled canvas renderer is equally acceptable.
  Judge only against the acceptance criteria below.
- Device-pixel-ratio aware, capped at 2. Render on demand: no animation
  loop while the graph is idle. Pause rendering when the tab is hidden or
  the route is not mounted.
- Force-directed layout (Barnes–Hut or equivalent), computed once per
  dataset, then frozen. Node positions are persisted (localStorage, keyed by
  a hash of node/edge IDs) so the map is spatially stable across visits — a
  map that rearranges itself every load is a failed map. An explicit
  "Re-layout" control in the corner re-runs the simulation. First-compute
  settle animation ≤ 1.5s, then fully static.

### Initial view and progressive disclosure

- Initial render shows the top 150 nodes by degree, laid out as the map.
- Everything else enters by expansion (below). A mono caption bottom-right
  states what is on screen, e.g. `150 of 959 entities · 212 of 745 edges`.

### Interactions (each one is an acceptance item)

1. **Zoom**: mouse wheel / pinch zooms toward the cursor, range 0.1×–4×.
   On-screen + / − / reset buttons (bottom-left, white, hairline border).
2. **Pan**: drag empty canvas. Cursor: grab / grabbing.
3. **Drag node**: node follows the pointer, its edges flex with it; on
   release it stays where dropped (position persisted). No global re-layout.
4. **Click node → open**: selects the node and opens the detail panel
   (below) listing ALL of its connections. The node's neighborhood lights
   up: node + neighbors + their connecting edges go dark; everything else
   fades to `#e5e5e5` with labels off.
5. **Click empty canvas** → deselect, panel closes, fade restores.
6. **Double-click node → expand**: reveals that node's next ring of
   neighbors not yet on screen (with a brief fade/scale-in ≤ 200ms), and
   they join the map permanently until reset. Double-click an expanded
   leaf can collapse its ring if nothing else depends on it — if collapse
   is risky, omit collapse; expansion is the requirement.
7. **Hover node**: pointer cursor + tooltip (white card, hairline border):
   entity name (sans 13px), type and degree (mono 11px, `#666`).
8. **Search-to-node**: input in the graph toolbar; results dropdown
   (name + type); choosing one animates the camera to the node (≤ 600ms
   ease-out), selects it, opens its panel, expanding rings as needed so the
   node is on the map.
9. **Keyboard**: Esc = deselect/close panel; + / − = zoom; 0 = reset view.
10. **Panel connection rows are navigation**: clicking a connection flies
    to and selects that entity.

### Visual encoding (monotone only)

- Node radius ∝ sqrt(degree), clamped 3–14px.
- Default node: white fill, 1.5px `#171717` ring.
- Selected node: solid `#000` fill.
- Neighbor of selected: white fill, 2px `#000` ring.
- Faded (non-neighbor during selection): `#e5e5e5` fill, no ring.
- Edges: `#d9d9d9`, 1px. Edges touching the selected node: `#171717`, 1.5px.
- Labels: Geist Mono 11px `#171717` on a white halo (paint-order stroke or
  text shadow in white). Labels are shown ONLY for: the selected node and
  its neighbors; the hovered node; and nodes with degree ≥ 10 while zoom
  ≥ 1.5×. All other labels hidden — declutter is a feature.
- Edge hover while a node is selected: tooltip shows the relationship type.
- Legend (bottom-right, mono 11px `#666`): `○ entity · size = connections`.

### Detail panel (right side of the graph route)

320px, white, 1px left hairline, slides in 150ms. Contents:

- Entity name — Geist Serif 20px.
- Type + degree — mono 12px `#666`, e.g. `PERSON · 23 CONNECTIONS`.
- Buttons row: `Expand neighbors`, `View entity` (→ entity detail route).
- **Connections** — the full list, grouped by relationship type with mono
  group headers (`WORKS_AT · 3`), one row per connection: related entity
  name + a quiet `→` affordance. The list scrolls; it is never truncated
  or sampled — ALL connections, however many.
- Footer: provenance line if the API exposes it (mono 11px `#888`).

### Graph performance acceptance (measured on Charlie's M1 Max, dev build)

- Seeded dataset (959/745): continuous pan + zoom for 10s with no frame
  over 50ms; node drag equally smooth.
- First paint of the map < 1s after graph data has loaded.
- Expand operation < 100ms for a node with ≤ 200 neighbors.
- Synthetic 5,000/10,000 dataset: pan/zoom remains interactive (≥ 30fps).

## 3. Routes

**Dashboard (/)** — Serif display title "Seme Memory Dashboard" is replaced
by a quiet sans header: this is a tool, not a landing page. Top: a stat band
of 4 cells divided by hairlines (Memories, Entities, Relationships, Wiki
pages) — numeral Geist Mono 28px `#171717`, label 12px `#888` uppercase
letterspaced. Below: two hairline tables side by side (stacked on narrow):
Recent memories and Recent entities (name, type mono, time mono). Quick
actions as plain bordered buttons (Submit memory, Run search, Open graph).
No hero, no gradient cards, no feature sections.

**Memories** — Table: content excerpt (sans 14, truncated 1 line), type,
confidence (mono, as a plain number), created (mono), source (mono).
Row click → detail: content in Geist Serif 17/28, metadata as a mono
d definition list, provenance shown verbatim (Seme's validation gate is a
feature — surface it), related entities as quiet links into the graph
(focused on that entity).

**Entities** — Table: name, type, degree (mono, right-aligned), last seen
(mono). Sortable by degree and name. Row click → entity detail: serif name,
mono metadata, its memories list, its connections list (same component
shape as the graph panel list), and an "Open in graph" button.

**Wiki** — Two panes divided by a hairline: left index (page titles, 14px,
active = `#000` weight 500 on `#fafafa`), right reading pane in Geist Serif
17/28, max-width 680px. Compiled-from sources listed at the foot in mono 11px `#888`.

**Search** — Keep the real hybrid retrieval shape exactly: tabs Memories /
Profile / Graph / Rules. Query input large (16px) with hairline border.
Results as hairline-divided lists, mono metadata. A Graph-tab result opens
/graph with that entity selected and centered.

**Tasks** — The review queue as a table: item, reason, age (mono).
Approve / Reject as small bordered buttons (Approve may be solid black;
Reject plain). No colored badges — state shown as mono text.

**Submit** — Single centered column (max-width 560px): serif heading
"Add to memory", textarea + URL field, black submit button. Result state
inline below the form in mono.

**Password gate** — Behavior identical to today (sessionStorage key, 401 →
re-prompt). Restyle only: centered 360px card, hairline border, serif
"Seme", mono label, black button.

## 4. States everywhere

- Loading: skeleton blocks in `#f5f5f5` holding the layout (no spinners
  except inside buttons).
- Empty: one line of `#888` text, centered in the region. No illustrations.
- Error: hairline-bordered box, primary text states what failed, a Retry
  bordered button. Never a red panel.
- All numbers tabular. All timestamps mono. All-caps labels letterspaced
  0.08em at 11–12px in `#888`.

## 5. Invariants and non-goals

- No API changes, no new endpoints. Graph expansion works from the existing
  graph/relationships API surface (`src/lib/api.ts`); check what exists
  before assuming a fetch per expansion.
- Every existing route and feature survives: dashboard, memories, entities,
  graph, wiki, search (4 tabs), tasks, submit, password gate.
- The words "gradient", dark-theme tokens, and ricord.ai styling are removed
  from `apps/web`, not left dormant.
- Deploying to Fly is OUT of this pass. Local dev only until Charlie says
  deploy.
- No infra detail in docs/commits/PRs (standing rule).

## 6. Build order (commit per stage)

1. Tokens, fonts, chrome (top bar), primitives restyle (button/card/badge/
   dialog/table/tabs/toast in the new system).
2. Graph rewrite against §2 (biggest risk — do it before page polish).
3. Pages in order: Dashboard, Memories, Entities, Wiki, Search, Tasks,
   Submit.
4. Password gate restyle.
5. Walk the acceptance checklist below; fix until every box is honestly
   checked.

## 7. Acceptance checklist (binary — all must be true)

- [ ] Every route's background is `#ffffff`; no dark theme remains.
- [ ] The string `gradient` appears nowhere in `apps/web` styles.
- [ ] No hue (non-grayscale) color value anywhere in `apps/web` styles.
- [ ] Geist Sans/Mono/Serif load from the bundled package; zero external
      font requests in the network tab.
- [ ] Memory content and wiki pages render in Geist Serif; IDs/counts/
      timestamps render in Geist Mono with tabular numerals.
- [ ] Graph: all 10 interactions in §2 work as written, incl. panel listing
      ALL connections of the most-connected entity in the seeded dataset.
- [ ] Graph: layout is stable across reloads (same node positions) until
      Re-layout is pressed.
- [ ] Graph: performance criteria in §2 met on the seeded dataset.
- [ ] Search keeps its 4 hybrid tabs; graph results deep-link into a
      focused graph.
- [ ] Password gate behavior unchanged (401 → re-prompt; sessionStorage).
- [ ] Nothing deployed to Fly.
