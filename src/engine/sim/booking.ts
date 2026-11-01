/**
 * Trip generation from schedules + the daily booking pass: demand arrives,
 * picks seats, pays through a channel (commission netted, settlement lag),
 * and some existing bookings cancel under RedBus-style refund tiers.
 */
import { BAL, CANCELLATION_POLICY_RULES } from '../data/balance'
import { BUS_MODELS, layoutKeyForZone } from '../data/busModels'
import { ROUTES, routeName } from '../data/routes'
import { adaptTripSeats, coveringSpare } from './cover'
import { clockFromMinutes, clockMinutes } from '../core/calendar'
import { rngFor, rPoisson, rChance } from '../core/rng'
import type { BusModel, CancellationPolicy, Channel, GameState, ID, Schedule, Trip, TripSeat } from '../types'
import { CHANNELS, CHANNEL_META, emptyChannelSold } from '../data/channels'
import { buildSeats, preferenceOrder, seatProfile, seatZoneOfId } from './seatmap'
import { AGG_ANY_SEAT, AGG_SEATER_SEAT, AGG_SLEEPER_SEAT, LIVE_SEAT_DAYS, hydrateTripSeats, packColdTripSeats } from './seatstate'
import { tripArrivals, buildBookingCtx, hybridCabinShare, elapsedBookingFrac, channelWeights, tripLoadFactor, type LoadFactorEstimate } from './demand'
import { hybridZoneFactors, isHomebound } from './corridor'
import { marketFare, resolveTripFare, roundFare, isReturnTrip } from './pricing'
export { isReturnTrip } from './pricing'
import {
  accrueGstOnTicket, earn, spend, spendNetted, pushTxn,
  accrueAttachOwnerShare, reverseAttachOwnerShare,
} from './finance'
import { cancelPairedReturn, clearTripBookings, pairReturnClock, turnaroundMinutes } from './pairing'
import { pushLog } from './log'
import { groupForTrip } from './groups'
import { fmtCompact } from '../core/money'
import { isFestivalDay, festivalRunSlot } from '../core/calendar'

export function tripKey(schId: string, busId: string, day: number, dir: 'AB' | 'BA'): string {
  return `tr_${schId}_${busId}_${day}_${dir}`
}

function seatCap(trip: Trip): number {
  return trip.seatCount || trip.seats.length
}

type Leg = {
  dir: 'AB' | 'BA'
  depHour: number
  depMin: 0 | 30
  /** Calendar day for this leg (may be outboundDay+1 for paired BA). */
  day: number
  /** Outbound trip id this BA returns (paired only). */
  pairOfTripId?: string
  isSeasonal?: boolean
  slot?: 1 | 2
}

/** Which festival-run legs are bookable on a trip day (see `festivalLegsOpen`). */
interface FestLegs {
  /** Slot 1 runs. */
  out: boolean
  /** Slot 2 (paired schedules only) runs. */
  ret: boolean
  /** Padded run day: only this direction has flow. */
  padDir?: 'AB' | 'BA'
}

const NO_FEST_LEGS: FestLegs = { out: false, ret: false }

/**
 * Festival-run window for a scheduled coach on a trip day.
 *
 * The named window (pre/peak/post) runs both legs. One day either side of it the
 * festival service still runs, but only in the direction the crowd actually
 * travels: homebound out of the metro before the window, returning after it.
 * That lets a coach reach the outstation base with a paying load instead of
 * dead-heading, and earn the return rush on the way back.
 */
export function festivalLegsOpen(
  s: GameState,
  sch: Schedule,
  route: NonNullable<(typeof ROUTES)[string]>,
  day: number,
): FestLegs {
  const seasonalOk = s.permits[sch.routeId]?.seasonal?.status === 'active'
  if (!seasonalOk) return NO_FEST_LEGS
  // Festival booking opens 3 days before the departure day (past days keep
  // their legs so a departure that already started is not pruned).
  if (day - s.day > 3) return NO_FEST_LEGS
  const slot = festivalRunSlot(day)
  if (!slot) return NO_FEST_LEGS
  if (slot === 'window') return { out: true, ret: true }
  const homeboundAB = isHomebound(route, 'AB')
  if (slot === 'pre_pad') {
    return homeboundAB ? { out: true, ret: false, padDir: 'AB' } : { out: false, ret: true, padDir: 'BA' }
  }
  // post_pad — the return rush, i.e. the direction that is not homebound.
  return homeboundAB ? { out: false, ret: true, padDir: 'BA' } : { out: true, ret: false, padDir: 'AB' }
}

/**
 * Legs for outbound calendar day `day` and bus index k.
 * Paired: bus0 AB→BA; bus1 mirrors BA→AB so both directions sell daily.
 */
function legsForDay(
  sch: Schedule,
  route: NonNullable<typeof ROUTES[string]>,
  day: number,
  busId: string,
  busIdx: number,
  fest: FestLegs,
): Leg[] {
  return padDayFilter(planLegsForDay(sch, route, day, busId, busIdx, fest), sch, fest)
}

