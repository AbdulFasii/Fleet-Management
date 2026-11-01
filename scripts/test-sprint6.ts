import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BAL } from '../src/engine/data/balance'
import { fromCivil } from '../src/engine/core/calendar'
import { seasonOpen } from '../src/engine/core/calendar'
import {
  statesOnRoute,
  applySeasonalPermit,
  permitPass,
  createSchedule,
  assignBus,
} from '../src/engine/sim/schedules'
import { festivalAssignPass, festivalTeardownPass } from '../src/engine/sim/festival'
import { generateTrips } from '../src/engine/sim/booking'
import type { Bus } from '../src/engine/types'

console.log('--- Testing Sprint 6 Realism: Seasonal Permits, States & Mixed Festival Legs ---')

function createTestBus(id: string, sDay = 20179): Bus {
  return {
    id,
    reg: `KA-01-EQ-${id.slice(-4)}`,
    nickname: `Bus ${id}`,
    modelId: 'cheetah',
    ownership: 'owned',
    mfgYear: 2022,
    acquiredDay: sDay,
    acquiredPrice: 3_000_000,
    bookValue: 3_000_000,
    odometer: 50_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
    tyreKm: 20_000,
    tyresRetreaded: false,
    frontTyreKm: 20_000,
    rearTyreKm: 20_000,
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: 6,
    lastServiceOdo: 40_000,
    insuranceExpiryDay: sDay + 365,
    fitnessExpiryDay: sDay + 365,
    pucExpiryDay: sDay + 180,
    gpsDeviceFitted: true,
    roadTaxPayableDay: sDay + 365,
    aitpPaidUntilDay: sDay + 365,
    parkedCityId: 'blr',
    status: 'active',
    duty: 'line',
    accidentHistory: false,
    busCleanliness: 90,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: 4.5,
  }
}

// Check 1: statesOnRoute & season calendar helpers
console.log('\n[Check 1] statesOnRoute & season helpers...')
const routeBlnMaa = ROUTES['blr-maa']! // Bengaluru (KA) to Chennai (TN)
const states1 = statesOnRoute(routeBlnMaa)
if (states1.length === 2 && states1.includes('Karnataka') && states1.includes('Tamil Nadu')) {
  console.log('✓ statesOnRoute correctly identifies unique states on route:', states1.join(', '))
} else {
  console.error('FAIL: Expected Karnataka & Tamil Nadu, got:', states1)
  process.exit(1)
}

const summerDay = fromCivil(2025, 5, 10) // 10 May (Summer)
const winterDay = fromCivil(2025, 12, 1) // 1 Dec (Pilgrim)
const diwaliDay = fromCivil(2025, 11, 1) // 1 Nov (Diwali)
const augustDay = fromCivil(2025, 8, 20) // 20 Aug (None)

if (seasonOpen(summerDay, 'summer') && !seasonOpen(summerDay, 'pilgrim') && !seasonOpen(summerDay, 'diwali')) {
  console.log('✓ Summer season open on 10 May and closed for pilgrim/diwali')
} else {
  console.error('FAIL: Summer season check failed on 10 May')
  process.exit(1)
}

if (seasonOpen(winterDay, 'pilgrim') && !seasonOpen(winterDay, 'summer')) {
  console.log('✓ Pilgrim season open on 1 Dec')
} else {
  console.error('FAIL: Pilgrim season check failed on 1 Dec')
  process.exit(1)
}

if (seasonOpen(diwaliDay, 'diwali') && !seasonOpen(diwaliDay, 'summer')) {
  console.log('✓ Diwali season open on 1 Nov')
} else {
  console.error('FAIL: Diwali season check failed on 1 Nov')
  process.exit(1)
}

if (!seasonOpen(augustDay, 'summer') && !seasonOpen(augustDay, 'pilgrim') && !seasonOpen(augustDay, 'diwali')) {
  console.log('✓ All seasons closed on 20 Aug')
} else {
  console.error('FAIL: Seasons should be closed on 20 Aug')
  process.exit(1)
}

// Check 2: Cannot save festival schedule without active seasonal permit
console.log('\n[Check 2] Gating festival schedule on seasonal permit...')
const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)
s.day = fromCivil(2025, 4, 1)
const testRouteId = 'blr-maa'
// Ensure annual permit is active
s.permits[testRouteId] = {
  routeId: testRouteId,
  status: 'active',
  appliedDay: s.day - 30,
  expiryDay: s.day + 335,
}

