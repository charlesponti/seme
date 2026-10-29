import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { semeApi } from '../lib/api'
import {
  buildGraphIndex,
  connectionsFor,
  groupConnections,
  type Connection,
  type GraphEntity,
  type GraphIndex,
  type GraphRelationship,
} from '../lib/graphModel'
import { ConnectionList } from '../components/graph/ConnectionList'
import { formatDay } from '../lib/format'

export const Route = createFileRoute('/entities')({
  validateSearch: (search: Record<string, unknown>): { entity?: string } => ({
    entity: typeof search.entity === 'string' ? search.entity : undefined,
  }),
  component: EntitiesPage,
})

interface MemoryRow {
  id: string
  kind?: string
  value_text?: string
  confidence?: number
  observed_at?: string
}

type Snapshot = { entities: GraphEntity[]; relationships: GraphRelationship[] }
type SortKey = 'degree' | 'name' | 'last_seen'
type SortDir = 'asc' | 'desc'

const EMPTY_INDEX: GraphIndex = buildGraphIndex([], [])
const PAGE_SIZE = 50

// Hairline dividers without a background-gap grid: left border except at the
// start of each row, top border on the second row below sm.
const SUMMARY_BORDERS = [
  'border-l-0',
  '',
  'border-l-0 border-t sm:border-l sm:border-t-0',
  'border-t sm:border-t-0',
]

const SORT_LABELS: Record<SortKey, string> = {
  degree: 'Degree',
  name: 'Name',
  last_seen: 'Last seen',
}

