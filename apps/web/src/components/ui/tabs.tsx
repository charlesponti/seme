import { cn } from '../../lib/utils'

interface TabsProps {
  tabs: { id: string; label: string; count?: number }[]
  value: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-lg border border-border bg-card p-1', className)}>
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="rounded-full bg-background/60 px-1.5 text-[10px] tabular-nums">{t.count}</span>
            )}
          </button>
        )}
      })}
    </div>
  )
}
