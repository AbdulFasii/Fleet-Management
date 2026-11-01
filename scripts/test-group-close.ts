import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  createGroup,
  retireGroup,
  restoreGroup,
  deleteGroup,
  assignBusToGroup,
  assignScheduleToGroup,
  activeGroups,
} from '../src/engine/sim/groups'

console.log('=== TEST: Brand closing lifecycle (retire, restore, delete) ===')

const s = newGame('Karnataka Express Lines', 'malik', 'blr-maa')
const initialGroup = Object.values(s.groups)[0]

// Create two brands: A (MAR) and B (MYS)
const resA = createGroup(s, { name: 'Maruti Line', code: 'MAR' })
const resB = createGroup(s, { name: 'Mysore Roadways', code: 'MYS' })
assert.ok('id' in resA && 'id' in resB)
const idA = (resA as { id: string }).id
const idB = (resB as { id: string }).id

// Add bus and schedule to Brand A
const busId = 'bus-test-1'
s.buses[busId] = {
  id: busId,
  modelId: 'ashok_12m',
  reg: 'KA-01-AB-9999',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: s.day,
  odometer: 1000,
  condition: 90,
  breakdownRisk: 0.05,
  busCleanliness: 85,
  groupId: idA,
  groupHistory: [{ day: s.day, groupId: idA }],
  maintenanceHistory: [],
} as any

const schId = 'sch-test-1'
s.schedules[schId] = {
  id: schId,
  routeId: 'blr-maa',
  groupId: idA,
  busIds: [busId],
  active: true,
  duty: 'daily',
  depHour: 6,
  ticketPrice: 50000 as any,
  serviceTier: 'standard',
  autoPrice: false,
} as any

// 1. Rejects invalid destination
const errInvalidDest = retireGroup(s, idA, 'non-existent-brand')
assert.ok(errInvalidDest, 'Retiring to missing brand must fail')

const errSelfDest = retireGroup(s, idA, idA)
assert.ok(errSelfDest, 'Retiring to self must fail')

// 2. Successful retire: moves coaches and schedules to Brand B
const retireErr = retireGroup(s, idA, idB)
assert.equal(retireErr, null, 'Retiring should succeed')
assert.equal(s.groups[idA].status, 'retired')
assert.equal(s.groups[idA].retiredDay, s.day)

// Check that coach and schedule moved to Brand B
assert.equal(s.buses[busId].groupId, idB)
assert.equal(s.schedules[schId].groupId, idB)
assert.equal(s.buses[busId].groupHistory?.length, 2)
assert.equal(s.buses[busId].groupHistory?.[1].groupId, idB)
console.log('✓ Retiring moved coaches and schedules to destination')

// 3. Cannot retire twice
const retireTwiceErr = retireGroup(s, idA, undefined)
assert.ok(retireTwiceErr, 'Cannot retire already retired brand')

// Destination cannot be a retired brand
const retireToRetiredErr = retireGroup(s, idB, idA)
assert.ok(retireToRetiredErr, 'Cannot move to a retired destination brand')
console.log('✓ Retirement integrity checks passed')

// 4. Restore brings it back empty with rating and status active
s.groups[idA].rating = 4.7
s.groups[idA].ratingCount = 80
s.groups[idA].primo = true

const restoreErr = restoreGroup(s, idA)
assert.equal(restoreErr, null, 'Restoring should succeed')
assert.equal(s.groups[idA].status, 'active')
assert.equal(s.groups[idA].retiredDay, undefined)
assert.equal(s.groups[idA].rating, 4.7)
assert.equal(s.groups[idA].ratingCount, 80)
assert.equal(s.groups[idA].primo, true)

// Restored brand is empty because coaches remained at destination
assert.equal(Object.values(s.buses).filter((b) => b.groupId === idA).length, 0)
console.log('✓ Restore brand brings it back empty with ratings preserved')

// 5. Delete tests
// Delete fails if brand is active
const delActiveErr = deleteGroup(s, idA)
assert.ok(delActiveErr, 'Cannot delete active brand')

// Retire brand A again (to unassigned)
retireGroup(s, idA, undefined)

// Delete succeeds when retired and empty
const delErr = deleteGroup(s, idA)
assert.equal(delErr, null, 'Delete should succeed when retired and holding nothing')
assert.equal(s.groups[idA], undefined, 'Group should be purged from s.groups')

// Check groupHistory rewriting: any past history pointing to purged brand rewrites to undefined
assert.ok(
  s.buses[busId].groupHistory?.every((h) => h.groupId !== idA),
  'groupHistory referencing purged brand should be rewritten to undefined',
)
console.log('✓ Purge delete succeeds and rewrites dangling groupHistory references')

// 6. Retiring all active brands allows unassigned purchases
const remainingActive = activeGroups(s)
for (const grp of remainingActive) {
  retireGroup(s, grp.id, undefined)
}
assert.equal(activeGroups(s).length, 0, 'All brands are now retired')

// An unassigned coach can be added and assigned without crashing
const unassignedBusId = 'bus-unassigned'
s.buses[unassignedBusId] = {
  id: unassignedBusId,
  modelId: 'ashok_12m',
  reg: 'KA-01-UN-0001',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: s.day,
  odometer: 0,
  condition: 100,
  breakdownRisk: 0,
  busCleanliness: 100,
  groupId: undefined,
  groupHistory: [],
  maintenanceHistory: [],
} as any

const assignErr = assignBusToGroup(s, unassignedBusId, undefined)
assert.equal(assignErr, null)
assert.equal(s.buses[unassignedBusId].groupId, undefined)
console.log('✓ Retiring last active brand leaves unassigned operations working')

console.log('All group closing lifecycle tests passed successfully!')
