import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'
import { Tabs } from '../components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

export const Route = createFileRoute('/memories')({
  component: MemoriesPage,
})

function MemoriesPage() {
  const [memories, setMemories] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params: any = { limit: '200' }
        if (filter !== 'all') params.status = filter
        const data = await semeApi.memories(params)
        setMemories(data.memories || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [filter])

  const shown = memories.filter((m) =>
    query.trim() ? `${m.value_text} ${m.slot ?? ''} ${m.kind}`.toLowerCase().includes(query.toLowerCase()) : true
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Memories</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{shown.length} of {memories.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-52 rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
          />
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'superseded', label: 'Superseded' },
              { id: 'deleted', label: 'Deleted' },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No memories found.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Conf.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px]">{m.kind}</span>
                  </TableCell>
                  <TableCell className="max-w-[520px] text-sm">{m.value_text}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.slot || '—'}</TableCell>
                  <TableCell>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-[11px] ' +
                        (m.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : m.status === 'superseded'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-red-500/15 text-red-300')
                      }
                    >
                      {m.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {typeof m.confidence === 'number' ? m.confidence.toFixed(2) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}