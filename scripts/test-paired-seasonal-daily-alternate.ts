import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { generateTrips, tripKey } from '../src/engine/sim/booking'
import { isFestivalDay } from '../src/engine/core/calendar'
import type { Schedule, Trip } from '../src/engine/types'

console.log('--- Testing Paired 2-Bus Seasonal + Daily Alternate Days ---')

const s = newGame('Paired Alternate Test', 'seth', 'maa-mdu', 3001)

// Add 2 buses
s.buses['b1'] = {
  id: 'b1',
  reg: 'TN 01 AB 1001',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 10000,
  assignedScheduleId: 'sch_paired',
  wear: { body: 95, ac: 95, electrical: 95, chassis: 95 },
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  comfortScore: 80,
  cleanliness: 90,
  breakdownHistory: [],
  chassisKm: 10000,
  rebodyCount: 0,
  seatRefurbCount: 0,
}

s.buses['b2'] = {
  id: 'b2',
  reg: 'TN 01 CD 2002',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 15000,
  assignedScheduleId: 'sch_paired',
  wear: { body: 95, ac: 95, electrical: 95, chassis: 95 },
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  comfortScore: 80,
  cleanliness: 90,
  breakdownHistory: [],
  chassisKm: 15000,
  rebodyCount: 0,
  seatRefurbCount: 0,
}

// Create paired schedule as in user's image:
// 1st trip: 09:00 Seasonal (festivals)
// 2nd trip: 21:00 Daily
const sch: Schedule = {
  id: 'sch_paired',
  name: 'Chennai-Madurai Paired',
  routeId: 'maa-mdu',
  busIds: ['b1', 'b2'],
  depHour: 9,
  depMin: 0,
  returnDepHour: 21,
  // 21:00, not 21:30: an 8h run back at 21:30 lands 05:30 and the coach is only
  // ready at 09:30 after turnaround, too late for the next 09:00 festival leg.
  returnDepMin: 0,
  farePaise: 80000,
  active: true,
  paired: true,
  outboundDuty: 'festival',
  returnDuty: 'daily',
}
s.schedules['sch_paired'] = sch

// Ensure route permit and seasonal permit are active
s.permits['maa-mdu'] = {
  id: 'pm-mdu',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  seasonal: {
    status: 'active',
    appliedDay: 1,
    approvedDay: 1,
    expiryDay: s.day + 365,
  },
}

// Generate trips
generateTrips(s)

for (let d = s.day; d <= s.day + 15; d++) {
  const trs = Object.values(s.trips).filter((t) => t.scheduleId === 'sch_paired' && t.day === d)
  if (trs.length > 0) {
    console.log(`Day ${d} (isFest=${isFestivalDay(d)}): ${trs.length} trips -> ${trs.map((t) => `${t.busId} ${t.depHour}:${t.depMin || 0} ${t.direction}`).join(' | ')}`)
  }
}

// Find a festival day and a non-festival day in the window
let festivalDay = -1
let nonFestDay1 = -1
let nonFestDay2 = -1

for (let d = s.day + 1; d <= s.day + 30; d++) {
  if (isFestivalDay(d) && festivalDay === -1) {
    festivalDay = d
  } else if (!isFestivalDay(d)) {
    if (nonFestDay1 === -1) nonFestDay1 = d
    else if (nonFestDay2 === -1 && d === nonFestDay1 + 1) nonFestDay2 = d
  }
}

console.log(`Testing with Festival Day: ${festivalDay}, Non-Festival Days: ${nonFestDay1}, ${nonFestDay2}`)

// [Check 1] On Festival Day: 2 trips on both ways (09:00 both ways, 21:30 both ways)
console.log('\n[Check 1] Verifying festival day runs 2 trips on both ways...')
const midFestDay = festivalDay + 1
s.day = midFestDay - 1 // within 3-day booking window for festival
generateTrips(s)
const festTrips = Object.values(s.trips).filter((t) => t.scheduleId === 'sch_paired' && t.day === midFestDay)
assert.equal(festTrips.length, 4, `Festival day should have exactly 4 departures (2 slots x 2 directions), got ${festTrips.length}`)

const festMornUp = festTrips.find((t) => t.depHour === 9 && t.direction === 'AB')
const festMornDown = festTrips.find((t) => t.depHour === 9 && t.direction === 'BA')
const festNightUp = festTrips.find((t) => t.depHour === 21 && t.direction === 'AB')
const festNightDown = festTrips.find((t) => t.depHour === 21 && t.direction === 'BA')

assert(festMornUp, 'Festival morning Up (AB) trip must exist')
assert(festMornDown, 'Festival morning Down (BA) trip must exist')
assert(festNightUp, 'Festival night Up (AB) trip must exist')
assert(festNightDown, 'Festival night Down (BA) trip must exist')
assert.equal(festMornUp.isSeasonal, true, 'Morning leg is seasonal festival run')
assert.equal(festMornDown.isSeasonal, true, 'Morning leg is seasonal festival run')
console.log('✓ Festival day runs both ways at 09:00 AND both ways at 21:30!')

