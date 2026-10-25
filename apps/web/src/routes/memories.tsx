import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/memories')({
  component: MemoriesPage,
})

function MemoriesPage() {
  const [memories, setMemories] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params: any = { limit: '100' }
        if (filter !== 'all') params.status = filter
        const data = await semeApi.memories(params)
        setMemories(data.memories || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [filter])

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Memories</h2>
      <div className="flex gap-2 mb-4">
        {['all', 'active', 'superseded', 'deleted'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded border ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
            {f}
          </button>
        ))}
      </div>
      {loading ? <p className="text-gray-500">Loading...</p> :
        memories.length === 0 ? <p className="text-gray-500">No memories found</p> :
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {memories.map((m: any) => (
            <div key={m.id} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-mono">{m.kind}</span>
                <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{m.status}</span>
              </div>
              <p className="text-gray-800 text-sm mt-1">{m.value_text}</p>
              <p className="text-xs text-gray-500 mt-1">slot: {m.slot || 'none'} | confidence: {m.confidence} | source: {m.source_type}</p>
            </div>
          ))}
        </div>
      }
    </div>
  )
}