// Try creating festival schedule without seasonal permit
const resFail = createSchedule(s, {
  routeId: testRouteId,
  depHour: 21,
  baseFare: 100_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  outboundDuty: 'festival',
  returnDuty: 'festival',
})

if ('error' in resFail && resFail.error.includes('seasonal permit')) {
  console.log('✓ createSchedule correctly rejected festival duty without seasonal permit:', resFail.error)
} else {
  console.error('FAIL: createSchedule should reject festival duty without seasonal permit, got:', resFail)
  process.exit(1)
}

// Check 3: Apply for seasonal permit & permitPass processing
console.log('\n[Check 3] Applying seasonal permit & approval in permitPass...')
const applyErr = applySeasonalPermit(s, testRouteId, 'summer')
if (!applyErr && s.permits[testRouteId].seasonal?.status === 'applied') {
  console.log(`✓ Seasonal permit applied (spent ${BAL.seasonalPermitFee / 100} Rs), status is 'applied'`)
} else {
  console.error('FAIL: Failed to apply seasonal permit:', applyErr)
  process.exit(1)
}

// Advance days to trigger permitPass approval
s.day += 30 // exceed max lead days (28)
// Make sure reject chance doesn't reject in test: temporarily give doc manager
s.staff['doc1'] = {
  id: 'doc1',
  name: 'Doc Mgr',
  role: 'manager',
  desk: 'docs',
  skill: 10,
  salary: 2000000,
  morale: 90,
  loyalty: 90,
  experienceYears: 10,
  hiredDay: 1,
  fatigue: 0,
  consecutiveDutyDays: 0,
  drivingStyle: 'cautious',
  licenceClass: 'HMV_PSV',
  safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
  cmvrHoursToday: 0,
  tripsDriven: 0,
}
s.company.docsManagerId = 'doc1'

// Keep running permitPass until granted
let granted = false
for (let d = 0; d < 30; d++) {
  s.day++
  permitPass(s)
  if (s.permits[testRouteId]?.seasonal?.status === 'active') {
    granted = true
    break
  }
  if (!s.permits[testRouteId]?.seasonal) {
    // If rejected by RNG, re-apply
    applySeasonalPermit(s, testRouteId, 'summer')
  }
}

if (granted && s.permits[testRouteId].seasonal?.status === 'active') {
  const expiry = s.permits[testRouteId].seasonal!.expiryDay
  console.log(`✓ Seasonal permit granted! Expiry day is ${expiry}`)
} else {
  console.error('FAIL: Seasonal permit was not granted')
  process.exit(1)
}

// Check 4: Return-only festival is rejected
console.log('\n[Check 4] Return-only festival combination rejected...')
const resReturnOnly = createSchedule(s, {
  routeId: testRouteId,
  depHour: 21,
  baseFare: 100_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: true,
  returnDepHour: 14,
  outboundDuty: 'daily',
  returnDuty: 'festival',
})

if ('error' in resReturnOnly && resReturnOnly.error.includes('Return-only festival is not permitted')) {
  console.log('✓ Return-only festival combination correctly rejected')
} else {
  console.error('FAIL: Expected return-only festival rejection, got:', resReturnOnly)
  process.exit(1)
}

// Check 5: Mixed festival outbound + daily return schedule
console.log('\n[Check 5] Mixed schedule (outbound festival + daily return)...')
const resMixed = createSchedule(s, {
  routeId: testRouteId,
  depHour: 21,
  baseFare: 100_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: true,
  returnDepHour: 14,
  outboundDuty: 'festival',
  returnDuty: 'daily',
})

if (!('id' in resMixed)) {
  console.error('FAIL: Could not create mixed schedule:', resMixed)
  process.exit(1)
}
const mixedSchId = resMixed.id
const mixedSch = s.schedules[mixedSchId]!
if (mixedSch.outboundDuty === 'festival' && mixedSch.returnDuty === 'daily' && !mixedSch.festivalOnly) {
  console.log('✓ Mixed schedule created with outboundDuty=festival and returnDuty=daily')
} else {
  console.error('FAIL: Mixed schedule duty flags incorrect:', mixedSch)
  process.exit(1)
}

// Check 6: Bus assignment rules
console.log('\n[Check 6] Bus assignment rules for mixed vs both-festival...')
const bus1 = createTestBus('b1', s.day)
const bus2 = createTestBus('b2', s.day)
s.buses['b1'] = bus1
s.buses['b2'] = bus2

