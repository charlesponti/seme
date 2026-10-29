import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { semeApi } from '../lib/api'
import { formatDay } from '../lib/format'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

interface StatCell {
  label: string
  value: string
}

interface SearchResults {
  memories?: any[]
  profile_text?: string
  abstain?: boolean
  procedural_rules?: any[]
  graph_summary?: {
    entities?: { name: string; type: string; mention_count?: number }[]
    relationships?: { source: string; relation_type: string; target: string }[]
  }
}

function Dashboard() {
  const [stats, setStats] = useState<StatCell[] | null>(null)
  const [memories, setMemories] = useState<any[]>([])
  const [entities, setEntities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mems, ents, rels, wiki] = await Promise.all([
        semeApi.memories({ limit: '8' }),
        semeApi.entities({ limit: '8' }),
        semeApi.relationships({ limit: '1' }),
        semeApi.wiki({ limit: '1' }),
      ])
      setMemories(Array.isArray(mems?.memories) ? mems.memories : [])
      setEntities(Array.isArray(ents?.entities) ? ents.entities : [])
      setStats([
        { label: 'Memories', value: formatCount(mems?.total) },
        { label: 'Entities', value: formatCount(ents?.total) },
        { label: 'Relationships', value: formatCount(rels?.total) },
        { label: 'Wiki pages', value: formatCount(wiki?.total) },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <h1 className="text-[24px] font-medium leading-8 tracking-[-0.01em] text-[#171717]">Dashboard</h1>

      <div className="mt-6 grid grid-cols-2 border-y border-[#eaeaea] sm:grid-cols-4">
        {(stats ?? PLACEHOLDER_STATS).map((cell, i) => (
          <div
            key={cell.label}
            className={`border-l border-[#eaeaea] bg-white px-5 py-5 ${CELL_BORDERS[i]}`}
          >
            <div className="font-mono text-[28px] leading-9 tabular-nums text-[#171717]">
              {stats ? cell.value : '—'}
            </div>
            <div className="mt-1 text-[12px] uppercase leading-4 tracking-[0.08em] text-[#888888]">{cell.label}</div>
          </div>
        ))}
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : (
        <>
          <SearchBlock />

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <RecentMemories rows={memories} loading={loading} />
            <RecentEntities rows={entities} loading={loading} />
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <Link
              to="/submit"
              className="inline-flex h-8 items-center rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
            >
              Submit memory
            </Link>
            <Link
              to="/graph"
              className="inline-flex h-8 items-center rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
            >
              Open graph
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

const PLACEHOLDER_STATS: StatCell[] = [
  { label: 'Memories', value: '—' },
  { label: 'Entities', value: '—' },
  { label: 'Relationships', value: '—' },
  { label: 'Wiki pages', value: '—' },
]

// Hairline dividers without a background-gap grid (which leaves a 1px sliver at
// fractional widths): a left border on every cell except the first of each row.
const CELL_BORDERS = ['border-l-0', '', 'border-l-0 border-t sm:border-l sm:border-t-0', 'border-t sm:border-t-0']

function formatCount(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—'
}

function RecentMemories({ rows, loading }: { rows: any[]; loading: boolean }) {
  const navigate = useNavigate()

  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-[#eaeaea] pb-2">
        <h2 className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Recent memories</h2>
        <Link to="/memories" className="text-[12px] text-[#666666] hover:text-[#171717]">
          View all →
        </Link>
      </div>
      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[#888888]">No memories yet.</p>
      ) : (
        <ul>
          {rows.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => navigate({ to: '/memories', search: { memory: m.id } })}
                className="flex w-full items-center gap-3 border-b border-[#eaeaea] py-2.5 text-left hover:bg-[#f5f5f5]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[#171717]">{m.value_text}</span>
                <span className="shrink-0 font-mono text-[11px] uppercase leading-[18px] text-[#888888]">{m.kind}</span>
                <span className="w-20 shrink-0 text-right font-mono text-[11px] leading-[18px] tabular-nums text-[#666666]">
                  {formatDay(m.observed_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentEntities({ rows, loading }: { rows: any[]; loading: boolean }) {
  const navigate = useNavigate()

  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-[#eaeaea] pb-2">
        <h2 className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Recent entities</h2>
        <Link to="/entities" className="text-[12px] text-[#666666] hover:text-[#171717]">
          View all →
        </Link>
      </div>
      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[#888888]">No entities yet.</p>
      ) : (
        <ul>
          {rows.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => navigate({ to: '/entities', search: { entity: e.id } })}
                className="flex w-full items-center gap-3 border-b border-[#eaeaea] py-2.5 text-left hover:bg-[#f5f5f5]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[#171717]">{e.name}</span>
                <span className="shrink-0 font-mono text-[11px] uppercase leading-[18px] text-[#888888]">{e.type}</span>
                <span className="w-20 shrink-0 text-right font-mono text-[11px] leading-[18px] tabular-nums text-[#666666]">
                  {formatDay(e.last_seen_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-px pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-9 w-full bg-[#f5f5f5]" />
      ))}
    </div>
  )
}

const SEARCH_TABS = [
  { id: 'memories', label: 'Memories' },
  { id: 'profile', label: 'Profile' },
  { id: 'graph', label: 'Graph' },
  { id: 'rules', label: 'Rules' },
] as const

type SearchTab = (typeof SEARCH_TABS)[number]['id']

function SearchBlock() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<SearchTab>('memories')
  const [opening, setOpening] = useState<string | null>(null)

  const doSearch = useCallback(async () => {
    const q = query.trim()
    if (!q || loading) return
    setLoading(true)
    setError(null)
    try {
      const data = await semeApi.search(q)
      if (data?.error) throw new Error(data.error.message ?? 'Search failed')
      setResults(data as SearchResults)
      setTab('memories')
    } catch (e) {
      setResults(null)
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, loading])

  const openEntity = useCallback(
    async (name: string) => {
      if (opening) return
      setOpening(name)
      setError(null)
      try {
        const entity = await semeApi.entityByName(name)
        const id = entity?.id ?? entity?.entity?.id
        if (!id) throw new Error(`No entity found for ${name}`)
        await navigate({ to: '/graph', search: { focus: id } })
      } catch (e) {
        setOpening(null)
        setError(e instanceof Error ? e.message : 'Could not open that entity')
      }
    },
    [navigate, opening],
  )

  const memories = useMemo(() => results?.memories ?? [], [results])
  const rules = useMemo(() => results?.procedural_rules ?? [], [results])
  const graph = results?.graph_summary

  return (
    <section className="mt-8">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          doSearch()
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything — e.g. what kind of pet does he have?"
          aria-label="Search memories"
          className="h-11 min-w-0 flex-1 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[16px] leading-6 text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="h-11 shrink-0 rounded-[6px] bg-black px-5 text-[14px] font-medium text-white hover:bg-[#171717] disabled:opacity-40"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="mt-2 font-mono text-[12px] leading-[18px] text-[#666666]">{error}</p>}

      {loading && !results && (
        <div className="mt-4 space-y-px">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 w-full bg-[#f5f5f5]" />
          ))}
        </div>
      )}

      {results && (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] uppercase leading-[18px] tracking-[0.08em] text-[#888888]">
            <span className="text-[#171717]">{results.abstain ? 'abstained' : 'answered'}</span>
            <span className="normal-case tracking-normal tabular-nums">
              {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
            </span>
            {graph && (
              <span className="normal-case tracking-normal tabular-nums">
                {graph.entities?.length ?? 0} entities · {graph.relationships?.length ?? 0} relationships
              </span>
            )}
            {rules.length > 0 && (
              <span className="normal-case tracking-normal tabular-nums">
                {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
              </span>
            )}
          </div>

          <div role="tablist" className="mt-3 flex gap-6 border-b border-[#eaeaea]">
            {SEARCH_TABS.map((t) => {
              const active = t.id === tab
              const count =
                t.id === 'memories'
                  ? memories.length
                  : t.id === 'graph'
                    ? graph?.entities?.length
                    : t.id === 'rules'
                      ? rules.length
                      : undefined
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 pb-2 text-[13px] leading-5 transition-colors duration-150 ease-out motion-reduce:transition-none ${
                    active
                      ? 'border-[#171717] font-medium text-[#171717]'
                      : 'border-transparent text-[#888888] hover:text-[#171717]'
                  }`}
                >
                  {t.label}
                  {typeof count === 'number' && (
                    <span className="ml-1.5 font-mono text-[11px] tabular-nums text-[#888888]">{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="border-b border-[#eaeaea]">
            {tab === 'memories' &&
              (memories.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[#888888]">No memories matched.</p>
              ) : (
                memories.map((m: any) => (
                  <div key={m.id} className="border-b border-[#eaeaea] py-3 last:border-b-0">
                    <p className="text-[14px] leading-5 text-[#171717]">{m.value_text}</p>
                    <p className="mt-1 font-mono text-[11px] leading-[18px] tabular-nums text-[#888888]">
                      {[
                        m.kind,
                        m.slot ? `slot ${m.slot}` : null,
                        typeof m.confidence === 'number' ? `confidence ${m.confidence.toFixed(2)}` : null,
                        m.source_type,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                ))
              ))}

            {tab === 'profile' &&
              (results.profile_text ? (
                <pre className="whitespace-pre-wrap bg-white py-3 text-[13px] leading-5 text-[#171717]">
                  {results.profile_text}
                </pre>
              ) : (
                <p className="py-6 text-center text-[13px] text-[#888888]">No profile text.</p>
              ))}

            {tab === 'graph' &&
              (!graph || ((graph.entities?.length ?? 0) === 0 && (graph.relationships?.length ?? 0) === 0) ? (
                <p className="py-6 text-center text-[13px] text-[#888888]">No graph context.</p>
              ) : (
                <div className="py-3">
                  <div className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">Entities</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(graph.entities ?? []).map((e) => (
                      <button
                        key={e.name}
                        type="button"
                        onClick={() => openEntity(e.name)}
                        disabled={opening !== null}
                        className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#eaeaea] bg-white px-2 py-1 text-[12px] leading-4 text-[#171717] hover:bg-[#f5f5f5] disabled:opacity-50"
                      >
                        <span className="truncate">{e.name}</span>
                        <span className="font-mono text-[10px] uppercase text-[#888888]">{e.type}</span>
                        <span aria-hidden className="font-mono text-[11px] text-[#888888]">
                          →
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">
                    Relationships
                  </div>
                  {(graph.relationships ?? []).length === 0 ? (
                    <p className="mt-1 text-[13px] text-[#888888]">None.</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {(graph.relationships ?? []).map((r, i) => (
                        <li key={i} className="font-mono text-[12px] leading-[18px] text-[#171717]">
                          {r.source}{' '}
                          <span className="text-[#888888]">—{r.relation_type}→</span> {r.target}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

            {tab === 'rules' &&
              (rules.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[#888888]">No active procedural rules.</p>
              ) : (
                rules.map((r: any) => (
                  <div key={r.id} className="flex items-start gap-3 border-b border-[#eaeaea] py-3 last:border-b-0">
                    <span className="mt-0.5 shrink-0 rounded-[4px] border border-[#eaeaea] px-1.5 font-mono text-[11px] leading-[18px] tabular-nums text-[#666666]">
                      {r.priority}
                    </span>
                    <p className="text-[14px] leading-5 text-[#171717]">{r.rule_text}</p>
                  </div>
                ))
              ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 max-w-md rounded-[8px] border border-[#eaeaea] p-4">
      <p className="text-[13px] text-[#171717]">Could not load the dashboard: {message}</p>
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
