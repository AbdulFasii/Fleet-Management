/**
 * Festival service now runs one day either side of the named window, in the
 * direction the crowd actually travels (homebound before, return after), so the
 * coach repositions with a paying load instead of dead-heading.
 *   npx tsx scripts/test-festival-run-pad.ts
 */
import { newGame } from '../src/engine/newGame'
import { fromCivil, FESTIVALS, festivalEffect, festivalRunEffect, festivalRunSlot, isFestivalDay } from '../src/engine/core/calendar'
import { applySeasonalPermit, createSchedule } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { advanceDay } from '../src/engine/tick'
import { isHomebound } from '../src/engine/sim/corridor'
import { ROUTES } from '../src/engine/data/routes'
import { BAL } from '../src/engine/data/balance'
import type { GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

/** Chennai -> Madurai style: AB is homebound (metro -> hometown). */
const routeId = 'maa-mdu'
const route = ROUTES[routeId]!
const hbAB = isHomebound(route, 'AB')

console.log('\n[1] Window vs padded run days')
for (const f of FESTIVALS) {
  const y = 2026
  const fday = fromCivil(y, f.month, f.day)
  const prePad = fday - f.pre - 1
  const postPad = fday + f.post + 1
  // Overlapping festivals (e.g. Diwali's post window covers Chhath's window)
  // legitimately leave a day inside a named window; only assert clear pad days.
  const clearPre = !isFestivalDay(prePad) && festivalRunSlot(prePad) !== 'post_pad'
  const clearPost = !isFestivalDay(postPad) && festivalRunSlot(postPad) !== 'pre_pad'
  if (clearPre) {
    check(!isFestivalDay(prePad), `${f.name}: pre-pad is outside the named window`)
    check(festivalRunSlot(prePad) === 'pre_pad', `${f.name}: window start −1 = pre run day`)
    check(festivalEffect(prePad).name === null && festivalRunEffect(prePad).name !== null, `${f.name}: run effect is padded while isFestivalDay stays strict`)
  }
  if (clearPost) {
    check(!isFestivalDay(postPad), `${f.name}: post-pad is outside the named window`)
    check(festivalRunSlot(postPad) === 'post_pad', `${f.name}: window end +1 = return run day`)
  }
  check(festivalRunSlot(fday) === 'window', `${f.name}: festival day is inside the window`)
  const before2 = festivalRunSlot(fday - f.pre - 2)
  const after2 = festivalRunSlot(fday + f.post + 2)
  check(before2 !== 'pre_pad', `${f.name}: two days before the window is not a pre run day`)
  check(after2 !== 'post_pad', `${f.name}: two days after the window is not a return run day`)
  check((festivalRunSlot(fday) === 'window') === isFestivalDay(fday), `${f.name}: only named-window days count as festival days`)
}

console.log('\n[2] Padded days carry that side\'s flow')
{
  const fday = fromCivil(2026, 11, 1) // Diwali
  const f = FESTIVALS.find((x) => x.id === 'diwali')!
  const prePad = festivalRunEffect(fday - f.pre - 1)
  const postPad = festivalRunEffect(fday + f.post + 1)
  check(prePad.homebound > prePad.returning, `pre-pad homebound ${prePad.homebound.toFixed(2)} > returning ${prePad.returning.toFixed(2)}`)
  check(postPad.returning > postPad.homebound, `post-pad returning ${postPad.returning.toFixed(2)} > homebound ${postPad.homebound.toFixed(2)}`)
  check(festivalEffect(fday - f.pre - 1).homebound === 1, 'strict effect stays neutral on the pad day')
  check(prePad.homebound > 1.3 && postPad.returning > 1.3, 'pad flow is materially better than a dead-head run')
}

console.log('\n[3] Festival service generates the right legs')

/** Onam 2026 (Sep 5, pre 3 / post 3) has clean pad days on both sides. */
const FEST = FESTIVALS.find((x) => x.id === 'onam')!
const FEST_DAY = fromCivil(2026, FEST.month, FEST.day)

function festivalGame(): GameState {
  const s: GameState = newGame('Pad', 'seth', routeId, 4321)
  s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 30, expiryDay: s.day + 400 }
  applySeasonalPermit(s, routeId)
  s.permits[routeId]!.seasonal!.status = 'active'
  s.permits[routeId]!.seasonal!.expiryDay = s.day + 400
  return s
}

