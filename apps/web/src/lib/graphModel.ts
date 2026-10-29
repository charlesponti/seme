// src/lib/graphModel.ts
//
// Pure graph model helpers for the graph route: typing, adjacency, degree and
// the initial "top N by degree" selection. No rendering, no fetching.

export interface GraphEntity {
  id: string
  name: string
  type: string
  aliases?: string[]
  description?: string | null
  first_seen_at?: string | null
  last_seen_at?: string | null
  mention_count?: number
  confidence?: number
}

export interface GraphRelationship {
  id: string
  source_id: string
  target_id: string
  relation_type: string
  mention_count?: number
  confidence?: number
}

export interface GraphIndex {
  entities: GraphEntity[]
  relationships: GraphRelationship[]
  byId: Map<string, GraphEntity>
  /** relationship rows touching each entity */
  edges: Map<string, GraphRelationship[]>
  /** number of relationship rows touching each entity */
  degree: Map<string, number>
  /** neighbours, unique entities */
  neighbours: Map<string, Set<string>>
}

export function buildGraphIndex(entities: GraphEntity[], relationships: GraphRelationship[]): GraphIndex {
  const byId = new Map<string, GraphEntity>()
  for (const e of entities) byId.set(e.id, e)

  const edges = new Map<string, GraphRelationship[]>()
  const degree = new Map<string, number>()
  const neighbours = new Map<string, Set<string>>()
  for (const e of entities) {
    edges.set(e.id, [])
    degree.set(e.id, 0)
    neighbours.set(e.id, new Set())
  }

  for (const r of relationships) {
    if (!byId.has(r.source_id) || !byId.has(r.target_id)) continue
    edges.get(r.source_id)!.push(r)
    if (r.target_id !== r.source_id) edges.get(r.target_id)!.push(r)
    degree.set(r.source_id, (degree.get(r.source_id) ?? 0) + 1)
    if (r.target_id !== r.source_id) degree.set(r.target_id, (degree.get(r.target_id) ?? 0) + 1)
    neighbours.get(r.source_id)!.add(r.target_id)
    neighbours.get(r.target_id)!.add(r.source_id)
  }

  return { entities, relationships, byId, edges, degree, neighbours }
}

/** Top `count` entities by degree, ties broken by name for determinism. */
export function topByDegree(index: GraphIndex, count: number): string[] {
  return index.entities
    .slice()
    .sort((a, b) => {
      const da = index.degree.get(a.id) ?? 0
      const db = index.degree.get(b.id) ?? 0
      if (db !== da) return db - da
      return a.name.localeCompare(b.name)
    })
    .slice(0, count)
    .map((e) => e.id)
}

export function visibleEdgeCount(index: GraphIndex, visible: Set<string>): number {
  let n = 0
  for (const r of index.relationships) {
    if (visible.has(r.source_id) && visible.has(r.target_id)) n++
  }
  return n
}

/** A connection row from the perspective of one entity. */
export interface Connection {
  relationship: GraphRelationship
  other: GraphEntity | null
  otherId: string
  direction: 'out' | 'in'
}

export function connectionsFor(index: GraphIndex, id: string): Connection[] {
  const rows = index.edges.get(id) ?? []
  return rows.map((relationship) => {
    const out = relationship.source_id === id
    const otherId = out ? relationship.target_id : relationship.source_id
    return {
      relationship,
      other: index.byId.get(otherId) ?? null,
      otherId,
      direction: out ? 'out' : 'in',
    }
  })
}

export function groupConnections(rows: Connection[]): Array<{ type: string; rows: Connection[] }> {
  const groups = new Map<string, Connection[]>()
  for (const row of rows) {
    const key = row.relationship.relation_type || 'RELATED_TO'
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, groupRows]) => ({ type, rows: groupRows }))
}
