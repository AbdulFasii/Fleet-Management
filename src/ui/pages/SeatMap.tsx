import { fmtINR } from '../../engine/core/money'
import { tripSeatView } from '../../engine/sim/seatstate'
import { useGameState } from '../../store/gameStore'
import type { Trip } from '../../engine/types'

export function SeatMap({ trip }: { trip: Trip }) {
  const state = useGameState()
  // Cold departures keep only their sold rows; rebuild the map for display
  // without hydrating (and mutating) the live store.
  const seats = state ? tripSeatView(state, trip) : trip.seats
  if (seats.length === 0) {
    return (
      <div className="small dim">
        Seat map cleared after departure ({trip.sold}/{trip.seatCount || 0} sold).
      </div>
    )
  }
  const decks: { id: 'L' | 'U' | 'M'; label: string }[] = [
    { id: 'L', label: 'Lower berths' },
    { id: 'U', label: 'Upper berths' },
    { id: 'M', label: seats.some((x) => x.zone === 'semi') ? 'Semi-sleeper cabin' : 'Cabin' },
  ]
  return (
    <div className="flex flex-wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
      {decks.map((d) => {
        const rows = seats.filter((x) => x.deck === d.id)
        if (rows.length === 0) return null
        return (
          <div key={d.id}>
            <div className="small dim" style={{ marginBottom: 4 }}>{d.label}</div>
            <div className="seatmap" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 22px)' }}>
              {rows.map((seat) => (
                <span
                  key={seat.id}
                  className={`seat ${seat.sale ? 'sold' : seat.ladies ? 'ladies' : 'open'}`}
                  title={`${seat.id}${seat.zone === 'sleeper' ? ' · sleeper' : seat.zone === 'semi' ? ' · semi' : ''}${seat.ladies ? ' (ladies)' : ''} · ${seat.sale ? `SOLD ${fmtINR(seat.sale.price)} via ${seat.sale.channel}` : 'open'}`}
                >
                  {seat.sale ? '▣' : seat.ladies ? '♀' : '▢'}
                </span>
              ))}
            </div>
          </div>
        )
      })}
      <div className="small dim">
        <div><span className="accent">▣</span> sold</div>
        <div><span className="faint">▢</span> open</div>
        <div><span className="ladies">♀</span> ladies (open)</div>
        <div style={{ marginTop: 6 }}>{trip.sold}/{trip.seatCount || seats.length} sold</div>
      </div>
    </div>
  )
}
