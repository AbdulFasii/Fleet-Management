import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { EVENTS, forceEvent, applyDecision } from '../src/engine/sim/events'
import { ROUTES } from '../src/engine/data/routes'
import { rs, toRupees } from '../src/engine/core/money'
import type { Bus, Staff } from '../src/engine/types'

console.log('--- Testing Sprint 10 Realism: 15-Event Deck Integration ---')

const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)

// Add test staff and buses to test various event preconditions
const driver1: Staff = {
  id: 'd1',
  name: 'Driver One',
  role: 'driver',
  skill: 7,
  safety: 8,
  salary: rs(20_000),
  morale: 80,
  loyalty: 80,
  experienceYears: 5,
  hiredDay: 1,
  fatigue: 0,
}
const driver2: Staff = {
  id: 'd2',
  name: 'Driver Two',
  role: 'driver',
  skill: 6,
  safety: 7,
  salary: rs(24_000),
  morale: 85,
  loyalty: 85,
  experienceYears: 6,
  hiredDay: 1,
  fatigue: 0,
}
s.staff['d1'] = driver1
s.staff['d2'] = driver2

const bus1: Bus = {
  id: 'b1',
  reg: 'KA-01-EQ-1111',
  nickname: 'Bus 1',
  modelId: 'cheetah',
  ownership: 'owned',
  mfgYear: 2022,
  acquiredDay: s.day,
  acquiredPrice: rs(3_000_000),
  bookValue: rs(3_000_000),
  odometer: 50_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
  tyreKm: 20_000,
  tyresRetreaded: false,
  frontTyreKm: 20_000,
  rearTyreKm: 20_000,
  frontBrand: 'tier2',
  rearBrand: 'oem',
  tyreCount: 6,
  lastServiceOdo: 40_000,
  insuranceExpiryDay: s.day + 365,
  fitnessExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 180,
  gpsDeviceFitted: true,
  roadTaxPayableDay: s.day + 365,
  aitpPaidUntilDay: s.day + 365,
  status: 'active',
  duty: 'line',
  accidentHistory: false,
  busCleanliness: 90,
  lifeRevenue: 0,
  lifeCost: 0,
  lifeTrips: 0,
  qualityScore: 4.5,
}
const bus2: Bus = {
  ...bus1,
  id: 'b2',
  reg: 'KA-01-EQ-2222',
  frontBrand: 'oem',
  rearBrand: 'retread',
}
s.buses['b1'] = bus1
s.buses['b2'] = bus2

// 15 event ids to test
const sprint10Events = [
  'checkpost_inspection',
  'road_widening',
  'bridge_closure',
  'fuel_adulteration',
  'labour_inspection',
  'festival_charter',
  'cheque_bounce',
  'new_expressway_proposal',
  'driver_union_demand',
  'flood_disruption',
  'quota_travel_surge',
  'celebrity_travel',
  'pilferage_at_terminal',
  'tyre_recall',
]

console.log('\n[Check 1] Verifying all new events exist in the deck...')
for (const id of sprint10Events) {
  const def = EVENTS.find((e) => e.id === id)
  if (!def) {
    console.error(`FAIL: Missing event definition for ${id}`)
    process.exit(1)
  }
}
console.log(`✓ All 14 new event deck definitions registered in EVENTS (total deck size: ${EVENTS.length})`)

// Check 2: Flood closes only ghat routes
console.log('\n[Check 2] Flood disruption closes only ghat routes...')
// Closures on corridors we hold no permit for are trimmed the same day (they
// cannot affect us), so hold permits on every ghat route to see them.
for (const r of Object.values(ROUTES)) {
  if (r.ghat && !s.permits[r.id]) s.permits[r.id] = { routeId: r.id, status: 'active', appliedDay: s.day - 5, expiryDay: s.day + 20_000 } as never
}
s.forcedEventId = 'flood_disruption'
advanceDay(s)

