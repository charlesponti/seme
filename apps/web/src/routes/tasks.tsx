import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { semeApi } from '../lib/api'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await semeApi.tasks({ limit: '100' })
      setTasks(data.tasks || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createTask() {
    if (!newTitle.trim()) return
    await fetch('http://localhost:3000/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, priority: 'medium' }),
    })
    setNewTitle('')
    load()
  }

  async function updateStatus(id: string, status: string) {
    await fetch('http://localhost:3000/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    load()
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Tasks</h2>
      <div className="flex gap-2 mb-6">
        <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
          placeholder="New task title..." className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm" />
        <button onClick={createTask} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">Add Task</button>
      </div>
      {loading ? <p className="text-gray-500">Loading...</p> :
        tasks.length === 0 ? <p className="text-gray-500">No tasks</p> :
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {tasks.map((t: any) => (
            <div key={t.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-gray-800 text-sm font-medium">{t.title}</p>
                <p className="text-xs text-gray-500">{t.priority} | {t.status} | due: {t.due_date || 'none'}</p>
              </div>
              <select value={t.status} onChange={e => updateStatus(t.id, e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          ))}
        </div>
      }
    </div>
  )
}