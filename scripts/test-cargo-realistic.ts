import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { BAL } from '../src/engine/data/balance'
import { BUS_MODELS, cargoVolumeForSeats } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { rs, toRupees } from '../src/engine/core/money'
import { fuelLitresForRun } from '../src/engine/sim/dispatch'
import {
  allocateCargoForTrip,
  cargoFreightRupees,
  dailyCargoPass,
  getAvailableContracts,
  makeCorridorCargoPool,
  openCargoPermit,
  truckRatePerKg100Km,
} from '../src/engine/sim/cargo'
import { assignBus, createSchedule } from '../src/engine/sim/schedules'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Bus, Staff } from '../src/engine/types'

const route = ROUTES['mdu-maa']!
const rate = BAL.cargoBaseRateDefaultRs * BAL.cargoTruckRateVsParcel
const freight = cargoFreightRupees(4150, route.km, rate)
assert(freight > 12000 && freight < 20000, `4.15t on ${route.km} km should earn ₹12–20k, got ₹${Math.round(freight)}`)

const heavy = BUS_MODELS.bb_5528t!
const coach = BUS_MODELS.bb1824!
const cautious = fuelLitresForRun(coach.mileage, 705, true, false, 0.7, 1)
const aggressive = fuelLitresForRun(coach.mileage, 705, true, false, 0.7, 0.857)
assert(cautious > 198 && cautious < 208, `1824HD cautious on 705 km should be ~201 L, got ${cautious.toFixed(0)}`)
assert(aggressive > 230 && aggressive < 242, `1824HD aggressive on 705 km should be ~235 L, got ${aggressive.toFixed(0)}`)

const lightLitres = fuelLitresForRun(heavy.mileage, route.km, false, true, 0.16, 1)
const fullLitres = fuelLitresForRun(heavy.mileage, route.km, false, true, 1, 1)
const coachLitres = fuelLitresForRun(coach.mileage, route.km, Boolean(coach.ac), false, 0.7, 1)
assert(lightLitres > coachLitres, `26T at 16% (${lightLitres.toFixed(0)} L) should burn more than a coach (${coachLitres.toFixed(0)} L)`)
assert(lightLitres > 180 && lightLitres < 210, `16% load expected ~180–200 L, got ${lightLitres.toFixed(0)}`)
assert(fullLitres > lightLitres, 'a full truck burns more than a light one')

const s = newGame('Cargo realism', 'seth', 'mdu-maa', 42)
s.company.cash = 50_000_000_00
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

// No cargo licence yet: the desk must not invite freight on the corridor.
assert.equal(getAvailableContracts(s).length, 0, 'no contract invites without a cargo licence')
const licenceFee = BAL.cargoPermitBaseFee + Math.round(BAL.cargoPermitPerKmFee * route.km)
const cashBeforeLicence = s.company.cash
assert.equal(openCargoPermit(s, 'mdu-maa'), null)
assert.equal(s.company.cash, cashBeforeLicence - licenceFee, 'the annual licence is paid upfront')
assert(s.permits['mdu-maa']?.cargo?.expiryDay === s.day + BAL.cargoPermitTermDays, 'licence runs a year')

const offered = getAvailableContracts(s).filter((c) => c.routeId === 'mdu-maa')
assert(offered.length > 2, `expected more than 2 proposals, got ${offered.length}`)
const cashBefore = s.company.cash
dailyCargoPass(s)
const signed = (s.company.cargoContracts ?? []).filter((c) => c.active && c.routeId === 'mdu-maa')
assert(signed.length > 2, `manager should sign every proposal, signed ${signed.length}`)
assert.equal(s.company.cash, cashBefore, 'signing and queueing must not pay freight')
assert.equal(s.curMonth.income.cargo_spot ?? 0, 0, 'spot loads are not a separate payday')

const departures = [1, 2].map((n) => ({
  tripId: `t${n}`,
  routeId: route.id,
  capKg: 4150,
  depHour: 21,
  depMin: 0,
  isCargo: true,
}))
const pool = makeCorridorCargoPool(s, route, 'AB', departures)
const alloc = allocateCargoForTrip(s, pool, route, 't1', 4150, true)
assert(alloc.kg > 0 && alloc.kg <= 4150, `load should fit the truck cap, got ${alloc.kg}`)
assert(alloc.kg < 4150, `a 4.15t truck should not be topped off on purpose, got ${alloc.kg}`)
const perKg = toRupees(alloc.revenue) / alloc.kg
const lane = route.km / 100
assert(perKg > 2.5 && perKg < 6, `₹/kg on this lane should be truck freight (~₹${(truckRatePerKg100Km(s) * lane).toFixed(2)}), got ₹${perKg.toFixed(2)}`)
const again = allocateCargoForTrip(s, pool, route, 't2', 4150, true)
const hauled = alloc.contractKg + alloc.spotKg
const hauledAgain = again.contractKg + again.spotKg
assert(hauledAgain <= hauled, 'the same contract and spot kilograms must not be paid twice')