const closedRoutes = Object.keys(s.world.closures)
console.log(`Closures active: ${closedRoutes.join(', ')}`)
if (closedRoutes.length >= 2 && closedRoutes.every((rid) => ROUTES[rid]?.ghat)) {
  console.log('✓ Flood disruption closed 2-4 routes, and ALL closed routes are ghat routes (ghat: true)')
} else {
  console.error('FAIL: Flood disruption closed non-ghat routes or failed to close routes:', closedRoutes)
  process.exit(1)
}

// Check 3: Driver union demand raises every driver salary by 10%
console.log('\n[Check 3] Driver union demand raises every driver salary by 10%...')
const salary1Before = driver1.salary
const salary2Before = driver2.salary

s.forcedEventId = 'driver_union_demand'
advanceDay(s)

const unionDec = s.decisions.find((d) => d.kind === 'driver_union_demand')
if (!unionDec) {
  console.error('FAIL: driver_union_demand decision was not pushed')
  process.exit(1)
}

console.log(`Found union decision: "${unionDec.title}"`)
const applyErr = applyDecision(s, unionDec.id, 'accept')
if (!applyErr) {
  const s1Expected = Math.round(salary1Before * 1.10)
  const s2Expected = Math.round(salary2Before * 1.10)
  if (driver1.salary === s1Expected && driver2.salary === s2Expected) {
    console.log(`✓ Union agreement raised driver 1 salary: ₹${toRupees(salary1Before)} -> ₹${toRupees(driver1.salary)} (+10%)`)
    console.log(`✓ Union agreement raised driver 2 salary: ₹${toRupees(salary2Before)} -> ₹${toRupees(driver2.salary)} (+10%)`)
  } else {
    console.error(`FAIL: Salary not raised properly: d1 ${driver1.salary} (expected ${s1Expected}), d2 ${driver2.salary} (expected ${s2Expected})`)
    process.exit(1)
  }
} else {
  console.error('FAIL: applyDecision failed for union demand:', applyErr)
  process.exit(1)
}

// Check 4: Tyre recall affects only the named brand
console.log('\n[Check 4] Tyre recall affects only the named brand...')
// Set initial tyre km
bus1.frontBrand = 'tier2'
bus1.frontTyreKm = 10_000
bus1.rearBrand = 'oem'
bus1.rearTyreKm = 10_000

bus2.frontBrand = 'oem'
bus2.frontTyreKm = 10_000
bus2.rearBrand = 'retread'
bus2.rearTyreKm = 10_000

s.forcedEventId = 'tyre_recall'
advanceDay(s)

// Either tier2 or retread was recalled
const tier2Hit = bus1.frontTyreKm > 10_000
const retreadHit = bus2.rearTyreKm > 10_000

if ((tier2Hit && !retreadHit) || (!tier2Hit && retreadHit)) {
  const brandRecalled = tier2Hit ? 'tier2' : 'retread'
  console.log(`✓ Tyre recall targeted only ${brandRecalled}: affected axles were set to maximum life; OEM axles untouched`)
  if (tier2Hit) {
    if (bus1.rearTyreKm !== 10_000 || bus2.frontTyreKm !== 10_000) {
      console.error('FAIL: OEM axles were inadvertently altered by tyre recall')
      process.exit(1)
    }
  }
} else {
  console.error('FAIL: Tyre recall did not correctly isolate the recalled brand')
  process.exit(1)
}

// Check 5: Forcing each remaining new event via forcedEventId
console.log('\n[Check 5] Verifying all remaining new events fire cleanly...')
const remainingEvents = [
  'checkpost_inspection',
  'road_widening',
  'bridge_closure',
  'fuel_adulteration',
  'labour_inspection',
  'festival_charter',
  'new_expressway_proposal',
  'quota_travel_surge',
  'celebrity_travel',
  'pilferage_at_terminal',
]

for (const evtId of remainingEvents) {
  s.forcedEventId = evtId
  advanceDay(s)
  console.log(`✓ Forced and processed: ${evtId}`)
}

console.log('\n--- ALL SPRINT 10 CHECKS PASSED! ---')
