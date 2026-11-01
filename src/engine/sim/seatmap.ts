/**
 * Seat map generation. Every trip gets concrete seats with position-based
 * price multipliers and RedBus-style ladies reservations, so "only upper
 * berths left" pressure emerges naturally from allocation.
 */
import { BAL } from '../data/balance'
import type { BusModel, HybridStatsSnapshot, LayoutCols, TripSeat } from '../types'
import { isLayoutCols } from '../types'
import { rngFor } from '../core/rng'
import { hybridSleeperCount } from '../data/busModels'
import { roundFare } from './pricing'

/**
 * Sleeper 2+1: each deck row has one single berth (window side) and one
 * double berth (window + aisle). Seater/semi 2+2 or 2+3 single deck.
 * Hybrid: half the seats as berths, half as rear-cabin semi-sleeper.
 */
export function buildSeats(model: BusModel, seed: number, tripKey: string): TripSeat[] {
  if (model.cls === 'CARGO' || model.layout.kind === 'cargo' || model.seats === 0) {
    return []
  }
  const seats: TripSeat[] = []
  const { layout } = model
  const m = BAL.seatMult

  const hybridSlp = layout.kind === 'hybrid' ? hybridSleeperCount(model) : 0
  const sleeperRows = layout.kind === 'hybrid'
    ? Math.max(1, Math.ceil(hybridSlp / 6))
    : layout.rows

  if (layout.kind === 'sleeper' || layout.kind === 'hybrid') {
    const zone = layout.kind === 'hybrid' ? m.hybridSleeperZone : 1
    for (const deck of ['L', 'U'] as const) {
      const deckMult = deck === 'L' ? m.lowerBerth : m.upperBerth
      for (let r = 1; r <= sleeperRows; r++) {
        seats.push({ id: `${deck}${r}S`, deck, mult: deckMult * m.singleBerth * zone, ladies: false, zone: layout.kind === 'hybrid' ? 'sleeper' : undefined })
        seats.push({ id: `${deck}${r}W`, deck, mult: deckMult * m.window * zone, ladies: false, zone: layout.kind === 'hybrid' ? 'sleeper' : undefined })
        seats.push({ id: `${deck}${r}A`, deck, mult: deckMult * m.aisle * zone, ladies: false, zone: layout.kind === 'hybrid' ? 'sleeper' : undefined })
      }
    }
  }

  if (layout.kind === 'hybrid') {
    seats.splice(hybridSlp)
    const semiNeed = Math.max(0, model.seats - seats.length)
    const perRow = 4
    const semiRows = Math.ceil(semiNeed / perRow)
    const posOfCol: ('window' | 'aisle')[] = ['window', 'aisle', 'aisle', 'window']
    for (let r = 1; r <= semiRows; r++) {
      for (let c = 0; c < perRow; c++) {
        const pos = posOfCol[c]!
        let mult = (pos === 'window' ? m.window : m.aisle) * m.hybridSemiZone
        if (r <= 2) mult += m.frontRows
        if (r === semiRows) mult += m.lastRow
        const colLetter = String.fromCharCode(65 + c)
        seats.push({ id: `M${r}${colLetter}`, deck: 'M', mult, ladies: false, zone: 'semi' })
      }
    }
  } else if (layout.kind !== 'sleeper') {
    const cols: LayoutCols = isLayoutCols(layout.cols)
      ? layout.cols
      : (layout.kind === 'hybrid' ? '2+1' : '2+2')
    const perRow = cols === '2+3' ? 5 : 4
    const posOfCol: ('window' | 'aisle' | 'middle')[] =
      cols === '2+3'
        ? ['window', 'aisle', 'aisle', 'middle', 'window']
        : ['window', 'aisle', 'aisle', 'window']
    for (let r = 1; r <= layout.rows; r++) {
      for (let c = 0; c < perRow; c++) {
        const pos = posOfCol[c]
        let mult = pos === 'window' ? m.window : pos === 'middle' ? m.middle : m.aisle
        if (r <= 3) mult += m.frontRows
        if (r === layout.rows) mult += m.lastRow
        const colLetter = String.fromCharCode(65 + c) // A..E
        seats.push({ id: `${r}${colLetter}`, deck: 'M', mult, ladies: false })
      }
    }
  }

  // trim to the model's actual seat count (last row may be partial)
  const trimmed = seats.slice(0, model.seats)

  // reserve ladies seats: prefer lower deck / front, window-adjacent pairs
  const rng = rngFor(seed, 'ladies', tripKey)
  const target = Math.round(model.seats * BAL.ladiesSeatShare)
  const candidates = trimmed
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.deck !== 'U')
  let marked = 0
  for (let k = 0; k < candidates.length && marked < target; k++) {
    // deterministic scatter
    const idx = Math.floor(rng() * candidates.length)
    const c = candidates[idx]
    if (!c.s.ladies) {
      c.s.ladies = true
      marked++
    }
  }
  // if lower deck was too small, top up anywhere
  for (let i = 0; i < trimmed.length && marked < target; i++) {
    if (!trimmed[i].ladies) {
      trimmed[i].ladies = true
      marked++
    }
  }
  return trimmed
}

