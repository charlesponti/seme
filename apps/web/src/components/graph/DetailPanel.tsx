import { useMemo } from 'react'
import { groupConnections, type Connection, type GraphEntity } from '../../lib/graphModel'

interface Props {
  entity: GraphEntity | null
  connections: Connection[]
  degree: number
  onClose: () => void
  onExpand: (id: string) => void
  onNavigate: (id: string) => void
}

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export function DetailPanel({ entity, connections, degree, onClose, onExpand, onNavigate }: Props) {
  const groups = useMemo(() => groupConnections(connections), [connections])
  const firstSeen = formatDate(entity?.first_seen_at)
  const lastSeen = formatDate(entity?.last_seen_at)

  return (
    <aside
      aria-hidden={!entity}
      aria-label="Entity detail"
      className={`absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-[#eaeaea] bg-white transition-transform duration-150 ease-out motion-reduce:transition-none ${
        entity ? 'translate-x-0' : 'pointer-events-none translate-x-full'
      }`}
    >
      {entity && (
        <>
          <div className="border-b border-[#eaeaea] px-4 pb-3 pt-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-serif text-[20px] leading-7 text-[#171717]">{entity.name}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close detail panel"
                className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[16px] leading-none text-[#888888] hover:bg-[#f5f5f5] hover:text-[#171717]"
              >
                ×
              </button>
            </div>
            <p className="mt-1 font-mono text-[12px] leading-[18px] uppercase tracking-[0.04em] text-[#666666]">
              {entity.type} · {degree} {degree === 1 ? 'connection' : 'connections'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onExpand(entity.id)}
                className="h-8 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
              >
                Expand neighbors
              </button>
              <a
                href={`/entities?entity=${encodeURIComponent(entity.id)}`}
                className="inline-flex h-8 items-center rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
              >
                View entity
              </a>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <div className="px-2 pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#888888]">
              Connections · {connections.length}
            </div>
            {groups.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-[#888888]">No connections.</p>
            ) : (
              groups.map((group) => (
                <section key={group.type} className="mb-2">
                  <div className="px-2 py-1 font-mono text-[11px] uppercase leading-[18px] tracking-[0.08em] text-[#888888]">
                    {group.type} · {group.rows.length}
                  </div>
                  {group.rows.map((row) => (
                    <button
                      key={row.relationship.id}
                      type="button"
                      onClick={() => onNavigate(row.otherId)}
                      className="group flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-[#f5f5f5]"
                    >
                      <span className="truncate text-[13px] leading-5 text-[#171717]">
                        {row.other?.name ?? row.otherId.slice(0, 8)}
                      </span>
                      <span aria-hidden className="font-mono text-[12px] text-[#888888] group-hover:text-[#171717]">
                        →
                      </span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>

          <div className="border-t border-[#eaeaea] px-4 py-3 font-mono text-[11px] leading-[18px] text-[#888888]">
            {firstSeen && <div>first seen {firstSeen}</div>}
            {lastSeen && <div>last seen {lastSeen}</div>}
            {typeof entity.confidence === 'number' && <div>confidence {entity.confidence.toFixed(2)}</div>}
          </div>
        </>
      )}
    </aside>
  )
}
