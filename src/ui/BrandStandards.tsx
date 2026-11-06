import { useGame, useGameActions } from '../store/gameStore'
import type { BusGroup } from '../engine/types'
import { resolveStandard } from '../engine/sim/brandModifiers'

/** Coach age cap for one brand, shown next to its odometer milestone. Blank follows the operator. */
export function AgeCapInput({ group }: { group: BusGroup }) {
  const s = useGame((x) => x.state)!
  const g = useGameActions()
  const own = group.maxBusAgeYears
  const inherited = resolveStandard(s.groups, group, 'maxBusAgeYears')
  return (
    <div className="flex" style={{ alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span className="dim small" style={{ whiteSpace: 'nowrap' }}>Replace after</span>
      <input
        key={`${group.id}-age-${own ?? 'x'}`}
        type="number"
        min={1}
        max={30}
        style={{ width: 62 }}
        defaultValue={own ?? ''}
        placeholder={inherited.value !== undefined ? String(inherited.value) : 'no cap'}
        title="Coaches older than this are flagged for replacement. Blank follows the operator above, or no cap."
        onBlur={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            if (own !== undefined) g.updateGroup(group.id, { maxBusAgeYears: undefined })
            return
          }
          const n = Math.round(Number(raw))
          if (!Number.isFinite(n) || n < 1 || n > 30) {
            g.toast('Enter 1 to 30 years.', 'bad')
            e.target.value = own !== undefined ? String(own) : ''
            return
          }
          if (n !== own) g.updateGroup(group.id, { maxBusAgeYears: n })
        }}
      />
      <span className="dim small">yrs</span>
      {own !== undefined ? (
        <button
          type="button"
          className="small text"
          style={{ fontSize: '0.72rem', color: 'var(--info)' }}
          title="Clear this brand's own cap"
          onClick={() => g.updateGroup(group.id, { maxBusAgeYears: undefined })}
        >
          ↺
        </button>
      ) : inherited.from ? (
        <span className="dim small">from {inherited.from.code}</span>
      ) : null}
    </div>
  )
}
