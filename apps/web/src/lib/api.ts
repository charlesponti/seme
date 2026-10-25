// src/lib/api.ts — Seme API client
const API_BASE = import.meta.env.VITE_SEME_API_URL || 'http://localhost:3000'

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return res.json()
}

export const semeApi = {
  health: () => apiFetch('/health'),
  memories: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch('/memories' + qs)
  },
  entities: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch('/entities' + qs)
  },
  wiki: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch('/wiki' + qs)
  },
  tasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch('/tasks' + qs)
  },
  search: (query: string, opts?: any) => apiFetch('/search', { method: 'POST', body: JSON.stringify({ query, ...opts }) }),
  submitText: (text: string, title?: string) => apiFetch('/ingest/source', { method: 'POST', body: JSON.stringify({ text, title: title || 'Web Submission', session_id: 'web' }) }),
  endSession: (sessionId: string) => apiFetch('/sessions/' + sessionId + '/end', { method: 'POST', body: JSON.stringify({}) }),
  stats: () => apiFetch('/kb/lint', { method: 'POST' }),
  profile: () => apiFetch('/profile'),
}