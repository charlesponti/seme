import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

export const Route = createFileRoute('/entities')({
  component: EntitiesPage,
})

const TYPE_BADGE: Record<string, string> = {
  person: 'bg-blue-500/15 text-blue-300',
  organization: 'bg-emerald-500/15 text-emerald-300',
  place: 'bg-yellow-500/15 text-yellow-300',
  tool: 'bg-purple-500/15 text-purple-300',
  animal: 'bg-red-500/15 text-red-300',
  topic: 'bg-cyan-500/15 text-cyan-300',
  project: 'bg-orange-500/15 text-orange-300',
  preference: 'bg-pink-500/15 text-pink-300',
}

function EntitiesPage() {
  const [entities, setEntities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await semeApi.entities({ limit: '200' })
        setEntities(data.entities || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Entities</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{entities.length} entities in the knowledge graph</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entities found.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="text-right">Mentions</TableHead>
                <TableHead className="text-right">Conf.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entities.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${TYPE_BADGE[e.type] ?? 'bg-accent text-muted-foreground'}`}>
                      {e.type}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(e.aliases || []).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{e.mention_count}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {typeof e.confidence === 'number' ? e.confidence.toFixed(2) : '—'}
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