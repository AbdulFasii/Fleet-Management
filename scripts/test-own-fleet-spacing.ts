/**
 * Own-fleet roster spacing: our own departures share shoppers with a nearby
 * neighbour at a gentle, fixed curve - 50% inside half an hour, 25% at an
 * hour, 10% at two hours, and nothing by three.
 *   npx tsx scripts/test-own-fleet-spacing.ts
 */
import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import { ownSubstitutionWeight, substitutionWeight, wrapDistMin } from '../src/engine/sim/corridor'
import { clockMinutes } from '../src/engine/core/calendar'
import { BUS_MODELS, cargoVolumeForSeats, isCargoModel } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { BAL } from '../src/engine/data/balance'
import { rs } from '../src/engine/core/money'
import type { Bus, GameState, Staff, Trip } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const s: GameState = newGame('Spacing', 'seth', 'blr-hyd', 4242)
s.company.cash = 50_000_000_00

let seq = 0
function addCoach(modelId = 'bb1824'): string {
  const model = BUS_MODELS[modelId]!
  const id = `coach${seq}`
  const bus: Bus = {
    id,
    reg: `TN33 SP ${1000 + seq}`,
    nickname: model.name,
    modelId,
    ownership: 'owned',
    mfgYear: 2023,
    acquiredDay: s.day,
    acquiredPrice: rs(2_000_000),
    bookValue: rs(2_000_000),
    odometer: 30_000,
    condition: { engine: 92, gearbox: 92, brakes: 92, suspension: 92, ac: 92, electrical: 92, body: 92 },
    tyreKm: 8_000,
    frontTyreKm: 8_000,
    rearTyreKm: 8_000,
    tyresRetreaded: false,
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: isCargoModel(modelId) ? 10 : 6,
    status: 'active',
    duty: 'line',
    accidentHistory: false,
    busCleanliness: 90,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: 3.6,
    insuranceExpiryDay: s.day + 400,
    fitnessExpiryDay: s.day + 400,
    pucExpiryDay: s.day + 200,
    roadTaxPayableDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200,
    gpsDeviceFitted: true,
    lastServiceOdo: 20_000,
    cargoVolumeCbm: model.cargoVolumeCbm ?? cargoVolumeForSeats(model.seats),
    parkedCityId: ROUTES['blr-hyd']!.from,
  }
  s.buses[id] = bus
  const drv: Staff = {
    id: `d${seq}`, name: `Driver ${seq}`, role: 'driver', skill: 7, experienceYears: 8,
    salary: 2_800_000, loyalty: 70, morale: 80, fatigue: 5, safety: 7, hiredDay: s.day,
    busId: id, duty: 'line', licenceClass: 'HMV_PSV',
  }
  s.staff[drv.id] = drv
  const cond: Staff = {
    id: `c${seq}`, name: `Conductor ${seq}`, role: 'conductor', skill: 7, experienceYears: 6,
    salary: 1_800_000, loyalty: 70, morale: 80, fatigue: 5, safety: 7, hiredDay: s.day,
    busId: id, duty: 'line',
  }
  s.staff[cond.id] = cond
  seq++
  return id
}

function addService(hour: number, min: 0 | 30 = 0): string {
  const made = createSchedule(s, {
    routeId: 'blr-hyd',
    depHour: hour,
    depMin: min,
    baseFare: rs(1050),
    autoPrice: true,
    cancellation: 'standard',
    redDeal: false,
  })
  if ('error' in made) throw new Error(made.error)
  const err = assignBus(s, made.id, addCoach())
  if (err) throw new Error(err)
  return made.id
}

const day = s.day + 1

/** Target LF for one trip with the whole roster on sale vs. that trip alone. */
function ratio(schId: string): { together: number; solo: number; dir: string; hour: number } {
  const trip = Object.values(s.trips).find(
    (t) => t.scheduleId === schId && t.day === day && t.status === 'open',
  )
  if (!trip) throw new Error(`no trip for ${schId} on day ${day}`)
  const all = s.openTripIds
  const together = tripLoadFactor(s, trip, day - s.day, buildBookingCtx(s)).target
  s.openTripIds = [trip.id]
  const solo = tripLoadFactor(s, trip, day - s.day, buildBookingCtx(s)).target
  s.openTripIds = all
  return { together, solo, dir: trip.direction, hour: trip.depHour }
}

// --- the kernel itself ------------------------------------------------------
console.log('\nKernel')
const own = BAL.market.ownFleetSubstitution
const near = (a: number, b: number) => Math.abs(a - b) < 1e-12
check(near(ownSubstitutionWeight(0), 0.50), 'same clock: half the pool is shared')
check(near(ownSubstitutionWeight(30), 0.50), 'half an hour apart is still the same shopper: 50%')
check(near(ownSubstitutionWeight(60), 0.25), 'one hour apart: 25%')
check(near(ownSubstitutionWeight(120), 0.10), 'two hours apart: 10%')
check(near(ownSubstitutionWeight(90), 0.175), '90 minutes: interpolated between 25% and 10%')
check(near(ownSubstitutionWeight(150), 0.05), 'two and a half hours: half of the two-hour rate, then nothing')
check(ownSubstitutionWeight(180) === 0, 'three hours apart: nothing left')
check(ownSubstitutionWeight(300) === 0, 'five hours apart: nothing left')
check(ownSubstitutionWeight(600) === 0, 'ten hours apart: nothing left')
check(ownSubstitutionWeight(15 * 60) === 0, '15 hours apart: nothing left')
check(own.curve[0]![0] === 0, 'the curve covers zero gap explicitly')
check(
  ownSubstitutionWeight(0) < substitutionWeight(0) / 1.5,
  'our roster is far softer than the market kernel it replaced',
)
let monotone = true
for (let g = 0; g <= 400; g += 5) {
  if (ownSubstitutionWeight(g) < ownSubstitutionWeight(g + 5)) monotone = false
}
check(monotone, 'overlap never rises as the gap widens')
check(ownSubstitutionWeight(60) < ownSubstitutionWeight(30) && ownSubstitutionWeight(120) < ownSubstitutionWeight(60), 'the rate halves, then more than halves, as the gap doubles')
check(wrapDistMin(23 * 60, 30) === 90, 'midnight wrap measures 90 min between 23:00 and 00:30')

