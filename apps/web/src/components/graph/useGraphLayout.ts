import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ForceLayout,
  hashGraph,
  layoutStorageKey,
  loadLayout,
  saveLayout,
  saveNodePosition,
  type LayoutPoint,
} from '../../lib/graphLayout'
import type { GraphIndex } from '../../lib/graphModel'

export interface GraphLayoutState {
  points: Map<string, LayoutPoint> | null
  running: boolean
  storageKey: string
  relayout: () => void
  persistNode: (id: string, point: LayoutPoint) => void
}

/**
 * Computes (or restores) the frozen layout for the whole dataset.
 * Positions are persisted per dataset hash; re-layout recomputes and replaces
 * them. The simulation runs in small time-boxed chunks so the first paint
 * stays responsive while it settles.
 */
export function useGraphLayout(index: GraphIndex): GraphLayoutState {
  const storageKey = useMemo(
    () => layoutStorageKey(hashGraph(index.entities.map((e) => e.id), index.relationships.map((r) => r.id))),
    [index],
  )

  const [points, setPoints] = useState<Map<string, LayoutPoint> | null>(null)
  const [running, setRunning] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ids = index.entities.map((e) => e.id)
    if (ids.length === 0) {
      setPoints(new Map())
      setRunning(false)
      return
    }

    const positionOf = new Map<string, number>()
    ids.forEach((id, i) => positionOf.set(id, i))
    const links: Array<[number, number]> = []
    for (const r of index.relationships) {
      const s = positionOf.get(r.source_id)
      const t = positionOf.get(r.target_id)
      if (s !== undefined && t !== undefined) links.push([s, t])
    }

    if (nonce === 0) {
      const stored = loadLayout(storageKey, ids)
      if (stored) {
        setPoints(stored.points)
        setRunning(false)
        return
      }
    }

    const seed = nonce === 0 ? parseInt(hashGraph(ids, []), 36) >>> 0 : (Date.now() & 0xffffffff) >>> 0
    const sim = new ForceLayout(ids, links, seed)
    let raf = 0
    let cancelled = false
    setRunning(true)

    const tick = () => {
      if (cancelled) return
      const start = performance.now()
      do {
        sim.step(1)
      } while (!sim.done && performance.now() - start < 9)
      if (sim.done) {
        const next = sim.positions()
        saveLayout(storageKey, seed, next)
        if (!cancelled) {
          setPoints(next)
          setRunning(false)
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [index, storageKey, nonce])

  const relayout = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  const persistNode = useCallback(
    (id: string, point: LayoutPoint) => {
      saveNodePosition(storageKey, id, point)
    },
    [storageKey],
  )

  return { points, running, storageKey, relayout, persistNode }
}
