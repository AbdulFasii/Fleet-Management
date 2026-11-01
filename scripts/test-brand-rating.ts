import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { createGroup, updateGroup } from '../src/engine/sim/groups'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import { checkPrimo } from '../src/engine/sim/reputation'
import { BAL } from '../src/engine/data/balance'
import type { Trip, Bus } from '../src/engine/types'

console.log('=== TEST: Brand ratings divergence, inheritance threshold, and independent Primo standing ===')

const s = newGame('Karnataka Express Lines', 'malik', 'blr-maa')
s.company.rating = 4.2
s.company.ratingCount = 200

// 1. Create two brands: Premium Line and Budget Line
const resA = createGroup(s, { name: 'Premium Line', code: 'PREM' })
const resB = createGroup(s, { name: 'Budget Line', code: 'BDGT' })
assert.ok('id' in resA && 'id' in resB)
const idPrem = (resA as { id: string }).id
const idBdgt = (resB as { id: string }).id

const grpPrem = s.groups[idPrem]
const grpBdgt = s.groups[idBdgt]

// Add a coach for each brand
const startDay = s.day
const busPrem: Bus = {
  id: 'bus-prem',
  modelId: 'volvo9600',
  reg: 'KA-01-PR-1111',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: startDay,
  odometer: 10000,
  condition: 95 as any,
  breakdownRisk: 0,
  busCleanliness: 95,
  qualityScore: 4.5,
  lifeTrips: 250,
  groupId: idPrem,
  groupHistory: [{ day: startDay, groupId: idPrem }],
  maintenanceHistory: [],
} as any

const busBdgt: Bus = {
  id: 'bus-bdgt',
  modelId: 'cheetah',
  reg: 'KA-01-BG-2222',
  ownership: 'owned',
  status: 'idle',
  acquiredDay: startDay,
  odometer: 50000,
  condition: 75 as any,
  breakdownRisk: 0,
  busCleanliness: 70,
  qualityScore: 3.5,
  groupId: idBdgt,
  groupHistory: [{ day: startDay, groupId: idBdgt }],
  maintenanceHistory: [],
} as any

s.buses[busPrem.id] = busPrem
s.buses[busBdgt.id] = busBdgt

// 2. Under 25 reviews rule: both inherit company rating
grpPrem.rating = 4.9
grpPrem.ratingCount = 10 // < 25
grpBdgt.rating = 3.2
grpBdgt.ratingCount = 15 // < 25

const tripPrem: Trip = {
  id: 'trip-prem-1',
  scheduleId: 'sch-prem',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: busPrem.id,
  day: startDay + 1,
  depHour: 8,
  fare: 70000 as any,
  seats: [],
  seatCount: 40,
  sold: 0,
  revenue: 0 as any,
  cancelledRevenue: 0 as any,
  channelSold: { redbus: 0, ownapp: 0, counter: 0, abhibus: 0 },
  status: 'open',
}

const tripBdgt: Trip = {
  id: 'trip-bdgt-1',
  scheduleId: 'sch-bdgt',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: busBdgt.id,
  day: startDay + 1,
  depHour: 8,
  fare: 70000 as any,
  seats: [],
  seatCount: 40,
  sold: 0,
  revenue: 0 as any,
  cancelledRevenue: 0 as any,
  channelSold: { redbus: 0, ownapp: 0, counter: 0, abhibus: 0 },
  status: 'open',
}

s.schedules['sch-prem'] = {
  id: 'sch-prem',
  groupId: idPrem,
  routeId: 'blr-maa',
  busIds: [busPrem.id],
  active: true,
  duty: 'daily',
  depHour: 8,
  depMin: 0,
  ticketPrice: 70000 as any,
  serviceTier: 'standard',
  autoPrice: false,
  channels: { redbus: true, abhibus: true, ownapp: true, counter: true },
} as any

s.schedules['sch-bdgt'] = {
  id: 'sch-bdgt',
  groupId: idBdgt,
  routeId: 'blr-maa',
  busIds: [busBdgt.id],
  active: true,
  duty: 'daily',
  depHour: 8,
  depMin: 0,
  ticketPrice: 70000 as any,
  serviceTier: 'standard',
  autoPrice: false,
  channels: { redbus: true, abhibus: true, ownapp: true, counter: true },
} as any

let ctx = buildBookingCtx(s)
assert.ok(ctx.ratingByGroup, 'BookingCtx must have ratingByGroup')
assert.equal(ctx.ratingByGroup.get(idPrem)?.count, 10)
assert.equal(ctx.ratingByGroup.get(idBdgt)?.count, 15)

