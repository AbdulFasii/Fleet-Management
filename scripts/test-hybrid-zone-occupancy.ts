/**
 * Hybrid coaches: berth and rear-cabin occupancy by haul length.
 *
 *   mid haul (6-8h)   — the cabin follows the berth rate exactly. A 6.5h run
 *                       is short enough that a recliner and a berth appeal to
 *                       the same traveller, so both zones fill together.
 *   overnight (8h+)   — berths sell out, the rear cabin takes about half
 *                       (a 20-seat cabin lands near 10/20).
 *   short / long      — seats and berths stay clearly differentiated.
 *
 *   npx tsx scripts/test-hybrid-zone-occupancy.ts
 */
import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { createSchedule } from '../src/engine/sim/schedules'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { advanceDay } from '../src/engine/tick'
import { getDurationCategory } from '../src/engine/sim/corridor'
import type { Bus, GameState } from '../src/engine/types'

function makeBus(s: GameState, modelId: string): Bus {
  const model = BUS_MODELS[modelId]!
  return {
    id: 'b1',
    reg: 'TN 01 AB 1111',
    modelId,
    status: 'active',
    odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2,
    seatCount: model.seats,
    acquisitionDay: 1,
    purchasePrice: 6500000,
    parkedCityId: 'mdu',
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
    skill: 8,
    safety: 8,
    morale: 85,
    loyalty: 85,
    experienceYears: 6,
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

interface Rig {
  s: GameState
  schId: string
}

function rig(label: string, routeId: string, depHour: number, modelId = 'leyhybrid'): Rig {
  const s = newGame(label, 'seth', routeId, 4242)
  refreshMarkets(s)
  s.buses['b1'] = makeBus(s, modelId)
  addDriver(s, 'b1')
  const res = createSchedule(s, {
    routeId,
    depHour,
    depMin: 0,
    autoPrice: true,
    redDeal: false,
    cancellation: 'standard',
  } as never)
  if ('error' in res) throw new Error(res.error)
  s.schedules[res.id]!.busIds = ['b1']
  generateTrips(s)
  return { s, schId: res.id }
}

function targets(rig: Rig) {
  // The weekly peak night is priced 10-12% higher, which trims occupancy by
  // design. These checks describe a normal night, so use the cheapest departure
  // in the window (the midweek base fare) rather than whatever day the new game
  // happens to start on.
  const trips = Object.values(rig.s.trips)
    .filter((t) => t.scheduleId === rig.schId && t.status === 'open')
    .sort((a, b) => a.fare - b.fare || a.day - b.day)
  const trip = trips[0]!
  const est = tripLoadFactor(rig.s, trip, 5, buildBookingCtx(rig.s))
  if (!est.hybrid) throw new Error('expected hybrid zone targets')
  return est.hybrid
}

/** Run the booking window and measure real per-zone occupancy near departure. */
function measuredOccupancy(rig: Rig, days = 12) {
  let slpSold = 0
  let slpCap = 0
  let strSold = 0
  let strCap = 0
  let departures = 0
  // Sample every departure once, on the morning before it leaves: that is the
  // finished book. A single day's 0-2 day window only holds two departures, so
  // one lucky night used to swing the cabin number by 20%.
  const sample = () => {
    const trips = Object.values(rig.s.trips).filter(
      (t) => t.scheduleId === rig.schId && t.status === 'open' && t.day === rig.s.day + 1,
    )
    for (const t of trips) {
      departures++
      for (const seat of t.seats) {
        if (seat.zone === 'sleeper') {
          slpCap++
          if (seat.sale) slpSold++
        } else if (seat.zone === 'semi') {
          strCap++
          if (seat.sale) strSold++
        }
      }
    }
  }
  for (let i = 0; i < days; i++) {
    sample()
    advanceDay(rig.s)
  }
  return {
    sleeper: slpCap ? slpSold / slpCap : 0,
    seater: strCap ? strSold / strCap : 0,
    slpSold,
    slpCap,
    strSold,
    strCap,
    departures,
  }
}

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}
const pct = (x: number) => `${Math.round(x * 100)}%`

console.log('--- Hybrid zone occupancy by haul length ---')

// 1. Mid-haul parity: berths and cabin sell at the same rate.
console.log('\n[1] Mid-haul (6-8h) hybrid — cabin follows the berth rate')
for (const [routeId, depHour] of [['mdu-koc', 21], ['mdu-trv', 21], ['blr-maa', 21]] as const) {
  const r = rig(`mid ${routeId}`, routeId, depHour)
  const hours = ROUTES[routeId]!.hours
  if (getDurationCategory(hours) !== 'mid') throw new Error(`${routeId} should be a mid haul, got ${hours}h`)
  const t = targets(r)
  check(
    Math.abs(t.sleeperTarget - t.seaterTarget) < 0.02,
    `${routeId} (${hours}h): berths ${pct(t.sleeperTarget)} vs cabin ${pct(t.seaterTarget)} — same rate`,
  )
}

// 2. The seats actually sold match: parity holds end to end, not just on paper.
{
  const r = rig('mid measured', 'mdu-koc', 21)
  const m = measuredOccupancy(r)
  const gap = Math.abs(m.sleeper - m.seater)
  check(gap < 0.12, `mdu-koc ${m.departures} departures: berths ${pct(m.sleeper)} (${m.slpSold}/${m.slpCap}) vs cabin ${pct(m.seater)} (${m.strSold}/${m.strCap})`)
}

// 3. Overnight (8h+): berths fill, cabin lands near half — the 10/20 case.
console.log('\n[2] Overnight (8h+) hybrid — cabin takes about half')
for (const [routeId, depHour] of [['mdu-maa', 21], ['mdu-blr', 21]] as const) {
  const r = rig(`night ${routeId}`, routeId, depHour)
  const hours = ROUTES[routeId]!.hours
  if (getDurationCategory(hours) === 'short' || getDurationCategory(hours) === 'mid') {
    throw new Error(`${routeId} should be an overnight+ haul, got ${hours}h`)
  }
  const t = targets(r)
  check(t.sleeperTarget >= 0.85, `${routeId} (${hours}h): berths ${pct(t.sleeperTarget)} near-full`)
  check(
    t.seaterTarget >= 0.42 && t.seaterTarget <= 0.58,
    `${routeId} (${hours}h): cabin ${pct(t.seaterTarget)} — about half`,
  )
}

// 4. A 20-seat cabin on an 8h overnight run books ~10 seats (about half).
{
  const r = rig('night measured', 'mdu-maa', 21)
  const m = measuredOccupancy(r)
  const cabinPerTrip = m.strCap > 0 ? m.strSold / (m.strCap / 20) : 0
  check(
    cabinPerTrip >= 8 && cabinPerTrip <= 12,
    `mdu-maa 8h overnight: cabin books ${cabinPerTrip.toFixed(1)}/20 (${pct(m.seater)})`,
  )
  check(m.sleeper > m.seater, `mdu-maa: berths ${pct(m.sleeper)} out-sell the cabin ${pct(m.seater)}`)
}

// 5. Short hop: seats are still the product.
{
  const r = rig('short hop', 'mdu-cbe', 9)
  const t = targets(r)
  check(t.seaterTarget > t.sleeperTarget, `short hop: cabin ${pct(t.seaterTarget)} beats berths ${pct(t.sleeperTarget)}`)
}

// 6. Long haul: berths dominate, cabin is the price-led product.
{
  const r = rig('long haul', 'maa-hyd', 20)
  const t = targets(r)
  check(
    t.sleeperTarget > t.seaterTarget + 0.35,
    `11h haul: berths ${pct(t.sleeperTarget)} vs cabin ${pct(t.seaterTarget)}`,
  )
}

// 7. Parity is specific to mid-haul: it must not leak into overnight pricing.
{
  const mid = targets(rig('parity scope', 'mdu-koc', 21))
  const night = targets(rig('parity scope night', 'mdu-maa', 21))
  check(
    night.seaterTarget < mid.seaterTarget,
    `cabin rate falls from mid ${pct(mid.seaterTarget)} to overnight ${pct(night.seaterTarget)}`,
  )
}

console.log(failures === 0 ? '\n--- ALL HYBRID ZONE CHECKS PASSED ---' : `\n--- ${failures} HYBRID ZONE CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
