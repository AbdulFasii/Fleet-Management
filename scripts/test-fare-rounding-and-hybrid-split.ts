import { roundFare } from '../src/engine/sim/pricing'
import { rs, toRupees } from '../src/engine/core/money'
import { hybridClassStats } from '../src/engine/sim/seatmap'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { newGame } from '../src/engine/newGame'
import { dispatchPass } from '../src/engine/sim/dispatch'
import type { Trip } from '../src/engine/types'

console.log('--- Testing Fare Rounding & Hybrid Base Fare Split ---')

// 1. Test roundFare()
console.log('\n[Check 1] Validating Fare Rounding Rules...')
// Rules:
// - Fares under ₹1,000 round UP to next ₹50
// - Fares ₹1,000 and above round to NEAREST ₹100

const testsUnder1000: [number, number][] = [
  [450, 450],
  [451, 500],
  [561, 600],
  [583, 600],
  [642, 650],
  [650, 650],
  [656, 700],
  [664, 700],
  [693, 700],
  [766, 800],
  [800, 800],
  [810, 850],
  [862, 900],
  [875, 900],
  [895, 900],
  [912, 950],
  [950, 950],
  [985, 1000],
]

for (const [input, expected] of testsUnder1000) {
  const result = toRupees(roundFare(rs(input)))
  if (result !== expected) {
    throw new Error(`FAIL: input ₹${input} expected ₹${expected}, got ₹${result}`)
  }
}
console.log(`✓ All ${testsUnder1000.length} test cases for fares < ₹1,000 correctly rounded UP to next ₹50!`)

const testsAbove1000: [number, number][] = [
  [1000, 1000],
  [1007, 1000],
  [1018, 1000],
  [1049, 1000],
  [1050, 1100],
  [1063, 1100],
  [1175, 1200],
  [1343, 1300],
  [1399, 1400],
  [1740, 1700],
  [1760, 1800],
]

for (const [input, expected] of testsAbove1000) {
  const result = toRupees(roundFare(rs(input)))
  if (result !== expected) {
    throw new Error(`FAIL: input ₹${input} expected ₹${expected}, got ₹${result}`)
  }
}
console.log(`✓ All ${testsAbove1000.length} test cases for fares >= ₹1,000 correctly rounded to NEAREST ₹100!`)

// 2. Test hybridClassStats() rounding
console.log('\n[Check 2] Validating Hybrid Class Fare Calculation...')
const hybridModel = BUS_MODELS['leyhybrid']! // 12M Hybrid (20 sleeper, 20 semi)
console.log(`Testing with model: ${hybridModel.name} (${hybridModel.layout.kind}, ${hybridModel.seats} seats)`)

const mockOpenTrip: Trip = {
  id: 'tr_test_1',
  scheduleId: 'sch_1',
  routeId: 'maa-mdu',
  direction: 'AB',
  busId: 'b1',
  day: 10,
  depHour: 21,
  fare: rs(850), // base fare ₹850
  seatCount: 40,
  sold: 30,
  revenue: rs(25000),
  cancelledRevenue: 0,
  channelSold: { redbus: 15, abhibus: 5, ownapp: 8, counter: 2 },
  status: 'open',
  seats: [
    ...Array(20).fill(0).map((_, i) => ({ id: `L${i}W`, deck: 'L' as const, mult: 1.25, ladies: false, zone: 'sleeper' as const })),
    ...Array(20).fill(0).map((_, i) => ({ id: `S${i}W`, deck: 'L' as const, mult: 0.80, ladies: false, zone: 'semi' as const })),
  ],
}

const stats = hybridClassStats(mockOpenTrip, hybridModel)
if (!stats) throw new Error('FAIL: hybridClassStats returned null for open hybrid trip')

const slpFare = toRupees(stats.sleeper.listed)
const strFare = toRupees(stats.seater.listed)
console.log(`Open trip base fare ₹850 -> Sleeper: ₹${slpFare}, Seater: ₹${strFare}`)