// Assigning 1 bus to mixed schedule should SUCCEED (needed for daily return leg)
const assign1Err = assignBus(s, mixedSchId, 'b1')
if (!assign1Err && mixedSch.busIds.includes('b1')) {
  console.log('✓ Hand-assigning 1 bus to mixed schedule for daily return leg SUCCEEDED')
} else {
  console.error('FAIL: Should allow assigning 1 bus to mixed schedule, got error:', assign1Err)
  process.exit(1)
}

// Assigning 2nd bus to mixed schedule should SUCCEED (allows up & down at the same time)
const assign2Err = assignBus(s, mixedSchId, 'b2')
if (!assign2Err && mixedSch.busIds.includes('b2')) {
  console.log('✓ Assigning 2nd bus to mixed schedule SUCCEEDED')
  // Verify 3rd bus is blocked
  const bus3 = createTestBus('b3', s.day)
  s.buses['b3'] = bus3
  const assign3Err = assignBus(s, mixedSchId, 'b3')
  if (assign3Err && assign3Err.includes('at most 2 buses')) {
    console.log('✓ Assigning 3rd bus to schedule correctly blocked')
  }
  // Unassign b2 for 1-bus test in Check 7
  mixedSch.busIds = ['b1']
  s.buses['b2'].scheduleId = undefined
} else {
  console.error('FAIL: Should allow 2nd bus on mixed schedule, got:', assign2Err)
  process.exit(1)
}

// Create both-festival schedule
const resBothFest = createSchedule(s, {
  routeId: testRouteId,
  depHour: 22,
  baseFare: 100_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: true,
  returnDepHour: 15,
  outboundDuty: 'festival',
  returnDuty: 'festival',
})
if (!('id' in resBothFest)) {
  console.error('FAIL: Could not create both-festival schedule:', resBothFest)
  process.exit(1)
}
const bothFestSchId = resBothFest.id

// Hand-assigning bus to both-festival schedule should be BLOCKED
const assignBothFestErr = assignBus(s, bothFestSchId, 'b2')
if (assignBothFestErr && assignBothFestErr.includes('auto-assign idle buses')) {
  console.log('✓ Hand-assigning bus to both-festival schedule correctly blocked:', assignBothFestErr)
} else {
  console.error('FAIL: Expected hand-assign to be blocked on both-festival, got:', assignBothFestErr)
  process.exit(1)
}

// Check 7: Trip generation on festival day vs non-festival day
console.log('\n[Check 7] Trip generation on festival day vs non-festival day in Summer...')
// Ugadi is 9 April (in summer, isFestivalDay is true)
// Let's test on 9 April 2025:
const ugadiDay = fromCivil(2025, 4, 9)
s.day = ugadiDay
s.trips = {}
s.openTripIds = []

// Reset booking state & generate trips for today
generateTrips(s)

const allTrips = Object.values(s.trips).filter((t) => t.scheduleId === mixedSchId)
console.log('Generated mixed trips:', allTrips.map((t) => `${t.direction} day=${t.day} dep=${t.depHour}:${t.depMin}`).join(', '))

const ugadiOut = allTrips.find((t) => t.direction === 'AB' && t.day === ugadiDay)
// On paired service with next-day return, the return leg is at ugadiDay + dayOffset
const ugadiRet = allTrips.find((t) => t.direction === 'BA')

if (ugadiOut && ugadiRet) {
  console.log(`✓ On Ugadi festival day (${ugadiDay}), festival outbound was GENERATED (day ${ugadiOut.day}) and daily return was GENERATED (day ${ugadiRet.day})!`)
} else {
  console.error('FAIL: Expected both outbound and return trips on Ugadi, found:', { outbound: !!ugadiOut, return: !!ugadiRet })
  process.exit(1)
}

// Now test on a NON-festival day in summer (e.g. 15 April 2025)
const nonFestSummerDay = fromCivil(2025, 4, 15)
s.day = nonFestSummerDay
s.trips = {}
s.openTripIds = []

generateTrips(s)
const nonFestTrips = Object.values(s.trips).filter((t) => t.scheduleId === mixedSchId)
const nonFestOut = nonFestTrips.find((t) => t.direction === 'AB')
const nonFestRet = nonFestTrips.find((t) => t.direction === 'BA')

if (!nonFestOut && nonFestRet) {
  console.log(`✓ On non-festival day (${nonFestSummerDay}), festival outbound was SKIPPED (0 AB trips) and return daily was GENERATED (${nonFestRet.day})!`)
} else {
  console.error('FAIL: Expected 0 festival outbound trips and >0 return trips on non-festival day, found:', { outbound: !!nonFestOut, return: !!nonFestRet })
  process.exit(1)
}

