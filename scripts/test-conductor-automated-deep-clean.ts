import { conductorCleanlinessTarget, conductorAutoClean } from '../src/engine/sim/maintenance'
import { newGame } from '../src/engine/newGame'
import { dispatchPass } from '../src/engine/sim/dispatch'
import type { Bus, Staff, Trip } from '../src/engine/types'
import { rs } from '../src/engine/core/money'

console.log('--- Testing Conductor Automated Deep Clean & Cleanliness Rating ---')

// 1. Test conductorCleanlinessTarget
console.log('\n[Check 1] Validating Conductor Skill -> Cleanliness Target Mapping...')
const expectedTargets: [number, number][] = [
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 70],
  [6, 75],
  [7, 80],
  [8, 85],
  [9, 90],
  [10, 95],
]

for (const [skill, expected] of expectedTargets) {
  const result = conductorCleanlinessTarget(skill)
  if (result !== expected) {
    throw new Error(`FAIL: Skill ${skill} expected target ${expected}, got ${result}`)
  }
}
console.log('✓ Skill <= 4 correctly returns 0 (no automated deep clean)')
console.log('✓ Skills 5-10 correctly return realistic progressive targets: 70 -> 75 -> 80 -> 85 -> 90 -> 95!')

// 2. Test conductorAutoClean across different conductor skill levels
console.log('\n[Check 2] Validating Automated Deep Clean by Conductor Skill...')
const s = newGame('CleanTest', 'seth', 'maa-mdu', 42)

// Setup buses
s.buses['b_star10'] = {
  id: 'b_star10',
  reg: 'TN 01 ST 1010',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 60, // dirty
  lastDeepCleanDay: 1,
} as Bus

s.buses['b_star8'] = {
  id: 'b_star8',
  reg: 'TN 01 ST 0808',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 60, // dirty
  lastDeepCleanDay: 1,
} as Bus

s.buses['b_star5'] = {
  id: 'b_star5',
  reg: 'TN 01 ST 0505',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 55, // dirty
  lastDeepCleanDay: 1,
} as Bus

s.buses['b_star3'] = {
  id: 'b_star3',
  reg: 'TN 01 ST 0303',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 55, // dirty
  lastDeepCleanDay: 1,
} as Bus

s.buses['b_none'] = {
  id: 'b_none',
  reg: 'TN 01 NO 0000',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 55, // dirty
  lastDeepCleanDay: 1,
} as Bus

// Assign conductors
s.staff['c10'] = { id: 'c10', name: 'Mani', role: 'conductor', skill: 10, busId: 'b_star10' } as Staff
s.staff['c8'] = { id: 'c8', name: 'Murugan', role: 'conductor', skill: 8, busId: 'b_star8' } as Staff
s.staff['c5'] = { id: 'c5', name: 'Kannan', role: 'conductor', skill: 5, busId: 'b_star5' } as Staff
s.staff['c3'] = { id: 'c3', name: 'Raju', role: 'conductor', skill: 3, busId: 'b_star3' } as Staff

s.day = 10 // 9 days since last deep clean, due for deep clean

// Run automated cleaning
conductorAutoClean(s)

console.log(`Bus with 10★ Conductor Cleanliness: ${s.buses['b_star10'].busCleanliness}/100`)
if (s.buses['b_star10'].busCleanliness !== 95) {
  throw new Error(`FAIL: Expected 10★ conductor to restore cleanliness to 95, got ${s.buses['b_star10'].busCleanliness}`)
}
console.log('✓ 10★ Conductor automatically restored bus cleanliness to 95/100')

console.log(`Bus with 8★ Conductor Cleanliness: ${s.buses['b_star8'].busCleanliness}/100`)
if (s.buses['b_star8'].busCleanliness !== 85) {
  throw new Error(`FAIL: Expected 8★ conductor to restore cleanliness to 85, got ${s.buses['b_star8'].busCleanliness}`)
}
console.log('✓ 8★ Conductor automatically restored bus cleanliness to 85/100')

console.log(`Bus with 5★ Conductor Cleanliness: ${s.buses['b_star5'].busCleanliness}/100`)
if (s.buses['b_star5'].busCleanliness !== 70) {
  throw new Error(`FAIL: Expected 5★ conductor to restore cleanliness to 70, got ${s.buses['b_star5'].busCleanliness}`)
}
console.log('✓ 5★ Conductor automatically restored bus cleanliness to 70/100')

