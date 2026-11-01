/**
 * Swapping a coach on an existing schedule must open bookings for the new coach.
 *
 * Regression: a coach's direction depends on its slot in `busIds`, and trip ids
 * are per schedule + coach + day. Pulling the coach in slot 0 promoted the other
 * coach into that slot, so its already-open leg blocked the newly-expected one in
 * the collision guard; the replacement coach then had nothing on sale and the
 * board showed empty days. Pulling a coach and putting it back left its stale
 * cancelled trip ids behind, which never reopened.
 *
 *   npx tsx scripts/test-bus-swap-openings.ts
 */
import { newGame } from '../src/engine/newGame'
import { BAL } from '../src/engine/data/balance'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { createSchedule, assignBus, unassignBus, repairTripBoards } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { advanceDay } from '../src/engine/tick'
import type { Bus, GameState, Trip } from '../src/engine/types'

function makeBus(s: GameState, id: string, modelId: string, city: string): Bus {
  const model = BUS_MODELS[modelId]!
  return {
    id,
    reg: `TN 32 C ${id.toUpperCase()}`,
    modelId,
    status: 'active',
    odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2,
    seatCount: model.seats,
    acquisitionDay: 1,
    purchasePrice: 6500000,
    parkedCityId: city,
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    tyreKm: 5000,
    engineOilKm: 5000,
    brakeOilKm: 5000,
    coolantKm: 5000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
  } as unknown as Bus
}

function addDriver(s: GameState, busId: string) {
  s.staff[`d_${busId}`] = {
    id: `d_${busId}`,
    name: `Driver ${busId}`,
    role: 'driver',
    busId,
    salary: 2500000,
    skill: 7,
    safety: 8,
    morale: 85,
    loyalty: 85,
    experienceYears: 5,
    hiredDay: s.day,
    fatigue: 0,
    consecutiveDutyDays: 0,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
    safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
    cmvrHoursToday: 0,
    tripsDriven: 0,
  } as never
}

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

interface Rig {
  s: GameState
  schId: string
}

function rig(label: string, routeId: string, depHour: number, paired: boolean): Rig {
  const s = newGame(label, 'seth', routeId, 4242)
  refreshMarkets(s)
  const from = routeId.split('-')[0]!
  s.buses['b1'] = makeBus(s, 'b1', 'bb1624', from)
  s.buses['b2'] = makeBus(s, 'b2', 'bb1624', from)
  s.buses['c'] = makeBus(s, 'c', 'leyhybrid', from)
  for (const id of ['b1', 'b2', 'c']) addDriver(s, id)
  const res = createSchedule(s, {
    routeId,
    depHour,
    depMin: 0,
    ...(paired ? { paired: true, returnDepHour: depHour, returnDepMin: 0 } : {}),
    autoPrice: true,
    redDeal: false,
    cancellation: 'standard',
  } as never)
  if ('error' in res) throw new Error(res.error)
  return { s, schId: res.id }
}

function openFor(s: GameState, schId: string): Trip[] {
  return Object.values(s.trips).filter((t) => t.scheduleId === schId && t.status === 'open' && t.day >= s.day)
}

/** Every day of the window must have a departure, and no coach may be in two places. */
function auditBoard(s: GameState, schId: string, label: string): { ab: number; ba: number } {
  const open = openFor(s, schId)
  let gapDay = -1
  for (let d = s.day; d <= s.day + BAL.bookingWindowDays; d++) {
    // Today's departures have already left during the tick, so count any status.
    const ran = Object.values(s.trips).some((t) => t.scheduleId === schId && t.day === d)
    if (!ran) {
      gapDay = d
      break
    }
  }
  const windows = new Map<string, Array<{ start: number; end: number }>>()
  let clash = ''
  for (const t of open) {
    const start = t.day * 1440 + t.depHour * 60 + (t.depMin ?? 0)
    const end = start + Math.round((ROUTES[t.routeId]?.hours ?? 8) * 60)
    const list = windows.get(t.busId) ?? []
    const hit = list.find((w) => start < w.end && w.start < end)
    if (hit && !clash) clash = `${t.busId} @ day ${t.day}`
    list.push({ start, end })
    windows.set(t.busId, list)
  }
  check(gapDay === -1, `${label}: departures on every day of the window`, `no departure on day ${gapDay - s.day}`)
  check(clash === '', `${label}: no coach double-booked`, clash)
  check(open.length > 0, `${label}: board is not empty`)
  return {
    ab: open.filter((t) => t.direction === 'AB').length,
    ba: open.filter((t) => t.direction === 'BA').length,
  }
}

console.log('--- Swapping a coach keeps the new coach on sale ---')

