import { AMENITY_CATALOG, AMENITY_GROUPS } from '../engine/data/amenitiesCatalog'
import { fmtCompact } from '../engine/core/money'

interface Props {
  value: Record<string, boolean | undefined>
  onChange: (id: string, on: boolean) => void
}

// Cheapest first, reading left to right. Ties keep group/catalog order.
const GROUP_RANK = new Map(AMENITY_GROUPS.map((g, i) => [g.id, i]))
const ORDERED = [...AMENITY_CATALOG].sort(
  (a, b) => a.cost - b.cost || (GROUP_RANK.get(a.group) ?? 0) - (GROUP_RANK.get(b.group) ?? 0),
)

/**
 * Flat 3-column amenity checklist, ordered by price. Each row is the name with
 * its per-pax price and PSS effect below it; the description is a tooltip.
 */
export function AmenityPicker({ value, onChange }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px 12px' }}>
      {ORDERED.map((a) => (
        <label
          key={a.id}
          className="flex"
          style={{ alignItems: 'flex-start', gap: 6 }}
          title={`${a.blurb}${a.nightOnly ? ' (night departures only)' : ''}`}
        >
          <input
            type="checkbox"
            checked={!!value[a.id]}
            onChange={(e) => onChange(a.id, e.target.checked)}
          />
          <div>
            <b>{a.title}</b>
            <div className="small">
              {fmtCompact(a.cost)}/pax{a.nightOnly ? ' night' : ''}
              {' '}
              <span className="small good">+{a.pssBonus} PSS</span>
            </div>
          </div>
        </label>
      ))}
    </div>
  )
}