console.log(`Bus with 3★ Conductor Cleanliness: ${s.buses['b_star3'].busCleanliness}/100`)
if (s.buses['b_star3'].busCleanliness !== 55) {
  throw new Error(`FAIL: Expected 3★ conductor NOT to deep clean (cleanliness should stay 55), got ${s.buses['b_star3'].busCleanliness}`)
}
console.log('✓ 3★ Conductor performed NO deep clean (cleanliness remained uncleaned at 55/100)')

console.log(`Bus with No Conductor Cleanliness: ${s.buses['b_none'].busCleanliness}/100`)
if (s.buses['b_none'].busCleanliness !== 55) {
  throw new Error(`FAIL: Expected bus without conductor NOT to deep clean, got ${s.buses['b_none'].busCleanliness}`)
}
console.log('✓ Bus with no conductor performed NO deep clean')

// 3. Test Trip degradation & turnaround upkeep
console.log('\n[Check 3] Validating Trip Degradation and Turnaround Upkeep...')
s.buses['b_trip10'] = {
  id: 'b_trip10',
  reg: 'TN 01 TR 1010',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 95,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, electrical: 90, ac: 90, body: 90, tyres: 90 },
} as Bus

s.buses['b_trip3'] = {
  id: 'b_trip3',
  reg: 'TN 01 TR 0303',
  modelId: 'leyacsleep2',
  status: 'active',
  busCleanliness: 50,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, electrical: 90, ac: 90, body: 90, tyres: 90 },
} as Bus

// Drivers
s.staff['d1'] = { id: 'd1', name: 'Driver 1', role: 'driver', skill: 8, busId: 'b_trip10' } as Staff
s.staff['d2'] = { id: 'd2', name: 'Driver 2', role: 'driver', skill: 8, busId: 'b_trip3' } as Staff
s.staff['cond10'] = { id: 'cond10', name: 'Conductor 10', role: 'conductor', skill: 10, busId: 'b_trip10' } as Staff
s.staff['cond3'] = { id: 'cond3', name: 'Conductor 3', role: 'conductor', skill: 3, busId: 'b_trip3' } as Staff

s.trips['tr_t10'] = {
  id: 'tr_t10',
  scheduleId: 's1',
  routeId: 'maa-mdu',
  direction: 'AB',
  busId: 'b_trip10',
  day: s.day,
  depHour: 21,
  fare: rs(800),
  seats: [],
  seatCount: 36,
  sold: 30,
  revenue: rs(24000),
  cancelledRevenue: 0,
  channelSold: { redbus: 30, abhibus: 0, ownapp: 0, counter: 0 },
  status: 'open',
} as Trip

s.trips['tr_t3'] = {
  id: 'tr_t3',
  scheduleId: 's2',
  routeId: 'maa-mdu',
  direction: 'AB',
  busId: 'b_trip3',
  day: s.day,
  depHour: 21,
  fare: rs(800),
  seats: [],
  seatCount: 36,
  sold: 30,
  revenue: rs(24000),
  cancelledRevenue: 0,
  channelSold: { redbus: 30, abhibus: 0, ownapp: 0, counter: 0 },
  status: 'open',
} as Trip

s.openTripIds.push('tr_t10', 'tr_t3')

dispatchPass(s)

console.log(`Trip finished -> 10★ bus cleanliness: ${s.buses['b_trip10'].busCleanliness}/100`)
console.log(`Trip finished -> 3★ bus cleanliness: ${s.buses['b_trip3'].busCleanliness}/100`)

if (s.buses['b_trip10'].busCleanliness < 90) {
  throw new Error(`FAIL: 10★ conductor should keep bus at high cleanliness (>= 90), got ${s.buses['b_trip10'].busCleanliness}`)
}
if (s.buses['b_trip3'].busCleanliness >= 50) {
  throw new Error(`FAIL: 3★ conductor bus cleanliness should drop below 50, got ${s.buses['b_trip3'].busCleanliness}`)
}
console.log('✓ 10★ Conductor bus maintained at high cleanliness (>= 90)')
console.log('✓ 3★ Conductor bus cleanliness dropped without high turnaround recovery (< 50)')

console.log('\n======================================================')
console.log('🎉 ALL CONDUCTOR AUTOMATED DEEP CLEAN TESTS PASSED!')
console.log('======================================================')
