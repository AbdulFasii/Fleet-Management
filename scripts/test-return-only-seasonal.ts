import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { createSchedule, updateSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { isFestivalDay, fromCivil } from '../src/engine/core/calendar'
import type { Bus } from '../src/engine/types'

console.log('--- Testing Return-Only Seasonal Schedules (Daily 1st + Seasonal 2nd) ---')

const s = newGame('Return Seasonal Test', 'seth', 'maa-mdu', 4001)

// Activate seasonal permit on maa-mdu
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
  reg: 'TN 01 AB 1001',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 10000,
  fitnessExpiryDay: 30000,
  insuranceExpiryDay: 30000,
  pucExpiryDay: 30000,
  taxExpiryDay: 30000,
  parkedCityId: 'maa',
} as Bus

s.buses['b2'] = {
  id: 'b2',
  reg: 'TN 01 CD 2002',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 15000,
  fitnessExpiryDay: 30000,
  insuranceExpiryDay: 30000,
  pucExpiryDay: 30000,
  taxExpiryDay: 30000,
  parkedCityId: 'mdu',
} as Bus

// 1. Create schedule with Daily 1st (09:00) + Seasonal 2nd (21:00)
console.log('\n[Check 1] Creating schedule with Daily 1st (09:00) + Seasonal 2nd (21:00)...')
const res = createSchedule(s, {
  routeId: 'maa-mdu',
  depHour: 9,
  depMin: 0,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  outboundDuty: 'daily',
  returnDuty: 'festival',
  cancellation: 'standard',
  autoPrice: true,
  redDeal: false,
})

if ('error' in res) {
  throw new Error(`Failed to create schedule: ${res.error}`)
}
const schId = res.id
console.log('✓ Successfully created schedule with Daily 1st + Seasonal 2nd! ID:', schId)

const sch = s.schedules[schId]!
assert.equal(sch.outboundDuty, 'daily')
assert.equal(sch.returnDuty, 'festival')
assert.equal(Boolean(sch.festivalOnly), false)

// 2. Assign buses
assignBus(s, schId, 'b1')
assignBus(s, schId, 'b2')
console.log('✓ Assigned 2 buses to schedule:', sch.busIds)

// 3. Test updateSchedule duty switching
console.log('\n[Check 2] Testing updateSchedule duty switching...')
const err1 = updateSchedule(s, schId, { outboundDuty: 'daily', returnDuty: 'daily' })
assert.equal(err1, null)
assert.equal(sch.outboundDuty, 'daily')
assert.equal(sch.returnDuty, 'daily')

const err2 = updateSchedule(s, schId, { outboundDuty: 'daily', returnDuty: 'festival' })
assert.equal(err2, null)
assert.equal(sch.outboundDuty, 'daily')
assert.equal(sch.returnDuty, 'festival')
console.log('✓ updateSchedule allows Daily 1st + Seasonal 2nd without error!')

// 4. Test Trip Generation on non-season days
console.log('\n[Check 3] Verifying trip generation on non-season days...')
generateTrips(s)

const nonFestTrips = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === s.day)
console.log(`Non-festival day ${s.day} trips count:`, nonFestTrips.length)
for (const t of nonFestTrips) {
  console.log(`  Trip: dep ${t.depHour}:${t.depMin ?? 0} | dir: ${t.direction} | bus: ${t.busId} | isSeasonal: ${t.isSeasonal}`)
}

assert.equal(nonFestTrips.length, 2, 'Expected exactly 2 trips on non-season day (both ways for 09:00 slot)')
assert.ok(nonFestTrips.every((t) => t.depHour === 9), 'All non-season trips must be at 09:00 (1st slot)')
assert.ok(nonFestTrips.some((t) => t.direction === 'AB'), 'Expected AB departure on non-season day')
assert.ok(nonFestTrips.some((t) => t.direction === 'BA'), 'Expected BA departure on non-season day')
assert.ok(nonFestTrips.every((t) => !t.isSeasonal), 'All daily trips must have isSeasonal: false')
console.log('✓ Non-season day runs ONLY 1st slot (09:00) on both ways!')

// 5. Check festival day trip generation
console.log('\n[Check 4] Verifying trip generation on festival days...')
const poojaDay = fromCivil(2025, 10, 15) // Pooja festival
assert.ok(isFestivalDay(poojaDay + 1), 'The fixture date must be a named festival day')
s.day = poojaDay
// Clear previous trips to test freshly generated trips
s.trips = {}
s.openTripIds = []
generateTrips(s)

// Verify trips on full festival day (poojaDay + 1)
const festTrips = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === poojaDay + 1)
console.log(`Festival day ${poojaDay + 1} trips count:`, festTrips.length)
for (const t of festTrips) {
  console.log(`  Trip: dep ${t.depHour}:${t.depMin ?? 0} | dir: ${t.direction} | bus: ${t.busId} | isSeasonal: ${t.isSeasonal}`)
}

assert.equal(festTrips.length, 4, 'Expected 4 trips on festival day (both ways for 09:00 AND both ways for 21:00)')
const festSlot1 = festTrips.filter((t) => t.depHour === 9)
const festSlot2 = festTrips.filter((t) => t.depHour === 21)
assert.equal(festSlot1.length, 2, 'Expected 2 trips at 09:00')
assert.equal(festSlot2.length, 2, 'Expected 2 trips at 21:00')
assert.ok(festSlot1.every((t) => !t.isSeasonal), '09:00 daily trips have isSeasonal: false')
assert.ok(festSlot2.every((t) => t.isSeasonal), '21:00 seasonal return trips have isSeasonal: true')
console.log('✓ Festival day runs BOTH slots on both ways, with 2nd slot flagged as seasonal!')

console.log('\n======================================================')
console.log('🎉 ALL RETURN-ONLY SEASONAL SCHEDULE TESTS PASSED!')
console.log('======================================================')
