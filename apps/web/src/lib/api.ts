// src/lib/api.ts — Seme API client
const API_BASE = import.meta.env.VITE_SEME_API_URL || 'http://localhost:3000'

export const SEME_API_KEY_STORAGE = 'seme_api_key'

export function getApiKey(): string | null {
  try {
    return sessionStorage.getItem(SEME_API_KEY_STORAGE)
  } catch {
    return null
  }
}

export function setApiKey(value: string) {
  try {
    sessionStorage.setItem(SEME_API_KEY_STORAGE, value)
  } catch {
    /* ignore */
  }
}

export function clearApiKey() {
  try {
    sessionStorage.removeItem(SEME_API_KEY_STORAGE)
  } catch {
    /* ignore */
  }
}

export async function apiFetch(path: string, options?: RequestInit) {
  const key = getApiKey()
  const headers = new Headers(options?.headers || {})
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (key) headers.set('Authorization', `Bearer ${key}`)

  const res = await fetch(API_BASE + path, { ...options, headers })

  if (res.status === 401) {
    clearApiKey()
    try {
      window.dispatchEvent(new Event('seme:unauthorized'))
    } catch {
      /* ignore */
    }
    throw new Error('Unauthorized')
  }

  return res.json()
}

function qs(params?: Record<string, string>) {
  return params ? '?' + new URLSearchParams(params).toString() : ''
}

export const semeApi = {
  health: () => apiFetch('/health'),
  memories: (params?: Record<string, string>) => apiFetch('/memories' + qs(params)),
  entities: (params?: Record<string, string>) => apiFetch('/entities' + qs(params)),
  entityByName: (name: string) => apiFetch('/entities/name/' + encodeURIComponent(name)),
  relationships: (params?: Record<string, string>) => apiFetch('/relationships' + qs(params)),
  wiki: (params?: Record<string, string>) => apiFetch('/wiki' + qs(params)),
  tasks: (params?: Record<string, string>) => apiFetch('/tasks' + qs(params)),
  profile: () => apiFetch('/profile'),

  // Retrieval
  search: (query: string, opts?: any) =>
    apiFetch('/graph/search', {
      method: 'POST',
      body: JSON.stringify({ user_message: query, ...opts }),
    }),
  retrieve: (sessionId: string, userMessage: string, hint?: any) =>
    apiFetch(`/sessions/${encodeURIComponent(sessionId)}/retrieve`, {
      method: 'POST',
      body: JSON.stringify({ user_message: userMessage, ...hint }),
    }),

  // Ingestion
  submitText: (text: string, title?: string) =>
    apiFetch('/ingest/source', {
      method: 'POST',
      body: JSON.stringify({ text, title: title || 'Web Submission', session_id: 'web' }),
    }),
  submitUrl: (url: string) =>
    apiFetch('/ingest/source', {
      method: 'POST',
      body: JSON.stringify({ url, session_id: 'web' }),
    }),
  recordTurn: (sessionId: string, role: string, content: string) =>
    apiFetch(`/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ role, content }),
    }),
  endSession: (sessionId: string) =>
    apiFetch('/sessions/' + encodeURIComponent(sessionId) + '/end', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // Graph
  graphSnapshot: () => apiFetch('/graph/snapshot'),
  graphNeighborhood: (entityId: string, depth = 2) =>
    apiFetch(`/graph/neighborhood/${encodeURIComponent(entityId)}?depth=${depth}`),
  graphPath: (fromId: string, toId: string) =>
    apiFetch(`/graph/path/${encodeURIComponent(fromId)}/${encodeURIComponent(toId)}`),

  // Knowledge base
  lint: () => apiFetch('/kb/lint', { method: 'POST' }),
  stats: () => apiFetch('/kb/lint', { method: 'POST' }),
}

export { API_BASE }