function planLegsForDay(
  sch: Schedule,
  route: NonNullable<typeof ROUTES[string]>,
  day: number,
  busId: string,
  busIdx: number,
  fest: FestLegs,
): Leg[] {
  const out = clockFromMinutes(clockMinutes(sch))

  if (sch.paired) {
    const ret = pairReturnClock(sch, route)
    const outDuty = sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
    const retDuty = sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
    const outActive = outDuty === 'daily' || (outDuty === 'festival' && fest.out)
    const retActive = retDuty === 'daily' || (retDuty === 'festival' && fest.ret)

    // Padded festival run day on a festival-only service: one leg, in the
    // direction the crowd travels, so the coach repositions with a paying load
    // instead of dead-heading. Mixed services keep their daily leg (see
    // `padDayFilter`).
    if (fest.padDir && sch.festivalOnly) {
      const dir = fest.padDir
      const clock = dir === 'AB' ? out : ret
      return [{ dir, depHour: clock.depHour, depMin: clock.depMin, day, isSeasonal: true, slot: dir === 'AB' ? 1 : 2 }]
    }

    // Case 1: Both trips active on this day (Festival days, or both daily)
    if (outActive && retActive) {
      // The return clearing midnight only rules out a same-day round trip when
      // the two legs would overlap inside one calendar day (e.g. 21:30 out and
      // 21:30 back). Then the coach works one leg a day and alternates bases,
      // and a 2nd coach at the other base fills the opposite direction.
      const runMin = Math.round(route.hours * 60)
      const outMin = clockMinutes(out)
      const retMin = clockMinutes(ret)
      const overlapsSameDay = !(retMin + runMin <= outMin || retMin >= outMin + runMin)
      // Marathon haul (ret.dayOffset >= 2) or multi-coach rotation (sch.busIds.length >= 3 on ret.dayOffset >= 1):
      const isMultiCoachMarathon = ret.dayOffset >= 2 || (ret.dayOffset >= 1 && sch.busIds.length >= 3)
      if (isMultiCoachMarathon) {
        // Group 0: busIdx 0 and 1 -> active on even days (day % 2 === 0)
        // Group 1: busIdx 2 and 3 -> active on odd days (day % 2 === 1)
        const isGroup0 = busIdx === 0 || busIdx === 1
        const activeDay = isGroup0 ? day % 2 === 0 : day % 2 === 1
        if (!activeDay) return []

        // In group 0: bus 0 starts at A, bus 1 starts at B
        // In group 1: bus 2 starts at A, bus 3 starts at B
        const startsAtA = busIdx % 2 === 0
        const cycle = Math.floor(day / 2)
        const dir: 'AB' | 'BA' = (startsAtA ? cycle % 2 === 0 : cycle % 2 === 1) ? 'AB' : 'BA'
        const leg = dir === 'AB' ? out : ret
        const pairOfTripId = dir === 'BA'
          ? tripKey(sch.id, busId, day - 2, 'AB')
          : undefined

        return [
          {
            dir,
            depHour: leg.depHour,
            depMin: leg.depMin,
            day,
            pairOfTripId,
            isSeasonal: (dir === 'AB' ? outDuty : retDuty) === 'festival',
            slot: dir === 'AB' ? 1 : 2,
          },
        ]
      }

      if (ret.dayOffset === 1 && overlapsSameDay) {
        const dir: 'AB' | 'BA' = (day + busIdx) % 2 === 0 ? 'AB' : 'BA'
        const leg = dir === 'AB' ? out : ret
        return [
          {
            dir,
            depHour: leg.depHour,
            depMin: leg.depMin,
            day,
            // A 2nd-trip leg follows this coach's 1st-trip leg from yesterday.
            pairOfTripId: dir === 'BA' ? tripKey(sch.id, busId, day - 1, 'AB') : undefined,
            isSeasonal: (dir === 'AB' ? outDuty : retDuty) === 'festival',
            slot: dir === 'AB' ? 1 : 2,
          },
        ]
      }

      // Both legs fit in one calendar day: each coach runs out and back.
      const returnDay = sch.busIds.length >= 2 ? day : day + ret.dayOffset
      const pairDay = returnDay - ret.dayOffset
      if (busIdx % 2 === 0) {
        // Primary coach (starts at City A): A -> B at 1st trip, B -> A at 2nd trip
        const abId = tripKey(sch.id, busId, pairDay, 'AB')
        return [
          { dir: 'AB', ...out, day, isSeasonal: outDuty === 'festival', slot: 1 },
          {
            dir: 'BA',
            depHour: ret.depHour,
            depMin: ret.depMin,
            day: returnDay,
            pairOfTripId: abId,
            isSeasonal: retDuty === 'festival',
            slot: 2,
          },
        ]
      }
      // Opposite-base coach (starts at City B): B -> A at 1st trip, A -> B at 2nd trip
      // Enables simultaneous departures in both directions at both slot times!
      const baId = tripKey(sch.id, busId, pairDay, 'BA')
      return [
        { dir: 'BA', ...out, day, isSeasonal: outDuty === 'festival', slot: 1 },
        {
          dir: 'AB',
          depHour: ret.depHour,
          depMin: ret.depMin,
          day: returnDay,
          pairOfTripId: baId,
          isSeasonal: retDuty === 'festival',
          slot: 2,
        },
      ]
    }

    // Case 2: Only 2nd trip active (Non-season for Seasonal 1st trip + Daily 2nd trip)
    if (!outActive && retActive) {
      // 1st trip does NOT run.
      // 2nd trip runs on both ways on alternate days for the two vehicles!
      const dir: 'AB' | 'BA' = (day + busIdx) % 2 === 0 ? 'AB' : 'BA'
      return [
        {
          dir,
          depHour: ret.depHour,
          depMin: ret.depMin,
          day,
          isSeasonal: false,
          slot: 2,
        },
      ]
    }

    // Case 3: Only 1st trip active (Non-season for Daily 1st trip + Seasonal 2nd trip)
    if (outActive && !retActive) {
      // 2nd trip does NOT run.
      // 1st trip runs on both ways on alternate days for the two vehicles!
      const dir: 'AB' | 'BA' = (day + busIdx) % 2 === 0 ? 'AB' : 'BA'
      return [
        {
          dir,
          depHour: out.depHour,
          depMin: out.depMin,
          day,
          isSeasonal: false,
          slot: 1,
        },
      ]
    }

    // Case 4: Neither trip active
    return []
  }

  // Unpaired schedules
  const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
  if (isAllFest && !fest.out && !fest.ret) return []

  // One-way festival service on a padded run day: a single leg in the surge
  // direction, at that direction's clock.
  if (isAllFest && fest.padDir) {
    const back = clockFromMinutes(clockMinutes(sch) + (Math.ceil(route.hours) + 2) * 60)
    const clock = fest.padDir === 'BA' && route.hours <= 6 ? back : out
    return [{ dir: fest.padDir, depHour: clock.depHour, depMin: clock.depMin, day, isSeasonal: true, slot: 1 }]
  }

  let legs: Leg[]
  if (route.hours <= 6) {
    const back = clockFromMinutes(clockMinutes(sch) + (Math.ceil(route.hours) + 2) * 60)
    legs = [
      { dir: 'AB', ...out, day, slot: 1 },
      { dir: 'BA', ...back, day, slot: 1 },
    ]
  } else {
    const dir: 'AB' | 'BA' = (day + busIdx) % 2 === 0 ? 'AB' : 'BA'
    legs = [{ dir, ...out, day, slot: 1 }]
  }
  return legs
}

/**
 * On a padded festival day (one day either side of the named window) only the
 * direction that actually carries the crowd runs. Festival-duty legs pointing
 * the other way are dropped so the coach repositions with a paying load instead
 * of dead-heading; daily/mixed legs are left exactly as they are.
 */
function padDayFilter(legs: Leg[], sch: Schedule, fest: FestLegs): Leg[] {
  if (!fest.padDir) return legs
  const outDuty = sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
  const retDuty = sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
  return legs.filter((leg) => {
    const duty = leg.slot === 2 ? retDuty : outDuty
    return duty !== 'festival' || leg.dir === fest.padDir
  })
}