const spotBefore = (s.company.spotOffers ?? []).filter((o) => o.status === 'queued')
assert(spotBefore.length > 0, 'manager should queue spot loads instead of cashing them')

const model = BUS_MODELS.bb_5528t!
const bus: Bus = {
  id: 'truck1',
  reg: 'TN32 TJ 2468',
  nickname: '5528T',
  modelId: model.id,
  ownership: 'owned',
  mfgYear: 2022,
  acquiredDay: s.day,
  acquiredPrice: rs(4_500_000),
  bookValue: rs(4_500_000),
  odometer: 40_000,
  condition: { engine: 95, gearbox: 95, brakes: 95, suspension: 95, ac: 95, electrical: 95, body: 95 },
  tyreKm: 10_000,
  frontTyreKm: 10_000,
  rearTyreKm: 10_000,
  tyresRetreaded: false,
  frontBrand: 'oem',
  rearBrand: 'oem',
  tyreCount: 10,
  status: 'active',
  insuranceExpiryDay: s.day + 200,
  fitnessExpiryDay: s.day + 200,
  pucExpiryDay: s.day + 200,
  roadTaxPayableDay: s.day + 200,
  aitpPaidUntilDay: s.day + 200,
  gpsDeviceFitted: true,
  lastServiceOdo: 30_000,
  cargoVolumeCbm: model.cargoVolumeCbm ?? cargoVolumeForSeats(model.seats),
}
s.buses[bus.id] = bus
const drv: Staff = {
  id: 'drv1',
  name: 'Ramesh Cargo',
  role: 'driver',
  skill: 7,
  experienceYears: 8,
  salary: 2800000,
  loyalty: 70,
  morale: 80,
  fatigue: 10,
  safety: 7,
  hiredDay: s.day,
  busId: bus.id,
  duty: 'line',
  licenceClass: 'HMV_HP',
}
s.staff[drv.id] = drv
const made = createSchedule(s, {
  routeId: 'mdu-maa',
  depHour: 21,
  depMin: 0,
  baseFare: rs(800),
  autoPrice: false,
  cancellation: 'standard',
  redDeal: false,
  serviceKind: 'cargo',
})
assert('id' in made, `cargo schedule: ${'error' in made ? made.error : ''}`)
if (!('id' in made)) throw new Error('schedule')
assert.equal(assignBus(s, made.id, bus.id), null)

advanceDay(s)
const done = Object.values(s.trips).filter((t) => t.status === 'completed' && t.outcome)
assert(done.length > 0, 'the 26T should complete a departure')
const hauledKg = done.reduce((a, t) => a + (t.outcome?.cargoKg ?? 0), 0)
const hauledPay = done.reduce((a, t) => a + (t.outcome?.cargoRevenue ?? 0), 0)
assert.equal(s.curMonth.cargoKgMtd ?? 0, hauledKg, 'month kilograms are the kilograms on completed trips')
assert.equal(s.curMonth.income.cargo ?? 0, hauledPay, 'freight is booked once, on the cargo head')
assert.equal(s.curMonth.income.cargo_spot ?? 0, 0, 'a hauled spot is not a second payday')
for (const t of done) {
  const kg = t.outcome?.cargoKg ?? 0
  const rupees = toRupees(t.outcome?.cargoRevenue ?? 0)
  if (kg <= 0) continue
  const each = rupees / kg
  assert(each < 6, `trip freight ₹${each.toFixed(2)}/kg is still parcel-desk pricing`)
  assert(rupees < 100_000, `trip freight ₹${Math.round(rupees)} should stay under ₹1L`)
}

console.log(`✓ 4.15t freight ₹${Math.round(freight)} · 26T ${lightLitres.toFixed(0)} L vs coach ${coachLitres.toFixed(0)} L · signed ${signed.length} contracts · ₹${perKg.toFixed(2)}/kg · hauled ${hauledKg.toLocaleString('en-IN')} kg for ₹${Math.round(toRupees(hauledPay)).toLocaleString('en-IN')}`)
