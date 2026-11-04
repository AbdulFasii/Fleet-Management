import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { advanceDay } from '../src/engine/tick'
import { dow } from '../src/engine/core/calendar'
import { tripLoadFactor } from '../src/engine/sim/demand'
import type { Bus, Staff, Trip } from '../src/engine/types'

console.log('--- Testing Booking Curve Shape (Hybrid + Sleeper) ---')

// Initialize game
const s = newGame('Curve Test Co', 'seth', 'blr-cbe', 4242)
s.config.routeLifeCycle = false // these tests measure mature routes

// Set up permits
s.permits['blr-cbe'] = {
  id: 'pm-blr-cbe',
  routeId: 'blr-cbe',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: s.day + 365,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}
s.permits['maa-mdu'] = {
  id: 'pm-maa-mdu',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: s.day + 365,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}

// 1. Sleeper Coach
s.buses['b-sleeper'] = {
  id: 'b-sleeper',
  reg: 'TN 01 SL 1111',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 5000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 36,
  acquisitionDay: 1,
  purchasePrice: 6500000,
  parkedCityId: 'maa',
  fitnessExpiryDay: s.day + 365,
  insuranceExpiryDay: s.day + 365,
  permitExpiryDay: s.day + 365,
  taxExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 365,
  tyreKm: 5000,
  engineOilKm: 5000,
  brakeOilKm: 5000,
  coolantKm: 5000,
  lastMajorServiceKm: 0,
  lifeTrips: 0,
} as Bus

// 2. Hybrid Coach
s.buses['b-hybrid'] = {
  id: 'b-hybrid',
  reg: 'KA 01 HY 2222',
  modelId: 'leyhybrid',
  status: 'active',
  odometerKm: 5000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 40,
  acquisitionDay: 1,
  purchasePrice: 7500000,
  parkedCityId: 'blr',
  fitnessExpiryDay: s.day + 365,
  insuranceExpiryDay: s.day + 365,
  permitExpiryDay: s.day + 365,
  taxExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 365,
  tyreKm: 5000,
  engineOilKm: 5000,
  brakeOilKm: 5000,
  coolantKm: 5000,
  lastMajorServiceKm: 0,
  lifeTrips: 0,
} as Bus

function makeDriver(id: string, name: string, busId: string): Staff {
  return {
    id,
    name,
    role: 'driver',
    busId,
    salary: 2500000,
    skill: 7,
    fatigue: 0,
    hiredDay: s.day,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
  }
}

s.staff['d1'] = makeDriver('d1', 'Driver 1', 'b-sleeper')
s.staff['d2'] = makeDriver('d2', 'Driver 2', 'b-sleeper')
s.staff['d3'] = makeDriver('d3', 'Driver 3', 'b-hybrid')
s.staff['d4'] = makeDriver('d4', 'Driver 4', 'b-hybrid')

const schSleeperRes = createSchedule(s, {
  routeId: 'maa-mdu',
  depHour: 22,
  depMin: 0,
  paired: false,
  cancellation: 'standard',
  autoPrice: true,
  redDeal: false,
})
if ('error' in schSleeperRes) throw new Error(schSleeperRes.error)
assignBus(s, schSleeperRes.id, 'b-sleeper')

const schHybridRes = createSchedule(s, {
  routeId: 'blr-cbe',
  depHour: 23,
  depMin: 0,
  paired: false,
  cancellation: 'standard',
  autoPrice: true,
  redDeal: false,
})
if ('error' in schHybridRes) throw new Error(schHybridRes.error)
assignBus(s, schHybridRes.id, 'b-hybrid')

// Warm up the booking window by advancing 10 days
console.log('Warming up schedule booking windows over 10 days...')
for (let i = 0; i < 10; i++) {
  advanceDay(s)
}

// Find a midweek departure generated at s.day + 7
// Advance until s.day + 7 is a midweek day (Tue or Wed: dow === 2 or 3)
while (dow(s.day + 7) !== 2 && dow(s.day + 7) !== 3) {
  advanceDay(s)
}

const targetDay = s.day + 7
const targetSleeperTrip = Object.values(s.trips).find(
  (t) => t.scheduleId === schSleeperRes.id && t.day === targetDay,
)
const targetHybridTrip = Object.values(s.trips).find(
  (t) => t.scheduleId === schHybridRes.id && t.day === targetDay,
)

assert.ok(targetSleeperTrip, 'Target sleeper trip should exist at T-7')
assert.ok(targetHybridTrip, 'Target hybrid trip should exist at T-7')

console.log(`Initial at creation (T-7): Sleeper ${targetSleeperTrip.sold}/36 | Hybrid ${targetHybridTrip.sold}/40`)
const slf = tripLoadFactor(s, targetSleeperTrip, 7)
const hlf = tripLoadFactor(s, targetHybridTrip, 7)
console.log(`TripLoadFactor targets at T-7: Sleeper target ${Math.round(slf.target * 100)}% | Hybrid target ${Math.round(hlf.target * 100)}%`)

console.log(`\nTracking departure Day ${targetDay} (started at T-7):`)

const sleeperCap = targetSleeperTrip.seatCount || 36
const hybridCap = targetHybridTrip.seatCount || 40

