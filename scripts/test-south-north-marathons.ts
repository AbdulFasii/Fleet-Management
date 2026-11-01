import assert from 'node:assert'
import { ROUTES, RIVALS, routeViaCities, routeViaLabel } from '../src/engine/data/routes'
import { CITIES, CITY_FREIGHT } from '../src/engine/data/cities'
import { BAL } from '../src/engine/data/balance'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { layoverMinutes, turnaroundMinutes, recommendedFleetSize, earliestReturn, suggestReturnSlot } from '../src/engine/sim/pairing'
import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import type { Bus, GameState } from '../src/engine/types'

function makeTestBus(s: GameState, id: string, reg: string, parked: string): Bus {
  return {
    id,
    reg,
    modelId: 'bb1624',
    status: 'active',
    odometer: 10000,
    odometerKm: 10000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2,
    seatCount: 36,
    acquisitionDay: 1,
    purchasePrice: 6500000,
    parkedCityId: parked,
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    aitpPaidUntilDay: s.day + 365,
    tyreKm: 5000,
    engineOilKm: 5000,
    brakeOilKm: 5000,
    coolantKm: 5000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
    breakdownHistory: [],
    busCleanliness: 95,
  } as unknown as Bus
}

console.log('--- 1. Testing Cities & Freight Profiles ---')
assert(CITIES.nag, 'nag must exist in CITIES')
assert(CITIES.bbs, 'bbs must exist in CITIES')
assert.strictEqual(CITIES.nag.name, 'Nagpur')
assert.strictEqual(CITIES.bbs.name, 'Bhubaneswar')
assert(CITY_FREIGHT.nag, 'nag must exist in CITY_FREIGHT')
assert(CITY_FREIGHT.bbs, 'bbs must exist in CITY_FREIGHT')
assert.strictEqual(CITY_FREIGHT.nag.tier, 'industrial')
assert.strictEqual(CITY_FREIGHT.bbs.tier, 'commercial')
console.log('✓ Cities and freight profiles verified.')

console.log('--- 2. Testing 13 South->North Corridors & Rivals ---')
const expectedRoutes = [
  { id: 'blr-nag', km: 1100, hours: 20, unlock: 20 },
  { id: 'hyd-amd', km: 1200, hours: 21, unlock: 20 },
  { id: 'maa-bbs', km: 1250, hours: 22, unlock: 20 },
  { id: 'hyd-del', km: 1560, hours: 26, unlock: 25 },
  { id: 'blr-del', km: 2150, hours: 32, unlock: 30 },
  { id: 'maa-del', km: 2200, hours: 34, unlock: 30 },
  { id: 'koc-del', km: 2650, hours: 36, unlock: 30 },
  { id: 'hyd-jai', km: 1450, hours: 24, unlock: 25 },
  { id: 'blr-jai', km: 1900, hours: 30, unlock: 30 },
  { id: 'blr-amd', km: 1500, hours: 24, unlock: 25 },
  { id: 'maa-amd', km: 1800, hours: 28, unlock: 25 },
  { id: 'hyd-lko', km: 1350, hours: 22, unlock: 25 },
  { id: 'blr-lko', km: 1750, hours: 28, unlock: 30 },
]

for (const exp of expectedRoutes) {
  const r = ROUTES[exp.id]
  assert(r, `Route ${exp.id} must exist in ROUTES`)
  assert.strictEqual(r.km, exp.km, `${exp.id} km mismatch`)
  assert.strictEqual(r.hours, exp.hours, `${exp.id} hours mismatch`)
  assert.strictEqual(r.unlockRep, exp.unlock, `${exp.id} unlockRep mismatch`)
  assert(RIVALS[exp.id] && RIVALS[exp.id].length >= 2, `${exp.id} must have rivals defined`)
  const via = routeViaCities(exp.id)
  assert(via.length > 0, `${exp.id} must have via cities defined (got: ${routeViaLabel(exp.id)})`)
  console.log(`  ✓ ${exp.id}: ${r.km}km, ${r.hours}h, rep ${r.unlockRep}, rivals: ${RIVALS[exp.id].join(', ')}, ${routeViaLabel(exp.id)}`)
}

console.log('--- 3. Testing Layover & Recommended Fleet Sizing ---')
const rShort = ROUTES['maa-pdy']! // 3.5h
const r8h = ROUTES['maa-mdu']! // 8h
const rNag = ROUTES['blr-nag']! // 20h
const rBbs = ROUTES['maa-bbs']! // 22h
const rHydDel = ROUTES['hyd-del']! // 26h
const rBlrDel = ROUTES['blr-del']! // 32h
const rKocDel = ROUTES['koc-del']! // 36h

