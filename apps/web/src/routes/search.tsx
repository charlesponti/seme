import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { semeApi } from '../lib/api'
import { Tabs } from '../components/ui/tabs'
import { useToast } from '../components/ui/toast'

export const Route = createFileRoute('/search')({
  component: SearchPage,
})

function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('memories')
  const { toast } = useToast()

  async function doSearch() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await semeApi.search(query)
      if (data?.error) throw new Error(data.error.message ?? 'search failed')
      setResults(data)
      setTab('memories')
      toast(`Retrieved ${data.memories?.length ?? 0} memories`, 'success')
    } catch (e: any) {
      toast(e.message ?? 'Search failed', 'error')
    }
    setLoading(false)
  }

  const mems = results?.memories ?? []
  const graph = results?.graph_summary

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Hybrid Search</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          FTS5 keyword + vector similarity + graph traversal, scored and ranked.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Ask anything — e.g. what kind of pet does he have?"
          className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className={`rounded-full px-2 py-0.5 ${results.abstain ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
              {results.abstain ? 'abstained' : 'answered'}
            </span>
            <span>{mems.length} memories</span>
            {graph && <span>{graph.entities?.length ?? 0} entities · {graph.relationships?.length ?? 0} relationships</span>}
          </div>

          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'memories', label: 'Memories', count: mems.length },
              { id: 'profile', label: 'Profile' },
              { id: 'graph', label: 'Graph context', count: graph?.entities?.length },
              { id: 'rules', label: 'Rules', count: results.procedural_rules?.length },
            ]}
          />

          {tab === 'memories' && (
            <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
              {mems.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No memories matched.</p>
              ) : (
                mems.map((m: any) => (
                  <div key={m.id} className="flex items-start gap-3 p-4">
                    <span className="mt-0.5 shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px]">{m.kind}</span>
                    <div>
                      <p className="text-sm">{m.value_text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        slot {m.slot ?? '—'} · confidence {m.confidence} · {m.source_type}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'profile' && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
              {results.profile_text || '(empty profile)'}
            </pre>
          )}

          {tab === 'graph' && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              {!graph ? (
                <p className="text-muted-foreground">No graph context.</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Entities</div>
                    <div className="flex flex-wrap gap-1.5">
                      {graph.entities.map((e: any) => (
                        <span key={e.name} className="rounded-full bg-accent px-2 py-0.5 text-xs">
                          {e.name} <span className="text-muted-foreground">({e.type})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Relationships</div>
                    {graph.relationships.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None.</p>
                    ) : (
                      graph.relationships.map((r: any, i: number) => (
                        <div key={i} className="text-xs">
                          {r.source} <span className="text-muted-foreground">—{r.relation_type}→</span> {r.target}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'rules' && (
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {(results.procedural_rules ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No active procedural rules.</p>
              ) : (
                results.procedural_rules.map((r: any) => (
                  <div key={r.id} className="p-4 text-sm">
                    <span className="mr-2 rounded-full bg-accent px-2 py-0.5 text-[11px]">{r.priority}</span>
                    {r.rule_text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}