function createTrip(
  s: GameState,
  sch: Schedule,
  busId: string,
  day: number,
  dir: 'AB' | 'BA',
  depHour: number,
  depMin: 0 | 30,
  pairOfTripId?: string,
  isSeasonal?: boolean,
  slot?: 1 | 2,
): void {
  const id = tripKey(sch.id, busId, day, dir)
  const isReturnLeg = slot === 2 || Boolean(pairOfTripId)
  const duty = isReturnLeg
    ? (sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily'))
    : (sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily'))
  const isSeasonalTrip = Boolean(
    isSeasonal
    || sch.festivalOnly
    || (duty === 'festival' && isFestivalDay(day)),
  )
  if (s.trips[id]) {
    const existing = s.trips[id]
    if (existing.status === 'open') {
      existing.depHour = depHour
      existing.depMin = depMin
      // The leg's role can change (a schedule unpairing turns a 2nd-trip return
      // into a plain 1st-trip departure), so overwrite both markers instead of
      // only filling the blanks.
      existing.slot = slot
      if (pairOfTripId) existing.pairOfTripId = pairOfTripId
      else delete existing.pairOfTripId
      if (isSeasonalTrip) existing.isSeasonal = true
      return
    }
    // A cancelled departure must come back when this coach is scheduled for the
    // leg again — a vehicle swapped out and back, or re-added after a schedule
    // edit. Trip ids are per schedule+bus+day, so a stale cancelled record would
    // otherwise keep that seat inventory closed for the rest of the window.
    if (existing.status === 'cancelled' && day >= s.day) {
      reviveTrip(s, sch, existing, busId, day, depHour, depMin, pairOfTripId, isSeasonalTrip, slot)
    }
    return
  }
  const bus = s.buses[busId]
  if (!bus) return
  const model = BUS_MODELS[bus.modelId]
  const route = ROUTES[sch.routeId]
  if (!route) return
  const seats: TripSeat[] = buildSeats(model, s.seed, id)
  const trip: Trip = {
    id,
    scheduleId: sch.id,
    routeId: sch.routeId,
    direction: dir,
    busId,
    day,
    depHour,
    depMin,
    fare: 0,
    seats,
    seatModelId: model.id,
    seatCount: seats.length,
    sold: 0,
    revenue: 0,
    cancelledRevenue: 0,
    channelSold: emptyChannelSold(),
    status: 'open',
    slot,
    ...(pairOfTripId ? { pairOfTripId } : {}),
    ...(isSeasonalTrip ? { isSeasonal: true } : {}),
  }
  trip.fare = resolveTripFare(s, trip, sch, bus, day - s.day)
  if (trip.fare <= 0) {
    trip.fare = marketFare(s, route, bus.modelId, day, dir, bus, depHour, depMin, sch.serviceTier)
  }
  s.trips[id] = trip
  s.openTripIds.push(id)
}

/**
 * Re-open a cancelled departure in place: fresh seat map for the coach that now
 * runs it, no carried-over sales, and back on the booking list. Refunds from the
 * earlier cancellation stay in the ledger; only the seat inventory is rebuilt.
 */
function reviveTrip(
  s: GameState,
  sch: Schedule,
  trip: Trip,
  busId: string,
  day: number,
  depHour: number,
  depMin: 0 | 30,
  pairOfTripId: string | undefined,
  isSeasonalTrip: boolean,
  slot: 1 | 2 | undefined,
): void {
  const bus = s.buses[busId]
  const route = ROUTES[sch.routeId]
  if (!bus || !route) return
  const model = BUS_MODELS[bus.modelId]
  const seats = buildSeats(model, s.seed, trip.id)
  trip.status = 'open'
  trip.busId = busId
  trip.day = day
  trip.depHour = depHour
  trip.depMin = depMin
  trip.slot = slot
  if (pairOfTripId) trip.pairOfTripId = pairOfTripId
  else delete trip.pairOfTripId
  if (isSeasonalTrip) trip.isSeasonal = true
  else delete trip.isSeasonal
  trip.seats = seats
  trip.seatModelId = model.id
  delete trip.seatSales
  trip.seatCount = seats.length
  trip.sold = 0
  trip.revenue = 0
  trip.cancelledRevenue = 0
  trip.channelSold = emptyChannelSold()
  delete trip.fareSleeper
  delete trip.fareSeater
  delete trip.flatFare
  delete trip.fareLocked
  delete trip.lastPricedDay
  delete trip.cmvrBlocked
  delete trip.cmvrRunAnyway
  delete trip.pairEmptyDepart
  delete trip.outcome
  delete trip.hybridSnapshot
  trip.fare = resolveTripFare(s, trip, sch, bus, day - s.day)
  if (trip.fare <= 0) {
    trip.fare = marketFare(s, route, bus.modelId, day, trip.direction, bus, depHour, depMin, sch.serviceTier)
  }
  if (!s.openTripIds.includes(trip.id)) s.openTripIds.push(trip.id)
}

/** Booked windows of each vehicle, so one bus can never be dispatched twice at once. */
interface BusyIndex {
  byBus: Map<ID, { id: string; start: number; end: number }[]>
  byTrip: Map<string, { busId: ID; start: number; end: number }>
}

function makeBusyIndex(s: GameState): BusyIndex {
  const idx: BusyIndex = { byBus: new Map(), byTrip: new Map() }
  for (const t of Object.values(s.trips)) {
    if (t.status === 'cancelled') continue
    // Only recent and future departures can collide with a fresh leg.
    if (t.day < s.day - 2) continue
    const route = ROUTES[t.routeId]
    const start = t.day * 1440 + t.depHour * 60 + (t.depMin ?? 0)
    const turnMin = route ? turnaroundMinutes(route, s) : 45
    const end = start + Math.round((route?.hours ?? 6) * 60) + turnMin
    setBusy(idx, t.id, t.busId, start, end)
  }
  return idx
}

function setBusy(idx: BusyIndex, tripId: string, busId: ID, start: number, end: number): void {
  const prev = idx.byTrip.get(tripId)
  if (prev) {
    const list = idx.byBus.get(prev.busId)
    if (list) {
      const at = list.findIndex((w) => w.id === tripId)
      if (at >= 0) list.splice(at, 1)
    }
  }
  idx.byTrip.set(tripId, { busId, start, end })
  const list = idx.byBus.get(busId) ?? []
  list.push({ id: tripId, start, end })
  idx.byBus.set(busId, list)
}

/** True when this vehicle is already booked for an overlapping departure. */
function busyClash(idx: BusyIndex, busId: ID, start: number, end: number, selfTripId: string): boolean {
  const list = idx.byBus.get(busId)
  if (!list) return false
  return list.some((w) => w.id !== selfTripId && start < w.end && w.start < end)
}

/** Ensure trips exist for one outbound calendar day of a schedule. */
function generateTripsForDay(
  s: GameState,
  sch: Schedule,
  route: NonNullable<typeof ROUTES[string]>,
  d: number,
  busy: BusyIndex,
): void {
  const fest = festivalLegsOpen(s, sch, route, d)

  sch.busIds.forEach((busId, k) => {
    const line = s.buses[busId]
    if (!line || line.status === 'delivery') return
    const runner = (line.status === 'active' ? line : coveringSpare(s, busId))
    if (!runner || runner.status !== 'active') return

    for (const leg of legsForDay(sch, route, d, busId, k, fest)) {
      const id = tripKey(sch.id, busId, leg.day, leg.dir)
      // Same truck, two departures at once: a second leg cannot run. This is the
      // safety net for corrupt saves where one vehicle is listed on two services.
      const start = leg.day * 1440 + leg.depHour * 60 + leg.depMin
      const turnMin = turnaroundMinutes(route, s)
      const end = start + Math.round(route.hours * 60) + turnMin
      if (busyClash(busy, runner.id, start, end, id)) {
        if (s.trips[id]?.status === 'open') {
          s.trips[id].busId = runner.id
          setBusy(busy, id, runner.id, start, end)
        }
        continue
      }
      const existed = Boolean(s.trips[id])
      createTrip(s, sch, busId, leg.day, leg.dir, leg.depHour, leg.depMin, leg.pairOfTripId, leg.isSeasonal, leg.slot)
      const trip = s.trips[id]
      if (trip && trip.status === 'open') {
        trip.busId = runner.id
        setBusy(busy, id, runner.id, start, end)
        if (!existed || runner.modelId !== line.modelId) {
          if (runner.modelId !== line.modelId) adaptTripSeats(s, trip, runner.modelId)
        }
      }
    }
  })
}

/** Prunes open trips that belong to seasonal slots on non-festival dates or beyond the 3-day booking window. */
export function pruneInvalidSeasonalTrips(s: GameState): void {
  let changed = false
  for (const id of [...s.openTripIds]) {
    const t = s.trips[id]
    if (!t || t.status !== 'open') continue
    const sch = s.schedules[t.scheduleId]
    if (!sch) continue

    const route = ROUTES[t.routeId]
    if (!route) continue
    const fest = festivalLegsOpen(s, sch, route, t.day)

    // 1. Festival-only schedule: a trip on a day the festival service does not
    //    run (or where booking is not yet open, > 3 days) is invalid.
    const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
    if (isAllFest && !fest.out && !fest.ret) {
      delete s.trips[id]
      changed = true
      continue
    }

    // 2. Paired schedule: check duty of the departure slot
    if (sch.paired) {
      const outDuty = sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
      const retDuty = sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily')

      // Check if this trip is at the 1st trip slot
      const isOutSlot = t.slot === 1 || (t.depHour === sch.depHour && (t.depMin ?? 0) === (sch.depMin ?? 0))
      if (isOutSlot && outDuty === 'festival' && !fest.out) {
        delete s.trips[id]
        changed = true
        continue
      }

      // Check if this trip is at the 2nd trip slot
      const isRetSlot = t.slot === 2 || (sch.returnDepHour !== undefined && t.depHour === sch.returnDepHour && (t.depMin ?? 0) === (sch.returnDepMin ?? 0))
      if (isRetSlot && retDuty === 'festival' && !fest.ret) {
        delete s.trips[id]
        changed = true
        continue
      }
    }
  }
  if (changed) {
    s.openTripIds = s.openTripIds.filter((id) => Boolean(s.trips[id]))
  }
}

/**
 * Trip ids are per schedule + coach + day, and a scheduled coach's direction
 * depends on its slot in `busIds`. Swapping a vehicle shifts that slot, so the
 * surviving coach can still hold yesterday's leg — which then blocks its real
 * departure in the collision guard (and the new coach's leg too) and the board
 * shows empty days. Release every open leg the current plan does not run.
 * Sold seats are refunded; the record stays cancelled so the leg revives if the
 * coach is put back on it.
 */
function releaseStaleTrips(
  s: GameState,
  sch: Schedule,
  route: NonNullable<typeof ROUTES[string]>,
  edge: number,
  openTrips: Trip[],
): number {
  if (openTrips.length === 0) return 0
  const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
  const lastGenDay = isAllFest ? Math.min(edge, s.day + 3) : edge
  const expected = new Set<string>()
  sch.busIds.forEach((busId, k) => {
    for (let d = s.day; d <= lastGenDay; d++) {
      const fest = festivalLegsOpen(s, sch, route, d)
      for (const leg of legsForDay(sch, route, d, busId, k, fest)) {
        expected.add(tripKey(sch.id, busId, leg.day, leg.dir))
      }
    }
  })
  let dropped = 0
  let refunded = 0
  for (const t of openTrips) {
    // Keep past departures for dispatch; only the open booking window is rebuilt.
    if (t.day < s.day || t.day > edge + 1) continue
    if (expected.has(t.id)) continue
    refunded += clearTripBookings(s, t, 'departure released after schedule change')
    t.status = 'cancelled'
    t.outcome = {
      delayMin: 0, breakdown: false, accident: false,
      fuelCost: 0, tollCost: 0, tripCosts: 0, cargoRevenue: 0,
      reviewScore: 0, pss: 0, note: 'Cancelled: released after schedule change',
    }
    dropped++
  }
  if (dropped > 0) {
    s.openTripIds = s.openTripIds.filter((id) => {
      const t = s.trips[id]
      return Boolean(t) && t.status === 'open'
    })
    pushLog(
      s,
      'info',
      `${routeName(sch.routeId)} ${String(sch.depHour).padStart(2, '0')}:${String(sch.depMin).padStart(2, '0')}: ` +
        `${dropped} departure(s) released to match the current coaches` +
        `${refunded > 0 ? ` (${fmtCompact(refunded)} refunded)` : ''}.`,
    )
  }
  return dropped
}

/**
 * Create missing trips across the booking window.
 */
export function generateTrips(s: GameState): void {
  pruneInvalidSeasonalTrips(s)
  const edge = s.day + BAL.bookingWindowDays
  const openBySchedule = new Map<string, Trip[]>()
  for (const id of s.openTripIds) {
    const t = s.trips[id]
    if (!t || t.status !== 'open') continue
    const list = openBySchedule.get(t.scheduleId) ?? []
    list.push(t)
    openBySchedule.set(t.scheduleId, list)
  }

  // 1. Release legs the current plan no longer runs, so they cannot block the
  //    coach's real departure in the collision index below.
  for (const sch of Object.values(s.schedules)) {
    if (!sch.active || sch.busIds.length === 0) continue
    const permit = s.permits[sch.routeId]
    if (!permit || permit.status !== 'active') continue
    const route = ROUTES[sch.routeId]
    if (!route) continue
    releaseStaleTrips(s, sch, route, edge, openBySchedule.get(sch.id) ?? [])
  }

  // 2. Book what survived, then fill in every missing leg of the window.
  const busy = makeBusyIndex(s)
  for (const sch of Object.values(s.schedules)) {
    if (!sch.active || sch.busIds.length === 0) continue
    const permit = s.permits[sch.routeId]
    if (!permit || permit.status !== 'active') continue
    const route = ROUTES[sch.routeId]
    if (!route) continue

    // Festival-only: booking opens 3 days out, and the service window runs the
    // named festival days plus one surge-direction run day either side.
    const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
    if (isAllFest) {
      const festEdge = Math.min(edge, s.day + 3)
      for (let d = s.day; d <= festEdge; d++) {
        if (festivalRunSlot(d)) generateTripsForDay(s, sch, route, d, busy)
      }
      continue
    }

    // Mixed schedule or daily: ensure all missing open trips are generated across the booking window
    for (let d = s.day; d <= edge; d++) {
      generateTripsForDay(s, sch, route, d, busy)
    }
  }
}

interface ChannelBatch {
  gross: number
  seats: number
  /** Dominant layout key for route stats (first sold zone this batch). */
  layoutKey?: string
  sleeperGross?: number
  sleeperSeats?: number
  seaterGross?: number
  seaterSeats?: number
}

/** Mark the seat sold on the trip; money is flushed once per trip×channel. */
function markSeatSold(
  s: GameState,
  trip: Trip,
  seat: TripSeat,
  channel: Channel,
  price: number,
  batch: Record<Channel, ChannelBatch>,
): void {
  seat.sale = { price, channel, bookedDay: s.day }
  trip.sold++
  trip.channelSold[channel]++
  trip.revenue += price
  const b = batch[channel]!
  b.gross += price
  b.seats++
  if (!b.layoutKey) b.layoutKey = seat.zone
  if (seat.zone === 'sleeper') {
    b.sleeperGross = (b.sleeperGross ?? 0) + price
    b.sleeperSeats = (b.sleeperSeats ?? 0) + 1
  } else {
    b.seaterGross = (b.seaterGross ?? 0) + price
    b.seaterSeats = (b.seaterSeats ?? 0) + 1
  }
}

/** Empty per-channel sale batch for one trip. */
function emptyBatch(): Record<Channel, ChannelBatch> {
  return {
    redbus: { gross: 0, seats: 0 },
    abhibus: { gross: 0, seats: 0 },
    ownapp: { gross: 0, seats: 0 },
    counter: { gross: 0, seats: 0 },
  }
}

function batchHasSales(batch: Record<Channel, ChannelBatch>): boolean {
  for (const ch of CHANNELS) {
    if (batch[ch]!.gross > 0) return true
  }
  return false
}

/** Same price rules as `seatPrice`, priced from the coach profile, not a berth. */
function aggregateSeatPrice(trip: Trip, sleeperBerth: boolean, avgMult: number): number {
  let basePrice = 0
  if (sleeperBerth && trip.fareSleeper) {
    basePrice = roundFare(trip.fareSleeper)
  } else if (!sleeperBerth && trip.fareSeater) {
    basePrice = roundFare(trip.fareSeater)
  } else if (trip.flatFare) {
    basePrice = roundFare(trip.fare)
  } else {
    basePrice = roundFare(trip.fare * avgMult)
  }
  if (trip.flashDeal) {
    basePrice = roundFare(basePrice * (1 - BAL.yieldDeals.flashSaleDiscount))
  } else if (trip.surgeDeal) {
    basePrice = roundFare(basePrice * BAL.yieldDeals.surgePriceMultiplier)
  }
  return basePrice
}

/** Berths already committed on a packed hybrid trip, from its sold rows. */
function packedSleeperSold(model: BusModel, trip: Trip): number {
  let n = 0
  for (const row of trip.seatSales ?? []) {
    if (row.id === AGG_SLEEPER_SEAT || seatZoneOfId(model, row.id) === 'sleeper') n++
  }
  return n
}

/**
 * Aggregate booking for a departure that is still packed (further out than
 * LIVE_SEAT_DAYS). It books exactly the seats the per-seat walk would —
 * min(shoppers, free berths) — keeps the same shuffled channel mix and prices
 * from the coach's seat profile, but writes one marker row per seat instead of
 * materialising, sorting and scanning a 40-seat map twice a day.
 *
 * So occupancy, channel split, commissions and revenue stay on the seat-level
 * model; the concrete berth numbers are restored deterministically as soon as
 * the departure enters the live window (see `applyPackedSales`).
 */
function allocateAggregate(
  s: GameState,
  trip: Trip,
  arrivalsByChannel: Record<Channel, number>,
  est?: LoadFactorEstimate,
): void {
  const cap = seatCap(trip)
  const headroom = cap - trip.sold
  if (headroom <= 0) return
  const rng = rngFor(s.seed, 'alloc', trip.id, s.day)
  // Same shape as the seat-level queue: every shopper in, then shuffled.
  const queue: Channel[] = []
  for (const ch of CHANNELS) {
    const n = Math.max(0, Math.round(arrivalsByChannel[ch] ?? 0))
    for (let i = 0; i < n; i++) queue.push(ch)
  }
  if (queue.length === 0) return
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = queue[i]!
    queue[i] = queue[j]!
    queue[j] = tmp
  }
  const n = Math.min(queue.length, headroom)

  const bus = s.buses[trip.busId]
  const model = bus ? BUS_MODELS[bus.modelId] : undefined
  const profile = model ? seatProfile(model) : undefined
  const avgMult = profile?.avgMult ?? 1
  const hybrid = Boolean(model && profile && profile.sleeperCap > 0 && profile.semiCap > 0)
  const hyb = hybrid ? est?.hybrid : undefined

  // Zone state, driven by the same rules the seat walk uses: a shopper prefers
  // the class with target seats still unsold, may cross zones 15% of the time,
  // and is lost when their zone is full and they cannot cross. Berth sales are
  // reconstructed from the trip's sold rows, so this survives packing.
  const slpCap = profile?.sleeperCap ?? 0
  const strCap = profile?.semiCap ?? 0
  let slpSold = hybrid && model ? packedSleeperSold(model, trip) : 0
  let strSold = hybrid ? Math.max(0, trip.sold - slpSold) : 0
  let slpFree = Math.max(0, slpCap - slpSold)
  let strFree = Math.max(0, strCap - strSold)
  const slpTargetCount = Math.min(slpCap, Math.round(slpCap * (hyb?.sleeperTarget ?? 1)))
  const strTargetCount = Math.min(strCap, Math.round(strCap * (hyb?.seaterTarget ?? 1)))
  let slpRem = Math.max(0, slpTargetCount - slpSold)
  let strRem = Math.max(0, strTargetCount - strSold)
  const hours = ROUTES[trip.routeId]?.hours ?? 10
  const cabinShare = hybrid ? hybridCabinShare(hours) : 0

  const batch = emptyBatch()
  let sales = trip.seatSales
  if (!sales) {
    sales = []
    trip.seatSales = sales
  }
  for (let i = 0; i < n; i++) {
    const ch = queue[i]!
    let sleeperBerth = false
    if (hybrid) {
      let prefer: 'sleeper' | 'semi'
      if (slpRem > 0 && strRem > 0) prefer = rng() < strRem / (slpRem + strRem) ? 'semi' : 'sleeper'
      else if (slpRem > 0) prefer = 'sleeper'
      else if (strRem > 0) prefer = 'semi'
      else prefer = rng() < cabinShare ? 'semi' : 'sleeper'
      const allowCrossZone = rChance(rng, 0.15)
      if (prefer === 'sleeper') {
        if (slpFree > 0) sleeperBerth = true
        else if (allowCrossZone && strFree > 0) sleeperBerth = false
        else continue
      } else {
        if (strFree > 0) sleeperBerth = false
        else if (allowCrossZone && slpFree > 0) sleeperBerth = true
        else continue
      }
      if (sleeperBerth) {
        slpFree--
        slpSold++
        if (slpRem > 0) slpRem--
      } else {
        strFree--
        strSold++
        if (strRem > 0) strRem--
      }
    }
    const price = aggregateSeatPrice(trip, sleeperBerth, avgMult)
    const marker = hybrid
      ? (sleeperBerth ? AGG_SLEEPER_SEAT : AGG_SEATER_SEAT)
      : AGG_ANY_SEAT
    sales.push({ id: marker, p: price, c: ch, d: s.day })
    trip.sold++
    trip.channelSold[ch]++
    trip.revenue += price
    const b = batch[ch]!
    b.gross += price
    b.seats++
    if (hybrid) {
      if (sleeperBerth) {
        b.layoutKey = 'sleeper'
        b.sleeperGross = (b.sleeperGross ?? 0) + price
        b.sleeperSeats = (b.sleeperSeats ?? 0) + 1
      } else {
        b.layoutKey ??= 'semi'
        b.seaterGross = (b.seaterGross ?? 0) + price
        b.seaterSeats = (b.seaterSeats ?? 0) + 1
      }
    }
  }
  if (batchHasSales(batch)) flushSaleBatch(s, trip, batch)
}

/** One ledger + receivable line per channel for today's sales on this trip. */
function flushSaleBatch(s: GameState, trip: Trip, batch: Record<Channel, ChannelBatch>): void {
  const bus = s.buses[trip.busId]
  const model = bus ? BUS_MODELS[bus.modelId] : undefined
  const sch = s.schedules[trip.scheduleId]
  let organicPax = 0

  for (const ch of CHANNELS) {
    const b = batch[ch]!
    if (b.gross <= 0) continue
    const meta = CHANNEL_META[ch]
    const refs = {
      busId: trip.busId,
      routeId: trip.routeId,
      tripId: trip.id,
      layoutKey: layoutKeyForZone(
        bus?.modelId ?? '',
        b.layoutKey === 'semi' ? 'semi' : b.layoutKey === 'sleeper' ? 'sleeper' : undefined,
      ),
      note: `${b.seats} seats · ${meta.short}`,
    }

    let channelDeduction = 0
    if (ch === 'redbus') {
      let commBps = s.world.redbusCommissionBps
      if (sch?.redDeal) commBps += BAL.redDealExtraBps
      if (s.company.primo) commBps += BAL.primoCommissionExtraBps
      const comm = Math.round((b.gross * commBps) / 10000)
      channelDeduction = comm
      earn(s, 'ticket', b.gross, refs, BAL.redbusSettleDays, 'redbus')
      spendNetted(s, 'redbus_commission', comm, refs)
      const rcv = s.receivables[s.receivables.length - 1]
      if (rcv && rcv.channel === 'redbus') rcv.amount -= comm
      organicPax += b.seats
    } else if (ch === 'ownapp') {
      const pg = Math.round((b.gross * BAL.ownappPgBps) / 10000)
      channelDeduction = pg
      earn(s, 'ticket', b.gross, refs, BAL.ownappSettleDays, 'ownapp')
      spendNetted(s, 'pg_fees', pg, refs)
      const rcv = s.receivables[s.receivables.length - 1]
      if (rcv && rcv.channel === 'ownapp') rcv.amount -= pg
    } else if (ch === 'counter') {
      const comm = Math.round((b.gross * BAL.counterCommissionBps) / 10000)
      channelDeduction = comm
      earn(s, 'ticket', b.gross, refs, 1, 'counter')
      spendNetted(s, 'agent_commission', comm, refs)
      const rcv = s.receivables[s.receivables.length - 1]
      if (rcv && rcv.channel === 'counter') rcv.amount -= comm
      organicPax += b.seats
    } else {
      // Other OTAs (AbhiBus)
      const comm = Math.round((b.gross * meta.commissionBps) / 10000)
      channelDeduction = comm
      earn(s, 'ticket', b.gross, refs, meta.settleDays, ch)
      spendNetted(s, 'agent_commission', comm, refs)
      const rcv = s.receivables[s.receivables.length - 1]
      if (rcv && rcv.channel === ch) rcv.amount -= comm
      organicPax += b.seats
    }

    // Accumulate monthly ticket sales breakdown
    if (!s.curMonth.ticketBreakdown) {
      s.curMonth.ticketBreakdown = {
        gross: 0,
        seats: 0,
        channels: {
          redbus: { revenue: 0, seats: 0, commission: 0 },
          abhibus: { revenue: 0, seats: 0, commission: 0 },
          ownapp: { revenue: 0, seats: 0, commission: 0 },
          counter: { revenue: 0, seats: 0, commission: 0 },
        },
        bySeatType: {
          sleeper: { revenue: 0, seats: 0 },
          seater: { revenue: 0, seats: 0 },
        },
      }
    }
    const tb = s.curMonth.ticketBreakdown
    tb.gross += b.gross
    tb.seats += b.seats
    const chData = tb.channels[ch] ?? (tb.channels[ch] = { revenue: 0, seats: 0, commission: 0 })
    chData.revenue += b.gross
    chData.seats += b.seats
    chData.commission += channelDeduction
    if (tb.bySeatType) {
      if (b.sleeperGross || b.sleeperSeats) {
        tb.bySeatType.sleeper.revenue += b.sleeperGross ?? 0
        tb.bySeatType.sleeper.seats += b.sleeperSeats ?? 0
      }
      if (b.seaterGross || b.seaterSeats) {
        tb.bySeatType.seater.revenue += b.seaterGross ?? 0
        tb.bySeatType.seater.seats += b.seaterSeats ?? 0
      }
    }

    if (model) accrueGstOnTicket(s, b.gross, model.ac)

    // Attached coaches: owner share hits P&L with the ticket sale (same month),
    // cash is paid when the trip departs.
    if (bus?.ownership === 'attached' && bus.attach && b.gross > 0) {
      accrueAttachOwnerShare(s, b.gross, bus.attach.ownerShare, refs)
    }
  }

  if (organicPax > 0 && s.company.app.tier > 0) {
    s.company.app.installs += BAL.appOrganicInstallsPerPax * organicPax
    s.company.app.mau += BAL.appOrganicInstallsPerPax * BAL.appInstallToMauRatio * organicPax
  }
}

/** Seat price for a trip: flat fare if manual, otherwise base fare x seat multiplier rounded. */
export function seatPrice(trip: Trip, seat: TripSeat): number {
  let basePrice = 0
  if (trip.fareSleeper && seat.zone === 'sleeper') {
    basePrice = roundFare(trip.fareSleeper)
  } else if (trip.fareSeater && seat.zone === 'semi') {
    basePrice = roundFare(trip.fareSeater)
  } else if (trip.flatFare) {
    basePrice = roundFare(trip.fare)
  } else {
    basePrice = roundFare(trip.fare * seat.mult)
  }
  if (trip.flashDeal) {
    basePrice = roundFare(basePrice * (1 - BAL.yieldDeals.flashSaleDiscount))
  } else if (trip.surgeDeal) {
    basePrice = roundFare(basePrice * BAL.yieldDeals.surgePriceMultiplier)
  }
  return basePrice
}

function isHybridMap(seats: TripSeat[]): boolean {
  let slp = false
  let semi = false
  for (const s of seats) {
    if (s.zone === 'sleeper') slp = true
    else if (s.zone === 'semi') semi = true
    if (slp && semi) return true
  }
  return false
}

/**
 * Choose a seat for one shopper. Ladies seats are held for ladies on every
 * service, on every day — they are never released to men.
 */
export function pickSeat(
  trip: Trip,
  order: number[],
  isLady: boolean,
  preferZone: 'sleeper' | 'semi' | undefined,
  allowCrossZone = true,
): TripSeat | undefined {
  const n = trip.seats.length
  const zones: Array<'sleeper' | 'semi' | undefined> = preferZone
    ? (allowCrossZone ? [preferZone, preferZone === 'sleeper' ? 'semi' : 'sleeper'] : [preferZone])
    : [undefined]

  const scan = (zone: 'sleeper' | 'semi' | undefined, ladiesOnly: boolean, allowLadies: boolean) => {
    for (let k = 0; k < n; k++) {
      const seat = trip.seats[order[k]!]!
      if (seat.sale) continue
      if (zone && seat.zone !== zone) continue
      if (ladiesOnly && !seat.ladies) continue
      if (!allowLadies && seat.ladies) continue
      return seat
    }
  }

  if (isLady) {
    for (const z of zones) {
      const hit = scan(z, true, true)
      if (hit) return hit
    }
  }
  // Ladies seats are always held for ladies on every departure — never released
  // to men, not even on the last day before departure.
  for (const z of zones) {
    const hit = scan(z, false, false)
    if (hit) return hit
  }
  return undefined
}

/** Integer channel split that sums to `total` (largest fractional remainder). */
function exactChannelCounts(total: number, weights: Record<Channel, number>): Record<Channel, number> {
  const counts = emptyChannelSold()
  const den = CHANNELS.reduce((sum, ch) => sum + (weights[ch] ?? 0), 0)
  if (den <= 0 || total <= 0) return counts
  const ranked = CHANNELS.map((ch) => {
    const exact = (total * (weights[ch] ?? 0)) / den
    const base = Math.floor(exact)
    return { ch, base, frac: exact - base }
  })
  let left = total
  for (const row of ranked) {
    counts[row.ch] = row.base
    left -= row.base
  }
  ranked.sort((a, b) => b.frac - a.frac || (a.ch < b.ch ? -1 : 1))
  for (const row of ranked) {
    if (left <= 0) break
    counts[row.ch]++
    left--
  }
  return counts
}

/**
 * Seats that should already be on the book, from the days of the curve that
 * have passed. Empty new trips and trips that only dribbled a few sales under
 * the old late curve both get pulled up to that pace. Today's own slice is
 * left to tripArrivals.
 *
 * Returns integer channel counts (empty when there is nothing to backfill) so
 * a packed departure can take the aggregate path with the same numbers.
 */
function backfillGap(
  s: GameState,
  trip: Trip,
  daysToDep: number,
  est: LoadFactorEstimate,
  weights: Record<Channel, number>,
): Record<Channel, number> | null {
  if (daysToDep < 0 || daysToDep >= BAL.bookingWindowDays) return null
  if (!s.schedules[trip.scheduleId]) return null
  if (est.target <= 0) return null
  const frac = elapsedBookingFrac(daysToDep)
  if (frac <= 0) return null
  const cap = seatCap(trip)
  const pace = Math.min(cap, Math.round(cap * est.target * frac))
  const gap = pace - trip.sold
  if (gap <= 0) return null
  const counts = exactChannelCounts(gap, weights)
  if (CHANNELS.every((ch) => counts[ch] <= 0)) return null
  return counts
}

function backfillElapsedSales(
  s: GameState,
  trip: Trip,
  daysToDep: number,
  est: LoadFactorEstimate,
  weights: Record<Channel, number>,
): void {
  const counts = backfillGap(s, trip, daysToDep, est, weights)
  if (!counts) return
  allocateSeats(s, trip, counts, true, est)
}

function allocateSeats(
  s: GameState,
  trip: Trip,
  arrivalsByChannel: Record<Channel, number>,
  exact = false,
  est?: LoadFactorEstimate,
): void {
  const rng = rngFor(s.seed, 'alloc', trip.id, s.day)
  const seats = hydrateTripSeats(s, trip)
  const order = preferenceOrder(seats, rng)
  const cap = seatCap(trip)
  const hybrid = isHybridMap(seats)
  const hours = ROUTES[trip.routeId]?.hours ?? 10
  const cabinShare = hybrid ? hybridCabinShare(hours) : 0

  const slpCap = hybrid ? seats.filter((st) => st.zone === 'sleeper').length : 0
  const strCap = hybrid ? seats.filter((st) => st.zone === 'semi').length : 0
  const zone = hybrid ? hybridZoneFactors(hours) : undefined
  const slpTargetCount = est?.hybrid
    ? Math.min(slpCap, Math.round(slpCap * est.hybrid.sleeperTarget))
    : (hybrid && zone ? Math.min(slpCap, Math.round(slpCap * zone.sleeper)) : slpCap)
  const strTargetCount = est?.hybrid
    ? Math.min(strCap, Math.round(strCap * est.hybrid.seaterTarget))
    : (hybrid && zone ? Math.min(strCap, Math.round(strCap * zone.seater)) : strCap)

  let currentSlpSold = hybrid ? trip.seats.filter((st) => st.zone === 'sleeper' && st.sale).length : 0
  let currentStrSold = hybrid ? trip.seats.filter((st) => st.zone === 'semi' && st.sale).length : 0

  const batch: Record<Channel, ChannelBatch> = {
    redbus: { gross: 0, seats: 0 },
    abhibus: { gross: 0, seats: 0 },
    ownapp: { gross: 0, seats: 0 },
    counter: { gross: 0, seats: 0 },
  }

  const queue: Channel[] = []
  for (const ch of CHANNELS) {
    const n = exact
      ? Math.max(0, Math.round(arrivalsByChannel[ch] ?? 0))
      : rPoisson(rng, arrivalsByChannel[ch] ?? 0)
    for (let i = 0; i < n; i++) queue.push(ch)
  }
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = queue[i]!
    queue[i] = queue[j]!
    queue[j] = tmp
  }

  for (const ch of queue) {
    if (trip.sold >= cap) break
    const isLady = rChance(rng, BAL.ladiesDemandShare)
    let preferZone: 'sleeper' | 'semi' | undefined = undefined
    let allowCrossZone = true
    if (hybrid) {
      const slpRem = Math.max(0, slpTargetCount - currentSlpSold)
      const strRem = Math.max(0, strTargetCount - currentStrSold)
      if (slpRem > 0 && strRem > 0) {
        preferZone = rng() < (strRem / (slpRem + strRem)) ? 'semi' : 'sleeper'
      } else if (slpRem > 0) {
        preferZone = 'sleeper'
      } else if (strRem > 0) {
        preferZone = 'semi'
      } else {
        preferZone = rng() < cabinShare ? 'semi' : 'sleeper'
      }
      allowCrossZone = rChance(rng, 0.15)
    }

    const chosen = pickSeat(trip, order, isLady, preferZone, allowCrossZone)
    if (chosen) {
      markSeatSold(s, trip, chosen, ch, seatPrice(trip, chosen), batch)
      if (chosen.zone === 'sleeper') currentSlpSold++
      if (chosen.zone === 'semi') currentStrSold++
    }
  }
  flushSaleBatch(s, trip, batch)
}