// 1. Paired service: pull the coach in slot 0, add a different coach.
{
  const { s, schId } = rig('paired swap slot 0', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  check(unassignBus(s, schId, 'b1') === null, 'pulled the slot-0 coach')
  check(assignBus(s, schId, 'c') === null, 'assigned the replacement coach')
  const { ab, ba } = auditBoard(s, schId, 'paired swap slot 0')
  check(ab > 0 && ba > 0, 'both directions on sale', `AB=${ab} BA=${ba}`)
  check(openFor(s, schId).some((t) => t.busId === 'c'), 'replacement coach has open departures')
}

// 2. Paired service: pull the coach in slot 1, add a different coach.
{
  const { s, schId } = rig('paired swap slot 1', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  unassignBus(s, schId, 'b2')
  check(assignBus(s, schId, 'c') === null, 'assigned the replacement coach')
  const { ab, ba } = auditBoard(s, schId, 'paired swap slot 1')
  check(ab > 0 && ba > 0, 'both directions on sale', `AB=${ab} BA=${ba}`)
  check(openFor(s, schId).some((t) => t.busId === 'c'), 'replacement coach has open departures')
}

// 3. Unpaired service: the replacement must inherit a direction, not sit idle.
{
  const { s, schId } = rig('unpaired swap slot 0', 'mdu-maa', 21, false)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  unassignBus(s, schId, 'b1')
  check(assignBus(s, schId, 'c') === null, 'assigned the replacement coach')
  const { ab, ba } = auditBoard(s, schId, 'unpaired swap slot 0')
  check(ab > 0 && ba > 0, 'both directions on sale', `AB=${ab} BA=${ba}`)
  check(openFor(s, schId).some((t) => t.busId === 'c'), 'replacement coach has open departures')
}

// 4. Pull a coach and put the same one back: its bookings must reopen.
{
  const { s, schId } = rig('re-add same coach', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  unassignBus(s, schId, 'b2')
  check(assignBus(s, schId, 'b2') === null, 're-assigned the same coach')
  const { ab, ba } = auditBoard(s, schId, 're-add same coach')
  check(ab > 0 && ba > 0, 'both directions back on sale', `AB=${ab} BA=${ba}`)
  check(openFor(s, schId).some((t) => t.busId === 'b2'), 'returning coach has open departures')
}

// 5. Sold seats on a swapped-out coach are refunded, not silently dropped.
{
  const { s, schId } = rig('refund on swap', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  const doomed = openFor(s, schId).filter((t) => t.busId === 'b2')
  const target = doomed[doomed.length - 1]!
  const seat = target.seats[0]!
  const price = 120000
  seat.sale = { price, channel: 'ownapp', bookedDay: s.day }
  target.sold = 1
  target.revenue = price
  target.channelSold = { redbus: 0, abhibus: 0, ownapp: 1, counter: 0 }
  const refundsBefore = s.txns.filter((t) => t.head === 'refund').length
  unassignBus(s, schId, 'b2')
  const refundsAfter = s.txns.filter((t) => t.head === 'refund')
  check(refundsAfter.length > refundsBefore, 'a refund was posted for the sold seat')
  check(refundsAfter.some((t) => t.tripId === target.id || t.note?.includes('refund')), 'refund is linked to the departure')
  check(s.trips[target.id]?.status === 'cancelled', 'swapped-out departure is cancelled')
  assignBus(s, schId, 'b2')
  const revived = s.trips[target.id]
  check(revived?.status === 'open', 'departure reopens when the coach comes back')
  check((revived?.sold ?? -1) === 0, 'revived departure starts with a clean seat map', `sold=${revived?.sold}`)
}

// 6. The board stays correct as days roll after a swap.
{
  const { s, schId } = rig('swap then run days', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  unassignBus(s, schId, 'b2')
  assignBus(s, schId, 'c')
  for (let i = 0; i < 4; i++) advanceDay(s)
  const { ab, ba } = auditBoard(s, schId, 'swap then run 4 days')
  check(ab > 0 && ba > 0, 'both directions still on sale after days roll', `AB=${ab} BA=${ba}`)
}

// 7. Idempotent: generating twice changes nothing.
{
  const { s, schId } = rig('idempotent generate', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  unassignBus(s, schId, 'b1')
  assignBus(s, schId, 'c')
  const before = openFor(s, schId).map((t) => t.id).sort().join(',')
  generateTrips(s)
  const after = openFor(s, schId).map((t) => t.id).sort().join(',')
  check(before === after, 'a second generate pass is a no-op')
}

// 8. A save left in the broken shape is healed by the load-time repair.
{
  const { s, schId } = rig('legacy repair', 'mdu-maa', 21, true)
  assignBus(s, schId, 'b1')
  assignBus(s, schId, 'b2')
  const stale = openFor(s, schId).filter((t) => t.busId === 'b2').map((t) => ({ id: t.id, day: t.day, dir: t.direction }))
  unassignBus(s, schId, 'b1')
  assignBus(s, schId, 'c')

  // Force the pre-fix shape: the surviving coach keeps its old legs, and the
  // replacement coach has nothing on sale.
  for (const t of openFor(s, schId)) {
    if (t.busId !== 'c') continue
    t.status = 'cancelled'
  }
  for (const old of stale) {
    const t = s.trips[old.id]
    if (!t) continue
    t.status = 'open'
    t.busId = 'b2'
    t.direction = old.dir
    t.day = old.day
    if (!s.openTripIds.includes(t.id)) s.openTripIds.push(t.id)
  }
  s.openTripIds = s.openTripIds.filter((id) => s.trips[id]?.status === 'open')
  const brokenOpen = openFor(s, schId)
  check(!brokenOpen.some((t) => t.busId === 'c'), 'legacy shape: replacement coach has nothing on sale')

  const changed = repairTripBoards(s)
  check(changed > 0, 'repair reports the schedule as rebuilt', `changed=${changed}`)
  const { ab, ba } = auditBoard(s, schId, 'legacy repair')
  check(ab > 0 && ba > 0, 'both directions on sale after the repair', `AB=${ab} BA=${ba}`)
  check(openFor(s, schId).some((t) => t.busId === 'c'), 'replacement coach is on sale after the repair')
}

console.log(failures === 0 ? '\n--- ALL SWAP CHECKS PASSED ---' : `\n--- ${failures} SWAP CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
