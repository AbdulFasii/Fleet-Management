/**
 * Paired AB→BA return scheduling: turnaround, earliest return, slip/strand.
 */
import { BAL } from '../data/balance'
import { clockFromMinutes, clockMinutes, type DepClock } from '../core/calendar'
import { fmtCompact } from '../core/money'
import type { GameState, RouteDef, Schedule, Trip } from '../types'
import { spend, reverseAttachOwnerShare } from './finance'
import { pushLog } from './log'
import { hydrateTripSeats } from './seatstate'
import { groupForTrip } from './groups'

/**
 * Trip id format (mirrors `tripKey` in booking.ts, duplicated here to avoid a
 * circular import: booking.ts imports this module for the pairing helpers).
 */
function pairedTripId(schId: string, busId: string, day: number, dir: 'AB' | 'BA'): string {
  return `tr_${schId}_${busId}_${day}_${dir}`
}

/**
 * The open BA leg this outbound trip feeds. Paired legs live on the same coach
 * and are generated at a day offset of at most one, so the id is knowable — no
 * scan of the 4,000-trip inventory (that scan ran for every departure and was
 * a third of the whole dispatch pass). The linear fallback only covers boards
 * edited by an older save.
 */
export function pairedReturnOf(s: GameState, outTrip: Trip, pairs?: Map<string, Trip>): Trip | undefined {
  const schId = outTrip.scheduleId
  for (const day of [outTrip.day, outTrip.day + 1, outTrip.day + 2, outTrip.day + 3, outTrip.day - 1]) {
    const t = s.trips[pairedTripId(schId, outTrip.busId, day, 'BA')]
    if (t && t.status === 'open' && t.pairOfTripId === outTrip.id) return t
  }
  // Covered coach / edited board: the return leg may sit on another bus id.
  // A caller that dispatches a whole day passes its own index so this never
  // degrades into a scan of every trip for every departure.
  if (pairs) {
    const hit = pairs.get(outTrip.id)
    return hit && hit.status === 'open' ? hit : undefined
  }
  for (const t of Object.values(s.trips)) {
    if (t.status === 'open' && t.pairOfTripId === outTrip.id) return t
  }
  return undefined
}

/** Open return legs keyed by the outbound trip they feed (one per dispatch pass). */
export function buildPairIndex(s: GameState): Map<string, Trip> {
  const index = new Map<string, Trip>()
  for (const t of Object.values(s.trips)) {
    if (t.status === 'open' && t.pairOfTripId) index.set(t.pairOfTripId, t)
  }
  return index
}

/** Check if the company has a leased yard or home depot in the return departure city. */
export function hasYardOrHome(s?: GameState, cityId?: string): boolean {
  if (!s || !cityId) return true
  if (s.company?.homeCityId === cityId) return true
  return s.yards?.some((y) => y.cityId === cityId) ?? false
}

/** Rest/layover minutes scaled by route duration for long hauls beyond 6 hours (capped). */
export function layoverMinutes(route: { hours?: number }): number {
  const h = route?.hours ?? 0
  const thresh = BAL.layoverMinHaulHours ?? 6
  if (h <= thresh) return 0
  const slope = BAL.layoverSlope ?? 0.48
  const maxMin = BAL.layoverMaxMin ?? 480
  const layoverH = Math.min(maxMin / 60, 1.5 + (h - thresh) * slope)
  return Math.round(layoverH * 60)
}

/** Calendar days one coach is busy for a single leg (drive + cooldown). */
export function oneWayCycleDays(
  route: { hours?: number; to?: string },
  s?: GameState,
): number {
  const hours = route.hours ?? 6
  const turnH = turnaroundMinutes(route, s) / 60
  return Math.max(1, Math.ceil((hours + turnH) / 24))
}

/** Terminal + rest minutes before the coach can leave again. Hard-capped at 8h. */
export function turnaroundMinutes(route: { hours?: number; km?: number; to?: string }, s?: GameState): number {
  const hasYard = hasYardOrHome(s, route.to)
  const base = BAL.pairMinTurnMin
  const yardExtra = hasYard ? 0 : 30
  const layover = layoverMinutes(route)
  const raw = base + yardExtra + layover
  const cap = BAL.layoverMaxMin ?? 480
  // Short hops stay at the small terminal turn; long hauls never exceed the 8h cooldown.
  return Math.min(cap, raw)
}

/** Running time in minutes (aligned with demand/hours, not the turnaround formula). */
export function runningMinutes(route: { hours: number }): number {
  return Math.round(route.hours * 60)
}

/** Recommended fleet size for a schedule to operate continuously without service gaps. */
export function recommendedFleetSize(
  route: RouteDef | undefined,
  paired: boolean,
  s?: GameState,
): number {
  if (!route) return paired ? 2 : 1
  const cycle = oneWayCycleDays(route, s)
  const maxCap = BAL.scheduleMaxCoaches ?? 4
  if (!paired) {
    return Math.max(1, Math.min(maxCap, cycle))
  }
  // Daily both ways: one A-start pool and one B-start pool, each sized to the one-way cycle.
  return Math.max(2, Math.min(maxCap, 2 * cycle))
}

