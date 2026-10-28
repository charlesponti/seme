import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi, apiFetch } from '../lib/api'
import { useToast } from '../components/ui/toast'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

const PRIORITY: Record<string, string> = {
  high: 'bg-red-500/15 text-red-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-zinc-500/15 text-zinc-300',
}

function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    try {
      const data = await semeApi.tasks({ limit: '200' })
      setTasks(data.tasks || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createTask() {
    if (!newTitle.trim()) return
    try {
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle, priority: 'medium' }),
      })
      setNewTitle('')
      toast('Task created', 'success')
      load()
    } catch (e: any) {
      toast(e.message ?? 'Could not create task', 'error')
    }
  }

  async function updateStatus(id: string, status: string) {
    await apiFetch('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status }) })
    load()
  }

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Tasks</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{open.length} open · {tasks.length} total</p>
      </div>

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createTask()}
          placeholder="New task title…"
          className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />
        <button
          onClick={createTask}
          className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
        >
          Add task
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {tasks.map((t: any) => (
            <div key={t.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${t.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>
                  {t.title}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className={`rounded-full px-2 py-0.5 ${PRIORITY[t.priority] ?? 'bg-accent text-muted-foreground'}`}>
                    {t.priority}
                  </span>
                  <span>{t.status}</span>
                  {t.due_date && <span>due {t.due_date.slice(0, 10)}</span>}
                </div>
              </div>
              <select
                value={t.status}
                onChange={(e) => updateStatus(t.id, e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}