import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

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
          semeApi.memories({ limit: '5' }),
          semeApi.entities({ limit: '5' }),
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

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card><CardContent className="pt-6"><div className="text-3xl font-bold">{stats?.memories ?? '-'}</div><div className="text-sm text-muted-foreground mt-1">Memories</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-3xl font-bold">{stats?.entities ?? '-'}</div><div className="text-sm text-muted-foreground mt-1">Entities</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-3xl font-bold">{stats?.health ? (stats.health * 100).toFixed(0) + '%' : '-'}</div><div className="text-sm text-muted-foreground mt-1">Health Score</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-3xl font-bold">{stats?.issues ?? '-'}</div><div className="text-sm text-muted-foreground mt-1">Issues</div></CardContent></Card>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">Recent Memories</CardTitle></CardHeader>
          <CardContent>
            {memories.length === 0 ? <p className="text-muted-foreground text-sm">No memories yet</p> :
              memories.map((m: any) => (
                <div key={m.id} className="py-2 border-b border-border last:border-0">
                  <Badge className="mr-2">{m.kind}</Badge>
                  <span className="text-sm">{m.value_text}</span>
                </div>
              ))
            }
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Recent Entities</CardTitle></CardHeader>
          <CardContent>
            {entities.length === 0 ? <p className="text-muted-foreground text-sm">No entities yet</p> :
              entities.map((e: any) => (
                <div key={e.id} className="py-2 border-b border-border last:border-0">
                  <Badge variant="secondary" className="mr-2">{e.type}</Badge>
                  <span className="text-sm">{e.name}</span>
                </div>
              ))
            }
          </CardContent>
        </Card>
      </div>
    </div>
  )
}