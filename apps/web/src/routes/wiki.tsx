import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'
import { Dialog } from '../components/ui/dialog'

export const Route = createFileRoute('/wiki')({
  component: WikiPage,
})

const MATURITY: Record<string, string> = {
  draft: 'bg-amber-500/15 text-amber-300',
  stable: 'bg-emerald-500/15 text-emerald-300',
  canonical: 'bg-blue-500/15 text-blue-300',
}

function WikiPage() {
  const [pages, setPages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<any | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await semeApi.wiki({ limit: '200' })
        setPages(data.pages || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Wiki</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pages.length} auto-compiled pages — one per entity, rewritten as knowledge changes.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wiki pages yet. Compile from entities first.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pages.map((p: any) => (
            <button
              key={p.id}
              onClick={() => setActive(p)}
              className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-foreground/25"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px]">{p.page_type}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${MATURITY[p.maturity] ?? 'bg-accent text-muted-foreground'}`}>
                  {p.maturity}
                </span>
                <span className="text-[11px] text-muted-foreground">v{p.version}</span>
              </div>
              <h3 className="font-semibold leading-snug group-hover:text-white">{p.title}</h3>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {p.content?.slice(0, 220)}…
              </p>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.title}
        description={active ? `${active.page_type} · ${active.maturity} · v${active.version}` : ''}
        className="max-w-2xl"
      >
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-xs leading-relaxed">
          {active?.content}
        </pre>
      </Dialog>
    </div>
  )
}