/** Refund share retained by operator, by hours before departure. */
export function retentionShare(hoursToDep: number, policy: 'flexible' | 'standard' | 'strict'): number {
  const rule = CANCELLATION_POLICY_RULES[policy] ?? CANCELLATION_POLICY_RULES.standard
  const t = rule.tiers
  if (hoursToDep > 24) return t.over24h
  if (hoursToDep > 12) return t.h12to24
  if (hoursToDep > 4) return t.h4to12
  return t.under4h
}

export function processCancellations(s: GameState, trip: Trip): void {
  if (trip.sold <= 0) return
  const rng = rngFor(s.seed, 'cxl', trip.id, s.day)
  const sch = s.schedules[trip.scheduleId]
  const policy: CancellationPolicy = sch?.cancellation ?? s.config?.scheduleDefaults?.cancellation ?? 'standard'
  const rule = CANCELLATION_POLICY_RULES[policy] ?? CANCELLATION_POLICY_RULES.standard
  const hoursToDep = (trip.day - s.day) * 24 + trip.depHour + (trip.depMin === 30 ? 0.5 : 0) - 12
  if (hoursToDep < 0) return

  // Progressive daily cancellation rate (accelerates closer to departure date)
  let baseRate = BAL.dailyCancelRate ?? 0.010
  if (hoursToDep <= 24) baseRate *= 2.0
  else if (hoursToDep <= 72) baseRate *= 1.5
  else if (hoursToDep <= 168) baseRate *= 1.1
  else baseRate *= 0.6

  // Policy modifier on cancellation propensity:
  // Flexible pax cancel more readily (+25%); Strict pax hesitate (-20%)
  const effectiveRate = baseRate * rule.cancelRateMult

  const nCancel = Math.min(trip.sold, rPoisson(rng, trip.sold * effectiveRate))
  if (nCancel <= 0) return
  let refundTotal = 0
  let retainedTotal = 0
  let totalTicketPrice = 0

  if (trip.seats.length === 0) {
    // Packed departure (still more than LIVE_SEAT_DAYS out): cancel straight
    // off its sold rows. Building the 40-seat map just to drop one booking is
    // the expensive half of the cancellation path.
    const rows = trip.seatSales
    if (!rows || rows.length === 0) return
    const toCancel = Math.min(nCancel, rows.length)
    for (let k = 0; k < toCancel; k++) {
      const idx = Math.floor(rng() * rows.length)
      const row = rows[idx]!
      const retained = Math.round(row.p * retentionShare(Math.max(0, hoursToDep), policy))
      refundTotal += row.p - retained
      retainedTotal += retained
      totalTicketPrice += row.p

      trip.revenue -= row.p
      trip.channelSold[row.c]--
      trip.sold--
      rows[idx] = rows[rows.length - 1]!
      rows.pop()
    }
  } else {
    // Only a trip that actually loses a booking pays for a live seat map.
    const soldIdx: number[] = []
    for (let i = 0; i < trip.seats.length; i++) {
      if (trip.seats[i]!.sale) soldIdx.push(i)
    }
    for (let i = soldIdx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = soldIdx[i]!
      soldIdx[i] = soldIdx[j]!
      soldIdx[j] = tmp
    }

    const toCancel = Math.min(nCancel, soldIdx.length)
    for (let k = 0; k < toCancel; k++) {
      const seat = trip.seats[soldIdx[k]!]
      if (!seat?.sale) continue
      const price = seat.sale.price
      const retained = Math.round(price * retentionShare(Math.max(0, hoursToDep), policy))
      const refund = price - retained
      refundTotal += refund
      retainedTotal += retained
      totalTicketPrice += price

      trip.revenue -= price
      trip.channelSold[seat.sale.channel]--
      trip.sold--
      seat.sale = undefined
    }
  }

  trip.cancelledRevenue += retainedTotal

  if (totalTicketPrice > 0) {
    if (refundTotal > 0) {
      spend(s, 'refund', refundTotal, {
        busId: trip.busId,
        routeId: trip.routeId,
        tripId: trip.id,
        note: `${nCancel} seat(s) cancelled by passenger`,
        refundCategory: 'passenger',
      })
    }
    if (retainedTotal > 0) {
      s.curMonth.income.ticket = Math.max(0, (s.curMonth.income.ticket ?? 0) - retainedTotal)
      s.curMonth.income.cancellation_fee = (s.curMonth.income.cancellation_fee ?? 0) + retainedTotal
      if (s.curMonth.ticketBreakdown) {
        s.curMonth.ticketBreakdown.gross = Math.max(0, s.curMonth.ticketBreakdown.gross - retainedTotal)
      }
      pushTxn(s, {
        day: s.day,
        head: 'cancellation_fee',
        kind: 'income',
        amount: retainedTotal,
        busId: trip.busId,
        routeId: trip.routeId,
        tripId: trip.id,
        note: `${nCancel} seat(s) cancelled · fee retained (${policy})`,
      })
    }
    const bus = s.buses[trip.busId]
    if (bus?.ownership === 'attached' && bus.attach) {
      // Owner share was accrued on the cancelled tickets — claw it back. The
      // cancellation fee retained by the company is not shared with the owner.
      reverseAttachOwnerShare(s, totalTicketPrice, bus.attach.ownerShare, {
        busId: trip.busId, routeId: trip.routeId, tripId: trip.id,
      })
    }
  }
}