export interface ReturnPlan {
  /** Absolute minutes from outbound calendar midnight (may be ≥ 1440 → next day, ≥ 2880 → +2d). */
  absMin: number
  dayOffset: number
  depHour: number
  depMin: 0 | 30
}

/** Earliest BA departure after outbound dep + run + turnaround, snapped up to :00/:30. */
export function earliestReturn(out: DepClock, route: RouteDef, s?: GameState): ReturnPlan {
  const outMin = clockMinutes(out)
  const ready = outMin + runningMinutes(route) + turnaroundMinutes(route, s)
  const snapped = Math.ceil(ready / 30) * 30
  const dayOffset = Math.floor(snapped / 1440)
  const clock = clockFromMinutes(snapped)
  return { absMin: snapped, dayOffset, depHour: clock.depHour, depMin: clock.depMin }
}

export function suggestReturnSlot(out: DepClock, route: RouteDef, s?: GameState): { depHour: number; depMin: 0 | 30; dayOffset: number } {
  const e = earliestReturn(out, route, s)
  return { depHour: e.depHour, depMin: e.depMin, dayOffset: e.dayOffset }
}

/** Absolute minutes of a return clock relative to outbound calendar day 0. */
export function returnAbsMinutes(ret: DepClock, dayOffset: number): number {
  return dayOffset * 1440 + clockMinutes(ret)
}

/**
 * Day offset for BA relative to outbound day when using schedule return slot.
 * Ensures the return departure is strictly at or after earliest ready time.
 */
export function pairReturnDayOffset(sch: Schedule, route: RouteDef, s?: GameState): number {
  if (!sch.paired) return 0
  const out = { depHour: sch.depHour, depMin: sch.depMin }
  const earliest = earliestReturn(out, route, s)
  const retHour = sch.returnDepHour ?? earliest.depHour
  const retMin = (sch.returnDepMin === 30 ? 30 : 0) as 0 | 30
  const retClockMin = clockMinutes({ depHour: retHour, depMin: retMin })

  if (retClockMin >= earliest.absMin) {
    return 0
  }
  const minDayOffset = Math.ceil((earliest.absMin - retClockMin) / 1440)
  return Math.max(earliest.dayOffset, minDayOffset)
}

export function pairReturnClock(sch: Schedule, route: RouteDef, s?: GameState): { depHour: number; depMin: 0 | 30; dayOffset: number } {
  const out = { depHour: sch.depHour, depMin: sch.depMin }
  const earliest = earliestReturn(out, route, s)
  const depHour = sch.returnDepHour ?? earliest.depHour
  const depMin = (sch.returnDepHour !== undefined
    ? (sch.returnDepMin === 30 ? 30 : 0)
    : earliest.depMin) as 0 | 30
  const dayOffset = sch.returnDepHour !== undefined
    ? pairReturnDayOffset({ ...sch, returnDepHour: depHour, returnDepMin: depMin }, route, s)
    : earliest.dayOffset
  return { depHour, depMin, dayOffset }
}

/** True if return slot is at/after earliest ready (accounting for day wrap). */
export function isReturnValid(out: DepClock, ret: DepClock, route: RouteDef, dayOffset: number, s?: GameState): boolean {
  const earliest = earliestReturn(out, route, s)
  const abs = returnAbsMinutes(ret, dayOffset)
  return abs >= earliest.absMin
}

/** Snap absolute minutes up to next half-hour clock (may cross midnight). */
export function ceilHalfHourAbs(absMin: number): { absMin: number; depHour: number; depMin: 0 | 30; dayOffset: number } {
  const snapped = Math.ceil(absMin / 30) * 30
  const dayOffset = Math.floor(snapped / 1440)
  const clock = clockFromMinutes(snapped)
  return {
    absMin: snapped,
    depHour: clock.depHour,
    depMin: clock.depMin,
    dayOffset,
  }
}

export function fmtTurnaround(route: RouteDef, s?: GameState): string {
  const m = turnaroundMinutes(route, s)
  const bayExtra = (s && !hasYardOrHome(s, route.to)) ? ' · Public bay +30 min' : ''
  if (m < 60) return `${m} min turnaround${bayExtra}`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return (mm ? `${h}h ${mm}m turnaround` : `${h}h turnaround`) + bayExtra
}