// [Check 2] On Non-Festival Days: ONLY 2nd trip (21:30) runs on both ways, 09:00 does NOT run!
console.log('\n[Check 2] Verifying non-season day runs ONLY 2nd trip (21:30) on both ways...')
const nonFestTrips1 = Object.values(s.trips).filter((t) => t.scheduleId === 'sch_paired' && t.day === nonFestDay1)

// 09:00 trips must NOT exist!
const morningTrips = nonFestTrips1.filter((t) => t.depHour === 9)
assert.equal(morningTrips.length, 0, `09:00 (seasonal) must NOT run on non-festival days! Found ${morningTrips.length}`)
console.log('✓ 09:00 trip is strictly absent on non-season days')

// 21:30 trips must exist in BOTH directions
assert.equal(nonFestTrips1.length, 2, `Non-season day must have exactly 2 departures (Up and Down at 21:30), got ${nonFestTrips1.length}`)
const nightUp1 = nonFestTrips1.find((t) => t.depHour === 21 && t.direction === 'AB')
const nightDown1 = nonFestTrips1.find((t) => t.depHour === 21 && t.direction === 'BA')
assert(nightUp1, 'Non-season day must have Up (AB) at 21:30')
assert(nightDown1, 'Non-season day must have Down (BA) at 21:30')
console.log(`✓ Non-season Day ${nonFestDay1} has both Up (bus ${nightUp1.busId}) and Down (bus ${nightDown1.busId}) at 21:30`)

// [Check 3] Alternate day operation across 2 consecutive non-season days
console.log('\n[Check 3] Verifying 2 vehicles alternate directions on alternate days...')
const nonFestTrips2 = Object.values(s.trips).filter((t) => t.scheduleId === 'sch_paired' && t.day === nonFestDay2)
const nightUp2 = nonFestTrips2.find((t) => t.depHour === 21 && t.direction === 'AB')
const nightDown2 = nonFestTrips2.find((t) => t.depHour === 21 && t.direction === 'BA')
assert(nightUp2 && nightDown2, 'Day 2 must also have both Up and Down at 21:30')

// Verify alternate buses
assert.notEqual(nightUp1.busId, nightUp2.busId, 'Up direction must be run by alternate buses on consecutive days')
assert.notEqual(nightDown1.busId, nightDown2.busId, 'Down direction must be run by alternate buses on consecutive days')
assert.equal(nightUp1.busId, nightDown2.busId, 'Bus running Up on Day 1 runs Down on Day 2')
assert.equal(nightDown1.busId, nightUp2.busId, 'Bus running Down on Day 1 runs Up on Day 2')
console.log(`✓ Alternate days verified: Day ${nonFestDay1} Up:${nightUp1.busId} Down:${nightDown1.busId} -> Day ${nonFestDay2} Up:${nightUp2.busId} Down:${nightDown2.busId}`)

// [Check 4] Test pruning of invalid old 09:00 trips on non-festival days
console.log('\n[Check 4] Verifying pruning of stale invalid 09:00 trips on non-festival days...')
s.day = nonFestDay1
// Inject fake invalid 09:00 trips on nonFestDay1
const fakeKey = tripKey(sch.id, 'b1', nonFestDay1, 'AB')
const fakeTrip: Trip = {
  id: fakeKey,
  scheduleId: sch.id,
  routeId: sch.routeId,
  direction: 'AB',
  busId: 'b1',
  day: nonFestDay1,
  depHour: 9,
  depMin: 0,
  fare: 80000,
  seats: [],
  seatCount: 45,
  sold: 0,
  revenue: 0,
  cancelledRevenue: 0,
  channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
  status: 'open',
}
s.trips[fakeKey] = fakeTrip
s.openTripIds.push(fakeKey)

// Run generateTrips (which triggers pruneInvalidSeasonalTrips and regenerates legitimate trips)
generateTrips(s)

// The stale 09:00 leg is gone (b1 may run the other direction that day, so its
// replacement need not reuse the same trip id), and b1's departure that day is
// the daily 21:00 return clock.
const stale = s.trips[fakeKey]
assert(!stale || stale.status !== 'open' || stale.depHour === 21, 'Stale 09:00 trip was pruned')
const b1That = Object.values(s.trips).filter((x) => x.busId === 'b1' && x.day === nonFestDay1 && x.status === 'open')
assert(b1That.length === 1 && b1That[0]!.depHour === 21 && (b1That[0]!.depMin ?? 0) === 0, 'b1 runs its one daily 21:00 leg that day')
console.log('✓ Stale invalid seasonal 09:00 trip was pruned; the coach runs its daily 21:00 leg')

console.log('\n======================================================================')
console.log('🎉 ALL PAIRED SEASONAL + DAILY ALTERNATE DAY TESTS PASSED PERFECTLY!')
console.log('======================================================================')
