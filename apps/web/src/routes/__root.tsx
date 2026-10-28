import { HeadContent, Scripts, createRootRoute, Outlet, Link } from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { ToastProvider } from '../components/ui/toast'

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

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}