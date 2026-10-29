import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { GraphIndex, GraphRelationship } from '../../lib/graphModel'
import type { LayoutPoint } from '../../lib/graphLayout'

export interface GraphCanvasHandle {
  flyTo: (id: string) => void
  resetView: () => void
  zoomBy: (factor: number) => void
}

interface Props {
  index: GraphIndex
  points: Map<string, LayoutPoint> | null
  visible: Set<string>
  selectedId: string | null
  panelOpen: boolean
  onSelect: (id: string | null) => void
  onExpand: (id: string) => void
  persistNode: (id: string, point: LayoutPoint) => void
}

interface Camera {
  x: number
  y: number
  k: number
}

interface Tooltip {
  x: number
  y: number
  kind: 'node' | 'edge'
  title: string
  sub: string
}

const COLOR = {
  ink: '#171717',
  secondary: '#666666',
  faint: '#e5e5e5',
  edge: '#d9d9d9',
} as const

const PANEL_WIDTH = 320
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const LABEL_FONT = '11px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function radiusFor(degree: number): number {
  return clamp(Math.sqrt(Math.max(1, degree)) * 2.4, 3, 14)
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = clamp(t, 0, 1)
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const dataRef = useRef(props)
  dataRef.current = props

  const camRef = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 })
  const rafRef = useRef(0)
  const animUntilRef = useRef(0)
  const flightRef = useRef<{ from: Camera; to: Camera; start: number; dur: number } | null>(null)

  const appearRef = useRef(new Map<string, number>())
  const prevVisibleRef = useRef<Set<string>>(new Set())
  const hoverRef = useRef<string | null>(null)
  const interactionRef = useRef<
    | {
        mode: 'pan'
        startX: number
        startY: number
        camX: number
        camY: number
        moved: boolean
      }
    | {
        mode: 'node'
        id: string
        offsetX: number
        offsetY: number
        startX: number
        startY: number
        moved: boolean
      }
    | null
  >(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null)
  const fittedRef = useRef<Map<string, LayoutPoint> | null>(null)

  const [tip, setTip] = useState<Tooltip | null>(null)

  const nodeAt = useCallback((sx: number, sy: number): string | null => {
    const { points, visible, index } = dataRef.current
    if (!points) return null
    const cam = camRef.current
    let hit: string | null = null
    for (const id of visible) {
      const p = points.get(id)
      if (!p) continue
      const x = (p.x - cam.x) * cam.k + sizeRef.current.w / 2
      const y = (p.y - cam.y) * cam.k + sizeRef.current.h / 2
      const r = Math.max(6, radiusFor(index.degree.get(id) ?? 0) + 4)
      if ((sx - x) * (sx - x) + (sy - y) * (sy - y) <= r * r) hit = id
    }
    return hit
  }, [])

  const edgeAt = useCallback((sx: number, sy: number): GraphRelationship | null => {
    const { points, visible, index, selectedId } = dataRef.current
    if (!points || !selectedId) return null
    const cam = camRef.current
    const { w, h } = sizeRef.current
    let best: GraphRelationship | null = null
    let bestDist = 6
    for (const rel of index.relationships) {
      if (rel.source_id !== selectedId && rel.target_id !== selectedId) continue
      if (!visible.has(rel.source_id) || !visible.has(rel.target_id)) continue
      const a = points.get(rel.source_id)
      const b = points.get(rel.target_id)
      if (!a || !b) continue
      const ax = (a.x - cam.x) * cam.k + w / 2
      const ay = (a.y - cam.y) * cam.k + h / 2
      const bx = (b.x - cam.x) * cam.k + w / 2
      const by = (b.y - cam.y) * cam.k + h / 2
      const d = distanceToSegment(sx, sy, ax, ay, bx, by)
      if (d < bestDist) {
        bestDist = d
        best = rel
      }
    }
    return best
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = sizeRef.current
    const { points, visible, index, selectedId } = dataRef.current
    const cam = camRef.current

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    if (!points || visible.size === 0) return

    const now = performance.now()
    const sx = (x: number) => (x - cam.x) * cam.k + w / 2
    const sy = (y: number) => (y - cam.y) * cam.k + h / 2
    const inView = (x: number, y: number) => x > -80 && x < w + 80 && y > -80 && y < h + 80

    const neighbour = selectedId ? index.neighbours.get(selectedId) : undefined

    // Edges: normal pass, then the selection's edges on top.
    const drawEdges = (highlighted: boolean) => {
      for (const rel of index.relationships) {
        if (!visible.has(rel.source_id) || !visible.has(rel.target_id)) continue
        const touches = selectedId !== null && (rel.source_id === selectedId || rel.target_id === selectedId)
        if (touches !== highlighted) continue
        const a = points.get(rel.source_id)
        const b = points.get(rel.target_id)
        if (!a || !b) continue
        const x1 = sx(a.x)
        const y1 = sy(a.y)
        const x2 = sx(b.x)
        const y2 = sy(b.y)
        if (!inView(x1, y1) && !inView(x2, y2)) continue
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = touches ? COLOR.ink : COLOR.edge
        ctx.lineWidth = touches ? 1.5 : 1
        ctx.stroke()
      }
    }
    drawEdges(false)
    drawEdges(true)

    const drawNode = (id: string) => {
      const p = points.get(id)
      if (!p) return
      const x = sx(p.x)
      const y = sy(p.y)
      if (!inView(x, y)) return
      const degree = index.degree.get(id) ?? 0
      let r = radiusFor(degree)
      const started = appearRef.current.get(id)
      let alpha = 1
      if (started !== undefined) {
        const t = clamp((now - started) / 200, 0, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        r *= 0.4 + 0.6 * eased
        alpha = 0.2 + 0.8 * eased
      }
      r = Math.max(1.6, r)
      const isSelected = id === selectedId
      const isNeighbour = neighbour ? neighbour.has(id) : false
      const faded = selectedId !== null && !isSelected && !isNeighbour

      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (isSelected) {
        ctx.fillStyle = '#000000'
        ctx.fill()
      } else if (faded) {
        ctx.fillStyle = COLOR.faint
        ctx.fill()
      } else if (isNeighbour) {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = COLOR.ink
        ctx.lineWidth = 1.5
        ctx.fill()
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    for (const id of visible) {
      if (id !== selectedId) drawNode(id)
    }
    if (selectedId && visible.has(selectedId)) drawNode(selectedId)

    // Labels
    ctx.font = LABEL_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    for (const id of visible) {
      const p = points.get(id)
      if (!p) continue
      const degree = index.degree.get(id) ?? 0
      const isSelected = id === selectedId
      const isNeighbour = neighbour ? neighbour.has(id) : false
      const isHovered = hoverRef.current === id
      const show = isSelected || isNeighbour || isHovered || (degree >= 10 && cam.k >= 1.5)
      if (!show) continue
      const entity = index.byId.get(id)
      if (!entity) continue
      const x = sx(p.x)
      const y = sy(p.y)
      if (!inView(x, y)) continue
      const r = Math.max(1.6, radiusFor(degree))
      const labelY = y + r + 4
      const faded = selectedId !== null && !isSelected && !isNeighbour
      if (faded) continue
      ctx.lineWidth = 3
      ctx.strokeStyle = '#ffffff'
      ctx.strokeText(entity.name, x, labelY)
      ctx.fillStyle = COLOR.ink
      ctx.fillText(entity.name, x, labelY)
    }
  }, [])

  const frame = useCallback(
    (now: number) => {
      rafRef.current = 0
      if (typeof document !== 'undefined' && document.hidden) return
      const flight = flightRef.current
      if (flight) {
        const t = clamp((now - flight.start) / flight.dur, 0, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        const cam = camRef.current
        cam.x = flight.from.x + (flight.to.x - flight.from.x) * eased
        cam.y = flight.from.y + (flight.to.y - flight.from.y) * eased
        cam.k = flight.from.k + (flight.to.k - flight.from.k) * eased
        if (t >= 1) flightRef.current = null
      }
      draw()
      if (flightRef.current || now < animUntilRef.current) {
        rafRef.current = requestAnimationFrame(frame)
      }
    },
    [draw],
  )

  const requestFrame = useCallback(
    (until?: number) => {
      if (until && until > animUntilRef.current) animUntilRef.current = until
      if (rafRef.current) return
      if (typeof document !== 'undefined' && document.hidden) return
      rafRef.current = requestAnimationFrame(frame)
    },
    [frame],
  )

  const fitPoints = useCallback(
    (points: Map<string, LayoutPoint>) => {
      const { visible } = dataRef.current
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const id of visible) {
        const p = points.get(id)
        if (!p) continue
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const { w, h } = sizeRef.current
      if (!Number.isFinite(minX)) {
        camRef.current = { x: 0, y: 0, k: 1 }
        requestFrame()
        return
      }
      const pad = 64
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const k = clamp(Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), MIN_ZOOM, 1.6)
      camRef.current = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k }
      flightRef.current = null
      requestFrame()
    },
    [requestFrame],
  )

  const zoomAt = useCallback(
    (x: number, y: number, factor: number) => {
      const cam = camRef.current
      const { w, h } = sizeRef.current
      const nextK = clamp(cam.k * factor, MIN_ZOOM, MAX_ZOOM)
      if (nextK === cam.k) return
      flightRef.current = null
      const wx = (x - w / 2) / cam.k + cam.x
      const wy = (y - h / 2) / cam.k + cam.y
      cam.x = wx - (x - w / 2) / nextK
      cam.y = wy - (y - h / 2) / nextK
      cam.k = nextK
      requestFrame()
    },
    [requestFrame],
  )

  useImperativeHandle(
    ref,
    () => ({
      flyTo(id: string) {
        const points = dataRef.current.points
        const p = points?.get(id)
        if (!p) return
        const cam = camRef.current
        const targetK = clamp(Math.max(cam.k, 1.15), MIN_ZOOM, 2.2)
        const shift = dataRef.current.panelOpen ? PANEL_WIDTH / 2 : 0
        const to = { x: p.x + shift / targetK, y: p.y, k: targetK }
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        if (reduce) {
          camRef.current = to
          requestFrame()
          return
        }
        flightRef.current = {
          from: { ...cam },
          to,
          start: performance.now(),
          dur: 600,
        }
        requestFrame(performance.now() + 620)
      },
      resetView() {
        const points = dataRef.current.points
        if (points) fitPoints(points)
      },
      zoomBy(factor: number) {
        const { w, h } = sizeRef.current
        zoomAt(w / 2, h / 2, factor)
      },
    }),
    [fitPoints, requestFrame, zoomAt],
  )

  // Size / DPR
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      if (hoverRef.current === null) canvas.style.cursor = 'grab'
      requestFrame()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [requestFrame])

  // Initial fit + refit after re-layout (new points identity)
  useEffect(() => {
    if (!props.points) return
    if (fittedRef.current === props.points) return
    fittedRef.current = props.points
    fitPoints(props.points)
  }, [props.points, fitPoints])

  // Track newly revealed nodes for the ≤200ms entrance
  useEffect(() => {
    const now = performance.now()
    const prev = prevVisibleRef.current
    let added = false
    for (const id of props.visible) {
      if (!prev.has(id)) {
        appearRef.current.set(id, now)
        added = true
      }
    }
    prevVisibleRef.current = new Set(props.visible)
    if (added) requestFrame(now + 220)
  }, [props.visible, requestFrame])

  // Redraw when data/selection changes
  useEffect(() => {
    requestFrame()
  }, [props.index, props.points, props.visible, props.selectedId, requestFrame])

  // Pause when the tab is hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      } else {
        requestFrame()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [requestFrame])

  // Wheel zoom (non-passive so we can prevent page scroll)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const factor = Math.exp(-delta * 0.0015)
      flightRef.current = null
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Pointer interactions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const local = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onPointerDown = (e: PointerEvent) => {
      const p = local(e)
      setTip(null)
      pointersRef.current.set(e.pointerId, p)
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
        }
        interactionRef.current = null
        return
      }
      if (pointersRef.current.size > 2) return
      canvas.setPointerCapture(e.pointerId)
      const hit = nodeAt(p.x, p.y)
      if (hit) {
        const point = dataRef.current.points?.get(hit)
        const cam = camRef.current
        const wx = (p.x - sizeRef.current.w / 2) / cam.k + cam.x
        const wy = (p.y - sizeRef.current.h / 2) / cam.k + cam.y
        interactionRef.current = {
          mode: 'node',
          id: hit,
          offsetX: (point?.x ?? wx) - wx,
          offsetY: (point?.y ?? wy) - wy,
          startX: p.x,
          startY: p.y,
          moved: false,
        }
        canvas.style.cursor = 'grabbing'
      } else {
        interactionRef.current = {
          mode: 'pan',
          startX: p.x,
          startY: p.y,
          camX: camRef.current.x,
          camY: camRef.current.y,
          moved: false,
        }
        canvas.style.cursor = 'grabbing'
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e)
      if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p)

      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const prev = pinchRef.current
        if (prev && prev.dist > 0) {
          const cam = camRef.current
          cam.x -= (midX - prev.midX) / cam.k
          cam.y -= (midY - prev.midY) / cam.k
          zoomAt(midX, midY, dist / prev.dist)
        }
        pinchRef.current = { dist, midX, midY }
        return
      }

      const interaction = interactionRef.current
      if (interaction?.mode === 'node') {
        const cam = camRef.current
        const wx = (p.x - sizeRef.current.w / 2) / cam.k + cam.x
        const wy = (p.y - sizeRef.current.h / 2) / cam.k + cam.y
        const point = dataRef.current.points?.get(interaction.id)
        if (point) {
          point.x = wx + interaction.offsetX
          point.y = wy + interaction.offsetY
        }
        if (Math.hypot(p.x - interaction.startX, p.y - interaction.startY) > 3) interaction.moved = true
        setTip(null)
        requestFrame()
        return
      }
      if (interaction?.mode === 'pan') {
        const dx = p.x - interaction.startX
        const dy = p.y - interaction.startY
        if (Math.hypot(dx, dy) > 3) interaction.moved = true
        const cam = camRef.current
        cam.x = interaction.camX - dx / cam.k
        cam.y = interaction.camY - dy / cam.k
        requestFrame()
        return
      }

      // Hover
      const hit = nodeAt(p.x, p.y)
      hoverRef.current = hit
      const canvasEl = canvas
      if (hit) {
        canvasEl.style.cursor = 'pointer'
        const entity = dataRef.current.index.byId.get(hit)
        const degree = dataRef.current.index.degree.get(hit) ?? 0
        setTip({
          x: p.x,
          y: p.y,
          kind: 'node',
          title: entity?.name ?? hit,
          sub: `${(entity?.type ?? 'entity').toUpperCase()} · ${degree} CONNECTIONS`,
        })
        requestFrame()
        return
      }
      const rel = edgeAt(p.x, p.y)
      if (rel) {
        canvasEl.style.cursor = 'pointer'
        setTip({ x: p.x, y: p.y, kind: 'edge', title: rel.relation_type, sub: 'RELATIONSHIP' })
        return
      }
      canvasEl.style.cursor = 'grab'
      setTip(null)
      if (hoverRef.current !== null) {
        hoverRef.current = null
        requestFrame()
      }
    }

    const finish = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      const interaction = interactionRef.current
      interactionRef.current = null
      if (!interaction) return
      canvas.style.cursor = 'grab'
      if (interaction.mode === 'node') {
        const point = dataRef.current.points?.get(interaction.id)
        if (interaction.moved && point) dataRef.current.persistNode(interaction.id, { x: point.x, y: point.y })
        if (!interaction.moved) dataRef.current.onSelect(interaction.id)
      } else if (!interaction.moved) {
        dataRef.current.onSelect(null)
      }
    }

    const onDoubleClick = (e: MouseEvent) => {
      const p = local(e)
      const hit = nodeAt(p.x, p.y)
      if (hit) dataRef.current.onExpand(hit)
    }

    const onLeave = () => {
      hoverRef.current = null
      setTip(null)
      if (!interactionRef.current) canvas.style.cursor = 'grab'
      requestFrame()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', finish)
    canvas.addEventListener('pointercancel', finish)
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', finish)
      canvas.removeEventListener('pointercancel', finish)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [edgeAt, nodeAt, requestFrame, zoomAt])

  // Keyboard: Esc deselect, +/- zoom, 0 reset
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (e.key === 'Escape') {
        dataRef.current.onSelect(null)
        setTip(null)
        return
      }
      if (typing) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        const { w, h } = sizeRef.current
        zoomAt(w / 2, h / 2, 1.25)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        const { w, h } = sizeRef.current
        zoomAt(w / 2, h / 2, 0.8)
      } else if (e.key === '0') {
        e.preventDefault()
        const points = dataRef.current.points
        if (points) fitPoints(points)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitPoints, zoomAt])

  // Cancel any pending frame on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  const { w, h } = sizeRef.current
  const tipStyle = tip
    ? {
        left: Math.min(tip.x + 14, Math.max(4, w - 210)),
        top: Math.min(tip.y + 14, Math.max(4, h - 60)),
      }
    : undefined

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-white">
      <canvas ref={canvasRef} className="block touch-none select-none" aria-label="Entity graph" role="img" />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[220px] rounded-md border border-[#eaeaea] bg-white px-2 py-1.5"
          style={{ ...tipStyle, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          <div className={tip.kind === 'node' ? 'text-[13px] leading-4 text-[#171717]' : 'font-mono text-[11px] uppercase leading-[18px] tracking-[0.08em] text-[#171717]'}>
            {tip.title}
          </div>
          <div className="mt-0.5 font-mono text-[11px] leading-[18px] text-[#666666]">{tip.sub}</div>
        </div>
      )}
    </div>
  )
})
