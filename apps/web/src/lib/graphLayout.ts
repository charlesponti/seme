// src/lib/graphLayout.ts
//
// Frozen force-directed layout for the graph route.
//
// The layout is computed once per dataset (Barnes–Hut approximation of
// many-body repulsion + edge springs + weak gravity), then persisted in
// localStorage keyed by a hash of the node/edge ids. Reloading the page
// therefore restores the exact same map; only an explicit re-layout replaces
// it.

export interface LayoutPoint {
  x: number
  y: number
}

const STORAGE_PREFIX = 'seme.graph.layout.v1.'

/** Order-independent FNV-1a digest of the dataset's node and edge ids. */
export function hashGraph(entityIds: string[], relationshipIds: string[]): string {
  let h = 2166136261
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x3b
    h = Math.imul(h, 16777619)
  }
  entityIds.slice().sort().forEach(feed)
  relationshipIds.slice().sort().forEach(feed)
  return (h >>> 0).toString(36)
}

export function layoutStorageKey(hash: string): string {
  return STORAGE_PREFIX + hash
}

interface StoredLayout {
  version: 1
  seed: number
  points: Record<string, [number, number]>
}

function readStored(key: string): StoredLayout | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredLayout
    if (parsed?.version !== 1 || typeof parsed.points !== 'object' || parsed.points === null) return null
    return parsed
  } catch {
    return null
  }
}

export function loadLayout(key: string, entityIds: string[]): { seed: number; points: Map<string, LayoutPoint> } | null {
  const stored = readStored(key)
  if (!stored) return null
  const points = new Map<string, LayoutPoint>()
  for (const id of entityIds) {
    const p = stored.points[id]
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return null // incomplete cache — recompute rather than half-restore
    }
    points.set(id, { x: p[0], y: p[1] })
  }
  return { seed: stored.seed, points }
}

export function saveLayout(key: string, seed: number, points: Map<string, LayoutPoint>): void {
  if (typeof window === 'undefined') return
  try {
    const out: Record<string, [number, number]> = {}
    for (const [id, p] of points) out[id] = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]
    const payload: StoredLayout = { version: 1, seed, points: out }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    /* storage full or unavailable — layout still works for this visit */
  }
}

/** Persist a single dragged node without rewriting the whole layout object. */
export function saveNodePosition(key: string, id: string, point: LayoutPoint): void {
  if (typeof window === 'undefined') return
  const stored = readStored(key)
  if (!stored) return
  stored.points[id] = [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]
  try {
    window.localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    /* ignore */
  }
}

// --- Simulation -----------------------------------------------------------

interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number
  fy: number
}

interface Cell {
  x0: number
  y0: number
  x1: number
  y1: number
  mass: number
  cx: number
  cy: number
  point: number
  children: Cell[] | null
}

const THETA = 0.9
const THETA2 = THETA * THETA
const REPULSION = 1100
const MAX_REPULSION = 4
const MAX_SPRING = 20
const MAX_SPEED = 60
const LINK_DISTANCE = 34
const LINK_STRENGTH = 0.06
const GRAVITY = 0.003
const DAMPING = 0.7
const MAX_DEPTH = 20

