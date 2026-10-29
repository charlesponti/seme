import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { semeApi } from '../lib/api'
import {
  buildGraphIndex,
  connectionsFor,
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
type SortKey = 'degree' | 'name'
type SortDir = 'asc' | 'desc'

const EMPTY_INDEX: GraphIndex = buildGraphIndex([], [])

function EntitiesPage() {
  const { entity: entityId } = Route.useSearch()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('degree')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  const rows = useMemo(() => {
    const all = index.entities.slice()
    const sign = sortDir === 'asc' ? 1 : -1
    all.sort((a, b) => {
      if (sortKey === 'name') return sign * a.name.localeCompare(b.name)
      const da = index.degree.get(a.id) ?? 0
      const db = index.degree.get(b.id) ?? 0
      if (da !== db) return sign * (da - db)
      return a.name.localeCompare(b.name)
    })
    return all
  }, [index, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
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
        <h2 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">Entities</h2>
        <p className="mt-1 font-mono text-[12px] leading-[18px] text-[#888888] tabular-nums">
          {loading ? '—' : rows.length} entities in the knowledge graph
        </p>
      </div>

      {loading ? (
        <div className="space-y-px border border-[#eaeaea]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-11 w-full bg-[#fafafa]" />
          ))}
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-[#888888]">No entities found.</p>
      ) : (
        <EntitiesTable rows={rows} index={index} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
      )}
    </div>
  )
}

function EntitiesTable({
  rows,
  index,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: GraphEntity[]
  index: GraphIndex
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const navigate = useNavigate()

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#eaeaea]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#eaeaea] bg-white">
            <SortHead label="Name" active={sortKey === 'name'} dir={sortDir} onClick={() => onSort('name')} />
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Type</th>
            <SortHead
              label="Degree"
              active={sortKey === 'degree'}
              dir={sortDir}
              onClick={() => onSort('degree')}
              align="right"
            />
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
              <td className="px-3 py-2.5 font-mono text-[11px] uppercase leading-[18px] tracking-[0.04em] text-[#666666]">
                {e.type}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] leading-[18px] text-[#666666] tabular-nums">
                {index.degree.get(e.id) ?? 0}
              </td>
              <td className="px-3 py-2.5 font-mono text-[12px] leading-[18px] text-[#666666] tabular-nums">
                {formatDay(e.last_seen_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'right'
}) {
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-[11px] font-normal uppercase tracking-[0.08em] hover:text-[#171717] ${
          active ? 'text-[#171717]' : 'text-[#888888]'
        }`}
      >
        {label}
        <span aria-hidden className="font-mono text-[10px] text-[#888888]">
          {active ? (dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
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
          <h2 className="mt-2 break-words font-serif text-[32px] leading-10 tracking-[-0.02em] text-[#171717]">
            {entity.name}
          </h2>
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
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">
            Memories · {memories ? memories.length : '—'}
          </h3>
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
        </section>

        <section className="min-w-0 lg:border-l lg:border-[#eaeaea] lg:pl-8">
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">
            Connections · {connections.length}
          </h3>
          <ConnectionList
            connections={connections}
            onNavigate={(id) => navigate({ to: '/entities', search: { entity: id } })}
          />
        </section>
      </div>
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