const logStatus = (label: string) => {
  const sTrip = s.trips[targetSleeperTrip.id]!
  const hTrip = s.trips[targetHybridTrip.id]!
  const sLf = sTrip.sold / sleeperCap
  const hLf = hTrip.sold / hybridCap
  console.log(
    `  ${label}: Sleeper ${sTrip.sold}/${sleeperCap} (${Math.round(sLf * 100)}%) | Hybrid ${hTrip.sold}/${hybridCap} (${Math.round(hLf * 100)}%)`,
  )
  return { sLf, hLf }
}

// Advance to T-6
advanceDay(s)
const t6 = logStatus('T-6 (Week out)')

// Advance to T-5
advanceDay(s)
const t5 = logStatus('T-5 (Week out)')

// Advance to T-4
advanceDay(s)
logStatus('T-4')

// Advance to T-3
advanceDay(s)
const t3 = logStatus('T-3 (Mid window)')

// Advance to T-2
advanceDay(s)
const t2 = logStatus('T-2')

// Advance to T-1
advanceDay(s)
const t1 = logStatus('T-1 (Inside two days)')

// Advance to T-0 (Today)
advanceDay(s)
const t0 = logStatus('T-0 (Departed / Today)')

// Test multiple departures to evaluate the booking curve pace across noise
console.log('\nTracking 5 consecutive midweek departures:')
const sleeperPaces: { t5: number[]; t3: number[]; t1: number[] } = { t5: [], t3: [], t1: [] }
const hybridPaces: { t5: number[]; t3: number[]; t1: number[] } = { t5: [], t3: [], t1: [] }

for (let run = 0; run < 5; run++) {
  // Advance until s.day + 7 is a midweek day
  while (dow(s.day + 7) !== 1 && dow(s.day + 7) !== 2 && dow(s.day + 7) !== 3) {
    advanceDay(s)
  }
  const tDay = s.day + 7
  const sTrip = Object.values(s.trips).find((t) => t.scheduleId === schSleeperRes.id && t.day === tDay)!
  const hTrip = Object.values(s.trips).find((t) => t.scheduleId === schHybridRes.id && t.day === tDay)!

  // T-7 -> T-6
  advanceDay(s)
  // T-6 -> T-5
  advanceDay(s)
  sleeperPaces.t5.push(s.trips[sTrip.id]!.sold / sleeperCap)
  hybridPaces.t5.push(s.trips[hTrip.id]!.sold / hybridCap)

  // T-5 -> T-4
  advanceDay(s)
  // T-4 -> T-3
  advanceDay(s)
  sleeperPaces.t3.push(s.trips[sTrip.id]!.sold / sleeperCap)
  hybridPaces.t3.push(s.trips[hTrip.id]!.sold / hybridCap)

  // T-3 -> T-2
  advanceDay(s)
  // T-2 -> T-1
  advanceDay(s)
  sleeperPaces.t1.push(s.trips[sTrip.id]!.sold / sleeperCap)
  hybridPaces.t1.push(s.trips[hTrip.id]!.sold / hybridCap)
}

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

const avgSlpT5 = avg(sleeperPaces.t5)
const avgHybT5 = avg(hybridPaces.t5)
const avgSlpT3 = avg(sleeperPaces.t3)
const avgHybT3 = avg(hybridPaces.t3)
const avgSlpT1 = avg(sleeperPaces.t1)
const avgHybT1 = avg(hybridPaces.t1)

console.log(`\nAverage Booking Curve Results over 5 midweek departures:`)
console.log(`  Week out (T-5): Sleeper ${Math.round(avgSlpT5 * 100)}% | Hybrid ${Math.round(avgHybT5 * 100)}% (target ~35-55%)`)
console.log(`  Mid window (T-3): Sleeper ${Math.round(avgSlpT3 * 100)}% | Hybrid ${Math.round(avgHybT3 * 100)}% (target ~50-65%)`)
console.log(`  Inside two days (T-1): Sleeper ${Math.round(avgSlpT1 * 100)}% | Hybrid ${Math.round(avgHybT1 * 100)}% (target ~55-75%)`)

assert.ok(avgSlpT5 >= 0.35 && avgSlpT5 <= 0.55, `Average Sleeper T-5 (${avgSlpT5.toFixed(2)}) should be in 35-55% band`)
assert.ok(avgHybT5 >= 0.35 && avgHybT5 <= 0.55, `Average Hybrid T-5 (${avgHybT5.toFixed(2)}) should be in 35-55% band`)
assert.ok(avgSlpT3 >= 0.50 && avgSlpT3 <= 0.65, `Average Sleeper T-3 (${avgSlpT3.toFixed(2)}) should be in 50-65% band`)
assert.ok(avgHybT3 >= 0.50 && avgHybT3 <= 0.65, `Average Hybrid T-3 (${avgHybT3.toFixed(2)}) should be in 50-65% band`)
assert.ok(avgSlpT1 >= 0.55 && avgSlpT1 <= 0.75, `Average Sleeper T-1 (${avgSlpT1.toFixed(2)}) should be in 55-75% band`)
assert.ok(avgHybT1 >= 0.55 && avgHybT1 <= 0.75, `Average Hybrid T-1 (${avgHybT1.toFixed(2)}) should be in 55-75% band`)

console.log('\n======================================================')
console.log('✓ ALL BOOKING CURVE SHAPE TESTS PASSED!')
console.log('======================================================')
