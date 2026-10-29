import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { semeApi } from '../lib/api'
import {
  buildGraphIndex,
  connectionsFor,
  topByDegree,
  visibleEdgeCount,
  type GraphEntity,
  type GraphIndex,
  type GraphRelationship,
} from '../lib/graphModel'
import { GraphCanvas, type GraphCanvasHandle } from '../components/graph/GraphCanvas'
import { DetailPanel } from '../components/graph/DetailPanel'
import { useGraphLayout } from '../components/graph/useGraphLayout'

export const Route = createFileRoute('/graph')({
  validateSearch: (search: Record<string, unknown>): { entity?: string; focus?: string } => ({
    entity: typeof search.entity === 'string' ? search.entity : undefined,
    focus: typeof search.focus === 'string' ? search.focus : undefined,
  }),
  component: GraphPage,
})

const INITIAL_NODES = 150

type GraphPageSearch = { entity?: string; focus?: string }

const EMPTY_INDEX: GraphIndex = buildGraphIndex([], [])

function GraphPage() {
  const { entity, focus } = Route.useSearch() as GraphPageSearch
  // /graph?focus=<id> is the canonical deep link (entity page, search results).
  // /graph?entity=<id> is kept as an alias for older links.
  const deepLinkId = focus ?? entity

  const [snapshot, setSnapshot] = useState<{ entities: GraphEntity[]; relationships: GraphRelationship[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const canvasRef = useRef<GraphCanvasHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const deepLinkDone = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const snap = await semeApi.graphSnapshot()
      setSnapshot({
        entities: Array.isArray(snap?.entities) ? snap.entities : [],
        relationships: Array.isArray(snap?.relationships) ? snap.relationships : [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the graph')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const index = useMemo(
    () => (snapshot ? buildGraphIndex(snapshot.entities, snapshot.relationships) : EMPTY_INDEX),
    [snapshot],
  )

  const layout = useGraphLayout(index)
  const points = layout.points

  // Initial view: top 150 by degree
  useEffect(() => {
    if (index.entities.length === 0) {
      setVisible(new Set())
      return
    }
    setVisible(new Set(topByDegree(index, INITIAL_NODES)))
  }, [index])

  const expand = useCallback(
    (id: string) => {
      setVisible((current) => {
        const next = new Set(current)
        next.add(id)
        for (const neighbour of index.neighbours.get(id) ?? []) next.add(neighbour)
        return next
      })
    },
    [index],
  )

  const ensureVisible = useCallback(
    (id: string): boolean => {
      if (!index.byId.has(id)) return false
      setVisible((current) => {
        if (current.has(id)) return current
        const next = new Set(current)
        next.add(id)
        for (const neighbour of index.neighbours.get(id) ?? []) next.add(neighbour)
        return next
      })
      return true
    },
    [index],
  )

  const focusEntity = useCallback(
    (id: string) => {
      if (!ensureVisible(id)) return
      setSelectedId(id)
      requestAnimationFrame(() => canvasRef.current?.flyTo(id))
    },
    [ensureVisible],
  )

  // Deep link: /graph?focus=<id> (entity page, search results), with
  // /graph?entity=<id> as a legacy alias. Selects the entity, centers it,
  // opens its panel, and expands its ring if it is outside the initial view.
  useEffect(() => {
    if (deepLinkDone.current === deepLinkId) return
    if (!deepLinkId || !points) return
    if (!index.byId.has(deepLinkId)) return
    deepLinkDone.current = deepLinkId
    focusEntity(deepLinkId)
  }, [deepLinkId, points, index, focusEntity])

  const selected = selectedId ? index.byId.get(selectedId) ?? null : null
  const connections = useMemo(
    () => (selectedId ? connectionsFor(index, selectedId) : []),
    [index, selectedId],
  )
  const degree = selectedId ? index.degree.get(selectedId) ?? 0 : 0

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return index.entities
      .filter((e) => e.name.toLowerCase().includes(q) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(q)))
      .sort((a, b) => (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0))
      .slice(0, 8)
  }, [index, query])

  const choose = useCallback(
    (id: string) => {
      setSearchOpen(false)
      setQuery('')
      searchRef.current?.blur()
      focusEntity(id)
    },
    [focusEntity],
  )

  const edgeCount = visibleEdgeCount(index, visible)

  return (
    <div className="relative h-full w-full bg-white">
      <div className="absolute inset-0">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="w-64 space-y-2">
              <div className="h-2 w-full rounded bg-[#f5f5f5]" />
              <div className="h-2 w-3/4 rounded bg-[#f5f5f5]" />
              <div className="h-2 w-1/2 rounded bg-[#f5f5f5]" />
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-md rounded-lg border border-[#eaeaea] p-4">
              <p className="text-sm text-[#171717]">Could not load the graph: {error}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 h-8 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
              >
                Retry
              </button>
            </div>
          </div>
        ) : index.entities.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[#888888]">No entities yet — submit some text to build the graph.</p>
          </div>
        ) : (
          <GraphCanvas
            ref={canvasRef}
            index={index}
            points={points}
            visible={visible}
            selectedId={selectedId}
            panelOpen={selectedId !== null}
            onSelect={setSelectedId}
            onExpand={expand}
            persistNode={layout.persistNode}
          />
        )}

        {!loading && !error && index.entities.length > 0 && !points && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">Laying out the map…</span>
          </div>
        )}

        <DetailPanel
          entity={selected}
          connections={connections}
          degree={degree}
          onClose={() => setSelectedId(null)}
          onExpand={expand}
          onNavigate={focusEntity}
        />
      </div>

      {!loading && !error && index.entities.length > 0 && (
        <>
          {/* Search */}
          <div className="absolute left-4 top-4 z-10 w-[280px]">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results.length > 0) choose(results[0].id)
                if (e.key === 'Escape') {
                  setSearchOpen(false)
                  searchRef.current?.blur()
                }
              }}
              placeholder="Search entities"
              aria-label="Search entities"
              className="h-8 w-full rounded-[6px] border border-[#d4d4d4] bg-white px-2.5 text-[13px] text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
            />
            {searchOpen && results.length > 0 && (
              <div
                className="mt-1 overflow-hidden rounded-md border border-[#eaeaea] bg-white"
                style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
              >
                {results.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => choose(e.id)}
                    className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left hover:bg-[#f5f5f5]"
                  >
                    <span className="truncate text-[13px] text-[#171717]">{e.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-[#888888]">{e.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={() => layout.relayout()}
              disabled={layout.running}
              className="h-7 rounded-[6px] border border-[#eaeaea] bg-white px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#171717] disabled:opacity-50"
            >
              {layout.running ? 'Laying out…' : 'Re-layout'}
            </button>
            <div className="flex flex-col overflow-hidden rounded-[6px] border border-[#eaeaea] bg-white">
              {[
                { label: '+', action: () => canvasRef.current?.zoomBy(1.25), aria: 'Zoom in' },
                { label: '−', action: () => canvasRef.current?.zoomBy(0.8), aria: 'Zoom out' },
                { label: '0', action: () => canvasRef.current?.resetView(), aria: 'Reset view' },
              ].map((btn, i) => (
                <button
                  key={btn.label}
                  type="button"
                  aria-label={btn.aria}
                  onClick={btn.action}
                  className={`flex h-7 w-7 items-center justify-center font-mono text-[12px] text-[#171717] hover:bg-[#f5f5f5] ${
                    i > 0 ? 'border-t border-[#eaeaea]' : ''
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Legend + caption — shift clear of the open panel */}
          <div
            className="pointer-events-none absolute bottom-4 z-10 flex flex-col items-end gap-1 transition-[right] duration-150 ease-out motion-reduce:transition-none"
            style={{ right: selectedId ? 336 : 16 }}
          >
            <div className="font-mono text-[11px] leading-[18px] text-[#666666]">○ entity · size = connections</div>
            <div className="font-mono text-[11px] leading-[18px] text-[#666666] tabular-nums">
              {visible.size} of {index.entities.length} entities · {edgeCount} of {index.relationships.length} edges
            </div>
          </div>
        </>
      )}
    </div>
  )
}
