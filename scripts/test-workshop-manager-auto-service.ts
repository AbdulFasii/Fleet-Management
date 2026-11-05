import { newGame } from '../src/engine/newGame'
import { BAL, driverBataForKm } from '../src/engine/data/balance'
import { dailyMaintenancePass, serviceDueKm, bServiceDueKm, overhaulDueInfo } from '../src/engine/sim/maintenance'
import { assignStaff } from '../src/engine/sim/staffing'
import type { Bus, Staff } from '../src/engine/types'

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

console.log('--- Testing Crew Bata ₹250 Reduction ---')
assert(BAL.driverBataMin === 35000, `Expected driverBataMin = 35000 paise (₹350), got ${BAL.driverBataMin}`)
assert(BAL.driverBataMax === 100000, `Expected driverBataMax = 100000 paise (₹1000), got ${BAL.driverBataMax}`)
assert(BAL.conductorBata === 15000, `Expected conductorBata = 15000 paise (₹150), got ${BAL.conductorBata}`)
assert(driverBataForKm(100) === 35000, `Expected 35000 for short km, got ${driverBataForKm(100)}`)
assert(driverBataForKm(1200) === 100000, `Expected 100000 for long km, got ${driverBataForKm(1200)}`)
console.log('✓ Crew bata reduced by ₹250 correctly!')

console.log('--- Testing Workshop Manager Auto-Service Automation ---')
const s = newGame('Test Corp', 'seth', 'maa-cbe', 42)
console.log('s.day is:', s.day)

// Make sure we have adequate cash
s.company.cash = 10_000_000

// Create 3 buses:
// Bus 1: 25k Minor A-Service due
// Bus 2: 100k Major B-Service due
// Bus 3: 250k Overhaul due
const bus1: Bus = {
  id: 'b1',
  reg: 'KA-01-A-1001',
  modelId: 'leyacsleep2',
  mfgYear: 2024,
  ownership: 'owned',
  status: 'active',
  condition: { engine: 80, gearbox: 80, brakes: 80, suspension: 80, ac: 80, electrical: 80, body: 80 },
  busCleanliness: 90,
  odometer: 30_000,
  lastServiceOdo: 0, // 30k since last service -> A-service due (> 25k)
  lastMajorServiceOdo: 0,
  lastOverhaulOdo: 0,
  lastOverhaulDay: s.day - 50,
  acquiredDay: s.day - 100,
  frontBrand: 'oem',
  rearBrand: 'oem',
  frontTyreKm: 10_000,
  rearTyreKm: 10_000,
  tyreKm: 10_000,
  tyresRetreaded: false,
  insuranceExpiryDay: s.day + 200,
  fitnessExpiryDay: s.day + 200,
  pucExpiryDay: s.day + 200,
  roadTaxPayableDay: s.day + 200,
  aitpPaidUntilDay: s.day + 200,
  gpsDeviceFitted: true,
}

const bus2: Bus = {
  ...bus1,
  id: 'b2',
  reg: 'KA-01-A-1002',
  odometer: 110_000,
  lastServiceOdo: 80_000, // 30k since service -> due
  lastMajorServiceOdo: 0, // 110k since major service -> B-service due (> 100k)
  lastOverhaulOdo: 0,
  lastOverhaulDay: s.day - 100,
  acquiredDay: s.day - 200,
}

const bus3: Bus = {
  ...bus1,
  id: 'b3',
  reg: 'KA-01-A-1003',
  odometer: 260_000,
  lastServiceOdo: 230_000,
  lastMajorServiceOdo: 150_000,
  lastOverhaulOdo: 0, // 260k since overhaul -> Overhaul due (> 250k)
  lastOverhaulDay: s.day - 380, // Overhaul due by days too (> 365d)
  acquiredDay: s.day - 400,
}

s.buses = { b1: bus1, b2: bus2, b3: bus3 }

// Phase 1: No workshop manager, no bays
console.log('Phase 1: No manager assigned');
s.workshop.managerId = undefined
s.workshop.bays = 0
s.workshop.mechanicIds = []
dailyMaintenancePass(s)
assert(s.buses.b1.status === 'active', 'Bus 1 should remain active when no manager')
assert(s.buses.b2.status === 'active', 'Bus 2 should remain active when no manager')
assert(s.buses.b3.status === 'active', 'Bus 3 should remain active when no manager')
console.log('✓ No auto-service without manager.')

