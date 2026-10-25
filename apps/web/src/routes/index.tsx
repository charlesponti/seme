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
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">{stats?.memories ?? '-'}</div>
          <div className="text-sm text-gray-500 mt-1">Memories</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">{stats?.entities ?? '-'}</div>
          <div className="text-sm text-gray-500 mt-1">Entities</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">{stats?.health ? (stats.health * 100).toFixed(0) + '%' : '-'}</div>
          <div className="text-sm text-gray-500 mt-1">Health Score</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">{stats?.issues ?? '-'}</div>
          <div className="text-sm text-gray-500 mt-1">Issues</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Recent Memories</h3>
          {memories.length === 0 ? <p className="text-gray-500 text-sm">No memories yet</p> :
            memories.map((m: any) => (
              <div key={m.id} className="py-2 border-b border-gray-100 last:border-0">
                <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full mr-2">{m.kind}</span>
                <span className="text-sm text-gray-700">{m.value_text}</span>
              </div>
            ))
          }
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Recent Entities</h3>
          {entities.length === 0 ? <p className="text-gray-500 text-sm">No entities yet</p> :
            entities.map((e: any) => (
              <div key={e.id} className="py-2 border-b border-gray-100 last:border-0">
                <span className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full mr-2">{e.type}</span>
                <span className="text-sm text-gray-700">{e.name}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}