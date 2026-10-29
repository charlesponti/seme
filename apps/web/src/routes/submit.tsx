import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/submit')({
  component: SubmitPage,
})

interface SubmitResult {
  ok: boolean
  message: string
}

function SubmitPage() {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const hasInput = text.trim().length > 0 || url.trim().length > 0

  async function submit() {
    if (!hasInput || loading) return
    setLoading(true)
    setResult(null)
    const useUrl = text.trim().length === 0
    try {
      const res = useUrl ? await semeApi.submitUrl(url.trim()) : await semeApi.submitText(text, 'Web Submission')
      if (res?.error) throw new Error(res.error.message ?? 'Ingest failed')
      const chunks = typeof res?.chunks === 'number' ? res.chunks : null
      setResult({
        ok: true,
        message: ['queued', chunks !== null ? `${chunks} ${chunks === 1 ? 'chunk' : 'chunks'}` : null, 'extraction runs in the background']
          .filter(Boolean)
          .join(' · '),
      })
      setText('')
      setUrl('')
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Submit failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <h1 className="font-serif text-[24px] leading-8 tracking-[-0.02em] text-[#171717]">Add to memory</h1>
      <p className="mt-1 text-[13px] leading-5 text-[#666666]">
        Paste text or point at a URL. Seme extracts memories, entities and relationships.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor="submit-text" className="text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">
          Text
        </label>
        <textarea
          id="submit-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a block of text, conversation, or notes…"
          className="mt-1 min-h-[180px] w-full resize-y rounded-[6px] border border-[#d4d4d4] bg-white p-3 text-[14px] leading-5 text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
        />

        <label htmlFor="submit-url" className="mt-4 block text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">
          URL
        </label>
        <input
          id="submit-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="mt-1 h-9 w-full rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[14px] leading-5 text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
        />
        <p className="mt-1 font-mono text-[11px] leading-[18px] text-[#888888]">
          A URL is ingested only when the text field is empty.
        </p>

        <button
          type="submit"
          disabled={!hasInput || loading}
          className="mt-4 h-9 rounded-[6px] bg-black px-5 text-[13px] font-medium text-white hover:bg-[#171717] disabled:opacity-40"
        >
          {loading ? 'Submitting…' : 'Submit'}
        </button>
      </form>

      {result && result.ok && (
        <p className="mt-4 font-mono text-[12px] leading-[18px] text-[#171717]">{result.message}</p>
      )}

      {result && !result.ok && (
        <div className="mt-4 rounded-[8px] border border-[#eaeaea] p-3">
          <p className="text-[13px] leading-5 text-[#171717]">Submit failed: {result.message}</p>
          <button
            type="button"
            onClick={submit}
            className="mt-2 h-7 rounded-[6px] border border-[#d4d4d4] bg-white px-2.5 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
