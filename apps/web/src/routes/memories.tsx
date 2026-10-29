import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { semeApi } from '../lib/api'
import { buildGraphIndex, type GraphEntity, type GraphIndex, type GraphRelationship } from '../lib/graphModel'
import { formatDay } from '../lib/format'

export const Route = createFileRoute('/memories')({
  validateSearch: (search: Record<string, unknown>): { memory?: string } => ({
    memory: typeof search.memory === 'string' ? search.memory : undefined,
  }),
  component: MemoriesPage,
})

interface MemoryRow {
  id: string
  kind?: string
  slot?: string | null
  value_text?: string
  status?: string
  source_type?: string | null
  confidence?: number
  observed_at?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'superseded', label: 'Superseded' },
  { id: 'deleted', label: 'Deleted' },
] as const

const EMPTY_INDEX: GraphIndex = buildGraphIndex([], [])

function MemoriesPage() {
  const { memory: memoryId } = Route.useSearch()
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [status, setStatus] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { limit: '200' }
      if (status !== 'all') params.status = status
      const data = await semeApi.memories(params)
      setMemories(Array.isArray(data?.memories) ? data.memories : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return memories
    return memories.filter((m) =>
      `${m.value_text ?? ''} ${m.slot ?? ''} ${m.kind ?? ''}`.toLowerCase().includes(q),
    )
  }, [memories, query])

  const selected = memoryId ? memories.find((m) => m.id === memoryId) ?? null : null

  if (memoryId) {
    if (loading) {
      return (
        <div className="max-w-[720px] space-y-3">
          <div className="h-3 w-24 bg-[#f5f5f5]" />
          <div className="h-5 w-full bg-[#f5f5f5]" />
          <div className="h-5 w-4/5 bg-[#f5f5f5]" />
          <div className="h-24 w-full bg-[#f5f5f5]" />
        </div>
      )
    }
    if (!selected) {
      return (
        <div>
          <BackLink />
          {error ? (
            <ErrorBox message={error} onRetry={load} />
          ) : (
            <p className="mt-4 text-[13px] text-[#888888]">No memory with that ID in this view.</p>
          )}
        </div>
      )
    }
    return <MemoryDetail memory={selected} />
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">Memories</h1>
          <p className="mt-1 font-mono text-[12px] leading-[18px] tabular-nums text-[#888888]">
            {loading ? '—' : `${shown.length} of ${memories.length} shown`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter memories"
            className="h-7 w-52 rounded-[6px] border border-[#d4d4d4] bg-white px-2 text-[12px] text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
          />
          <div className="flex overflow-hidden rounded-[6px] border border-[#eaeaea]">
            {STATUS_FILTERS.map((f) => {
              const active = f.id === status
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatus(f.id)}
                  aria-pressed={active}
                  className={`h-7 px-2.5 text-[12px] leading-4 transition-colors duration-150 ease-out motion-reduce:transition-none ${
                    active ? 'bg-black text-white' : 'bg-white text-[#666666] hover:bg-[#f5f5f5]'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="space-y-px border-y border-[#eaeaea]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-10 w-full bg-[#fafafa]" />
            ))}
          </div>
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[#888888]">No memories found.</p>
        ) : (
          <MemoriesTable rows={shown} />
        )}
      </div>
    </div>
  )
}

function MemoriesTable({ rows }: { rows: MemoryRow[] }) {
  const navigate = useNavigate()

  return (
    <div className="overflow-x-auto border-y border-[#eaeaea]">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col style={{ width: 112 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 124 }} />
        </colgroup>
        <thead>
          <tr className="border-b border-[#eaeaea] bg-white">
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Memory</th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Type</th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">
              Confidence
            </th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Created</th>
            <th className="px-3 py-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[#888888]">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              role="link"
              tabIndex={0}
              aria-label={`Open memory ${m.id}`}
              onClick={() => navigate({ to: '/memories', search: { memory: m.id } })}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  navigate({ to: '/memories', search: { memory: m.id } })
                }
              }}
              className="cursor-pointer border-b border-[#eaeaea] last:border-0 hover:bg-[#f5f5f5] focus:bg-[#f5f5f5] focus:outline-none"
            >
              <td className="px-3 py-2.5 text-[13px] leading-5 text-[#171717]">
                <div className="truncate">{m.value_text}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] uppercase leading-[18px] tracking-[0.04em] text-[#666666]">
                {m.kind ?? '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] leading-[18px] tabular-nums text-[#666666]">
                {typeof m.confidence === 'number' ? m.confidence.toFixed(2) : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] leading-[18px] tabular-nums text-[#666666]">
                {formatDay(m.observed_at)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] leading-[18px] text-[#666666]">
                {m.source_type ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Word-boundary match so "Ann" does not light up "Anna". */
function mentions(content: string, name: string): boolean {
  if (name.length < 2) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(content)
}

function MemoryDetail({ memory }: { memory: MemoryRow }) {
  const [index, setIndex] = useState<GraphIndex | null>(null)
  const [graphError, setGraphError] = useState(false)

  // There is no memory→entities endpoint. The graph snapshot is the only
  // client-side source for related entities, so it loads when detail opens.
  useEffect(() => {
    let cancelled = false
    semeApi
      .graphSnapshot()
      .then((data) => {
        if (cancelled) return
        setIndex(
          buildGraphIndex(
            Array.isArray(data?.entities) ? (data.entities as GraphEntity[]) : [],
            Array.isArray(data?.relationships) ? (data.relationships as GraphRelationship[]) : [],
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setGraphError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const related = useMemo(() => {
    const graph = index ?? EMPTY_INDEX
    const content = memory.value_text ?? ''
    if (!content) return []
    const seen = new Set<string>()
    return graph.entities
      .filter((e) => mentions(content, e.name))
      .sort((a, b) => (graph.degree.get(b.id) ?? 0) - (graph.degree.get(a.id) ?? 0))
      .filter((e) => {
        const key = e.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }, [index, memory.value_text])

  return (
    <div className="max-w-[760px]">
      <BackLink />
      <p className="mt-4 font-serif text-[17px] leading-[28px] text-[#171717]">{memory.value_text}</p>

      <section className="mt-8 border-t border-[#eaeaea] pt-4">
        <h2 className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Metadata</h2>
        <dl className="mt-3 grid grid-cols-[112px_1fr] gap-x-4 gap-y-1.5 font-mono text-[12px] leading-[18px] tabular-nums">
          <dt className="uppercase text-[#888888]">ID</dt>
          <dd className="break-all text-[#171717]">{memory.id}</dd>
          <dt className="uppercase text-[#888888]">Kind</dt>
          <dd className="text-[#171717]">{memory.kind ?? '—'}</dd>
          <dt className="uppercase text-[#888888]">Slot</dt>
          <dd className="text-[#171717]">{memory.slot ?? '—'}</dd>
          <dt className="uppercase text-[#888888]">Status</dt>
          <dd className="text-[#171717]">{memory.status ?? '—'}</dd>
          <dt className="uppercase text-[#888888]">Confidence</dt>
          <dd className="text-[#171717]">
            {typeof memory.confidence === 'number' ? memory.confidence.toFixed(2) : '—'}
          </dd>
          <dt className="uppercase text-[#888888]">Observed</dt>
          <dd className="text-[#171717]">{formatDay(memory.observed_at)}</dd>
          <dt className="uppercase text-[#888888]">Valid from</dt>
          <dd className="text-[#171717]">{formatDay(memory.valid_from)}</dd>
          <dt className="uppercase text-[#888888]">Valid to</dt>
          <dd className="text-[#171717]">{memory.valid_to ? formatDay(memory.valid_to) : '—'}</dd>
        </dl>
      </section>

      <section className="mt-8 border-t border-[#eaeaea] pt-4">
        <h2 className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Provenance</h2>
        <dl className="mt-3 grid grid-cols-[112px_1fr] gap-x-4 gap-y-1.5 font-mono text-[12px] leading-[18px]">
          <dt className="uppercase text-[#888888]">Source</dt>
          <dd className="text-[#171717]">{memory.source_type ?? '—'}</dd>
          <dt className="uppercase text-[#888888]">Evidence</dt>
          <dd className="text-[#888888]">not exposed by the memories API</dd>
        </dl>
      </section>

      <section className="mt-8 border-t border-[#eaeaea] pt-4">
        <h2 className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Related entities</h2>
        {graphError ? (
          <p className="mt-2 text-[12px] text-[#888888]">Could not load the graph index.</p>
        ) : index === null ? (
          <div className="mt-3 space-y-px">
            <div className="h-5 w-56 bg-[#f5f5f5]" />
            <div className="h-5 w-40 bg-[#f5f5f5]" />
          </div>
        ) : related.length === 0 ? (
          <p className="mt-2 text-[12px] text-[#888888]">No entities named in this memory.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {related.map((e) => (
              <li key={e.id}>
                <Link
                  to="/graph"
                  search={{ focus: e.id }}
                  className="text-[13px] leading-5 text-[#666666] underline decoration-[#d4d4d4] underline-offset-2 hover:text-[#171717]"
                >
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[11px] leading-[18px] text-[#888888]">
          Related entities are matched by name in the memory text — no memory→entity endpoint exists.
        </p>
      </section>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/memories"
      className="inline-flex items-center font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888] hover:text-[#171717]"
    >
      ← All memories
    </Link>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 max-w-md rounded-[8px] border border-[#eaeaea] p-4">
      <p className="text-[13px] text-[#171717]">Could not load memories: {message}</p>
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