{
  const s = festivalGame()
  // One owned coach, so the schedule has something to run.
  const busId = Object.keys(s.buses)[0] ?? 'b1'
  if (!s.buses[busId]) {
    ;(s.buses as Record<string, unknown>)[busId] = {
      id: busId, reg: 'TN 00 A 0001', modelId: 'cheetah', ownership: 'owned',
      status: 'active', odoKm: 0, condition: 80,
    }
  }
  const res = createSchedule(s, {
    routeId,
    depHour: 9,
    baseFare: 80_000,
    autoPrice: true,
    cancellation: 'standard',
    redDeal: false,
    outboundDuty: 'festival',
    returnDuty: 'festival',
    paired: true,
    returnDepHour: 21,
  })
  if ('error' in res) throw new Error(res.error)
  const sch = s.schedules[res.id]!
  sch.busIds = [busId]
  s.buses[busId]!.scheduleId = sch.id

  const fresh = structuredClone(s)
  const prePadDay = FEST_DAY - FEST.pre - 1
  const windowStart = FEST_DAY - FEST.pre
  const windowEnd = FEST_DAY + FEST.post
  const postPadDay = windowEnd + 1

  const legsOn = (day: number) => {
    generateTrips(s)
    return Object.values(s.trips).filter((t) => t.day === day && t.status === 'open').map((t) => t.direction).sort()
  }

  // Beyond the 3-day festival booking lead the run days are not opened yet.
  s.day = prePadDay - 4
  check(legsOn(prePadDay).length === 0, 'pre-pad is not bookable from 4+ days out')

  s.day = prePadDay
  const pre = legsOn(prePadDay)
  check(pre.length === 1, `pre-pad generates exactly one leg (got ${pre.length})`)
  check(pre[0] === (hbAB ? 'AB' : 'BA'), `pre-pad runs the homebound direction (${hbAB ? 'AB' : 'BA'}, got ${pre[0]})`)

  s.day = windowStart - 2
  const pre2 = legsOn(prePadDay)
  check(pre2.length === 1 && pre2[0] === (hbAB ? 'AB' : 'BA'), 'pre-pad leg survives a later regenerate')

  s.day = windowEnd - 2
  const post = legsOn(postPadDay)
  check(post.length === 1, `post-pad generates exactly one leg (got ${post.length})`)
  check(post[0] === (hbAB ? 'BA' : 'AB'), `post-pad runs the returning direction (${hbAB ? 'BA' : 'AB'}, got ${post[0]})`)

  // Each date jump is a separate planning snapshot. Undispatched old open
  // trips otherwise look like physical journeys when moved into the past.
  fresh.day = windowStart
  generateTrips(fresh)
  const windowTrips = Object.values(fresh.trips).filter((t) => t.day >= windowStart && t.day <= windowEnd && t.status === 'open')
  check(windowTrips.length > 0, `named window still runs (${windowTrips.length} legs)`)

  const seasonalFlags = Object.values(s.trips).filter((t) => t.status === 'open' && t.isSeasonal)
  check(seasonalFlags.length > 0, 'pad legs are tagged as seasonal runs for analytics')
}