if (slpFare % 100 !== 0 && slpFare >= 1000) {
  throw new Error(`FAIL: Sleeper fare ₹${slpFare} is >= 1000 but not rounded to nearest 100`)
}
if (strFare % 50 !== 0 && strFare < 1000) {
  throw new Error(`FAIL: Seater fare ₹${strFare} is < 1000 but not rounded up to 50s`)
}
if (slpFare !== 1100) {
  throw new Error(`FAIL: Expected sleeper listed fare to be ₹1100 (850 * 1.25 = 1062.5 -> nearest 100 = 1100), got ₹${slpFare}`)
}
if (strFare !== 700) {
  throw new Error(`FAIL: Expected seater listed fare to be ₹700 (850 * 0.80 = 680 -> round up to 50 = 700), got ₹${strFare}`)
}
console.log('✓ Hybrid open trip sleeper and seater listed fares match exact rounding rules!')

// 3. Test completed trip without seats (Recently Run table scenario)
console.log('\n[Check 3] Validating Completed Hybrid Trip (Seats Cleared)...')
const mockCompletedTrip: Trip = {
  ...mockOpenTrip,
  id: 'tr_test_completed',
  status: 'completed',
  seats: [], // dropped upon completion to save storage
}

const completedStats = hybridClassStats(mockCompletedTrip, hybridModel)
if (!completedStats) {
  throw new Error('FAIL: hybridClassStats should reconstruct hybrid stats using model when trip.seats is cleared')
}

console.log(`Completed trip with cleared seats -> Sleeper: ₹${toRupees(completedStats.sleeper.listed)} (${completedStats.sleeper.cap} berths), Seater: ₹${toRupees(completedStats.seater.listed)} (${completedStats.seater.cap} seats)`)
const compSlp = toRupees(completedStats.sleeper.listed)
const compStr = toRupees(completedStats.seater.listed)
if (compSlp % 100 !== 0 || compSlp < 1000) {
  throw new Error(`FAIL: Sleeper fare ₹${compSlp} should be >= 1000 and multiple of 100`)
}
if (compStr % 50 !== 0 || compStr >= 1000) {
  throw new Error(`FAIL: Seater fare ₹${compStr} should be < 1000 and multiple of 50`)
}
console.log('✓ Recently Run completed hybrid trips accurately resolve sleeper & seater listed fares!')

// 4. Test hybridSnapshot preservation in dispatchPass()
console.log('\n[Check 4] Validating hybridSnapshot Preservation in dispatchPass()...')
const s = newGame('Test', 'seth', 'maa-mdu', 42)
s.buses['b_hyb'] = {
  id: 'b_hyb',
  reg: 'TN 01 HY 9999',
  modelId: 'leyhybrid',
  status: 'active',
  odometerKm: 10000,
  parkedCityId: 'maa',
} as any

s.trips['tr_snap'] = {
  ...mockOpenTrip,
  id: 'tr_snap',
  busId: 'b_hyb',
  day: s.day,
  status: 'open',
}
s.openTripIds.push('tr_snap')

dispatchPass(s)

const dispatchedTrip = s.trips['tr_snap']!
if (!dispatchedTrip.hybridSnapshot) {
  throw new Error('FAIL: trip.hybridSnapshot was not set during dispatchPass')
}
console.log('hybridSnapshot:', dispatchedTrip.hybridSnapshot)
if (dispatchedTrip.hybridSnapshot.sleeper.cap !== 20 || dispatchedTrip.hybridSnapshot.seater.cap !== 20) {
  throw new Error('FAIL: hybridSnapshot cap mismatch')
}
console.log('✓ dispatchPass() successfully snapshot-cached hybrid sleeper/seater stats before seat map compaction!')

console.log('\n======================================================')
console.log('🎉 ALL FARE ROUNDING & HYBRID SPLIT TESTS PASSED!')
console.log('======================================================')