export interface SeatProfile {
  /** Berths/seats on the map. */
  count: number
  /** Mean position-based price multiplier — what an average ticket costs. */
  avgMult: number
  /** Berths on a hybrid coach (0 on a single-class map). */
  sleeperCap: number
  /** Rear-cabin seats on a hybrid coach (0 on a single-class map). */
  semiCap: number
  /** Share of the map held for ladies. */
  ladiesShare: number
}

const profileCache = new Map<string, SeatProfile>()

/**
 * Layout facts about a coach's map that do not depend on the trip: zone caps,
 * mean price multiplier, ladies share. Built once per model from a reference
 * template, so a packed departure can be priced without building ~40 seat
 * objects just to sell one berth.
 */
export function seatProfile(model: BusModel): SeatProfile {
  const hit = profileCache.get(model.id)
  if (hit) return hit
  const seats = buildSeats(model, 1, `profile:${model.id}`)
  let multSum = 0
  let sleeper = 0
  let semi = 0
  let ladies = 0
  for (const st of seats) {
    multSum += st.mult
    if (st.zone === 'sleeper') sleeper++
    else if (st.zone === 'semi') semi++
    if (st.ladies) ladies++
  }
  const profile: SeatProfile = {
    count: seats.length,
    avgMult: seats.length > 0 ? multSum / seats.length : 1,
    sleeperCap: sleeper,
    semiCap: semi,
    ladiesShare: seats.length > 0 ? ladies / seats.length : 0,
  }
  profileCache.set(model.id, profile)
  return profile
}

/**
 * Zone of a sold-seat id on this coach's map. Only hybrids split the coach, and
 * their berth ids start with the deck letter while cabin seats start with `M`
 * (see `buildSeats`), so a packed sale row can be classified without a map.
 */
export function seatZoneOfId(model: BusModel, id: string): 'sleeper' | 'semi' | undefined {
  if (model.layout.kind !== 'hybrid') return undefined
  return id.startsWith('L') || id.startsWith('U') ? 'sleeper' : 'semi'
}

export type HybridClassSlice = {
  cap: number
  sold: number
  /** Going class fare (base × mean seat mult). */
  listed: number
  /** Mean ticket actually paid in this class, if any sales. */
  paidAvg: number | null
}

/** Sleeper berths vs cabin seats on a hybrid trip. Null if not a hybrid map. */
export function hybridClassStats(
  trip: {
    fare: number
    fareSleeper?: number
    fareSeater?: number
    seats?: { zone?: 'sleeper' | 'semi'; mult: number; sale?: { price: number } }[]
    /** Sold rows of a packed trip (see engine/sim/seatstate.ts). */
    seatSales?: { id: string; p: number }[]
    hybridSnapshot?: HybridStatsSnapshot
  },
  model?: BusModel,
): {
  sleeper: HybridClassSlice
  seater: HybridClassSlice
} | null {
  if (trip.hybridSnapshot) {
    return {
      sleeper: { ...trip.hybridSnapshot.sleeper, paidAvg: trip.hybridSnapshot.sleeper.paidAvg ?? null },
      seater: { ...trip.hybridSnapshot.seater, paidAvg: trip.hybridSnapshot.seater.paidAvg ?? null },
    }
  }

  let seats = trip.seats
  if ((!seats || !seats.length) && model && (model.layout.kind === 'hybrid' || model.cls === 'AC_HYBRID')) {
    const built = buildSeats(model, 1, 'ref')
    if (trip.seatSales?.length) {
      const byId = new Map(built.map((s) => [s.id, s]))
      for (const sale of trip.seatSales) {
        const seat = byId.get(sale.id)
        // Only the paid price matters here; the packed row has no channel/day.
        if (seat) seat.sale = { price: sale.p, channel: 'counter', bookedDay: 0 }
      }
    }
    seats = built
  }
  if (!seats?.length) return null
  const slp = seats.filter((s) => s.zone === 'sleeper')
  const st = seats.filter((s) => s.zone === 'semi')
  if (!slp.length || !st.length) return null

  const baseFare = roundFare(trip.fare)
  const pack = (zs: typeof seats, manualFare?: number): HybridClassSlice => {
    let sold = 0
    let paid = 0
    let listedSum = 0
    for (const s of zs) {
      if (manualFare) {
        listedSum += manualFare
      } else {
        listedSum += roundFare(baseFare * s.mult)
      }
      if (s.sale) {
        sold++
        paid += s.sale.price
      }
    }
    return {
      cap: zs.length,
      sold,
      listed: manualFare ? roundFare(manualFare) : roundFare(listedSum / zs.length),
      paidAvg: sold > 0 ? roundFare(paid / sold) : null,
    }
  }
  return { sleeper: pack(slp, trip.fareSleeper), seater: pack(st, trip.fareSeater) }
}

/** Average of all seat multipliers (used for revenue estimates). */
export function avgSeatMult(model: BusModel): number {
  const seats = buildSeats(model, 1, 'avg')
  return seats.reduce((a, s) => a + s.mult, 0) / seats.length
}

/**
 * Seat preference order for allocation: passengers pick the "best" seats
 * first (lower/single/window), leaving unpopular seats to sell last.
 */
export function preferenceOrder(seats: TripSeat[], rand: () => number): number[] {
  return seats
    .map((s, i) => ({ i, score: s.mult + rand() * 0.18 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i)
}
