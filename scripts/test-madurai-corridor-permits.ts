import { newGame } from '../src/engine/newGame'
import { calculateRoutePlayerShare, dailyRivalPass } from '../src/engine/sim/rivals'
import { canonicalRouteId } from '../src/engine/data/routes'
import { rngFor } from '../src/engine/core/rng'
import assert from 'node:assert'

console.log('--- Testing Madurai Corridor Route Permits & Schedules ---')

// 1. Test canonical mapping
assert.strictEqual(canonicalRouteId('mdu-maa'), 'maa-mdu')
assert.strictEqual(canonicalRouteId('maa-mdu'), 'maa-mdu')
assert.strictEqual(canonicalRouteId('mdu-blr'), 'blr-mdu')
assert.strictEqual(canonicalRouteId('blr-mdu'), 'blr-mdu')
console.log('✓ canonicalRouteId mappings verified')

// 2. Setup game state with permits and schedules on mdu-maa and mdu-blr
const s = newGame('Test Operators', 'malik', 'maa-blr', 12345)

// Add permits on reverse/legacy keys
s.permits['mdu-maa'] = {
  routeId: 'mdu-maa',
  status: 'active',
  appliedDay: 1,
  activeFromDay: 10,
  expiryDay: 375,
}

s.permits['mdu-blr'] = {
  routeId: 'mdu-blr',
  status: 'active',
  appliedDay: 1,
  activeFromDay: 10,
  expiryDay: 375,
}

// Add a bus and schedule on mdu-maa
s.buses['bus_1'] = {
  id: 'bus_1',
  modelId: 'eicher_10_75',
  registration: 'TN59 AB 1234',
  purchaseDay: 1,
  purchasePrice: 200000000,
  condition: 1,
  status: 'active',
  depotCityId: 'mdu',
  odoKm: 1000,
  duty: 'line',
  scheduleId: 'sch_1',
}

s.schedules['sch_1'] = {
  id: 'sch_1',
  routeId: 'mdu-maa',
  depHour: 21,
  depMin: 0,
  busIds: ['bus_1'],
  active: true,
  paired: true,
  baseFare: 65000,
  autoPrice: false,
}

// Add bus and schedule on mdu-blr
s.buses['bus_2'] = {
  id: 'bus_2',
  modelId: 'eicher_10_75',
  registration: 'TN59 AB 5678',
  purchaseDay: 1,
  purchasePrice: 200000000,
  condition: 1,
  status: 'active',
  depotCityId: 'mdu',
  odoKm: 1000,
  duty: 'line',
  scheduleId: 'sch_2',
}

s.schedules['sch_2'] = {
  id: 'sch_2',
  routeId: 'mdu-blr',
  depHour: 22,
  depMin: 0,
  busIds: ['bus_2'],
  active: true,
  paired: true,
  baseFare: 75000,
  autoPrice: false,
}

// Test calculateRoutePlayerShare for maa-mdu (should find permit on mdu-maa and schedule on mdu-maa)
const shareMaaMdu = calculateRoutePlayerShare(s, 'maa-mdu')
console.log('maa-mdu share:', shareMaaMdu)
assert(shareMaaMdu.dailySeats > 0, 'maa-mdu should have dailySeats > 0')
assert(shareMaaMdu.playerShare > 0, 'maa-mdu should have playerShare > 0')

// Test calculateRoutePlayerShare for blr-mdu (should find permit on mdu-blr and schedule on mdu-blr)
const shareBlrMdu = calculateRoutePlayerShare(s, 'blr-mdu')
console.log('blr-mdu share:', shareBlrMdu)
assert(shareBlrMdu.dailySeats > 0, 'blr-mdu should have dailySeats > 0')
assert(shareBlrMdu.playerShare > 0, 'blr-mdu should have playerShare > 0')

// Test dailyRivalPass (advancing day)
const rng = rngFor(s.seed, 'test', 1)
dailyRivalPass(s, rng)
console.log('world share maa-mdu after pass:', s.world.share['maa-mdu']?.player)
console.log('world share blr-mdu after pass:', s.world.share['blr-mdu']?.player)
assert((s.world.share['maa-mdu']?.player ?? 0) > 0, 'maa-mdu player share in world.share should be > 0')
assert((s.world.share['blr-mdu']?.player ?? 0) > 0, 'blr-mdu player share in world.share should be > 0')

console.log('✓ All checks passed successfully!')