function clampForce(value: number): number {
  return Math.max(-MAX_SPRING, Math.min(MAX_SPRING, value))
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildCell(nodes: SimNode[], indices: number[], x0: number, y0: number, x1: number, y1: number, depth: number): Cell {
  const cell: Cell = { x0, y0, x1, y1, mass: 0, cx: 0, cy: 0, point: -1, children: null }
  if (indices.length === 0) return cell
  if (indices.length === 1) {
    const n = nodes[indices[0]]
    cell.point = indices[0]
    cell.cx = n.x
    cell.cy = n.y
    cell.mass = 1
    return cell
  }
  if (depth >= MAX_DEPTH) {
    let sx = 0
    let sy = 0
    for (const i of indices) {
      sx += nodes[i].x
      sy += nodes[i].y
    }
    cell.mass = indices.length
    cell.cx = sx / indices.length
    cell.cy = sy / indices.length
    return cell
  }
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const quads: number[][] = [[], [], [], []]
  for (const i of indices) {
    const n = nodes[i]
    const q = (n.x < mx ? 0 : 1) + (n.y < my ? 0 : 2)
    quads[q].push(i)
  }
  cell.children = [
    buildCell(nodes, quads[0], x0, y0, mx, my, depth + 1),
    buildCell(nodes, quads[1], mx, y0, x1, my, depth + 1),
    buildCell(nodes, quads[2], x0, my, mx, y1, depth + 1),
    buildCell(nodes, quads[3], mx, my, x1, y1, depth + 1),
  ]
  let mass = 0
  let sx = 0
  let sy = 0
  for (const child of cell.children) {
    if (child.mass > 0) {
      sx += child.cx * child.mass
      sy += child.cy * child.mass
      mass += child.mass
    }
  }
  cell.mass = mass
  cell.cx = mass > 0 ? sx / mass : 0
  cell.cy = mass > 0 ? sy / mass : 0
  return cell
}

function applyAggregate(node: SimNode, cell: Cell, index: number, strength: number) {
  if (cell.mass === 0) return
  let dx = node.x - cell.cx
  let dy = node.y - cell.cy
  let d2 = dx * dx + dy * dy
  if (d2 < 0.01) {
    dx = ((index % 7) - 3) * 0.5 + 0.1
    dy = ((index % 5) - 2) * 0.5 + 0.1
    d2 = dx * dx + dy * dy
  }
  const inv = 1 / Math.sqrt(d2)
  const f = Math.min(MAX_REPULSION, strength * cell.mass / d2)
  node.fx += dx * inv * f
  node.fy += dy * inv * f
}

function applyRepulsion(node: SimNode, cell: Cell, index: number) {
  if (cell.mass === 0) return
  if (!cell.children) {
    if (cell.point === index) return
    if (cell.point >= 0) {
      let dx = node.x - cell.cx
      let dy = node.y - cell.cy
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) {
        dx = ((index % 7) - 3) * 0.5 + 0.1
        dy = ((index % 5) - 2) * 0.5 + 0.1
        d2 = dx * dx + dy * dy
      }
      const inv = 1 / Math.sqrt(d2)
      const f = Math.min(MAX_REPULSION, REPULSION / d2)
      node.fx += dx * inv * f
      node.fy += dy * inv * f
      return
    }
    applyAggregate(node, cell, index, REPULSION)
    return
  }
  const dx = node.x - cell.cx
  const dy = node.y - cell.cy
  const d2 = dx * dx + dy * dy
  const size = Math.max(cell.x1 - cell.x0, cell.y1 - cell.y0)
  if (d2 > 0 && (size * size) / d2 < THETA2) {
    applyAggregate(node, cell, index, REPULSION)
    return
  }
  for (const child of cell.children) applyRepulsion(node, child, index)
}

export class ForceLayout {
  readonly nodes: SimNode[]
  private readonly links: Array<[number, number]>
  alpha = 1

  constructor(ids: string[], links: Array<[number, number]>, seed: number) {
    const rng = mulberry32(seed)
    const n = ids.length
    const radius = 26 * Math.sqrt(Math.max(1, n))
    this.links = links
    this.nodes = ids.map((id, i) => {
      const angle = i * 2.399963229728653 + rng() * 0.6
      const r = radius * Math.sqrt((i + 0.5) / Math.max(1, n)) * (0.85 + rng() * 0.3)
      return {
        id,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      }
    })
  }

  get done(): boolean {
    return this.alpha <= 0.021
  }

  step(batch = 1): void {
    const nodes = this.nodes
    if (nodes.length === 0) {
      this.alpha = 0
      return
    }
    for (let b = 0; b < batch; b++) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of nodes) {
        n.fx = 0
        n.fy = 0
        if (n.x < minX) minX = n.x
        if (n.y < minY) minY = n.y
        if (n.x > maxX) maxX = n.x
        if (n.y > maxY) maxY = n.y
      }
      const pad = 1
      const size = Math.max(maxX - minX, maxY - minY, 1)
      const root = buildCell(
        nodes,
        nodes.map((_, i) => i),
        minX - pad,
        minY - pad,
        minX - pad + size + pad * 2,
        minY - pad + size + pad * 2,
        0,
      )
      for (let i = 0; i < nodes.length; i++) applyRepulsion(nodes[i], root, i)

      for (const [s, t] of this.links) {
        const a = nodes[s]
        const c = nodes[t]
        if (!a || !c) continue
        const dx = c.x - a.x
        const dy = c.y - a.y
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const f = clampForce((d - LINK_DISTANCE) * LINK_STRENGTH)
        const ux = dx / d
        const uy = dy / d
        a.fx += ux * f
        a.fy += uy * f
        c.fx -= ux * f
        c.fy -= uy * f
      }

      const alpha = this.alpha
      for (const n of nodes) {
        n.fx -= n.x * GRAVITY
        n.fy -= n.y * GRAVITY
        n.vx = (n.vx + n.fx * alpha) * DAMPING
        n.vy = (n.vy + n.fy * alpha) * DAMPING
        n.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vx))
        n.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vy))
        n.x += n.vx
        n.y += n.vy
      }
      this.alpha = Math.max(0.02, this.alpha * 0.985)
    }
  }

  positions(): Map<string, LayoutPoint> {
    const out = new Map<string, LayoutPoint>()
    for (const n of this.nodes) out.set(n.id, { x: n.x, y: n.y })
    return out
  }
}