assert.strictEqual(layoverMinutes(rShort), 0, 'Short hop must have 0 layover')
assert.strictEqual(turnaroundMinutes(rShort), 45, 'Short hop turnaround is 45 min')
assert.strictEqual(recommendedFleetSize(rShort, true), 2, 'Short hop paired fleet is 2')

assert(layoverMinutes(r8h) >= 120 && layoverMinutes(r8h) <= 180, '8h layover should be ~2.5h')
assert.strictEqual(recommendedFleetSize(r8h, true), 2, '8h paired fleet is 2')

// 20-22h peer layover check
const bbsLayover = layoverMinutes(rBbs)
const bbsTurn = turnaroundMinutes(rBbs)
console.log(`  maa-bbs 22h layover: ${(bbsLayover / 60).toFixed(1)}h, total turnaround: ${(bbsTurn / 60).toFixed(1)}h`)
assert(bbsTurn >= 540 && bbsTurn <= 660, '22h turnaround should be ~9.5h to 11h')
assert.strictEqual(recommendedFleetSize(rNag, true), 3, 'blr-nag 20h paired fleet should be 3')
assert.strictEqual(recommendedFleetSize(rBbs, true), 3, 'maa-bbs 22h paired fleet should be 3')

// 26h-36h marathons
assert.strictEqual(recommendedFleetSize(rHydDel, true), 4, 'hyd-del 26h paired fleet should be 4')
assert.strictEqual(recommendedFleetSize(rBlrDel, true), 4, 'blr-del 32h paired fleet should be 4')
assert.strictEqual(recommendedFleetSize(rKocDel, true), 4, 'koc-del 36h paired fleet should be 4')
console.log('✓ Layover scaling and recommended fleet sizes verified.')

console.log('--- 4. Testing Earliest Return & Day Offsets on Marathons ---')
const dep20 = { depHour: 20, depMin: 0 as const }
const nagEarliest = earliestReturn(dep20, rNag)
console.log(`  blr-nag 20h departing 20:00 -> ready: absMin ${nagEarliest.absMin}, dayOffset ${nagEarliest.dayOffset}, clock ${nagEarliest.depHour}:${nagEarliest.depMin}`)
assert(nagEarliest.dayOffset >= 1, 'blr-nag ready crosses day')

const delEarliest = earliestReturn(dep20, rBlrDel)
console.log(`  blr-del 32h departing 20:00 -> ready: absMin ${delEarliest.absMin}, dayOffset ${delEarliest.dayOffset}, clock ${delEarliest.depHour}:${delEarliest.depMin}`)
assert(delEarliest.dayOffset >= 2, 'blr-del 32h ready is on day 2+')
console.log('✓ Earliest return & multi-day offsets verified.')

console.log('--- 5. Testing Multi-Bus Rotation & Schedule Cap in Sim ---')
const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)
s.reputation = 50 // unlock all prestige routes
s.permits['blr-nag'] = {
  id: 'p_blr_nag',
  routeId: 'blr-nag',
  status: 'active',
  grantedDay: s.day,
  expiryDay: s.day + 365,
  costMonthly: 5000,
  tripsRun: 0,
} as any

// Create 4 test buses
const b1 = makeTestBus(s, 'b1', 'KA 01 AB 1001', 'blr')
const b2 = makeTestBus(s, 'b2', 'MH 31 CD 2002', 'nag')
const b3 = makeTestBus(s, 'b3', 'KA 01 EF 3003', 'blr')
const b4 = makeTestBus(s, 'b4', 'MH 31 GH 4004', 'nag')
s.buses['b1'] = b1
s.buses['b2'] = b2
s.buses['b3'] = b3
s.buses['b4'] = b4

const retSlot = suggestReturnSlot(dep20, rNag, s)
const schRes = createSchedule(s, {
  routeId: 'blr-nag',
  depHour: 20,
  depMin: 0,
  paired: true,
  returnDepHour: retSlot.depHour,
  returnDepMin: retSlot.depMin,
  baseFare: 2200,
})
assert('id' in schRes, `Schedule creation failed: ${JSON.stringify(schRes)}`)
const schId = schRes.id

// Assign all 4 buses
assert.strictEqual(assignBus(s, schId, b1.id), null)
assert.strictEqual(assignBus(s, schId, b2.id), null)
assert.strictEqual(assignBus(s, schId, b3.id), null)
assert.strictEqual(assignBus(s, schId, b4.id), null)

