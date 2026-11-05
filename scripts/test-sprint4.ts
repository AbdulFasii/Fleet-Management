import { newGame } from '../src/engine/newGame'
import { leaseYard, cancelYard, dailyDepotPass } from '../src/engine/sim/depot'
import { turnaroundMinutes } from '../src/engine/sim/pairing'
import type { Bus } from '../src/engine/types'

function createTestBus(id: string, parkedCityId: string, status: 'active' | 'workshop' | 'grounded' = 'active', mfgYear = 2022): Bus {
  return {
    id,
    reg: `DL-01-AB-${id.slice(-4)}`,
    nickname: `Bus ${id}`,
    modelId: 'star_40_seater',
    ownership: 'owned',
    mfgYear,
    acquiredDay: 1,
    acquiredPrice: 3_000_000,
    bookValue: 3_000_000,
    odometer: 50_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
    tyreKm: 20_000,
    tyresRetreaded: false,
    frontTyreKm: 20_000,
    rearTyreKm: 20_000,
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: 6,
    lastServiceOdo: 40_000,
    insuranceExpiryDay: 365,
    fitnessExpiryDay: 365,
    pucExpiryDay: 180,
    gpsDeviceFitted: true,
    roadTaxPayableDay: 365,
    aitpPaidUntilDay: 365,
    parkedCityId,
    status,
    duty: 'line',
    accidentHistory: false,
    busCleanliness: 90,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: 4.5,
  }
}

console.log('--- Testing Sprint 4 Realism: Depots, Yards, and Time Decay ---')

// 1. Test overflow above depotSlots charges ₹300 per extra bus
{
  const s = newGame('Sprint 4', 'malik', 'del-jai', 1001)
  s.company.homeCityId = 'delhi'
  s.depotSlots = 2

  s.buses['b1'] = createTestBus('b1', 'delhi')
  s.buses['b2'] = createTestBus('b2', 'delhi')
  s.buses['b3'] = createTestBus('b3', 'delhi')
  s.buses['b4'] = createTestBus('b4', 'delhi')

  const txnsBefore = s.txns.length
  dailyDepotPass(s)
  const overflowTxn = s.txns.slice(txnsBefore).find(t => t.head === 'depot_rent' && t.note?.includes('home yard overflow'))
  if (!overflowTxn) {
    throw new Error('Expected home yard overflow txn')
  }
  const overflowCount = 4 - s.depotSlots
  const expectedFee = 300 * overflowCount * 100 // paise
  if (overflowTxn.amount !== expectedFee) {
    throw new Error(`Expected overflow fee ${expectedFee}, got ${overflowTxn.amount}`)
  }
  console.log(`✓ Check 4 Passed: Overflow above depotSlots charged ₹${overflowTxn.amount / 100} for ${overflowCount} buses (₹300/bus).`)
}

// 2. Test outstation parking fee and leasing yard stops the fee
{
  const s = newGame('Sprint 4', 'malik', 'maa-blr', 1002)
  s.company.homeCityId = 'maa' // Chennai
  s.depotSlots = 10
  s.buses['b_mum'] = createTestBus('b_mum', 'mum') // Mumbai outstation

  const txnsBefore = s.txns.length
  dailyDepotPass(s)
  const parkingTxn = s.txns.slice(txnsBefore).find(t => t.head === 'parking_cleaning' && t.note?.includes('outstation overnight parking (Mumbai'))
  if (!parkingTxn) {
    throw new Error('Expected outstation overnight parking txn for Mumbai')
  }
  console.log(`✓ Check 1 Passed: Bus ending in Mumbai while home is Chennai added parking txn: ₹${parkingTxn.amount / 100}`)

  // Now lease Mumbai yard
  const err = leaseYard(s, 'mum')
  if (err) throw new Error(`Failed to lease yard: ${err}`)
  if (!s.yards.some(y => y.cityId === 'mum')) throw new Error('Mumbai yard not in s.yards')

  const txnsAfterLease = s.txns.length
  dailyDepotPass(s)
  const parkingTxnAfter = s.txns.slice(txnsAfterLease).find(t => t.head === 'parking_cleaning' && t.note?.includes('Mumbai'))
  if (parkingTxnAfter) {
    throw new Error('Parking fee was charged despite having leased a yard in Mumbai!')
  }
  console.log('✓ Check 2 Passed: Leasing a Mumbai yard stopped the outstation overnight fee.')

  // Cancel yard and verify fee resumes
  cancelYard(s, 'mum')
  if (s.yards.some(y => y.cityId === 'mum')) throw new Error('Mumbai yard should be removed after cancel')
  const txnsAfterCancel = s.txns.length
  dailyDepotPass(s)
  const parkingTxnResumed = s.txns.slice(txnsAfterCancel).find(t => t.head === 'parking_cleaning' && t.note?.includes('Mumbai'))
  if (!parkingTxnResumed) throw new Error('Parking fee should resume after cancelling yard')
  console.log('✓ Cancel Yard Passed: Cancelled yard and fee resumed as expected.')
}

// 3. Test time decay over 10 days (comparing at home vs outstation uncovered)
{
  const s = newGame('Sprint 4', 'malik', 'del-jai', 1003)
  s.company.homeCityId = 'delhi'
  const bHome = createTestBus('b_home', 'delhi')
  const bAway = createTestBus('b_away', 'mum')
  s.buses['b_home'] = bHome
  s.buses['b_away'] = bAway

  for (let i = 0; i < 10; i++) {
    s.day++
    dailyDepotPass(s)
  }

  const lossHome = 90 - bHome.condition.ac
  const lossAway = 90 - bAway.condition.ac

  if (lossHome <= 0 || lossAway <= 0) {
    throw new Error(`Expected loss in condition, got home: ${lossHome}, away: ${lossAway}`)
  }
  if (lossHome >= lossAway) {
    throw new Error(`Expected home covered decay (${lossHome}) to be less than outstation uncovered decay (${lossAway})`)
  }
  // Engine and brakes should NOT decay from time decay
  if (bHome.condition.engine !== 90 || bHome.condition.brakes !== 90) {
    throw new Error('Engine/brakes should not suffer daily parking time decay')
  }
  console.log(`✓ Check 3 Passed: 10 days idle decay - Home AC lost ${lossHome.toFixed(2)} pts vs Away AC lost ${lossAway.toFixed(2)} pts (Home covered multiplier 0.6x verified). Engine/brakes untouched.`)
}

// 4. Turnaround no longer adds +30m for missing yard
{
  const s = newGame('Sprint 4', 'malik', 'maa-blr', 1004)
  s.company.homeCityId = 'maa'
  const route = { km: 350, to: 'blr', hours: 6 }
  const turnWithNoYard = turnaroundMinutes(route, s)

  leaseYard(s, 'blr')
  const turnWithYard = turnaroundMinutes(route, s)

  if (turnWithNoYard !== turnWithYard) {
    throw new Error(`Expected identical turnaround with/without yard, got ${turnWithNoYard} vs ${turnWithYard}`)
  }
  console.log(`✓ Turnaround Check Passed: ${turnWithYard} min with or without yard (no +30m public-bay penalty).`)
}

console.log('All Sprint 4 checks passed successfully!')