// With both under 25 reviews, demand calculation inherits parent company rating
const premUnder = tripLoadFactor(s, tripPrem, 1, ctx)
const bdgtUnder = tripLoadFactor(s, tripBdgt, 1, ctx)
assert.equal(
  premUnder.parts.rating,
  bdgtUnder.parts.rating,
  'Under 25 reviews, both brands must inherit the exact parent company rating appeal',
)

// Now simulate reviews crossing 25 reviews
grpPrem.ratingCount = 30
grpPrem.rating = 4.9
grpBdgt.ratingCount = 30
grpBdgt.rating = 3.2

ctx = buildBookingCtx(s)
const premEst = tripLoadFactor(s, tripPrem, 1, ctx)
const bdgtEst = tripLoadFactor(s, tripBdgt, 1, ctx)

assert.ok(
  premEst.parts.rating > bdgtEst.parts.rating,
  `Premium rating appeal (${premEst.parts.rating}) should exceed Budget (${bdgtEst.parts.rating}) after crossing 25 reviews`,
)
console.log('✓ Under 25 reviews inheritance rule and rating divergence verified')
console.log('✓ Under 25 reviews inheritance rule and load factor divergence verified')

// 3. Independent Primo Standing
// Let grpPrem meet Primo criteria: rating >= 4.3, cancelRate <= 0.03, cleanliness >= 80, trips >= 30
s.company.punctuality = 0.95
grpPrem.rating = 4.5
grpPrem.ratingCount = 50
grpPrem.cancelRate = 0.01
grpPrem.primo = false
grpPrem.primoOffered = false

// Seed completed trips for Premium coach
for (let i = 0; i < 35; i++) {
  s.trips[`past-prem-${i}`] = {
    id: `past-prem-${i}`,
    scheduleId: 'sch-prem',
    routeId: 'blr-maa',
    direction: 'AB',
    busId: busPrem.id,
    day: startDay - 5,
    depHour: 8,
    fare: 70000 as any,
    seats: [],
    seatCount: 40,
    sold: 35,
    revenue: 2450000 as any,
    cancelledRevenue: 0 as any,
    channelSold: { redbus: 20, ownapp: 10, counter: 5, abhibus: 0 },
    status: 'completed',
  }
}

// Budget brand does NOT meet Primo criteria (low rating 3.2)
grpBdgt.primo = false
grpBdgt.primoOffered = false

// Run checkPrimo
checkPrimo(s)

// Verify Premium was offered Primo while Budget was not
const premDecision = s.decisions.find((d) => d.kind === 'primo' && d.groupId === idPrem)
assert.ok(premDecision, 'Premium brand should receive Primo invitation')

const bdgtDecision = s.decisions.find((d) => d.kind === 'primo' && d.groupId === idBdgt)
assert.equal(bdgtDecision, undefined, 'Budget brand with low rating should NOT receive Primo invitation')
assert.equal(grpPrem.primoOffered, true)
assert.equal(grpBdgt.primoOffered, false)
console.log('✓ Independent Primo invitation evaluation verified')

// 4. Independent Primo Delisting
// Accept Primo for Premium
grpPrem.primo = true
grpPrem.primoSinceDay = startDay

// Now Premium rating drops below delist threshold
grpPrem.rating = 3.8
checkPrimo(s)

assert.equal(grpPrem.primo, false, 'Premium brand should be delisted when rating drops below threshold')
assert.ok(
  (grpPrem.primoNextEligibleDay ?? 0) >= s.day + BAL.primoReinviteCooldownDays,
  'Delist should set a re-invite cooldown',
)
console.log('✓ Independent Primo delisting verified')

// Rating recovers immediately — should NOT re-invite during cooldown
s.decisions = s.decisions.filter((d) => !(d.kind === 'primo' && d.groupId === idPrem))
grpPrem.primoOffered = false
grpPrem.rating = 4.6
const beforeCooldown = s.decisions.length
checkPrimo(s)
assert.equal(
  s.decisions.some((d) => d.kind === 'primo' && d.groupId === idPrem),
  false,
  'Should not re-invite during cooldown after rating bounce',
)
assert.equal(s.decisions.length, beforeCooldown, 'No new Primo decisions during cooldown')
console.log('✓ Primo re-invite cooldown blocks rating-fluctuation spam')

// After cooldown elapses, invite again
s.day = grpPrem.primoNextEligibleDay!
checkPrimo(s)
assert.ok(
  s.decisions.some((d) => d.kind === 'primo' && d.groupId === idPrem),
  'Should re-invite once cooldown has elapsed',
)
console.log('✓ Primo re-invite after cooldown verified')

console.log('All brand rating and Primo tests passed successfully!')
