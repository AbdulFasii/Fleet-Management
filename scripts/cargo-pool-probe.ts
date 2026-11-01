/**
 * Finite cargo pools: both directions, no unlimited fill, lane history survives a week.
 *   npx tsx scripts/cargo-pool-probe.ts
 */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { rs } from '../src/engine/core/money'
import { BUS_MODELS, cargoVolumeForSeats, isCargoModel } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { cargoLaneKey, openCargoPermit } from '../src/engine/sim/cargo'
import { assignBus, createSchedule } from '../src/engine/sim/schedules'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Bus, Staff } from '../src/engine/types'

const s = newGame('Cargo pool', 'seth', 'mdu-maa', 42)
s.company.cash = 80_000_000_00
s.company.dedicatedCargoSubsidiary = true

const mgr: Staff = {
  id: 'mgr1',
  name: 'Biju Sen',
  role: 'manager',
  skill: 8,
  experienceYears: 6,
  salary: 3500000,
  loyalty: 80,
  morale: 80,
  fatigue: 10,
  safety: 7,
  hiredDay: s.day,
}
s.staff[mgr.id] = mgr
assert.equal(appointCargoManager(s, mgr.id), null)

for (const routeId of ['maa-mdu', 'blr-hyd', 'maa-pdy']) {
  s.permits[routeId] = {
    routeId,
    status: 'active',
    appliedDay: s.day,
    activeFromDay: s.day,
    expiryDay: s.day + 400,
  }
  assert.equal(openCargoPermit(s, routeId), null, `cargo licence on ${routeId}`)
}

let n = 0
function addBus(modelId: string, routeId: string): string {
  const model = BUS_MODELS[modelId]!
  const id = `bus${n}`
  const bus: Bus = {
    id,
    reg: `TN32 C${String(n).padStart(4, '0')}`,
    nickname: model.name,
    modelId,
    ownership: 'owned',
    mfgYear: 2022,
    acquiredDay: s.day,
    acquiredPrice: rs(2_000_000),
    bookValue: rs(2_000_000),
    odometer: 40_000,
    condition: { engine: 95, gearbox: 95, brakes: 95, suspension: 95, ac: 95, electrical: 95, body: 95 },
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
    qualityScore: 4,
    insuranceExpiryDay: s.day + 400,
    fitnessExpiryDay: s.day + 400,
    pucExpiryDay: s.day + 200,
    roadTaxPayableDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200,
    gpsDeviceFitted: true,
    lastServiceOdo: 30_000,
    cargoVolumeCbm: model.cargoVolumeCbm ?? cargoVolumeForSeats(model.seats),
    parkedCityId: ROUTES[routeId]!.from,
  }
  s.buses[id] = bus
  const drv: Staff = {
    id: `drv${n}`,
    name: `Driver ${n}`,
    role: 'driver',
    skill: 7,
    experienceYears: 8,
    salary: 2800000,
    loyalty: 70,
    morale: 80,
    fatigue: 5,
    safety: 7,
    hiredDay: s.day,
    busId: id,
    duty: 'line',
    licenceClass: isCargoModel(modelId) ? 'HMV_HP' : 'HMV_PSV',
  }
  s.staff[drv.id] = drv
  n += 1
  return id
}

function launch(routeId: string, busIds: string[], cargo: boolean, hour: number): void {
  const made = createSchedule(s, {
    routeId,
    depHour: hour,
    depMin: 0,
    baseFare: rs(900),
    autoPrice: false,
    cancellation: 'standard',
    redDeal: false,
    serviceKind: cargo ? 'cargo' : 'passenger',
  })
  assert('id' in made, `schedule ${routeId}: ${'error' in made ? made.error : ''}`)
  if (!('id' in made)) return
  for (const busId of busIds) {
    const err = assignBus(s, made.id, busId)
    assert.equal(err, null, `${busId} on ${routeId}: ${err}`)
  }
}

launch('mdu-maa', [addBus('bb1824', 'mdu-maa'), addBus('bb1824', 'mdu-maa')], false, 18)
launch('mdu-maa', [addBus('bb_5528t', 'mdu-maa')], true, 19)
launch('blr-hyd', [addBus('bb1824', 'blr-hyd'), addBus('bb1824', 'blr-hyd')], false, 18)
launch('maa-pdy', [addBus('bb917', 'maa-pdy')], false, 8)

const coachFills: number[] = []
const truckFills: number[] = []
const seen = new Set<string>()
const laneKg = new Map<string, number>()

function sample(): void {
  for (const t of Object.values(s.trips)) {
    if (t.status !== 'completed' || !t.outcome || seen.has(t.id)) continue
    seen.add(t.id)
    const cap = t.outcome.cargoCapKg ?? 0
    const kg = t.outcome.cargoKg ?? 0
    const bus = s.buses[t.busId]
    // Promised contract freight rides only in a cargo vehicle, never a coach belly.
    if (!isCargoModel(bus?.modelId) && (t.outcome.cargoContractKg ?? 0) > 0) {
      assert.fail(`coach ${bus?.modelId} on ${t.routeId} loaded ${t.outcome.cargoContractKg} kg of contract freight`)
    }
    const route = ROUTES[t.routeId]
    if (route) {
      const key = cargoLaneKey(route, t.direction)
      laneKg.set(key, (laneKg.get(key) ?? 0) + kg)
    }
    if (cap <= 0) continue
    const fill = kg / cap
    if (bus && isCargoModel(bus.modelId)) truckFills.push(fill)
    else coachFills.push(fill)
  }
  for (const [routeId, days] of Object.entries(s.routeHistory ?? {})) {
    const route = ROUTES[routeId]
    if (!route) continue
    for (const day of days ?? []) {
      for (const dir of ['AB', 'BA'] as const) {
        const lane = day.cargo?.[dir]
        if (!lane || lane.bookKg <= 0) continue
        assert(
          lane.kg <= lane.bookKg + lane.trips,
          `${cargoLaneKey(route, dir)} day ${day.day} hauled ${lane.kg} above book ${lane.bookKg}`,
        )
      }
    }
  }
}

