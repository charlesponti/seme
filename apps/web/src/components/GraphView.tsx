import { useEffect, useMemo, useRef, useState } from 'react'

export interface GraphEntity {
  id: string
  name: string
  type: string
  mention_count?: number
  confidence?: number
}
export interface GraphRelationship {
  id: string
  source_id: string
  target_id: string
  relation_type: string
  mention_count?: number
}

interface Props {
  entities: GraphEntity[]
  relationships: GraphRelationship[]
  height?: number
  onSelect?: (entity: GraphEntity | null) => void
}

interface Node extends GraphEntity {
  x: number
  y: number
  vx: number
  vy: number
}

const TYPE_COLORS: Record<string, string> = {
  person: '#3b82f6',
  organization: '#22c55e',
  place: '#eab308',
  tool: '#a855f7',
  animal: '#ef4444',
  topic: '#06b6d4',
  project: '#f97316',
  preference: '#ec4899',
}

const colorFor = (type: string) => TYPE_COLORS[type] ?? '#94a3b8'

/**
 * Dependency-free force-directed graph.
 * Repulsion between all nodes, spring attraction along edges, weak centering.
 */
export default function GraphView({ entities, relationships, height = 520, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [nodes, setNodes] = useState<Node[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const rafRef = useRef(0)
  const nodesRef = useRef<Node[]>([])

  // Track container width
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800))
    ro.observe(el)
    setWidth(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  // Build initial layout when data changes
  useEffect(() => {
    const cx = width / 2
    const cy = height / 2
    const r = Math.min(width, height) * 0.32
    const next: Node[] = entities.map((e, i) => {
      const a = (i / Math.max(1, entities.length)) * Math.PI * 2
      return {
        ...e,
        x: cx + Math.cos(a) * r * (0.5 + Math.random() * 0.5),
        y: cy + Math.sin(a) * r * (0.5 + Math.random() * 0.5),
        vx: 0,
        vy: 0,
      }
    })
    nodesRef.current = next
    setNodes(next)
  }, [entities, width, height])

  // Simulation loop
  useEffect(() => {
    if (nodesRef.current.length === 0) return
    const links = relationships
      .map((r) => ({
        s: entities.findIndex((e) => e.id === r.source_id),
        t: entities.findIndex((e) => e.id === r.target_id),
      }))
      .filter((l) => l.s >= 0 && l.t >= 0)

    let ticks = 0
    const MAX_TICKS = 400

    const step = () => {
      const ns = nodesRef.current
      const cx = width / 2
      const cy = height / 2
      const kRepulse = 2600
      const kSpring = 0.012
      const restLen = Math.min(width, height) * 0.28
      const damping = 0.86

      // Repulsion
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i]
          const b = ns[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = 1
          }
          const d = Math.sqrt(d2)
          const f = kRepulse / d2
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }

      // Springs
      for (const l of links) {
        const a = ns[l.s]
        const b = ns[l.t]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const f = (d - restLen) * kSpring
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      // Centering + integrate + clamp
      const pad = 46
      for (const n of ns) {
        if (dragRef.current?.id === n.id) {
          n.vx = 0
          n.vy = 0
          continue
        }
        n.vx += (cx - n.x) * 0.0016
        n.vy += (cy - n.y) * 0.0016
        n.vx *= damping
        n.vy *= damping
        n.x += n.vx
        n.y += n.vy
        n.x = Math.max(pad, Math.min(width - pad, n.x))
        n.y = Math.max(pad, Math.min(height - pad, n.y))
      }

      setNodes([...ns])
      ticks++
      if (ticks < MAX_TICKS) rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [entities, relationships, width, height])

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const n = nodeById.get(id)
    if (!n) return
    dragRef.current = { id, dx: n.x - (e.clientX - rect.left), dy: n.y - (e.clientY - rect.top) }
    ;(e.target as Element).setPointerCapture(e.pointerId)
    // restart the sim briefly so drag feels live
    const ns = nodesRef.current
    let ticks = 0
    const live = () => {
      const node = ns.find((x) => x.id === id)
      if (node && dragRef.current) {
        const r = wrapRef.current?.getBoundingClientRect()
        if (r) {
          node.x = Math.max(20, Math.min(width - 20, e.clientX - r.left + dragRef.current.dx))
          node.y = Math.max(20, Math.min(height - 20, e.clientY - r.top + dragRef.current.dy))
          node.vx = 0
          node.vy = 0
        }
        setNodes([...ns])
      }
      ticks++
      if (ticks < 120 && dragRef.current) rafRef.current = requestAnimationFrame(live)
    }
    rafRef.current = requestAnimationFrame(live)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  if (entities.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground"
        style={{ height }}
      >
        No entities yet — submit some text to build the graph.
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl border border-border bg-card" style={{ height }}>
      <svg width={width} height={height} className="block touch-none select-none">
        {/* edges */}
        {relationships.map((r) => {
          const a = nodeById.get(r.source_id)
          const b = nodeById.get(r.target_id)
          if (!a || !b) return null
          const active = hover === r.source_id || hover === r.target_id
          return (
            <g key={r.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? '#60a5fa' : '#3f3f46'}
                strokeWidth={active ? 2 : 1.2}
                opacity={hover && !active ? 0.3 : 0.9}
              />
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#71717a"
                opacity={hover && !active ? 0.2 : 1}
              >
                {r.relation_type}
              </text>
            </g>
          )
        })}

        {/* nodes */}
        {nodes.map((n) => {
          const r = 10 + Math.min(14, (n.mention_count ?? 1) * 2)
          const hovered = hover === n.id
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className="cursor-pointer"
              onPointerDown={(e) => onPointerDown(e, n.id)}
              onPointerUp={onPointerUp}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onSelect?.(hovered ? n : n)}
            >
              <circle
                r={r + (hovered ? 4 : 0)}
                fill={colorFor(n.type)}
                fillOpacity={hovered ? 0.35 : 0.16}
              />
              <circle r={r} fill={colorFor(n.type)} stroke="#0a0a0a" strokeWidth={1.5} />
              <text
                y={r + 12}
                textAnchor="middle"
                fontSize={11}
                fill={hovered ? '#fafafa' : '#a1a1aa'}
                className="pointer-events-none"
              >
                {n.name}
              </text>
            </g>
          )
        })}
      </svg>

      {/* legend */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {[...new Set(nodes.map((n) => n.type))].map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 backdrop-blur">
            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(t) }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}