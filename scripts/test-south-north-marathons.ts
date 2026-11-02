import assert from 'node:assert'
import { ROUTES, RIVALS, routeViaCities, routeViaLabel } from '../src/engine/data/routes'
import { CITIES, CITY_FREIGHT } from '../src/engine/data/cities'
import { turnaroundMinutes, recommendedFleetSize, earliestReturn, suggestReturnSlot } from '../src/engine/sim/pairing'
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

console.log('--- 2. Testing Remaining South->North Corridors & Rivals ---')
const expectedRoutes = [
  { id: 'blr-nag', km: 1100, hours: 22, unlock: 20 },
  { id: 'maa-bbs', km: 1250, hours: 23, unlock: 20 },
  { id: 'maa-mum', km: 1340, hours: 24, unlock: 20 },
  { id: 'blr-mum', km: 985, hours: 19, unlock: 20 },
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

for (const gone of ['hyd-amd', 'hyd-jai', 'maa-pnq', 'hyd-lko', 'blr-amd', 'maa-amd', 'blr-jai', 'blr-lko', 'hyd-del', 'blr-del', 'maa-del', 'koc-del']) {
  assert.strictEqual(ROUTES[gone], undefined, `${gone} must be removed`)
}
console.log('✓ Retired ultra-long corridors are gone.')

console.log('--- 3. Testing Layover & Recommended Fleet Sizing ---')
const rShort = ROUTES['maa-pdy']! // 4h
const r8h = ROUTES['maa-mdu']! // 8h
const rNag = ROUTES['blr-nag']! // 22h
const rBbs = ROUTES['maa-bbs']! // 23h
const rMaaMum = ROUTES['maa-mum']! // 24h

assert.strictEqual(turnaroundMinutes(rShort), 234, 'Short hop default cooldown is 3.9h')
assert.strictEqual(recommendedFleetSize(rShort, true), 2, 'Short hop paired fleet is 2')

assert.strictEqual(turnaroundMinutes(r8h), 234, '8h cooldown is default 3.9h')
assert.strictEqual(recommendedFleetSize(r8h, true), 2, '8h paired fleet is 2')

// Tiered cooldown: ≥18→5.9, ≥24→7.9, ≥28→9.9, ≥34→11.9
const bbsTurn = turnaroundMinutes(rBbs)
console.log(`  maa-bbs ${rBbs.hours}h turnaround: ${(bbsTurn / 60).toFixed(1)}h`)
assert.strictEqual(turnaroundMinutes(ROUTES['maa-kkm']!), 234, '13h cooldown is default 3.9h')
assert.strictEqual(turnaroundMinutes(rNag), 354, '22h cooldown is 5.9h')
assert.strictEqual(bbsTurn, 354, '23h cooldown is 5.9h')
assert.strictEqual(turnaroundMinutes(rMaaMum), 474, '24h cooldown is 7.9h')
assert.strictEqual(turnaroundMinutes({ hours: 28 }), 594, '28h synthetic cooldown is 9.9h')
assert.strictEqual(turnaroundMinutes({ hours: 36 }), 714, '36h synthetic cooldown is 11.9h')
assert.strictEqual(recommendedFleetSize(rNag, true), 4, 'blr-nag 22h paired fleet should be 4')
assert.strictEqual(recommendedFleetSize(rBbs, true), 4, 'maa-bbs 23h paired fleet should be 4')
assert.strictEqual(recommendedFleetSize(rMaaMum, true), 4, 'maa-mum 24h paired fleet should be 4')
assert.strictEqual(recommendedFleetSize(rMaaMum, false), 3, 'maa-mum 24h unpaired needs 3 for daily round-trip')
console.log('✓ Tiered cooldown (3.9/5.9/7.9/9.9/11.9) and fleet sizes verified.')

console.log('--- 4. Testing Earliest Return & Day Offsets on Marathons ---')
const dep20 = { depHour: 20, depMin: 0 as const }
const nagEarliest = earliestReturn(dep20, rNag)
console.log(`  blr-nag ${rNag.hours}h departing 20:00 -> ready: absMin ${nagEarliest.absMin}, dayOffset ${nagEarliest.dayOffset}, clock ${nagEarliest.depHour}:${nagEarliest.depMin}`)
assert(nagEarliest.dayOffset >= 1, 'blr-nag ready crosses day')

const mumEarliest = earliestReturn(dep20, rMaaMum)
console.log(`  maa-mum ${rMaaMum.hours}h departing 20:00 -> ready: absMin ${mumEarliest.absMin}, dayOffset ${mumEarliest.dayOffset}, clock ${mumEarliest.depHour}:${mumEarliest.depMin}`)
assert(mumEarliest.dayOffset >= 1, 'maa-mum 24h ready crosses at least one day')
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
assert(reject5 && /at most 4/.test(reject5), `Expected cap rejection, got: ${reject5}`)

// Generate trips and verify daily departures both ways across 4 days
generateTrips(s)
const trips = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.status === 'open')
console.log(`  Generated ${trips.length} open trips on 4-coach marathon schedule.`)