// Phase 2: Manager appointed, but 0 bays and 0 mechanics
console.log('Phase 2: Manager appointed, but 0 bays and 0 employees')
const mgr: Staff = {
  id: 'mgr1',
  name: 'Ramesh Workshop Mgr',
  role: 'manager',
  skill: 8,
  salary: 40_000,
  hiredDay: 1,
  morale: 80,
  loyalty: 80,
  experienceMonths: 24,
}
s.staff[mgr.id] = mgr
s.workshop.managerId = mgr.id
s.workshop.bays = 0
s.workshop.mechanicIds = []
dailyMaintenancePass(s)
assert(s.buses.b1.status === 'active', 'Bus 1 should remain active when 0 bays and 0 employees')
assert(s.buses.b2.status === 'active', 'Bus 2 should remain active when 0 bays and 0 employees')
assert(s.buses.b3.status === 'active', 'Bus 3 should remain active when 0 bays and 0 employees')
console.log('✓ No auto-service when bays=0 and employees=0.')

// Phase 3: Manager appointed AND 1 bay built with 1 mechanic assigned
console.log('Phase 3: Manager appointed, 1 bay built, 1 mechanic assigned')
const mech: Staff = {
  id: 'mech1',
  name: 'Suresh Mechanic',
  role: 'mechanic',
  skill: 7,
  salary: 25_000,
  hiredDay: 1,
  morale: 80,
  loyalty: 80,
  experienceMonths: 12,
}
s.staff[mech.id] = mech
s.workshop.level = 1
s.workshop.bays = 1
s.workshop.mechanicIds = [mech.id]

dailyMaintenancePass(s)

// Verify that:
// 1. One bus got the in-house bay
// 2. With our own bays built, nothing is sent to an outside garage: the other
//    two wait (still active) for our bay to free up.
const inHouse = Object.values(s.buses).filter((b) => b.status === 'workshop' && !b.outsideGarage)
const outside = Object.values(s.buses).filter((b) => b.status === 'workshop' && b.outsideGarage)

console.log(`In-house jobs: ${inHouse.length} (${inHouse.map(b => b.reg).join(', ')})`)
console.log(`Outside commercial jobs: ${outside.length} (${outside.map(b => `${b.reg} [${b.workshopJob}]`).join(', ')})`)

assert(inHouse.length === 1, `Expected exactly 1 in-house bay job, got ${inHouse.length}`)
assert(outside.length === 0, `Expected no outside garage jobs while we own bays, got ${outside.length}`)
assert(Object.values(s.buses).filter((b) => b.status === 'active').length === 2, 'The other 2 due buses wait for our bay')

console.log('✓ General service automated in-house; the rest queue for our own bay.')

// Phase 4: one bay works through the queue; every coach is serviced in turn
// and returns to active duty.
console.log('Phase 4: Simulating turnaround and return to active duty')
const serviced = new Set(Object.values(s.buses).filter((b) => b.status === 'workshop').map((b) => b.id))
for (let d = 0; d < 25; d++) {
  s.day += 1
  dailyMaintenancePass(s)
  for (const b of Object.values(s.buses)) if (b.status === 'workshop') serviced.add(b.id)
}
const allActive = Object.values(s.buses).filter(b => b.status === 'active')
console.log(`Serviced through our bay: ${serviced.size} · active now: ${allActive.length}`)
assert(serviced.size === 3, 'All 3 due buses should pass through our bay')
assert(allActive.length === 3, 'All 3 buses should have returned to active duty after servicing')
console.log('✓ All buses completed servicing and returned to active duty!')
// Phase 5: Test "or employees assign" when bays = 0
console.log('Phase 5: Manager appointed, 0 bays, but mechanics assigned -> all 3 go to outside third-party')
const s2 = newGame('Test Corp 2', 'seth', 'maa-cbe', 43)
s2.company.cash = 10_000_000
const busA: Bus = { ...bus1, id: 'ba', reg: 'KA-01-A-2001', status: 'active', odometer: 30_000, lastServiceOdo: 0 }
const busB: Bus = { ...bus2, id: 'bb', reg: 'KA-01-A-2002', status: 'active', odometer: 110_000, lastMajorServiceOdo: 0 }
const busC: Bus = { ...bus3, id: 'bc', reg: 'KA-01-A-2003', status: 'active', odometer: 260_000, lastOverhaulOdo: 0 }
s2.buses = { ba: busA, bb: busB, bc: busC }
s2.staff[mgr.id] = mgr
s2.staff[mech.id] = mech
s2.workshop.managerId = mgr.id
s2.workshop.bays = 0
s2.workshop.mechanicIds = [mech.id]

dailyMaintenancePass(s2)
const outsideAll = Object.values(s2.buses).filter((b) => b.status === 'workshop' && b.outsideGarage)
console.log(`Outside jobs with 0 bays but mechanics assigned: ${outsideAll.length}`)
assert(outsideAll.length === 3, `Expected all 3 buses sent to outside third-party, got ${outsideAll.length}`)
console.log('✓ When mechanics are assigned even with 0 bays, all services automated to third party!')

console.log('All tests passed successfully!')
