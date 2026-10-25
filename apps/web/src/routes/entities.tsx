import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/entities')({
  component: EntitiesPage,
})

function EntitiesPage() {
  const [entities, setEntities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await semeApi.entities({ limit: '100' })
        setEntities(data.entities || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Entities</h2>
      {loading ? <p className="text-gray-500">Loading...</p> :
        entities.length === 0 ? <p className="text-gray-500">No entities found</p> :
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {entities.map((e: any) => (
            <div key={e.id} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full font-mono">{e.type}</span>
              </div>
              <p className="text-gray-800 text-sm font-semibold mt-1">{e.name}</p>
              <p className="text-xs text-gray-500 mt-1">aliases: {(e.aliases || []).join(', ') || 'none'} | mentions: {e.mention_count} | confidence: {e.confidence}</p>
            </div>
          ))}
        </div>
      }
    </div>
  )
}