function EntitiesPage() {
  const { entity: entityId } = Route.useSearch()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('degree')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await semeApi.graphSnapshot()
      setSnapshot({
        entities: Array.isArray(data?.entities) ? data.entities : [],
        relationships: Array.isArray(data?.relationships) ? data.relationships : [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // A deep link lands on a detail view; start that view at the top of the page.
  useEffect(() => {
    if (entityId) window.scrollTo(0, 0)
  }, [entityId])

  const index = useMemo(
    () => (snapshot ? buildGraphIndex(snapshot.entities, snapshot.relationships) : EMPTY_INDEX),
    [snapshot],
  )

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const e of index.entities) if (e.type) set.add(e.type)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [index])

  const summary = useMemo(() => {
    let mostConnected: GraphEntity | null = null
    let mostDegree = 0
    for (const e of index.entities) {
      const d = index.degree.get(e.id) ?? 0
      if (d > mostDegree) {
        mostDegree = d
        mostConnected = e
      }
    }
    return {
      entities: index.entities.length,
      types: types.length,
      relationships: index.relationships.length,
      mostConnected,
      mostDegree,
    }
  }, [index, types.length])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = index.entities.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    })

    const sign = sortDir === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      if (sortKey === 'name') return sign * a.name.localeCompare(b.name)
      if (sortKey === 'last_seen') {
        const ta = a.last_seen_at ? Date.parse(a.last_seen_at) : 0
        const tb = b.last_seen_at ? Date.parse(b.last_seen_at) : 0
        if (ta !== tb) return sign * (ta - tb)
        return a.name.localeCompare(b.name)
      }
      const da = index.degree.get(a.id) ?? 0
      const db = index.degree.get(b.id) ?? 0
      if (da !== db) return sign * (da - db)
      return a.name.localeCompare(b.name)
    })
    return filtered
  }, [index, query, typeFilter, sortKey, sortDir])

  useEffect(() => {
    setPage(1)
  }, [query, typeFilter, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * PAGE_SIZE
  const pageRows = rows.slice(start, start + PAGE_SIZE)

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  if (entityId) {
    if (loading) {
      return (
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-[#f5f5f5]" />
          <div className="h-8 w-80 rounded bg-[#f5f5f5]" />
          <div className="h-2 w-56 rounded bg-[#f5f5f5]" />
        </div>
      )
    }
    if (error) {
      return <ErrorBox message={error} onRetry={load} />
    }
    const entity = index.byId.get(entityId)
    if (!entity) {
      return (
        <div>
          <BackLink />
          <p className="mt-4 text-[13px] text-[#888888]">No entity with that ID.</p>
        </div>
      )
    }
    return <EntityDetail index={index} entity={entity} />
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">Entities</h1>
        <p className="mt-1 font-mono text-[12px] leading-[18px] tabular-nums text-[#888888]">
          {loading ? '—' : `${rows.length} of ${index.entities.length} entities`}
        </p>
      </div>

      {loading ? (
        <div className="space-y-px border-y border-[#eaeaea]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-11 w-full bg-[#fafafa]" />
          ))}
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : index.entities.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-[#888888]">No entities found.</p>
      ) : (
        <>
          <SummaryStrip summary={summary} />
          <Toolbar
            query={query}
            onQuery={setQuery}
            types={types}
            typeFilter={typeFilter}
            onType={setTypeFilter}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={setSort}
          />
          {rows.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-[#888888]">No entities match this filter.</p>
          ) : (
            <>
              <EntitiesTable rows={pageRows} index={index} />
              <Pager
                page={currentPage}
                pageCount={pageCount}
                from={start + 1}
                to={start + pageRows.length}
                total={rows.length}
                onPage={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

function SummaryStrip({
  summary,
}: {
  summary: {
    entities: number
    types: number
    relationships: number
    mostConnected: GraphEntity | null
    mostDegree: number
  }
}) {
  return (
    <dl className="grid grid-cols-2 border-y border-[#eaeaea] font-mono sm:grid-cols-4">
      <div className={`border-l border-[#eaeaea] bg-white px-4 py-3 ${SUMMARY_BORDERS[0]}`}>
        <dt className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Entities</dt>
        <dd className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-[#171717]">
          {summary.entities.toLocaleString('en-US')}
        </dd>
      </div>
      <div className={`border-l border-[#eaeaea] bg-white px-4 py-3 ${SUMMARY_BORDERS[1]}`}>
        <dt className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Types</dt>
        <dd className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-[#171717]">{summary.types}</dd>
      </div>
      <div className={`border-l border-[#eaeaea] bg-white px-4 py-3 ${SUMMARY_BORDERS[2]}`}>
        <dt className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Relationships</dt>
        <dd className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-[#171717]">
          {summary.relationships.toLocaleString('en-US')}
        </dd>
      </div>
      <div className={`min-w-0 border-l border-[#eaeaea] bg-white px-4 py-3 ${SUMMARY_BORDERS[3]}`}>
        <dt className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Most connected</dt>
        <dd className="mt-0.5 truncate text-[13px] leading-[18px] text-[#171717]">
          {summary.mostConnected ? (
            <>
              {summary.mostConnected.name}{' '}
              <span className="tabular-nums text-[#888888]">· {summary.mostDegree}</span>
            </>
          ) : (
            '—'
          )}
        </dd>
      </div>
    </dl>
  )
}

function Toolbar({
  query,
  onQuery,
  types,
  typeFilter,
  onType,
  sortKey,
  sortDir,
  onSort,
}: {
  query: string
  onQuery: (value: string) => void
  types: string[]
  typeFilter: string
  onType: (value: string) => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const selectClass =
    'h-7 rounded-[6px] border border-[#d4d4d4] bg-white px-2 font-mono text-[11px] uppercase tracking-[0.04em] text-[#171717] focus:border-[#171717] focus:outline-none'

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search entities by name"
        aria-label="Search entities by name"
        className="h-7 w-60 rounded-[6px] border border-[#d4d4d4] bg-white px-2 text-[12px] text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
      />
      <select
        value={typeFilter}
        onChange={(e) => onType(e.target.value)}
        aria-label="Filter by entity type"
        className={selectClass}
      >
        <option value="all">All types</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <select
          value={sortKey}
          onChange={(e) => onSort(e.target.value as SortKey)}
          aria-label="Sort entities"
          className={selectClass}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              Sort: {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#d4d4d4] bg-white font-mono text-[12px] text-[#171717] hover:bg-[#f5f5f5]"
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  )
}

function EntitiesTable({ rows, index }: { rows: GraphEntity[]; index: GraphIndex }) {
  const navigate = useNavigate()

  return (
    <div className="mt-3 overflow-x-auto border-y border-[#eaeaea]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#eaeaea] bg-white">
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Name</th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Type</th>
            <th className="px-3 py-2 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">
              Degree
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">
              Mentions
            </th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.id}
              role="link"
              tabIndex={0}
              aria-label={`Open ${e.name}`}
              onClick={() => navigate({ to: '/entities', search: { entity: e.id } })}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  navigate({ to: '/entities', search: { entity: e.id } })
                }
              }}
              className="cursor-pointer border-b border-[#eaeaea] last:border-0 hover:bg-[#f5f5f5] focus:bg-[#f5f5f5] focus:outline-none"
            >
              <td className="px-3 py-2.5 text-[13px] leading-5 text-[#171717]">{e.name}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] uppercase leading-[18px] tracking-[0.04em] text-[#666666]">
                {e.type}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12px] leading-[18px] tabular-nums text-[#666666]">
                {index.degree.get(e.id) ?? 0}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12px] leading-[18px] tabular-nums text-[#666666]">
                {typeof e.mention_count === 'number' ? e.mention_count : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] leading-[18px] tabular-nums text-[#666666]">
                {formatDay(e.last_seen_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pager({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number
  pageCount: number
  from: number
  to: number
  total: number
  onPage: (page: number) => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[11px] leading-[18px] tabular-nums text-[#888888]">
        {from}–{to} of {total} · page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="h-7 rounded-[6px] border border-[#d4d4d4] bg-white px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#171717] hover:bg-[#f5f5f5] disabled:opacity-40"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          className="h-7 rounded-[6px] border border-[#d4d4d4] bg-white px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#171717] hover:bg-[#f5f5f5] disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function EntityDetail({ index, entity }: { index: GraphIndex; entity: GraphEntity }) {
  const navigate = useNavigate()
  const connections = useMemo(() => connectionsFor(index, entity.id), [index, entity.id])
  const degree = index.degree.get(entity.id) ?? 0
  const aliases = entity.aliases ?? []

  const [memories, setMemories] = useState<MemoryRow[] | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)

  // There is no entity→memories endpoint in the API; the existing memories
  // search is the only supported lookup, so show what mentions this entity.
  useEffect(() => {
    let cancelled = false
    setMemories(null)
    setMemoryError(null)
    semeApi
      .memories({ search: entity.name, limit: '50' })
      .then((data) => {
        if (cancelled) return
        setMemories(Array.isArray(data?.memories) ? data.memories : [])
      })
      .catch((e) => {
        if (cancelled) return
        setMemories([])
        setMemoryError(e instanceof Error ? e.message : 'Failed to load memories')
      })
    return () => {
      cancelled = true
    }
  }, [entity.name])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[#eaeaea] pb-6">
        <div className="min-w-0">
          <BackLink />
          <h1 className="mt-2 break-words font-serif text-[32px] leading-10 tracking-[-0.02em] text-[#171717]">
            {entity.name}
          </h1>
          <p className="mt-1 font-mono text-[12px] leading-[18px] uppercase tracking-[0.04em] text-[#666666] tabular-nums">
            {entity.type} · {degree} {degree === 1 ? 'connection' : 'connections'} · last seen{' '}
            {formatDay(entity.last_seen_at)}
          </p>
          {aliases.length > 0 && (
            <p className="mt-1 font-mono text-[11px] leading-[18px] text-[#888888]">aka {aliases.join(' · ')}</p>
          )}
          {entity.description && (
            <p className="mt-3 max-w-[680px] text-[14px] leading-5 text-[#666666]">{entity.description}</p>
          )}
        </div>
        <Link
          to="/graph"
          search={{ focus: entity.id }}
          className="inline-flex h-8 shrink-0 items-center rounded-[6px] bg-black px-3 text-[12px] font-medium text-white hover:bg-[#171717]"
        >
          Open in graph
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">
            Memories · {memories ? memories.length : '—'}
          </h2>
          {memoryError ? (
            <p className="py-2 text-[12px] text-[#888888]">Could not load memories: {memoryError}</p>
          ) : memories === null ? (
            <div className="space-y-px">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 w-full bg-[#fafafa]" />
              ))}
            </div>
          ) : memories.length === 0 ? (
            <p className="py-2 text-[12px] text-[#888888]">No memories mention this entity.</p>
          ) : (
            <ul className="border-t border-[#eaeaea]">
              {memories.map((m) => (
                <li key={m.id} className="border-b border-[#eaeaea] py-3">
                  <p className="text-[14px] leading-5 text-[#171717]">{m.value_text}</p>
                  <p className="mt-1 font-mono text-[11px] leading-[18px] text-[#888888] tabular-nums">
                    {[m.kind, typeof m.confidence === 'number' ? m.confidence.toFixed(2) : null, formatDay(m.observed_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 font-mono text-[11px] leading-[18px] text-[#888888]">
            Name-search approximation — the API exposes no entity→memories lookup.
          </p>
        </section>

        <section className="min-w-0 lg:border-l lg:border-[#eaeaea] lg:pl-8">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">
            Connections · {connections.length}
          </h2>
          <ConnectionTypes connections={connections} />
          <ConnectionList
            connections={connections}
            onNavigate={(id) => navigate({ to: '/entities', search: { entity: id } })}
          />
        </section>
      </div>
    </div>
  )
}

function ConnectionTypes({ connections }: { connections: Connection[] }) {
  const groups = useMemo(() => groupConnections(connections), [connections])
  if (groups.length === 0) return null

  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b border-[#eaeaea] pb-2 font-mono text-[11px] uppercase leading-[18px] tracking-[0.04em] text-[#888888]">
      {groups.map((group) => (
        <span key={group.type}>
          {group.type} <span className="tabular-nums text-[#171717]">{group.rows.length}</span>
        </span>
      ))}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/entities"
      className="inline-flex items-center font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888] hover:text-[#171717]"
    >
      ← All entities
    </Link>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md rounded-[8px] border border-[#eaeaea] p-4">
      <p className="text-[13px] text-[#171717]">Could not load entities: {message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 h-8 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
      >
        Retry
      </button>
    </div>
  )
}