/**
 * Operator-side cancellation (breakdown, repossession, sale, strike):
 * full refunds, cancellation-rate hit, small rating hit.
 */
export function cancelTrip(s: GameState, tripId: string, reason: string): void {
  const trip = s.trips[tripId]
  if (!trip || trip.status !== 'open') return
  if (trip.direction === 'AB' && s.schedules[trip.scheduleId]?.paired) {
    cancelPairedReturn(s, trip, reason)
  }
  const refs = { busId: trip.busId, routeId: trip.routeId, tripId: trip.id }
  let refunded = 0
  if (trip.sold > 0) hydrateTripSeats(s, trip)
  for (const seat of trip.seats) {
    if (!seat.sale) continue
    refunded += seat.sale.price
    seat.sale = undefined
  }
  if (refunded > 0) {
    spend(s, 'refund', refunded, {
      ...refs,
      note: `bus cancelled (${reason})`,
      refundCategory: 'busCancel',
    })
    const bus = s.buses[trip.busId]
    if (bus?.ownership === 'attached' && bus.attach) {
      reverseAttachOwnerShare(s, refunded, bus.attach.ownerShare, refs)
    }
  }
  trip.revenue = 0
  trip.sold = 0
  trip.channelSold = emptyChannelSold()
  trip.status = 'cancelled'
  // operator cancellations poison RedBus ranking and rating
  s.company.cancelRate = s.company.cancelRate * 0.95 + 0.05
  s.company.rating = Math.max(1, s.company.rating - 0.02)
  const tripGrp = groupForTrip(s, trip)
  if (tripGrp) {
    tripGrp.cancelRate = (tripGrp.cancelRate ?? 0) * 0.95 + 0.05
    tripGrp.rating = Math.max(1, tripGrp.rating - 0.02)
  }
  if (trip.outcome === undefined) {
    trip.outcome = {
      delayMin: 0, breakdown: false, accident: false,
      fuelCost: 0, tollCost: 0, tripCosts: 0, cargoRevenue: 0,
      reviewScore: 0, pss: 0, note: `Cancelled: ${reason}`,
    }
  }
}

