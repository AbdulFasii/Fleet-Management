import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import {
  weeklyRivalIntelligencePass,
  isTripFrontRun,
  getCorridorStance,
  setCorridorStance,
} from '../src/engine/sim/rivalIntelligence'

console.log('Testing Dynamic Rival Intelligence & Predatory Timing...')

const s = newGame('Rival Intel Test', 'malik', 'blr-maa', 99999)

// 1. Initially, no rival actions
console.log('1. Initial rival actions count:', Object.keys(s.world.rivalActions ?? {}).length)

// Ensure player has active permit and 5 active schedules on Chennai-Bangalore (blr-maa)
s.permits['blr-maa'] = {
  routeId: 'blr-maa',
  appliedDay: s.day - 30,
  approvedDay: s.day - 10,
  feePaid: 5000000,
  status: 'active',
}

// Add 5 active schedules with departures at 06:00, 14:00, 21:00, 22:30, 23:00
const depTimes = [
  { h: 6, m: 0 },
  { h: 14, m: 0 },
  { h: 21, m: 0 },
  { h: 22, m: 30 },
  { h: 23, m: 0 },
]

for (let i = 0; i < depTimes.length; i++) {
  const schId = `sch_test_${i}`
  const busId = `bus_test_${i}`
  s.buses[busId] = {
    id: busId,
    reg: `TN-01-AB-100${i}`,
    nickname: `Express ${i}`,
    modelId: 'volvo9600s',
    ownership: 'owned',
    odometer: 50000,
    condition: { engine: 90, gearbox: 90, electrical: 90, body: 90, brakes: 90, suspension: 90, tyres: 90, ac: 90 },
    mfgYear: 2024,
    frontTyreKm: 5000,
    rearTyreKm: 5000,
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: 6,
    lastServiceOdo: 45000,
    lastMajorServiceOdo: 45000,
    lastOverhaulDay: 0,
    lastOverhaulOdo: 0,
    insuranceExpiryDay: s.day + 300,
    fitnessExpiryDay: s.day + 300,
    pucExpiryDay: s.day + 180,
    gpsDeviceFitted: true,
    roadTaxPayableDay: s.day + 300,
    aitpPaidUntilDay: s.day + 90,
    parkedCityId: 'maa',
    cargoVolumeCbm: 8,
    status: 'active',
    duty: 'line',
    scheduleId: schId,
    accidentHistory: false,
    busCleanliness: 95,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: 4.8,
  }

  s.schedules[schId] = {
    id: schId,
    routeId: 'blr-maa',
    depHour: depTimes[i].h,
    depMin: depTimes[i].m as 0 | 30,
    busIds: [busId],
    paired: true,
    active: true,
    outboundDuty: 'daily',
    returnDuty: 'daily',
    baseFare: 110000,
  }
}

console.log('2. Setup 5 departures on Chennai–Bangalore corridor.')

// Fast forward to trigger weekly evaluation
const initialDay = s.day
for (let d = 0; d < 30; d++) { // rivals may wait a few weeks before striking
  advanceDay(s)
}

console.log(`3. Advanced ${s.day - initialDay} days (now day ${s.day}). Checking rival intelligence...`)
const action = s.world.rivalActions?.['blr-maa'] ?? s.world.rivalActions?.['maa-blr']

if (!action) {
  throw new Error('Rival should have launched a retaliatory wave on blr-maa / maa-blr!')
}

console.log('   ✓ Rival Counter-Move Triggered:')
console.log('     Rival Name:', action.rivalName)
console.log('     Tactic:', action.tactic)
console.log('     Headline:', action.headline)
console.log('     Rival Counter-Clocks:', action.targetDepartureClocks)
console.log('     Price Discount:', `${action.fareDiscountPct}%`)
console.log('     Duration:', `${action.untilDay - s.day} days remaining`)

// 4. Verify Predatory Timing Check (15 min front-running)
// Player's 21:00 departure should be front-run (target is 20:45)
const check2100 = isTripFrontRun(s, 'blr-maa', 21, 0)
console.log('4. Front-Run Check for 21:00 departure:', check2100.frontRun ? `YES (by ${check2100.rivalName} at ${check2100.rivalClock})` : 'NO')
if (!check2100.frontRun) {
  throw new Error('21:00 departure should be front-run by rival 20:45 counter-bus')
}

// Player's 18:00 departure (not scheduled) should NOT be front-run
const check1800 = isTripFrontRun(s, 'blr-maa', 18, 0)
console.log('   Front-Run Check for 18:00 (non-flagship):', check1800.frontRun ? 'YES' : 'NO (Clear slot)')
if (check1800.frontRun) {
  throw new Error('18:00 should not be front-run')
}

// 5. Test Player Strategic Stance Selection
console.log('5. Default stance:', getCorridorStance(s, 'blr-maa'))
setCorridorStance(s, 'blr-maa', 'undercut')
console.log('   Updated stance to undercut:', getCorridorStance(s, 'blr-maa'))
if (getCorridorStance(s, 'blr-maa') !== 'undercut') {
  throw new Error('Stance update failed')
}

setCorridorStance(s, 'blr-maa', 'premium_hold')
console.log('   Updated stance to premium_hold:', getCorridorStance(s, 'blr-maa'))

setCorridorStance(s, 'blr-maa', 'cargo_bundle')
console.log('   Updated stance to cargo_bundle:', getCorridorStance(s, 'blr-maa'))

// 6. Test that no inbox alert spam was generated (user requested silent in background)
const rivalAlerts = s.inbox.filter((m: any) => (m.title ?? m.subject ?? m.text ?? '').includes('Retaliatory'))
console.log('6. Inbox alert notifications count for rival move:', rivalAlerts.length, '(Expected 0)')
if (rivalAlerts.length !== 0) {
  throw new Error('Should not push inbox alert notifications')
}

console.log('ALL RIVAL INTELLIGENCE TESTS PASSED SUCCESSFULLY! ✓')
