/**
 * Seat-map lifecycle for the booking inventory.
 *
 * A 30-day window on a 70-coach fleet holds ~4,000 open departures. Keeping a
 * full row of seat objects for every berth meant ~130,000 live objects (~11 MB)
 * even though most far-out departures had a handful of bookings. Every deep
 * clone, autosave and React selector paid for seats nobody had bought.
 *
 * Rule: a departure only carries live seat objects while it is close enough to
 * matter (it is being booked today / dispatching today). Everything else keeps
 * `seatSales` — one flat row per sold seat — plus `seatCount`, and rebuilds its
 * map from the same deterministic coach template on demand. The rebuild is
 * seeded by trip id, so hydration is exact, not approximate.
 */
import { BUS_MODELS } from '../data/busModels'
import type { GameState, Trip, TripSeat, TripSeatSale } from '../types'
import { buildSeats } from './seatmap'

/**
 * Open departures within this many days of the current day keep a live seat
 * map at the end of a day. Today's board is always live (booking + dispatch),
 * and tomorrow's is kept warm so the first action of the next day is cheap.
 */
export const LIVE_SEAT_DAYS = 2

export function seatCountOf(trip: Trip): number {
  return trip.seatCount || trip.seats.length
}

/** The coach template a trip's map was built from. */
function templateModelId(s: GameState, trip: Trip): string | undefined {
  return trip.seatModelId ?? s.buses[trip.busId]?.modelId
}

/** Rebuild the seat objects from the deterministic coach template. */
function buildTripSeats(seed: number, modelId: string | undefined, trip: Trip): TripSeat[] {
  const model = modelId ? BUS_MODELS[modelId] : undefined
  const seats = model ? buildSeats(model, seed, trip.id) : []
  const cap = trip.seatCount || seats.length
  // A template that no longer matches the recorded capacity would silently
  // change the inventory. Pad with neutral seats rather than shrink it.
  while (seats.length < cap) {
    seats.push({ id: `X${seats.length + 1}`, deck: 'M', mult: 1, ladies: false })
  }
  if (cap > 0 && seats.length > cap) seats.length = cap
  return seats
}

/**
 * Marker ids for sales booked while a departure was still packed. A cold trip
 * is booked in aggregate (no seat map built), so the berth number is not known
 * yet: the row records what was sold and where it belongs, and the concrete
 * seat is handed out the moment the map is materialised.
 */
export const AGG_SLEEPER_SEAT = '~s'
export const AGG_SEATER_SEAT = '~c'
export const AGG_ANY_SEAT = '~t'

/** Alternate front/back/middle so aggregate sales scatter over the coach. */
function spreadOrder(n: number): number[] {
  const order: number[] = []
  let lo = 0
  let hi = n - 1
  while (lo <= hi) {
    order.push(lo++)
    if (lo <= hi) order.push(hi--)
  }
  return order
}

function applyPackedSales(seats: TripSeat[], sales: TripSeatSale[] | undefined): void {
  if (!sales?.length) return
  const byId = new Map(seats.map((seat) => [seat.id, seat]))
  const loose: TripSeatSale[] = []
  for (const sale of sales) {
    if (sale.id === AGG_SLEEPER_SEAT || sale.id === AGG_SEATER_SEAT || sale.id === AGG_ANY_SEAT) {
      loose.push(sale)
      continue
    }
    const seat = byId.get(sale.id)
    if (seat) seat.sale = { price: sale.p, channel: sale.c, bookedDay: sale.d }
  }
  if (loose.length === 0) return
  // Oldest sale gets the first pick, so the map fills the way it was booked.
  loose.sort((a, b) => a.d - b.d)
  const order = spreadOrder(seats.length)
  const take = (zone: 'sleeper' | 'semi' | undefined): TripSeat | undefined => {
    for (const idx of order) {
      const seat = seats[idx]
      if (!seat || seat.sale) continue
      if (zone && seat.zone !== zone) continue
      return seat
    }
    return undefined
  }
  for (const sale of loose) {
    const wanted = sale.id === AGG_SLEEPER_SEAT ? 'sleeper' as const
      : sale.id === AGG_SEATER_SEAT ? 'semi' as const
        : undefined
    const seat = (wanted ? take(wanted) : undefined) ?? take(undefined)
    if (!seat) return
    seat.sale = { price: sale.p, channel: sale.c, bookedDay: sale.d }
  }
}

/** Materialise `trip.seats` in place (no-op when the map is already live). */
export function hydrateTripSeats(s: GameState, trip: Trip): TripSeat[] {
  if (trip.seats && trip.seats.length > 0) return trip.seats
  const modelId = templateModelId(s, trip)
  const seats = buildTripSeats(s.seed, modelId, trip)
  if (modelId && seats.length > 0) trip.seatModelId = modelId
  applyPackedSales(seats, trip.seatSales)
  delete trip.seatSales
  trip.seats = seats
  if (!trip.seatCount) trip.seatCount = seats.length
  return seats
}

/** Shed the per-seat objects of a trip, keeping only what is sold. */
export function packTripSeats(trip: Trip): void {
  if (!trip.seats || trip.seats.length === 0) return
  if (!trip.seatCount) trip.seatCount = trip.seats.length
  const sales: TripSeatSale[] = []
  for (const seat of trip.seats) {
    if (!seat.sale) continue
    sales.push({ id: seat.id, p: seat.sale.price, c: seat.sale.channel, d: seat.sale.bookedDay })
  }
  if (sales.length > 0) trip.seatSales = sales
  else delete trip.seatSales
  trip.seats = []
}

/** Pack a trip only when it is outside the live window (cheap no-op otherwise). */
export function packColdTripSeats(s: GameState, trip: Trip, liveDays = LIVE_SEAT_DAYS): void {
  if (trip.seats.length === 0) return
  if (trip.day <= s.day + liveDays) return
  packTripSeats(trip)
}

/**
 * Read-only seat map for the UI. Never mutates the (frozen) store state, so a
 * seat map can be rendered for a packed trip without hydrating the live game.
 */
export function tripSeatView(s: GameState, trip: Trip): TripSeat[] {
  if (trip.seats.length > 0) return trip.seats
  if (!trip.seatSales?.length && !trip.seatCount) return []
  const seats = buildTripSeats(s.seed, templateModelId(s, trip), trip)
  applyPackedSales(seats, trip.seatSales)
  return seats
}