for (let i = 0; i < 12; i++) {
  advanceDay(s)
  assert(!s.gameOver, s.gameOver?.reason ?? 'game over')
  sample()
}

const signed = (s.company.cargoContracts ?? []).filter((c) => c.active)
const lanes = new Set(signed.map((c) => c.laneKey))
assert(lanes.has('mdu>maa'), `expected Madurai → Chennai contracts, got ${[...lanes].join(', ')}`)
assert(lanes.has('maa>mdu'), `expected Chennai → Madurai contracts, got ${[...lanes].join(', ')}`)
assert(lanes.has('blr>hyd') || lanes.has('hyd>blr'), 'Bengaluru corridor should have a contract')
assert(lanes.has('maa>pdy') || lanes.has('pdy>maa'), 'Puducherry corridor should have a contract')

const perLane = new Map<string, number>()
for (const c of signed) perLane.set(c.laneKey, (perLane.get(c.laneKey) ?? 0) + 1)
for (const [key, count] of perLane) {
  assert(count <= 4, `${key} has ${count} live contracts`)
}

assert((laneKg.get('mdu>maa') ?? 0) > 0, 'Madurai → Chennai should haul something')
assert((laneKg.get('maa>mdu') ?? 0) > 0, 'Chennai → Madurai should haul something')
assert((laneKg.get('blr>hyd') ?? 0) > 0 && (laneKg.get('hyd>blr') ?? 0) > 0, 'both Bengaluru directions should haul')
assert((laneKg.get('maa>pdy') ?? 0) > 0 && (laneKg.get('pdy>maa') ?? 0) > 0, 'both Puducherry directions should haul')

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
}
assert(coachFills.length > 20, `expected a run of coach loads, got ${coachFills.length}`)
assert(truckFills.length > 4, `expected truck loads, got ${truckFills.length}`)
const coachMean = mean(coachFills)
const truckMean = mean(truckFills)
const coachFull = coachFills.filter((f) => f >= 0.98).length / coachFills.length
const truckFull = truckFills.filter((f) => f >= 0.98).length / truckFills.length
const truckContractKg = Object.values(s.trips).reduce(
  (a, t) => a + (isCargoModel(s.buses[t.busId]?.modelId) ? (t.outcome?.cargoContractKg ?? 0) : 0),
  0,
)
assert(truckContractKg > 0, 'cargo vehicles should be hauling the signed contract freight')

// Cargo revenue must split cleanly by what carried it, and the halves must add up.
const coachRevenue = s.curMonth.cargoCoachRevenue ?? 0
const truckRevenue = s.curMonth.cargoTruckRevenue ?? 0
const cargoIncome = (s.curMonth.income.cargo ?? 0) + (s.curMonth.income.cargo_spot ?? 0)
assert(coachRevenue > 0, 'coach bellies should be earning parcel freight')
assert(truckRevenue > 0, 'cargo vehicles should be earning freight')
assert.equal(coachRevenue + truckRevenue, cargoIncome, 'coach + truck cargo revenue must equal the cargo income head')
assert((s.curMonth.cargoCoachKg ?? 0) > 0 && (s.curMonth.cargoTruckKg ?? 0) > 0, 'both carriers should report kilograms')
assert(coachMean > 0.12 && coachMean <= 0.95, `coach fill mean ${Math.round(coachMean * 100)}% should sit in a natural band`)
assert(truckMean > 0.03 && truckMean <= 0.85, `truck fill mean ${Math.round(truckMean * 100)}% should not chase a full load`)
assert(coachFull <= 0.60, `${Math.round(coachFull * 100)}% of coach trips are full`)
assert(truckFull <= 0.40, `${Math.round(truckFull * 100)}% of truck trips are full`)

const pdyDays = new Set<number>()
for (const day of s.routeHistory['maa-pdy'] ?? []) {
  const cargo = day.cargo
  if (!cargo) continue
  const trips = (cargo.AB?.trips ?? 0) + (cargo.BA?.trips ?? 0)
  if (trips > 0) pdyDays.add(day.day)
}
assert(pdyDays.size >= 7, `a week of running should leave at least 7 lane-days, got ${pdyDays.size}`)

const offers = signed.filter((c) => c.routeId === 'mdu-maa' || c.routeId === 'maa-mdu')
const offerDirs = new Set(offers.map((c) => c.direction))
assert(offerDirs.has('AB') && offerDirs.has('BA'), 'signed Madurai contracts should name both directions')

console.log(
  `✓ pools · contracts ${signed.length} across ${lanes.size} lanes · ` +
  `coach fill ${Math.round(coachMean * 100)}% (${coachFills.length}) · ` +
  `truck fill ${Math.round(truckMean * 100)}% (${truckFills.length}) · ` +
  `Puducherry days ${pdyDays.size}`,
)