// Check 8: Schedule manager festival fleet auto-park and teardown
console.log('\n[Check 8] Schedule manager auto-park & teardown on festival schedules...')
// Set an idle bus
const bus3 = createTestBus('b3', s.day)
s.buses['b3'] = bus3
s.staff['schMgr'] = {
  id: 'schMgr',
  name: 'Schedule Mgr',
  role: 'manager',
  desk: 'schedule',
  skill: 8,
  salary: 2000000,
  morale: 80,
  loyalty: 80,
  experienceYears: 5,
  hiredDay: 1,
  fatigue: 0,
  consecutiveDutyDays: 0,
  drivingStyle: 'cautious',
  licenceClass: 'HMV_PSV',
  safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
  cmvrHoursToday: 0,
  tripsDriven: 0,
}
s.company.scheduleManagerId = 'schMgr'

// Move to festival day (Ugadi)
s.day = ugadiDay
const bothFestSch = s.schedules[bothFestSchId]!
bothFestSch.busIds = [] // starts empty

// A long one-way festival run (no 2nd-trip pairing) still needs a coach at each end.
const resOneWayFest = createSchedule(s, {
  routeId: testRouteId,
  depHour: 21,
  baseFare: 100_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: false,
  outboundDuty: 'festival',
})
if (!('id' in resOneWayFest)) {
  console.error('FAIL: Could not create unpaired festival schedule:', resOneWayFest)
  process.exit(1)
}
const oneWayFest = s.schedules[resOneWayFest.id]!
s.buses['b4'] = createTestBus('b4', s.day)
s.buses['b5'] = createTestBus('b5', s.day)

festivalAssignPass(s)
const parkedBusId = bothFestSch.busIds[0]
if (parkedBusId && s.buses[parkedBusId]?.scheduleId === bothFestSchId) {
  console.log(`✓ Schedule manager auto-parked idle coach ${parkedBusId} onto both-festival schedule`)
} else {
  console.error('FAIL: Expected Schedule manager to auto-park an idle bus, found busIds:', bothFestSch.busIds)
  process.exit(1)
}
if (bothFestSch.busIds.length === 2 && new Set(bothFestSch.busIds).size === 2) {
  console.log(`✓ Paired festival run got two different coaches: ${bothFestSch.busIds.join(', ')}`)
} else {
  console.error('FAIL: Paired festival run should have two different coaches, found:', bothFestSch.busIds)
  process.exit(1)
}
if (oneWayFest.busIds.length === 2 && new Set(oneWayFest.busIds).size === 2) {
  const second = s.buses[oneWayFest.busIds[1]!]
  const farEnd = second?.parkedCityId === ROUTES[testRouteId]!.to
  if (!farEnd) {
    console.error('FAIL: Second festival coach should stand at the far city, found:', second?.parkedCityId)
    process.exit(1)
  }
  console.log(`✓ Long festival run got two different coaches (${oneWayFest.busIds.join(', ')}), second parked at ${second?.parkedCityId}`)
} else {
  console.error('FAIL: Long festival run should have two different coaches, found:', oneWayFest.busIds)
  process.exit(1)
}

// Move to non-festival day
s.day = nonFestSummerDay
festivalTeardownPass(s)
if (bothFestSch.busIds.length === 0 && !s.buses[parkedBusId]?.scheduleId) {
  console.log(`✓ Festival teardown released temporary bus ${parkedBusId} when festival ended`)
} else {
  console.error(`FAIL: Expected bus ${parkedBusId} to be released on teardown, found busIds:`, bothFestSch.busIds, 'bus.scheduleId:', s.buses[parkedBusId]?.scheduleId)
  process.exit(1)
}

// Check 9: Document manager auto-renewal of seasonal permit inside 7 days of expiry
console.log('\n[Check 9] Document manager auto-renewal of seasonal permit...')
const seasonalPermit = s.permits[testRouteId].seasonal!
seasonalPermit.expiryDay = s.day + 5 // 5 days left (< 7 days)
const expiryBefore = seasonalPermit.expiryDay

permitPass(s)
if (seasonalPermit.expiryDay > expiryBefore) {
  console.log(`✓ Document manager renewed seasonal permit from day ${expiryBefore} to ${seasonalPermit.expiryDay}`)
} else {
  console.error('FAIL: Document manager did not auto-renew seasonal permit')
  process.exit(1)
}

console.log('\n--- ALL 9 SPRINT 6 CHECKS PASSED! ---')
