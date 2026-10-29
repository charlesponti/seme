import { useMemo } from 'react'
import { groupConnections, type Connection } from '../../lib/graphModel'

interface Props {
  connections: Connection[]
  onNavigate: (id: string) => void
}

/**
 * The grouped connection list used by the graph detail panel and the entity
 * detail page. One row per connection, grouped by relationship type with mono
 * group headers; never truncated.
 */
export function ConnectionList({ connections, onNavigate }: Props) {
  const groups = useMemo(() => groupConnections(connections), [connections])

  if (groups.length === 0) {
    return <p className="px-2 py-2 text-[12px] text-[#888888]">No connections.</p>
  }

  return (
    <div>
      {groups.map((group) => (
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
      ))}
    </div>
  )
}
