import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'default' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  variant: Variant
}

interface ToastApi {
  toast: (message: string, variant?: Variant) => void
}

const ToastCtx = createContext<ToastApi>({ toast: () => {} })

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, variant: Variant = 'default') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, message, variant }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto rounded-md border border-border bg-card px-4 py-3 text-sm shadow-lg',
              t.variant === 'success' && 'border-border text-foreground',
              t.variant === 'error' && 'border-border text-foreground',
              t.variant === 'default' && 'border-border text-foreground'
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
