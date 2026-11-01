import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { createGroup, updateGroup, resolvedAmenities } from '../src/engine/sim/groups'
import { dispatchPass } from '../src/engine/sim/dispatch'
import { BAL } from '../src/engine/data/balance'
import type { Schedule, Trip } from '../src/engine/types'

console.log('=== TEST: Brand amenities resolution, dispatch cost and PSS bonus ===')

const s = newGame('Karnataka Express Lines', 'malik', 'blr-maa')
const initialGroup = Object.values(s.groups)[0]

// 1. Create a luxury subsidiary with water + snack hamper
const res = createGroup(s, {
  name: 'Royal Gold Travels',
  code: 'RGLD',
})
assert.ok('id' in res)
const gid = (res as { id: string }).id
updateGroup(s, gid, {
  defaultAmenities: {
    waterBottle: true,
    snackHamper: true,
    sanitizedBedding: false,
  },
})

// Unassigned brand fallback
s.company.defaultAmenities = {
  waterBottle: false,
  snackHamper: false,
  sanitizedBedding: false,
}

const luxurySch: Schedule = {
  id: 'sch-lux',
  groupId: gid,
  routeId: 'blr-maa',
  busIds: ['bus-lux'],
  active: true,
  duty: 'daily',
  depHour: 8,
  ticketPrice: 60000 as any,
  serviceTier: 'standard',
  autoPrice: false,
} as any

const unassignedSch: Schedule = {
  id: 'sch-plain',
  routeId: 'blr-maa',
  busIds: ['bus-plain'],
  active: true,
  duty: 'daily',
  depHour: 8,
  ticketPrice: 50000 as any,
  serviceTier: 'standard',
  autoPrice: false,
} as any

s.schedules[luxurySch.id] = luxurySch
s.schedules[unassignedSch.id] = unassignedSch

// Verify resolvedAmenities
const luxAmenities = resolvedAmenities(s, luxurySch)
assert.equal(luxAmenities.waterBottle, true)
assert.equal(luxAmenities.snackHamper, true)
assert.equal(luxAmenities.sanitizedBedding, false)

const plainAmenities = resolvedAmenities(s, unassignedSch)
assert.equal(plainAmenities.waterBottle, false)
assert.equal(plainAmenities.snackHamper, false)
console.log('✓ resolvedAmenities correctly resolves brand defaults vs corporate fallback')

// 2. Set up coaches and trips for dispatch test
const startDay = s.day
const busLux = {
  id: 'bus-lux',
  modelId: 'cheetah',
  reg: 'KA-01-LUX-1',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: startDay,
  odometer: 10000,
  condition: { engine: 90, tyres: 90, brakes: 90, electrical: 90, body: 90, ac: 90 },
  breakdownRisk: 0,
  busCleanliness: 90,
  groupId: gid,
  groupHistory: [{ day: startDay, groupId: gid }],
  maintenanceHistory: [],
} as any

const busPlain = {
  id: 'bus-plain',
  modelId: 'cheetah',
  reg: 'KA-01-PLN-1',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: startDay,
  odometer: 10000,
  condition: { engine: 90, tyres: 90, brakes: 90, electrical: 90, body: 90, ac: 90 },
  breakdownRisk: 0,
  busCleanliness: 90,
  groupId: undefined,
  groupHistory: [],
  maintenanceHistory: [],
} as any

s.buses[busLux.id] = busLux
s.buses[busPlain.id] = busPlain

// Hire drivers
s.staff['drv-1'] = {
  id: 'drv-1',
  name: 'Ramesh',
  role: 'driver',
  assignedBusId: busLux.id,
  salary: 20000 as any,
  skill: 8,
  safety: 8,
  fatigue: 0,
  hiredDay: startDay,
  drivingStyle: 'cautious',
  safetyRecord: { hardBrakes: 0, accidents: 0 },
} as any

s.staff['drv-2'] = {
  id: 'drv-2',
  name: 'Suresh',
  role: 'driver',
  assignedBusId: busPlain.id,
  salary: 20000 as any,
  skill: 8,
  safety: 8,
  fatigue: 0,
  hiredDay: startDay,
  drivingStyle: 'cautious',
  safetyRecord: { hardBrakes: 0, accidents: 0 },
} as any

const tripLux: Trip = {
  id: 'trip-lux-1',
  scheduleId: luxurySch.id,
  routeId: 'blr-maa',
  direction: 'AB',
  busId: busLux.id,
  day: startDay,
  depHour: 8,
  fare: 60000 as any,
  seats: [],
  seatCount: 40,
  sold: 30,
  revenue: 1800000 as any,
  cancelledRevenue: 0 as any,
  channelSold: { redbus: 10, ownapp: 10, counter: 5, abhibus: 5 },
  status: 'open',
}

const tripPlain: Trip = {
  id: 'trip-plain-1',
  scheduleId: unassignedSch.id,
  routeId: 'blr-maa',
  direction: 'AB',
  busId: busPlain.id,
  day: startDay,
  depHour: 8,
  fare: 50000 as any,
  seats: [],
  seatCount: 40,
  sold: 30,
  revenue: 1500000 as any,
  cancelledRevenue: 0 as any,
  channelSold: { redbus: 10, ownapp: 10, counter: 5, abhibus: 5 },
  status: 'open',
}

s.trips[tripLux.id] = tripLux
s.trips[tripPlain.id] = tripPlain
s.openTripIds.push(tripLux.id, tripPlain.id)

// Initial cash & txns count
const initialTxnCount = s.txns.length

// Run dispatch
dispatchPass(s)

// Verify luxury trip posted passenger_amenities expense
const luxuryTxn = s.txns.find((t) => t.head === 'passenger_amenities' && t.tripId === tripLux.id)
assert.ok(luxuryTxn, 'Luxury trip must post passenger_amenities expense')
assert.ok(tripLux.amenitiesCost && tripLux.amenitiesCost > 0, 'Luxury trip amenitiesCost should be recorded')
assert.equal(luxuryTxn.amount, tripLux.amenitiesCost)

// Verify plain trip posted NO passenger_amenities expense
const plainTxn = s.txns.find((t) => t.head === 'passenger_amenities' && t.tripId === tripPlain.id)
assert.equal(plainTxn, undefined, 'Plain trip without amenities should not post amenity expense')

// Verify luxury trip got PSS bonus
assert.ok(tripLux.outcome && tripPlain.outcome)
assert.ok(
  tripLux.outcome.pss > tripPlain.outcome.pss,
  `Luxury trip PSS (${tripLux.outcome.pss}) should exceed Plain trip PSS (${tripPlain.outcome.pss})`,
)
console.log('✓ Dispatch posts amenity expenses and applies PSS bonus based on brand')

// 3. Changing brand default changes subsequent resolution
updateGroup(s, gid, {
  defaultAmenities: { waterBottle: false, snackHamper: false, sanitizedBedding: false },
})
const updatedAmenities = resolvedAmenities(s, luxurySch)
assert.equal(updatedAmenities.waterBottle, false)
assert.equal(updatedAmenities.snackHamper, false)
console.log('✓ Updating brand default immediately reflects in resolvedAmenities')

console.log('All brand amenities tests passed successfully!')