/** Refund all sold seats on an open trip but keep it open (empty reposition). */
export function clearTripBookings(s: GameState, trip: Trip, note: string): number {
  if (trip.status !== 'open') return 0
  // Packed saves may omit `seats` until hydratePackedState runs — never iterate undefined.
  if (trip.sold > 0) hydrateTripSeats(s, trip)
  if (!trip.seats) trip.seats = []
  let refunded = 0
  for (const seat of trip.seats) {
    if (!seat.sale) continue
    refunded += seat.sale.price
    seat.sale = undefined
  }
  if (refunded > 0) {
    spend(s, 'refund', refunded, {
      busId: trip.busId,
      routeId: trip.routeId,
      tripId: trip.id,
      note: note ?? 'paired return cancelled',
      refundCategory: 'busCancel',
    })
    const bus = s.buses[trip.busId]
    if (bus?.ownership === 'attached' && bus.attach) {
      reverseAttachOwnerShare(s, refunded, bus.attach.ownerShare, {
        busId: trip.busId, routeId: trip.routeId, tripId: trip.id,
      })
    }
  }
  trip.sold = 0
  trip.revenue = 0
  trip.channelSold = { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }
  return refunded
}

/**
 * After outbound completes with `delayMin`, slip or strand the paired BA.
 * Returns true if BA was adjusted / stranded.
 */
export function applyOutboundDelayToPair(
  s: GameState,
  outTrip: Trip,
  route: RouteDef,
  delayMin: number,
  pairs?: Map<string, Trip>,
): boolean {
  const sch = s.schedules[outTrip.scheduleId]
  if (!sch?.paired) return false

  const ba = pairedReturnOf(s, outTrip, pairs)
  if (!ba) return false

  const outAbs = outTrip.day * 1440 + clockMinutes(outTrip)
  const readyAbs = outAbs + runningMinutes(route) + delayMin + turnaroundMinutes(route, s)
  const plannedAbs = ba.day * 1440 + clockMinutes(ba)
  const latestAbs = plannedAbs + BAL.pairDelayBufferMin

  if (readyAbs <= latestAbs) {
    const targetAbs = Math.max(plannedAbs, Math.ceil(readyAbs / 30) * 30)
    const newDay = Math.floor(targetAbs / 1440)
    const clock = clockFromMinutes(targetAbs)
    const changed = ba.depHour !== clock.depHour || (ba.depMin ?? 0) !== clock.depMin || ba.day !== newDay
    if (changed) {
      ba.day = newDay
      ba.depHour = clock.depHour
      ba.depMin = clock.depMin
      const slip = targetAbs - plannedAbs
      if (slip > 0) {
        pushLog(
          s,
          'info',
          `2nd trip ${fmtClock(ba)} slipped ${slip} min — 1st trip ran ${Math.round(delayMin)} min late.`,
        )
      }
    }
    return changed
  }

  // Beyond buffer: strand passengers, depart empty.
  const refunded = clearTripBookings(s, ba, '2nd trip stranded — 1st trip late')
  ba.pairEmptyDepart = true
  s.company.reputation = Math.max(0, s.company.reputation - BAL.pairStrandRepHit)
  s.company.rating = Math.max(1, s.company.rating - BAL.pairStrandRatingHit)
  pushLog(
    s,
    'alert',
    `2nd trip stranded: 1st trip ${Math.round(delayMin)} min late past ${BAL.pairDelayBufferMin}m buffer. `
    + `${refunded > 0 ? `Refunded ${fmtCompact(refunded)}. ` : ''}`
    + `Bus leaves empty — reputation −${BAL.pairStrandRepHit}.`,
  )
  return true
}

function fmtClock(c: DepClock): string {
  const { depHour, depMin } = clockFromMinutes(clockMinutes(c))
  return `${String(depHour).padStart(2, '0')}:${String(depMin).padStart(2, '0')}`
}

/** Cancel open paired BA when outbound is cancelled / bus grounded. */
export function cancelPairedReturn(s: GameState, outTrip: Trip, reason: string, pairs?: Map<string, Trip>): void {
  const ba = pairedReturnOf(s, outTrip, pairs)
  if (!ba) return
  // Inline cancel to avoid circular import with booking.cancelTrip
  let refunded = 0
  if (ba.sold > 0) hydrateTripSeats(s, ba)
  for (const seat of ba.seats) {
    if (!seat.sale) continue
    refunded += seat.sale.price
    seat.sale = undefined
  }
  if (refunded > 0) {
    spend(s, 'refund', refunded, {
      busId: ba.busId,
      routeId: ba.routeId,
      tripId: ba.id,
      note: 'paired return cancelled',
      refundCategory: 'busCancel',
    })
  }
  ba.revenue = 0
  ba.sold = 0
  ba.channelSold = { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }
  ba.status = 'cancelled'
  ba.outcome = {
    delayMin: 0, breakdown: false, accident: false,
    fuelCost: 0, tollCost: 0, tripCosts: 0, cargoRevenue: 0,
    reviewScore: 0, pss: 0, note: `Cancelled: ${reason}`,
  }
  s.company.cancelRate = s.company.cancelRate * 0.95 + 0.05
  const baGrp = groupForTrip(s, ba)
  if (baGrp) baGrp.cancelRate = (baGrp.cancelRate ?? 0) * 0.95 + 0.05
  pushLog(s, 'alert', `2nd trip cancelled — ${reason}.`)
}
