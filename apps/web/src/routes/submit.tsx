import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/submit')({
  component: SubmitPage,
})

function SubmitPage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const ingestResult = await semeApi.submitText(text, 'Web Submission')
      await semeApi.endSession('web')
      setResult({ success: true, message: `Submitted ${ingestResult.chunks} chunk(s). Extraction running in background. Check Memories tab in ~20s.` })
      setText('')
    } catch (e: any) {
      setResult({ success: false, message: 'Error: ' + e.message })
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Submit Text for Extraction</h2>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste a block of text, conversation, or notes here. The system will extract memories, entities, and relationships."
          className="w-full min-h-[200px] border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-vertical" />
        <div className="flex gap-2 mt-3">
          <button onClick={submit} disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
            {loading ? 'Submitting...' : 'Extract & Save'}
          </button>
          <button onClick={() => setText('')} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">
            Clear
          </button>
        </div>
        {result && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  )
}