console.log('\n[4] Daily (non-seasonal) schedules are untouched')
{
  const s: GameState = newGame('Daily', 'seth', routeId, 777)
  const busId = Object.keys(s.buses)[0] ?? 'b1'
  if (!s.buses[busId]) {
    ;(s.buses as Record<string, unknown>)[busId] = {
      id: busId, reg: 'TN 00 A 0002', modelId: 'cheetah', ownership: 'owned',
      status: 'active', odoKm: 0, condition: 80,
    }
  }
  const res = createSchedule(s, {
    routeId,
    depHour: 21,
    baseFare: 80_000,
    autoPrice: true,
    cancellation: 'standard',
    redDeal: false,
    paired: false,
  })
  if ('error' in res) throw new Error(res.error)
  const sch = s.schedules[res.id]!
  sch.busIds = [busId]
  s.buses[busId]!.scheduleId = sch.id
  const f = FESTIVALS.find((x) => x.id === 'diwali')!
  s.day = fromCivil(2026, 11, 1) - f.pre - 1
  generateTrips(s)
  const days = new Set(Object.values(s.trips).filter((t) => t.status === 'open').map((t) => t.day))
  check(days.size >= BAL.bookingWindowDays, `a daily service still books the full window (${days.size} days)`)
}

console.log('\n[5] Pad-day runs actually sell seats (no dead-head)')
{
  const prePad = FEST_DAY - FEST.pre - 1
  const postPad = FEST_DAY + FEST.post + 1
  const s: GameState = newGame('PadSim', 'seth', routeId, 99)
  // Start a few days before the pre-pad run so the coach is crewed and booked.
  s.day = prePad - 4
  s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 30, expiryDay: s.day + 400 }
  applySeasonalPermit(s, routeId)
  s.permits[routeId]!.seasonal!.status = 'active'
  s.permits[routeId]!.seasonal!.expiryDay = s.day + 400

  const bus = {
    id: 'bpad',
    reg: 'TN 01 ZP 9001',
    modelId: 'leyacsleep2',
    status: 'active',
    odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.5,
    seatCount: 36,
    acquisitionDay: 1,
    purchasePrice: 6_500_000,
    parkedCityId: 'maa',
    fitnessExpiryDay: s.day + 400,
    insuranceExpiryDay: s.day + 400,
    permitExpiryDay: s.day + 400,
    taxExpiryDay: s.day + 400,
    pucExpiryDay: s.day + 400,
    tyreKm: 5000,
    engineOilKm: 5000,
    brakeOilKm: 5000,
    coolantKm: 5000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
  } as unknown as GameState['buses'][string]
  s.buses[bus.id] = bus
  for (const id of ['dpad1', 'dpad2']) {
    s.staff[id] = {
      id, name: id, role: 'driver', busId: bus.id, salary: 2_500_000, skill: 7,
      fatigue: 0, hiredDay: s.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV',
    } as GameState['staff'][string]
  }

  const res = createSchedule(s, {
    routeId,
    depHour: 9,
    depMin: 0,
    baseFare: 80_000,
    autoPrice: true,
    cancellation: 'standard',
    redDeal: false,
    outboundDuty: 'festival',
    returnDuty: 'festival',
    paired: true,
    returnDepHour: 21,
    returnDepMin: 0,
  })
  if ('error' in res) throw new Error(res.error)
  s.schedules[res.id]!.busIds = [bus.id]
  bus.scheduleId = res.id

  while (s.day < prePad) advanceDay(s)

  const preTrips = Object.values(s.trips).filter((t) => t.day === prePad && t.scheduleId === res.id)
  const preLeg = preTrips.find((t) => t.direction === (hbAB ? 'AB' : 'BA'))
  check(Boolean(preLeg), `pre-pad leg existed on the board (${preTrips.length} leg(s) that day)`)
  check(preTrips.length === 1, `pre-pad ran a single direction (${preTrips.map((t) => t.direction).join(',')})`)
  const preSold = preLeg?.sold ?? 0
  check(preSold > 0, `pre-pad carried ${preSold} paying passengers instead of dead-heading`)

  while (s.day < postPad) advanceDay(s)
  const postTrips = Object.values(s.trips).filter((t) => t.day === postPad && t.scheduleId === res.id)
  const postLeg = postTrips.find((t) => t.direction === (hbAB ? 'BA' : 'AB'))
  check(Boolean(postLeg), `post-pad return leg existed (${postTrips.length} leg(s) that day)`)
  const postSold = postLeg?.sold ?? 0
  check(postSold > 0, `post-pad return carried ${postSold} paying passengers back to the metro`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
