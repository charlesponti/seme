import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { semeApi } from '../lib/api'
import { Tabs } from '../components/ui/tabs'
import { useToast } from '../components/ui/toast'

export const Route = createFileRoute('/submit')({
  component: SubmitPage,
})

function SubmitPage() {
  const [mode, setMode] = useState('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function submit() {
    if (mode === 'text' && !text.trim()) return
    if (mode === 'url' && !url.trim()) return
    setLoading(true)
    try {
      const res =
        mode === 'text'
          ? await semeApi.submitText(text, title || 'Web Submission')
          : await semeApi.submitUrl(url)
      if (res?.error) throw new Error(res.error.message ?? 'ingest failed')
      toast(`Queued ${res.chunks ?? 1} chunk(s) — extraction runs in the background`, 'success')
      setText('')
      setUrl('')
      setTitle('')
    } catch (e: any) {
      toast(e.message ?? 'Submit failed', 'error')
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Submit for Extraction</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste text, notes, or a URL. Seme extracts memories, entities, and relationships.
        </p>
      </div>

      <Tabs
        className="mb-4"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'text', label: 'Text' },
          { id: 'url', label: 'URL' },
        ]}
      />

      <div className="rounded-xl border border-border bg-card p-5">
        {mode === 'text' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a block of text, conversation, or notes here…"
            className="min-h-[220px] w-full resize-vertical rounded-lg border border-border bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
          />
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
          />
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={loading}
            className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Submitting…' : 'Extract & Save'}
          </button>
          <button
            onClick={() => { setText(''); setUrl(''); setTitle('') }}
            className="rounded-lg border border-border px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}