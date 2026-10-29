import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { semeApi } from '../lib/api'
import { formatDay } from '../lib/format'

export const Route = createFileRoute('/wiki')({
  component: WikiPage,
})

interface WikiPageRow {
  id: string
  title: string
  content?: string
  page_type?: string
  maturity?: string
  version?: number
  entity_name?: string | null
  source_memory_ids?: string[]
  updated_at?: string
}

function WikiPage() {
  const [pages, setPages] = useState<WikiPageRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await semeApi.wiki({ limit: '200' })
      const rows: WikiPageRow[] = Array.isArray(data?.pages) ? data.pages : []
      setPages(rows)
      setTotal(typeof data?.total === 'number' ? data.total : rows.length)
      setActiveId((current) => current ?? rows[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the wiki')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const active = useMemo(() => pages.find((p) => p.id === activeId) ?? null, [pages, activeId])

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">Wiki</h1>
        <p className="mt-1 font-mono text-[12px] leading-[18px] tabular-nums text-[#888888]">
          {loading ? '—' : `${pages.length} of ${total ?? pages.length} compiled pages`}
        </p>
      </div>

      {loading ? (
        <div className="grid gap-8 md:grid-cols-[260px_1fr]">
          <div className="space-y-px">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 w-full bg-[#f5f5f5]" />
            ))}
          </div>
          <div className="space-y-3">
            <div className="h-7 w-64 bg-[#f5f5f5]" />
            <div className="h-4 w-full max-w-[680px] bg-[#f5f5f5]" />
            <div className="h-4 w-5/6 max-w-[680px] bg-[#f5f5f5]" />
            <div className="h-4 w-2/3 max-w-[680px] bg-[#f5f5f5]" />
          </div>
        </div>
      ) : error ? (
        <div className="max-w-md rounded-[8px] border border-[#eaeaea] p-4">
          <p className="text-[13px] text-[#171717]">Could not load the wiki: {error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 h-8 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
          >
            Retry
          </button>
        </div>
      ) : pages.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-[#888888]">No wiki pages yet — compile from entities first.</p>
      ) : (
        <div className="grid gap-0 md:grid-cols-[260px_1fr]">
          <nav
            aria-label="Wiki pages"
            className="border-b border-[#eaeaea] pb-4 md:h-[calc(100dvh-11rem)] md:overflow-y-auto md:border-b-0 md:border-r md:pb-0 md:pr-4"
          >
            <ul>
              {pages.map((p) => {
                const isActive = p.id === activeId
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(p.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`block w-full px-2 py-1.5 text-left text-[14px] leading-5 transition-colors duration-150 ease-out motion-reduce:transition-none ${
                        isActive
                          ? 'bg-[#fafafa] font-medium text-[#000000]'
                          : 'text-[#666666] hover:bg-[#f5f5f5] hover:text-[#171717]'
                      }`}
                    >
                      <span className="block truncate">{p.title}</span>
                      <span className="mt-0.5 block font-mono text-[11px] uppercase leading-4 tracking-[0.06em] text-[#888888]">
                        {p.page_type} · {p.maturity}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <article className="min-w-0 pt-6 md:pl-8 md:pt-0">
            {active ? (
              <>
                <header className="mb-6 border-b border-[#eaeaea] pb-4">
                  <h2 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">{active.title}</h2>
                  <p className="mt-1 font-mono text-[11px] uppercase leading-[18px] tracking-[0.06em] tabular-nums text-[#888888]">
                    {[active.page_type, active.maturity, `v${active.version ?? 1}`, `updated ${formatDay(active.updated_at)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {active.entity_name && active.entity_name !== active.title && (
                    <p className="mt-1 font-mono text-[11px] leading-[18px] text-[#888888]">entity {active.entity_name}</p>
                  )}
                </header>

                <div className="max-w-[680px] whitespace-pre-wrap font-serif text-[17px] leading-[28px] text-[#171717]">
                  {active.content || ''}
                </div>

                <footer className="mt-10 max-w-[680px] border-t border-[#eaeaea] pt-3">
                  <h3 className="font-mono text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">
                    Compiled from · {active.source_memory_ids?.length ?? 0}{' '}
                    {(active.source_memory_ids?.length ?? 0) === 1 ? 'memory' : 'memories'}
                  </h3>
                  {(active.source_memory_ids?.length ?? 0) === 0 ? (
                    <p className="mt-1 font-mono text-[11px] leading-[18px] text-[#888888]">
                      No source memories recorded.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {(active.source_memory_ids ?? []).map((id) => (
                        <li key={id} className="break-all font-mono text-[11px] leading-[18px] text-[#888888]">
                          {id}
                        </li>
                      ))}
                    </ul>
                  )}
                </footer>
              </>
            ) : (
              <p className="py-16 text-center text-[13px] text-[#888888]">Select a page.</p>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