const sch = s.schedules[schId]
assert.strictEqual(sch.busIds.length, 4, '4 buses assigned to schedule')

// Check 5th bus is rejected
const b5 = makeTestBus(s, 'b5', 'KA 01 IJ 5005', 'blr')
s.buses['b5'] = b5
const reject5 = assignBus(s, schId, b5.id)
assert(reject5 && reject5.includes('at most 4 buses'), `Expected cap rejection, got: ${reject5}`)

// Generate trips and verify daily departures both ways across 4 days
generateTrips(s)
const trips = Object.values(s.trips).filter((t) => t.scheduleId === schId)
console.log(`  Generated ${trips.length} trips on 4-coach marathon schedule.`)

// Verify that for each day in [s.day, s.day + 1, s.day + 2], we have AB and BA departures
for (let d = s.day; d <= s.day + 3; d++) {
  const dayTrips = trips.filter((t) => t.day === d)
  const ab = dayTrips.filter((t) => t.direction === 'AB')
  const ba = dayTrips.filter((t) => t.direction === 'BA')
  console.log(`  Day ${d}: ${dayTrips.length} trips (AB: ${ab.length}, BA: ${ba.length})`)
  assert(ab.length >= 1, `Day ${d} must have at least 1 AB departure`)
  assert(ba.length >= 1, `Day ${d} must have at least 1 BA departure`)
}

// Test sanitizeScheduleAssignments preserves 4 buses
import { sanitizeScheduleAssignments } from '../src/engine/sim/schedules'
const repairs = sanitizeScheduleAssignments(s)
assert.strictEqual(repairs, 0, 'sanitizeScheduleAssignments should not repair or drop valid 4-bus assignment')
assert.strictEqual(sch.busIds.length, 4, 'All 4 buses must stay retained after sanitization pass')

console.log('--- 6. Testing 3-Bus Unpaired Marathon (koc-del 36h) ---')
s.permits['koc-del'] = {
  id: 'p_koc_del',
  routeId: 'koc-del',
  status: 'active',
  grantedDay: s.day,
  expiryDay: s.day + 365,
  costMonthly: 5000,
  tripsRun: 0,
} as any

const schKocRes = createSchedule(s, {
  routeId: 'koc-del',
  depHour: 20,
  depMin: 0,
  paired: false,
  baseFare: 4500,
})
assert('id' in schKocRes, `koc-del schedule creation failed: ${JSON.stringify(schKocRes)}`)
const kocSchId = schKocRes.id

const kb1 = makeTestBus(s, 'kb1', 'KL 07 AB 1111', 'koc')
const kb2 = makeTestBus(s, 'kb2', 'KL 07 CD 2222', 'koc')
const kb3 = makeTestBus(s, 'kb3', 'KL 07 EF 3333', 'koc')
s.buses['kb1'] = kb1
s.buses['kb2'] = kb2
s.buses['kb3'] = kb3

assert.strictEqual(assignBus(s, kocSchId, kb1.id), null)
assert.strictEqual(assignBus(s, kocSchId, kb2.id), null)
assert.strictEqual(assignBus(s, kocSchId, kb3.id), null, 'Must be able to assign the 3rd bus!')

const kocSch = s.schedules[kocSchId]
assert.strictEqual(kocSch.busIds.length, 3, '3 buses successfully assigned to koc-del')

// Sanitize pass must retain all 3 buses
assert.strictEqual(sanitizeScheduleAssignments(s), 0)
assert.strictEqual(kocSch.busIds.length, 3, '3 buses retained after sanitizeScheduleAssignments')

generateTrips(s)
const kocTrips = Object.values(s.trips).filter((t) => t.scheduleId === kocSchId)
console.log(`  Generated ${kocTrips.length} trips on 3-coach koc-del schedule.`)
for (let d = s.day; d <= s.day + 2; d++) {
  const dTrips = kocTrips.filter((t) => t.day === d)
  assert.strictEqual(dTrips.length, 1, `Day ${d} must have exactly 1 departure on 3-coach marathon`)
  console.log(`  Day ${d}: Bus ${dTrips[0]?.busId} departs ${dTrips[0]?.direction}`)
}
console.log('✓ 3-coach unpaired marathon runs smoothly without drop or clash!')

console.log('✓ Multi-bus rotation generates daily departures in both directions without collision!')
console.log('ALL TESTS PASSED!')
