import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/wiki')({
  component: WikiPage,
})

function WikiPage() {
  const [pages, setPages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await semeApi.wiki({ limit: '100' })
        setPages(data.pages || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Wiki Pages</h2>
      {loading ? <p className="text-gray-500">Loading...</p> :
        pages.length === 0 ? <p className="text-gray-500">No wiki pages found. Compile from entities first.</p> :
        <div className="space-y-4">
          {pages.map((p: any) => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-mono">{p.page_type}</span>
                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">{p.maturity}</span>
                <span className="text-xs text-gray-500">v{p.version}</span>
              </div>
              <h3 className="font-semibold text-gray-900">{p.title}</h3>
              <pre className="bg-gray-50 p-3 rounded mt-2 text-xs overflow-x-auto whitespace-pre-wrap">{p.content?.substring(0, 500)}</pre>
            </div>
          ))}
        </div>
      }
    </div>
  )
}