import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  createGroup,
  assignBusToGroup,
  groupForTrip,
  groupOnDay,
  GROUP_PALETTE,
} from '../src/engine/sim/groups'
import type { GameState, Trip } from '../src/engine/types'

console.log('=== TEST: Groups creation, assignment, trip resolution, and historical ledger ===')

const s = newGame('Bangalore Super Express', 'malik', 'blr-maa')
assert.ok(s.groups, 'Initial brand groups should exist')
const initialGroup = Object.values(s.groups)[0]
assert.ok(initialGroup, 'Initial group created from company')

// 1. Rejects invalid codes
const emptyRes = createGroup(s, { name: 'Invalid', code: '' })
assert.ok('error' in emptyRes, 'Empty code should fail')

const shortRes = createGroup(s, { name: 'Too Short', code: 'A' })
assert.ok('error' in shortRes, 'Single char code should fail')

const longRes = createGroup(s, { name: 'Too Long', code: 'TOOLONG' })
assert.ok('error' in longRes, '6+ char code should fail')

// Rejects duplicate code
const dupRes = createGroup(s, { name: 'Duplicate Code', code: initialGroup.code.toLowerCase() })
assert.ok('error' in dupRes, 'Duplicate code should fail (case-insensitive)')

// Valid group creation
const newBrandRes = createGroup(s, { name: 'Maruti Travels', code: 'MAR', color: GROUP_PALETTE[1] })
assert.ok('id' in newBrandRes, 'Valid group creation should succeed')
const marGid = (newBrandRes as { id: string }).id
const marGroup = s.groups[marGid]
assert.equal(marGroup.name, 'Maruti Travels')
assert.equal(marGroup.code, 'MAR')
assert.equal(marGroup.status, 'active')
assert.equal(marGroup.rating, s.company.rating)
console.log('✓ Validation and creation tests passed')

// 2. Bus assignment and groupHistory
const startDay = s.day
const busId = 'bus-1'
s.buses[busId] = {
  id: busId,
  modelId: 'ashok_12m',
  reg: 'KA-01-AB-1234',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: startDay,
  odometer: 10000,
  condition: 90,
  breakdownRisk: 0.05,
  busCleanliness: 85,
  groupId: initialGroup.id,
  groupHistory: [{ day: startDay, groupId: initialGroup.id }],
  maintenanceHistory: [],
} as any
const bus = s.buses[busId]

// Currently assigned to initial brand
assert.equal(bus.groupId, initialGroup.id)
assert.ok(Array.isArray(bus.groupHistory))

s.day = startDay + 10
// Transfer bus to Maruti Travels
const err1 = assignBusToGroup(s, busId, marGid)
assert.equal(err1, null)
assert.equal(bus.groupId, marGid)
assert.equal(bus.groupHistory?.length, 2)
assert.equal(bus.groupHistory?.[1].day, startDay + 10)
assert.equal(bus.groupHistory?.[1].groupId, marGid)

// Assigning to same group is no-op for history
assignBusToGroup(s, busId, marGid)
assert.equal(bus.groupHistory?.length, 2, 'No redundant history record for same group')

// Transfer to unassigned on Day startDay + 20
s.day = startDay + 20
assignBusToGroup(s, busId, undefined)
assert.equal(bus.groupId, undefined)
assert.equal(bus.groupHistory?.length, 3)
assert.equal(bus.groupHistory?.[2].day, startDay + 20)
assert.equal(bus.groupHistory?.[2].groupId, undefined)
console.log('✓ assignBusToGroup and groupHistory tracking passed')

// 3. groupOnDay resolution across historical timeline
assert.equal(groupOnDay(s, busId, startDay + 5), initialGroup.id, 'Day startDay + 5 belonged to initial brand')
assert.equal(groupOnDay(s, busId, startDay + 10), marGid, 'Day startDay + 10 belonged to MAR')
assert.equal(groupOnDay(s, busId, startDay + 15), marGid, 'Day startDay + 15 belonged to MAR')
assert.equal(groupOnDay(s, busId, startDay + 20), undefined, 'Day startDay + 20 is unassigned')
assert.equal(groupOnDay(s, busId, startDay + 25), undefined, 'Day startDay + 25 is unassigned')
console.log('✓ groupOnDay historical lookup passed')

// 4. groupForTrip resolution
const tripMock: Trip = {
  id: 'trip-1',
  scheduleId: 'sch-1',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: busId,
  day: 15,
  depHour: 6,
  fare: 50000 as any,
  seats: [],
  seatCount: 40,
  sold: 30,
  revenue: 1500000 as any,
  cancelledRevenue: 0 as any,
  channelSold: { redbus: 10, ownapp: 10, counter: 5, abhibus: 5 },
  status: 'completed',
}

// bus currently has undefined groupId
assert.equal(groupForTrip(s, tripMock), undefined)

// assign bus back to MAR
assignBusToGroup(s, busId, marGid)
assert.equal(groupForTrip(s, tripMock)?.id, marGid, 'groupForTrip resolves via bus')

// Trip whose bus was sold or missing falls back to schedule's brand
const tripWithoutBus: Trip = {
  ...tripMock,
  id: 'trip-2',
  busId: 'sold-bus',
}
s.schedules['sch-1'] = {
  id: 'sch-1',
  routeId: 'blr-maa',
  groupId: initialGroup.id,
  busIds: [],
  active: true,
  duty: 'daily',
  depHour: 6,
  depMin: 0,
  returnDepHour: 18,
  returnDepMin: 0,
  speedKmh: 60,
  ticketPrice: 50000 as any,
  serviceTier: 'standard',
  autoPrice: false,
}
assert.equal(groupForTrip(s, tripWithoutBus)?.id, initialGroup.id, 'groupForTrip falls back to schedule groupId')
console.log('✓ groupForTrip resolution tests passed')

console.log('All groups tests passed successfully!')