// --- three services, 90 minutes apart: gentle sharing -----------------------
addService(17)
addService(18, 30)
addService(20)
const spacedIds = Object.keys(s.schedules).filter((id) => s.schedules[id]!.routeId === 'blr-hyd')
generateTrips(s)

console.log('\nRoster spaced 90 min apart')
for (const id of spacedIds) {
  const r = ratio(id)
  console.log(`   ${r.hour}:00 ${r.dir} · together ${(r.together * 100).toFixed(1)}% · solo ${(r.solo * 100).toFixed(1)}%`)
}
const spacedRatios = spacedIds.map((id) => {
  const r = ratio(id)
  return r.solo > 0 ? r.together / r.solo : 1
})
check(spacedRatios.every((x) => x < 1), 'a 90-minute neighbour still takes a slice of the pool')
check(spacedRatios.every((x) => x > 0.9), 'but only a slice - two hours apart is far from a shared pool')

// What the old market-wide kernel did to the same 90-minute roster.
function legacyCtx(): ReturnType<typeof buildBookingCtx> {
  const ctx = buildBookingCtx(s)
  const groups = new Map<string, Trip[]>()
  for (const id of s.openTripIds) {
    const t = s.trips[id]
    if (!t || t.status !== 'open') continue
    const k = `${t.routeId}|${t.day}|${t.direction}`
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }
  for (const g of groups.values()) {
    for (const a of g) {
      let seats = a.seatCount
      for (const b of g) {
        if (b.id === a.id) continue
        seats += b.seatCount * substitutionWeight(wrapDistMin(clockMinutes(a), clockMinutes(b)))
      }
      ctx.ownSeatsByTripId.set(a.id, seats)
    }
  }
  return ctx
}
const legacyRatios = spacedIds.map((id) => {
  const trip = Object.values(s.trips).find((t) => t.scheduleId === id && t.day === day && t.status === 'open')!
  const together = tripLoadFactor(s, trip, day - s.day, legacyCtx()).target
  const { solo } = ratio(id)
  return solo > 0 ? together / solo : 1
})
console.log(
  `   old full kernel would have run them at ${legacyRatios.map((x) => `${(x * 100).toFixed(0)}%`).join(' / ')} of solo`,
)
check(legacyRatios.every((x) => x < 0.995), 'the old kernel did eat into the pool even at 90-minute spacing')
check(
  spacedRatios.every((x, i) => x > legacyRatios[i]!),
  'the roster is freer than the old market-wide kernel',
)
const dragShare = spacedRatios.map((x, i) => (1 - x) / (1 - legacyRatios[i]!))
console.log(`   drag is ${dragShare.map((x) => `${(x * 100).toFixed(0)}%`).join(' / ')} of the old kernel`)
check(dragShare.every((x) => x > 0.30 && x < 0.60), 'a fraction of the old kernel, not a rounding error')

// --- a fourth service only 30 minutes from one of them ----------------------
const closeId = addService(17, 30)
generateTrips(s)
const closeTrip = Object.values(s.trips).find((t) => t.scheduleId === closeId && t.day === day && t.status === 'open')!
const neighbour = Object.values(s.trips).find(
  (t) => t.scheduleId === spacedIds[0]! && t.day === day && t.direction === closeTrip.direction && t.status === 'open',
)!
console.log(`\nTwo services ${wrapDistMin(closeTrip.depHour * 60 + (closeTrip.depMin ?? 0), neighbour.depHour * 60 + (neighbour.depMin ?? 0))} min apart`)

const all = s.openTripIds
const withClose = tripLoadFactor(s, neighbour, day - s.day, buildBookingCtx(s)).target
s.openTripIds = all.filter((id) => id !== closeTrip.id)
const withoutClose = tripLoadFactor(s, neighbour, day - s.day, buildBookingCtx(s)).target
s.openTripIds = all
const closeness = withClose / withoutClose
console.log(`   30-min neighbour drags it to ${(closeness * 100).toFixed(1)}% of its solo fill`)
check(closeness < 1, 'close slots still compete')
// The old kernel gave a 30-min neighbour the same full weight as a twin at the same clock.
const legacy = tripLoadFactor(s, neighbour, day - s.day, legacyCtx()).target / withoutClose
console.log(`   old full-weight kernel would have taken it to ${(legacy * 100).toFixed(1)}% · now ${(closeness * 100).toFixed(1)}%`)
check(closeness > legacy, 'the drag is softer than the old full-weight kernel')
check((1 - closeness) <= (1 - legacy) * 0.6, 'a twin loses about half of what the old kernel took')

// --- the other direction is a separate market -------------------------------
const outAb = Object.values(s.trips).filter((t) => t.day === day && t.scheduleId === spacedIds[0]! && t.status === 'open')
const outBa = Object.values(s.trips).filter((t) => t.day === day && t.scheduleId === spacedIds[1]! && t.status === 'open')
if (outAb[0] && outBa[0] && outAb[0].direction !== outBa[0].direction) {
  const r = ratio(spacedIds[1]!)
  check(Math.abs(r.together / r.solo - 1) < 1e-9, 'opposite-direction service does not cannibalize')
} else {
  console.log('   (both services run the same direction on this day — opposite-direction check skipped)')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
