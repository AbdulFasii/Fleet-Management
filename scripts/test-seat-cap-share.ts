import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { calculateRoutePlayerShare, syncRouteShare } from '../src/engine/sim/rivals'
import { assignBus, unassignBus, createSchedule } from '../src/engine/sim/schedules'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { rs } from '../src/engine/core/money'
import type { Bus } from '../src/engine/types'

console.log('--- Testing Market Share: 0% Without Permit/Schedule, Capacity-Based With Buses ---')

const s = newGame('Test Co', 'seth', 'blr-maa', 9999)

// 1. Unpermitted route has 0% share
console.log('\n[Check 1] Unpermitted routes must have 0% player share...')
const unpermittedRoute = 'maa-pdy'
assert.equal(s.permits[unpermittedRoute], undefined, 'Route should not have permit initially')
const unpermittedCap = calculateRoutePlayerShare(s, unpermittedRoute)
assert.equal(unpermittedCap.playerShare, 0, 'Unpermitted route must have 0% player share')
assert.equal(unpermittedCap.dailySeats, 0, 'Unpermitted route must have 0 daily seats')
console.log('✓ Unpermitted route correctly reports 0% market share and 0 seats')

// 2. Permitted route with no active schedule or buses has 0% share
console.log('\n[Check 2] Permitted route without assigned buses has 0% player share...')
// blr-maa is permitted by newGame
assert(s.permits['blr-maa']?.status === 'active', 'blr-maa must be active permit')
const noBusesCap = calculateRoutePlayerShare(s, 'blr-maa')
assert.equal(noBusesCap.playerShare, 0, 'Permitted route with 0 buses assigned must have 0% share')
assert.equal(noBusesCap.dailySeats, 0, 'Daily seats must be 0')
console.log('✓ Permitted route with 0 buses assigned correctly reports 0% market share')

// 3. Assign 1 Cheetah bus to schedule on blr-maa
console.log('\n[Check 3] Market share calculated from assigned bus seat capacity...')
const cheetahModel = BUS_MODELS['cheetah']
const testBus1: Bus = {
  id: 'b1',
  reg: 'KA-01-EQ-1111',
  nickname: 'Cheetah 1',
  modelId: 'cheetah', // 36 seats
  ownership: 'owned',
  mfgYear: 2022,
  acquiredDay: s.day,
  acquiredPrice: rs(3_000_000),
  bookValue: rs(3_000_000),
  odometer: 10_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
  tyreKm: 5_000,
  frontTyreKm: 5_000,
  rearTyreKm: 5_000,
  tyresRetreaded: false,
  tyreCount: 6,
  status: 'active',
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  lastServiceKm: 5_000,
  cleanliness: 90,
  busCleanliness: 90,
  lifeKm: 10_000,
  lifeTrips: 20,
  lifeRevenue: rs(200_000),
  lifeCost: rs(100_000),
}
s.buses[testBus1.id] = testBus1

// Create paired schedule on blr-maa
const schRes = createSchedule(s, {
  routeId: 'blr-maa',
  busIds: [],
  depHour: 6,
  depMin: 0,
  paired: true,
})
assert(schRes.id, 'Schedule must be created')
const schId = schRes.id

// Assign bus 1 to schedule
assignBus(s, schId, testBus1.id)
const capWith1Bus = calculateRoutePlayerShare(s, 'blr-maa')
assert.equal(capWith1Bus.dailySeats, 44 * 2, '1 Cheetah bus (44 seats) on paired schedule provides 88 seats/day')
assert(capWith1Bus.playerShare > 0, `Player share with 1 bus must be > 0 (got ${capWith1Bus.playerShare}%)`)
console.log(`✓ With 1 bus (88 seats/day), player market share is: ${capWith1Bus.playerShare}%`)

// 4. Assign 2nd bus to increase capacity and share
console.log('\n[Check 4] Adding second bus increases daily seats and market share...')
const testBus2: Bus = {
  ...testBus1,
  id: 'b2',
  reg: 'KA-01-EQ-2222',
  nickname: 'Cheetah 2',
}
s.buses[testBus2.id] = testBus2
assignBus(s, schId, testBus2.id)

const capWith2Buses = calculateRoutePlayerShare(s, 'blr-maa')
assert.equal(capWith2Buses.dailySeats, 44 * 2 * 2, '2 Cheetah buses on paired schedule provide 176 seats/day')
assert(capWith2Buses.playerShare > capWith1Bus.playerShare, `Player share with 2 buses (${capWith2Buses.playerShare}%) must be higher than 1 bus (${capWith1Bus.playerShare}%)`)
console.log(`✓ With 2 buses (176 seats/day), player market share increased to: ${capWith2Buses.playerShare}%`)

// 5. Unassigning buses drops share back to 0
console.log('\n[Check 5] Unassigning buses drops market share back to 0%...')
unassignBus(s, schId, testBus1.id)
unassignBus(s, schId, testBus2.id)

const capAfterUnassign = calculateRoutePlayerShare(s, 'blr-maa')
assert.equal(capAfterUnassign.playerShare, 0, 'Player share must be 0% after unassigning all buses')
assert.equal(capAfterUnassign.dailySeats, 0, 'Daily seats must be 0')
console.log('✓ Unassigning buses returns player market share to 0%')

console.log('\n======================================================')
console.log('🎉 ALL SEAT CAPACITY MARKET SHARE CHECKS PASSED!')
console.log('======================================================')
