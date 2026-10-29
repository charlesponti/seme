import { HeadContent, Scripts, createRootRoute, Outlet, Link } from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { ToastProvider } from '../components/ui/toast'
import { useState, useEffect } from 'react'
import { getApiKey, setApiKey, API_BASE } from '../lib/api'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Seme Memory Dashboard' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const [apiKey, setApiKeyState] = useState<string | null>(() => getApiKey())

  useEffect(() => {
    const handler = () => setApiKeyState(getApiKey())
    window.addEventListener('seme:unauthorized', handler)
    return () => window.removeEventListener('seme:unauthorized', handler)
  }, [])

  if (!apiKey) {
    return <PasswordGate onAuth={setApiKeyState} />
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 backdrop-blur bg-background/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">S</div>
            <h1 className="text-xl font-bold">Seme</h1>
          </div>
          <nav className="flex gap-1 text-sm">
            {[
              { to: '/', label: 'Dashboard' },
              { to: '/memories', label: 'Memories' },
              { to: '/entities', label: 'Entities' },
              { to: '/graph', label: 'Graph' },
              { to: '/wiki', label: 'Wiki' },
              { to: '/search', label: 'Search' },
              { to: '/tasks', label: 'Tasks' },
              { to: '/submit', label: 'Submit' },
            ].map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                activeProps={{ className: 'px-3 py-1.5 rounded-md text-foreground bg-accent' }}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  )
}

function PasswordGate({ onAuth }: { onAuth: (key: string) => void }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(API_BASE + '/entities?limit=1', {
        headers: { Authorization: `Bearer ${password}` },
      })
      if (res.status === 401) {
        setError('Incorrect password')
        setSubmitting(false)
        return
      }
      if (!res.ok) {
        setError(`Request failed (${res.status})`)
        setSubmitting(false)
        return
      }
      setApiKey(password)
      onAuth(password)
    } catch (err: any) {
      setError(err?.message || 'Failed to verify password')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            S
          </div>
          <h1 className="text-xl font-bold">Seme</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Enter gate password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mb-3"
          placeholder="Password"
        />
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      </form>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}