// Verify each day has exactly one AB and one BA (ready coach takes next schedule clock)
console.log('--- After b1, b2, b3, b4 assigned ---')
for (const t of Object.values(s.trips)) {
  if (t.scheduleId === schId) {
    console.log(`  TRIP: id=${t.id}, bus=${t.busId}, day=${t.day}, dir=${t.direction}, status=${t.status}`)
  }
}
for (let d = s.day; d <= s.day + 3; d++) {
  const dayTrips = trips.filter((t) => t.day === d)
  const ab = dayTrips.filter((t) => t.direction === 'AB')
  const ba = dayTrips.filter((t) => t.direction === 'BA')
  console.log(`  Day ${d}: open (AB: ${ab.length} [${ab.map(t=>t.busId).join(',')}], BA: ${ba.length} [${ba.map(t=>t.busId).join(',')}])`)
  assert.strictEqual(ab.length, 1, `Day ${d} must have exactly 1 AB departure`)
  assert.strictEqual(ba.length, 1, `Day ${d} must have exactly 1 BA departure`)
}

// Test sanitizeScheduleAssignments preserves 4 buses
import { sanitizeScheduleAssignments } from '../src/engine/sim/schedules'
const repairs = sanitizeScheduleAssignments(s)
assert.strictEqual(repairs, 0, 'sanitizeScheduleAssignments should not repair or drop valid 4-bus assignment')
assert.strictEqual(sch.busIds.length, 4, 'All 4 buses must stay retained after sanitization pass')

console.log('--- 6. Testing 3-Bus Unpaired Marathon (maa-mum 24h) ---')
s.permits['maa-mum'] = {
  id: 'p_maa_mum',
  routeId: 'maa-mum',
  status: 'active',
  grantedDay: s.day,
  expiryDay: s.day + 365,
  costMonthly: 5000,
  tripsRun: 0,
} as any

const schMumRes = createSchedule(s, {
  routeId: 'maa-mum',
  depHour: 20,
  depMin: 0,
  paired: false,
  baseFare: 2400,
})
assert('id' in schMumRes, `maa-mum schedule creation failed: ${JSON.stringify(schMumRes)}`)
const mumSchId = schMumRes.id

const kb1 = makeTestBus(s, 'kb1', 'TN 09 AB 1111', 'maa')
const kb2 = makeTestBus(s, 'kb2', 'TN 09 CD 2222', 'maa')
const kb3 = makeTestBus(s, 'kb3', 'TN 09 EF 3333', 'maa')
s.buses['kb1'] = kb1
s.buses['kb2'] = kb2
s.buses['kb3'] = kb3

assert.strictEqual(assignBus(s, mumSchId, kb1.id), null)
assert.strictEqual(assignBus(s, mumSchId, kb2.id), null)
assert.strictEqual(assignBus(s, mumSchId, kb3.id), null, 'Must be able to assign the 3rd bus!')

const mumSch = s.schedules[mumSchId]
assert.strictEqual(mumSch.busIds.length, 3, '3 buses successfully assigned to maa-mum')

assert.strictEqual(sanitizeScheduleAssignments(s), 0)
assert.strictEqual(mumSch.busIds.length, 3, '3 buses retained after sanitizeScheduleAssignments')

generateTrips(s)
const mumTrips = Object.values(s.trips).filter((t) => t.scheduleId === mumSchId && t.status === 'open')
console.log(`  Generated ${mumTrips.length} open trips on 3-coach maa-mum schedule.`)
assert(mumTrips.length >= 3, 'Must generate open trips across the window')
for (const t of mumTrips) {
  console.log(`  Day ${t.day} (${t.depHour}:${t.depMin}): ${t.direction} by ${t.busId}`)
}
console.log('✓ 3-coach unpaired marathon runs smoothly without drop or clash!')

console.log('--- 7. Testing Unpaired Cap at Recommended Fleet (maa-mum 24h → 3) ---')
const kb4 = makeTestBus(s, 'kb4', 'MH 01 GH 4444', 'mum')
s.buses['kb4'] = kb4
const reject4 = assignBus(s, mumSchId, kb4.id)
assert(reject4 && /at most 3/.test(reject4), `Expected 3-coach cap rejection, got: ${reject4}`)
assert.strictEqual(mumSch.busIds.length, 3, 'Unpaired maa-mum stays capped at recommended 3')
console.log('✓ Unpaired marathon caps assign at recommended fleet size!')

console.log('✓ Multi-bus rotation generates daily departures in both directions without collision!')
console.log('ALL TESTS PASSED!')