/** Cancel all open trips assigned to a bus (sale / repo / lease end). */
export function cancelOpenTripsForBus(s: GameState, busId: string, reason: string): number {
  let n = 0
  for (const id of s.openTripIds) {
    const t = s.trips[id]
    if (t && t.busId === busId && t.status === 'open') {
      cancelTrip(s, id, reason)
      n++
    }
  }
  return n
}

/** Daily booking pass over every open trip in the window. */
export function bookingPass(s: GameState): { seatsSold: number } {
  let before = 0
  let after = 0
  const ctx = buildBookingCtx(s)
  for (const id of s.openTripIds) {
    const trip = s.trips[id]
    if (!trip || trip.status !== 'open') continue
    if (!trip.seatCount) trip.seatCount = trip.seats.length
    const daysToDep = trip.day - s.day
    if (daysToDep < 0 || daysToDep > BAL.bookingWindowDays) continue
    if (!trip.fareLocked) {
      trip.fare = roundFare(trip.fare)
    }
    const sch = s.schedules[trip.scheduleId]
    const bus = s.buses[trip.busId]
    if (!trip.fareLocked && sch && bus) {
      const isRet = isReturnTrip(trip, sch)
      const isAuto = isRet ? (sch.returnAutoPrice ?? sch.autoPrice) : sch.autoPrice
      const expectedFare = isRet ? (sch.returnBaseFare ?? sch.baseFare) : sch.baseFare
      if (!isAuto) {
        // Flat manual pricing: ensure flat fare is maintained on the trip
        if (trip.fare !== expectedFare || !trip.flatFare) {
          trip.fare = resolveTripFare(s, trip, sch, bus, daysToDep)
          trip.flatFare = true
        }
      } else {
        // Reprice once a day inside the last 3 days for the ±3% late fill nudge
        if (daysToDep <= 3 && trip.lastPricedDay !== s.day) {
          trip.fare = resolveTripFare(s, trip, sch, bus, daysToDep)
          trip.lastPricedDay = s.day
        }
      }
    }
    before += trip.sold
    // One load-factor estimate per trip per day — cancellations, backfill and
    // today's arrivals all read the same model, and evaluating it three times
    // was the single largest cost of a day in a 70-coach game.
    const est = tripLoadFactor(s, trip, daysToDep, ctx)
    const weights = sch ? channelWeights(s, sch, ctx) : null
    // A departure further out than the live window has no seat map (it was
    // packed at the end of yesterday). Booking it in aggregate keeps the same
    // occupancy and channel mix without rebuilding, sorting and re-packing
    // ~40 berths twice a day.
    const aggregate = trip.seats.length === 0 && daysToDep > LIVE_SEAT_DAYS
    processCancellations(s, trip)
    if (aggregate) {
      const counts = emptyChannelSold()
      const gap = weights ? backfillGap(s, trip, daysToDep, est, weights) : null
      if (gap) {
        for (const ch of CHANNELS) counts[ch] += gap[ch]!
      }
      const demand = tripArrivals(s, trip, daysToDep, ctx, est)
      if (demand.lambda > 0) {
        const rng = rngFor(s.seed, 'arrivals', trip.id, s.day)
        for (const ch of CHANNELS) {
          counts[ch] += Math.max(0, rPoisson(rng, demand.byChannel[ch] ?? 0))
        }
      }
      if (CHANNELS.some((ch) => counts[ch] > 0)) allocateAggregate(s, trip, counts, est)
    } else {
      if (weights) backfillElapsedSales(s, trip, daysToDep, est, weights)
      const demand = tripArrivals(s, trip, daysToDep, ctx, est)
      const arrivals = demand.byChannel.redbus + demand.byChannel.abhibus
        + demand.byChannel.ownapp + demand.byChannel.counter
      if (arrivals > 0) allocateSeats(s, trip, demand.byChannel, false, est)
    }
    after += trip.sold
    // Cold departures go back to their compact form straight away, so the
    // booking window never inflates the live state for the rest of the day.
    packColdTripSeats(s, trip)
  }
  return { seatsSold: Math.max(0, after - before) }
}
