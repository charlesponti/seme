import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/search')({
  component: SearchPage,
})

function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function doSearch() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await semeApi.search(query)
      setResults(data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Search</h2>
      <div className="flex gap-2 mb-6">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search across memories, wiki, graph, turns..."
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        <button onClick={doSearch} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Search</button>
      </div>
      {loading ? <p className="text-gray-500">Searching...</p> : null}
      {results && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Total results: {results.total_results} | Abstain: {String(results.abstain)}</p>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">LLM-Ready Context</h3>
            <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">{results.context}</pre>
          </div>
          {results.layers?.memories?.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Memories ({results.layers.memories.length})</h3>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {results.layers.memories.map((m: any) => (
                  <div key={m.id} className="p-3 text-sm">{m.value_text}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}