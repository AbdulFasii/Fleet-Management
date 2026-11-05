import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { pairReturnClock, earliestReturn } from '../src/engine/sim/pairing'
import { FESTIVALS, fromCivil, isFestivalDay } from '../src/engine/core/calendar'
import type { Bus } from '../src/engine/types'

const s = newGame('Test', 'seth', 'maa-mdu', 42)
const route = ROUTES['maa-mdu']!

s.permits['maa-mdu'] = {
  id: 'pm-1',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: 30000,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
  seasonal: {
    appliedDay: 1,
    approvedDay: 1,
    expiresDay: 30000,
    status: 'active',
    dailyFee: 0,
    depositPaid: 0,
    tripsRun: 0,
  },
}

s.buses['b1'] = {
  id: 'b1',
  reg: 'TN 01 AB 1111',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 5000,
  fitnessExpiryDay: 30000,
  insuranceExpiryDay: 30000,
  permitExpiryDay: 30000,
  taxExpiryDay: 30000,
  pucExpiryDay: 30000,
  parkedCityId: 'maa',
} as Bus

s.buses['b2'] = {
  id: 'b2',
  reg: 'TN 01 CD 2222',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 6000,
  fitnessExpiryDay: 30000,
  insuranceExpiryDay: 30000,
  permitExpiryDay: 30000,
  taxExpiryDay: 30000,
  pucExpiryDay: 30000,
  parkedCityId: 'mdu',
} as Bus

const res = createSchedule(s, {
  routeId: 'maa-mdu',
  depHour: 9,
  depMin: 0,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  outboundDuty: 'festival',
  returnDuty: 'daily',
  cancellation: 'standard',
  autoPrice: true,
  redDeal: false,
})

const schId = (res as any).id
assignBus(s, schId, 'b1')
assignBus(s, schId, 'b2')

const sch = s.schedules[schId]!

const earliest = earliestReturn({ depHour: 9, depMin: 0 }, route, s)
const retClock = pairReturnClock(sch, route, s)

console.log('--- Checking earliestReturn and pairReturnClock ---')
console.log('earliestReturn:', earliest)
console.log('pairReturnClock:', retClock)

if (earliest.dayOffset !== 0) {
  throw new Error(`FAIL: Expected earliestReturn dayOffset to be 0 on maa-mdu 09:00, got ${earliest.dayOffset}`)
}
if (retClock.dayOffset !== 0) {
  throw new Error(`FAIL: Expected pairReturnClock dayOffset to be 0 on maa-mdu 09:00 -> 21:00, got ${retClock.dayOffset}`)
}
console.log('✓ Turnaround calculation correctly recognizes same-day return (dayOffset: 0)')

// Let's set game date to 11 Aug (3 days before festival on Aug 14) and run generateTrips
// Window dates come from the festival calendar (Independence Day: 3 days
// before to 2 after), not hard-coded: aug14Day is the window's first day.
const indep = FESTIVALS.find((f) => f.id === 'independence')!
const festDate = fromCivil(2026, indep.month, indep.day)
const aug14Day = festDate - indep.pre
const windowEnd = festDate + indep.post
s.day = aug14Day - 3
generateTrips(s)

console.log('\n--- Verifying trips across Festival Start Boundary (Aug 14 = Day', aug14Day, ') ---')
const tripsForDay = (day: number) =>
  Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === day)

// Aug 13 (day before the Independence Day window) is a padded festival run
// day: the festival 1st trip only runs in the homebound direction, and the
// daily 2nd trip (21:xx) still runs in both directions.
const aug13Trips = tripsForDay(aug14Day - 1)
console.log(`Aug 13 trips count: ${aug13Trips.length}`)
const aug13Daily = aug13Trips.filter((t) => t.depHour === 21)
const aug13Fest = aug13Trips.filter((t) => t.depHour === 9)
if (aug13Daily.length !== 2) {
  throw new Error(`FAIL: Expected 2 daily 2nd trips on Aug 13, got ${aug13Daily.length}`)
}
if (aug13Fest.length !== 1 || aug13Fest[0]!.direction !== 'AB') {
  throw new Error(`FAIL: Expected 1 homebound (AB) festival run on Aug 13, got ${JSON.stringify(aug13Fest.map((t) => t.direction))}`)
}
if (aug13Trips.length !== 3) {
  throw new Error(`FAIL: Expected 3 trips on Aug 13 (2 daily + 1 festival pad), got ${aug13Trips.length}`)
}
console.log('✓ Aug 13 (pre-festival pad) runs the daily 2nd trip both ways + one homebound festival run')

// Aug 14 (FIRST FESTIVAL DAY)
const aug14Trips = tripsForDay(aug14Day)
console.log(`Aug 14 trips count: ${aug14Trips.length}`)
const aug14Morning = aug14Trips.filter((t) => t.depHour === 9)
const aug14Evening = aug14Trips.filter((t) => t.depHour === 21)
if (aug14Morning.length !== 2) {
  throw new Error(`FAIL: Expected 2 morning trips (09:00) on Aug 14, got ${aug14Morning.length}`)
}
if (aug14Evening.length !== 2) {
  throw new Error(`FAIL: Expected 2 evening 2nd trips (21:xx) on Aug 14, got ${aug14Evening.length}`)
}
console.log('✓ Aug 14 (Festival Day 1) has BOTH 09:00 trips AND 21:xx 2nd trips (no missing 2nd trip!)')

// Check end of festival transition (Aug 16 = last festival day, Aug 17 = first normal day)
// Festival legs open 3 days before departure, so look from 2 days before the window ends.
s.day = windowEnd - 2
generateTrips(s)
const aug16Trips = tripsForDay(windowEnd)
const aug17Trips = tripsForDay(windowEnd + 2) // after the one-day post pad
if (aug16Trips.length !== 4) {
  throw new Error(`FAIL: Expected 4 trips on Aug 16 (last festival day), got ${aug16Trips.length}`)
}
if (aug17Trips.length !== 2) {
  throw new Error(`FAIL: Expected exactly 2 trips on Aug 17 (first normal day), got ${aug17Trips.length}`)
}
console.log('✓ Aug 17 (post-festival) cleanly resumes 2 trips without duplicates')

console.log('\n======================================================')
console.log('🎉 ALL FESTIVAL START 2ND TRIP TESTS PASSED!')
console.log('======================================================')


