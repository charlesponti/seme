import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { semeApi } from '../lib/api'
import GraphView from '../components/GraphView'
import { Dialog } from '../components/ui/dialog'
import { Tabs } from '../components/ui/tabs'

export const Route = createFileRoute('/graph')({
  component: GraphPage,
})

function GraphPage() {
  const [entities, setEntities] = useState<any[]>([])
  const [relationships, setRelationships] = useState<any[]>([])
  const [selected, setSelected] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('all')
  const [neighborhood, setNeighborhood] = useState<{ entities: any[]; relationships: any[] } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const snap = await semeApi.graphSnapshot()
        setEntities(snap.entities || [])
        setRelationships(snap.relationships || [])
      } catch (e) {
        console.error('Failed to load graph:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function focusNeighborhood(entity: any) {
    setSelected(entity)
    setNeighborhood(null)
    try {
      const nb = await semeApi.graphNeighborhood(entity.id, 2)
      setNeighborhood({ entities: nb.entities || [], relationships: nb.relationships || [] })
    } catch (e) {
      console.error(e)
    }
  }

  const shown =
    view === 'focus' && neighborhood
      ? { entities: neighborhood.entities, relationships: neighborhood.relationships }
      : { entities, relationships }

  const types = [...new Set(entities.map((e) => e.type))]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Knowledge Graph</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {entities.length} entities · {relationships.length} relationships · drag nodes to explore
          </p>
        </div>
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: 'all', label: 'Full graph', count: entities.length },
            { id: 'focus', label: 'Neighborhood', count: neighborhood?.entities.length },
          ]}
        />
      </div>

      {types.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {types.map((t) => (
            <span key={t} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {t}: {entities.filter((e) => e.type === t).length}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading graph…</p>
      ) : (
        <GraphView
          entities={shown.entities}
          relationships={shown.relationships}
          height={560}
          onSelect={(e) => e && focusNeighborhood(e)}
        />
      )}

      {view === 'focus' && !neighborhood && (
        <p className="mt-3 text-xs text-muted-foreground">Click any node to focus its 2-hop neighborhood.</p>
      )}

      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        description={selected ? `${selected.type} · ${selected.mention_count ?? 0} mentions · confidence ${selected.confidence ?? '-'}` : ''}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            {selected.description && (
              <p className="text-muted-foreground">{selected.description}</p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border p-2">
                <div className="text-muted-foreground">First seen</div>
                <div>{selected.first_seen_at?.slice(0, 10) ?? '-'}</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-muted-foreground">Last seen</div>
                <div>{selected.last_seen_at?.slice(0, 10) ?? '-'}</div>
              </div>
            </div>
            {selected.aliases?.length > 0 && (
              <p className="text-xs text-muted-foreground">Aliases: {selected.aliases.join(', ')}</p>
            )}
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Connections</div>
              {relationships
                .filter((r) => r.source_id === selected.id || r.target_id === selected.id)
                .map((r) => {
                  const otherId = r.source_id === selected.id ? r.target_id : r.source_id
                  const other = entities.find((e) => e.id === otherId)
                  const dir = r.source_id === selected.id ? '→' : '←'
                  return (
                    <div key={r.id} className="rounded-md bg-accent/50 px-2 py-1 text-xs">
                      {dir} <span className="text-muted-foreground">{r.relation_type}</span> {other?.name ?? otherId.slice(0, 8)}
                    </div>
                  )
                })}
              {relationships.filter((r) => r.source_id === selected.id || r.target_id === selected.id).length === 0 && (
                <p className="text-xs text-muted-foreground">No relationships yet.</p>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}