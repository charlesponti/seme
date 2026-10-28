import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const [stats, setStats] = useState<any>(null)
  const [memories, setMemories] = useState<any[]>([])
  const [entities, setEntities] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      try {
        const [mems, ents, health] = await Promise.all([
          semeApi.memories({ limit: '8' }),
          semeApi.entities({ limit: '8' }),
          semeApi.stats(),
        ])
        setMemories(mems.memories || [])
        setEntities(ents.entities || [])
        setStats({ memories: mems.total, entities: ents.total, health: health.health_score, issues: health.total_issues })
      } catch (e) {
        console.error('Failed to load dashboard:', e)
      }
    }
    load()
  }, [])

  const statCards = [
    { label: 'Memories', value: stats?.memories ?? '-', gradient: 'from-blue-500 to-cyan-500' },
    { label: 'Entities', value: stats?.entities ?? '-', gradient: 'from-purple-500 to-pink-500' },
    { label: 'Health Score', value: stats?.health ? (stats.health * 100).toFixed(0) + '%' : '-', gradient: 'from-emerald-500 to-teal-500' },
    { label: 'Issues', value: stats?.issues ?? '-', gradient: 'from-orange-500 to-red-500' },
  ]

  return (
    <div>
      {/* Hero */}
      <div className="mb-10">
        <h2 className="text-4xl font-bold tracking-tight">
          <span className="gradient-text">Seme Memory Dashboard</span>
        </h2>
        <p className="mt-2 text-muted-foreground">
          Your self-healing memory system. Extract, resolve, retrieve, and reason.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-xl border border-border bg-card p-6 hover:border-foreground/20 transition-all group"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
            <div className={`text-4xl font-bold bg-gradient-to-r ${s.gradient} bg-clip-text text-transparent`}>
              {s.value}
            </div>
            <div className="text-sm text-muted-foreground mt-2">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Memories */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Recent Memories</h3>
            <a href="/memories" className="text-xs text-muted-foreground hover:text-foreground transition-colors">View all →</a>
          </div>
          <div className="divide-y divide-border">
            {memories.length === 0 ? (
              <p className="p-6 text-muted-foreground text-sm">No memories yet</p>
            ) : (
              memories.map((m: any) => (
                <div key={m.id} className="px-6 py-3 flex items-start gap-3 hover:bg-accent/50 transition-colors">
                  <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium shrink-0 mt-0.5">
                    {m.kind}
                  </span>
                  <span className="text-sm leading-relaxed">{m.value_text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Entities */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Recent Entities</h3>
            <a href="/entities" className="text-xs text-muted-foreground hover:text-foreground transition-colors">View all →</a>
          </div>
          <div className="divide-y divide-border">
            {entities.length === 0 ? (
              <p className="p-6 text-muted-foreground text-sm">No entities yet</p>
            ) : (
              entities.map((e: any) => (
                <div key={e.id} className="px-6 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors">
                  <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium shrink-0">
                    {e.type}
                  </span>
                  <span className="text-sm">{e.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{e.mention_count} mentions</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <a href="/submit" className="rounded-xl border border-border bg-card p-5 hover:border-foreground/20 transition-all group">
          <div className="text-lg font-semibold mb-1 group-hover:text-white transition-colors">Submit Text</div>
          <p className="text-sm text-muted-foreground">Extract memories from any text</p>
        </a>
        <a href="/search" className="rounded-xl border border-border bg-card p-5 hover:border-foreground/20 transition-all group">
          <div className="text-lg font-semibold mb-1 group-hover:text-white transition-colors">Search</div>
          <p className="text-sm text-muted-foreground">Hybrid search across all layers</p>
        </a>
        <a href="/wiki" className="rounded-xl border border-border bg-card p-5 hover:border-foreground/20 transition-all group">
          <div className="text-lg font-semibold mb-1 group-hover:text-white transition-colors">Wiki</div>
          <p className="text-sm text-muted-foreground">Auto-generated knowledge pages</p>
        </a>
      </div>
    </div>
  )
}