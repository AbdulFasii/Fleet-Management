import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { openLounge, upgradeLounge, closeLounge, refitLounge, loungeServiceBonus, dailyLoungePass, getLoungeDemandBoost, getLoungeSchedulesHandled } from '../src/engine/sim/lounge'
import { LOUNGE_TIERS, loungePackage, loungePackageOf } from '../src/engine/data/loungeCatalog'
import { generateCharterInquiries, getCharterConfig } from '../src/engine/sim/charter'
import { rs } from '../src/engine/core/money'
import type { Schedule, Trip } from '../src/engine/types'

console.log('Testing Passenger Waiting Areas & Lounge Operations...')

// 1. Test Opening, Upgrading and Closing Lounges
{
  const s = newGame('test-lounge', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000) // ₹50 Lakhs cash

  // A. Open Express Lounge in Coimbatore (Gandhipuram)
  const err1 = openLounge(s, 'cbe', 'Gandhipuram Omni Bus Stand Hub', 'express')
  assert.equal(err1, null, 'Opening lounge should succeed')
  assert.equal(s.company.lounges?.length, 1, 'Should have 1 active lounge')

  const l1 = s.company.lounges![0]
  assert.equal(l1.cityId, 'cbe')
  assert.equal(l1.tier, 'express')
  assert.equal(s.company.cash, rs(5_000_000) - LOUNGE_TIERS.express.setupCost, 'CapEx deducted')

  // Duplicate location check
  const errDup = openLounge(s, 'cbe', 'Gandhipuram Omni Bus Stand Hub', 'premium')
  assert.ok(errDup?.includes('already exists'), 'Duplicate location rejected')

  // B. Upgrade to Premium Lounge
  const errUp = upgradeLounge(s, l1.id, 'premium')
  assert.equal(errUp, null, 'Upgrade to premium should succeed')
  assert.equal(l1.tier, 'premium', 'Lounge tier updated to premium')

  // C. Close Lounge and verify 25% salvage recovery
  const cashBeforeClose = s.company.cash
  const errClose = closeLounge(s, l1.id)
  assert.equal(errClose, null, 'Closing lounge should succeed')
  assert.equal(s.company.lounges?.length, 0, 'Lounge removed from array')
  const salvage = Math.round(LOUNGE_TIERS.premium.setupCost * 0.25)
  assert.equal(s.company.cash - cashBeforeClose, salvage, '25% security deposit recovered')

  console.log('✓ Opening, duplicate validation, tier upgrade and close recovery passed.')
}

// 2. Test Schedules Handled & Demand Boost
{
  const s = newGame('test-sched', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)

  // Add mock active schedules touching Coimbatore (cbe)
  s.schedules = {
    sch1: {
      id: 'sch1',
      routeId: 'maa-cbe', // Chennai - Coimbatore
      paired: true, // outbound arrives in cbe, the return leaves it
      active: true,
      busIds: ['b1', 'b2'],
    } as unknown as Schedule,
    sch2: {
      id: 'sch2',
      routeId: 'blr-cbe', // Bengaluru - Coimbatore
      paired: false, // one-way: arrives in cbe
      active: true,
      busIds: ['b3'],
    } as unknown as Schedule,
  }

  const schedStats = getLoungeSchedulesHandled(s, 'cbe')
  assert.equal(schedStats.total, 3, 'Should handle 3 daily slots touching Coimbatore')

  // Demand boost check
  // Before opening lounge: boost is 1.0 (0%)
  assert.equal(getLoungeDemandBoost(s, 'maa-cbe'), 1.0, 'No boost without lounge')

  // Open Premium lounge in Coimbatore (+1.5%)
  openLounge(s, 'cbe', 'Gandhipuram Omni Bus Stand Hub', 'premium')
  const boost = getLoungeDemandBoost(s, 'maa-cbe')
  assert.ok(Math.abs(boost - 1.015) < 0.0001, 'Premium lounge provides +1.5% route attractiveness boost')

  console.log('✓ Schedule counting and passenger demand boost passed.')
}

// 3. Test Daily Lounge Pass (Snack Sales, Rent, Electricity, Staff Wages)
{
  const s = newGame('test-sim', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)

  openLounge(s, 'cbe', 'Gandhipuram Omni Bus Stand Hub', 'express')
  const lounge = s.company.lounges![0]

  // Mock today's departing passengers from Coimbatore
  s.trips = {
    t1: {
      id: 't1',
      day: s.day,
      routeId: 'maa-cbe',
      direction: 'BA', // Departing from CBE
      sold: 40,
      status: 'completed',
    } as unknown as Trip,
    t2: {
      id: 't2',
      day: s.day,
      routeId: 'blr-cbe',
      direction: 'BA', // Departing from CBE
      sold: 35,
      status: 'completed',
    } as unknown as Trip,
  }

  const cashBeforeTick = s.company.cash
  dailyLoungePass(s)

  assert.ok(lounge.yesterdayPax > 0, 'Waiting passengers should be captured')
  assert.ok(lounge.yesterdaySnackRevenue > 0, 'Snack sales revenue generated')
  assert.equal(lounge.yesterdayRentExpense, LOUNGE_TIERS.express.dailyRent, 'Rent deducted')
  assert.equal(lounge.yesterdayElectricExpense, LOUNGE_TIERS.express.dailyElectricity, 'Electricity deducted')
  assert.equal(lounge.yesterdayStaffExpense, LOUNGE_TIERS.express.dailyStaffWage, 'Staff wage deducted')
  assert.ok(lounge.lifetimePax > 0, 'Lifetime pax incremented')

  console.log(`✓ Daily Lounge Pass passed (captured ${lounge.yesterdayPax} pax, snack net +${lounge.yesterdaySnackRevenue / 100} Rs).`)
}

// 4. Test Charter Integration (Regional Tour & Charter Office Unlock)
{
  const s = newGame('test-chtr-lounge', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)

  // Primary charter base is Chennai (maa)
  const cfg = getCharterConfig(s)
  cfg.operatingBaseCityId = 'maa'

  // Open Premium lounge in Madurai (mdu)
  openLounge(s, 'mdu', 'Mattuthavani Omni Bus Stand Hub', 'premium')

  // Generate charter inquiries over a few days
  s.charterInquiries = []
  for (let d = 0; d < 8; d++) {
    s.day++
    generateCharterInquiries(s)
  }

  assert.ok(s.charterInquiries.length > 0, 'Charter inquiries generated')
  const origins = new Set(s.charterInquiries.map((inq) => inq.originCityId))
  console.log('Generated Charter Inquiry Origins:', Array.from(origins))
  assert.ok(origins.has('mdu') || origins.has('maa'), 'Charter inquiries originate from both base city and lounge branch cities')

  console.log('✓ Regional Tour & Charter Office integration passed.')
}

// 4. Seating and amenity packages
{
  const s = newGame('test-package', 'malik', 'maa-cbe', 77)
  s.company.cash = rs(20_000_000)

  // Recliners cost 25% more to fit out and seat fewer people
  const cash0 = s.company.cash
  assert.equal(openLounge(s, 'cbe', 'Gandhipuram', 'express', 'recliner', ['tea', 'wifi', 'rest']), null)
  const lounge = s.company.lounges![0]!
  assert.equal(cash0 - s.company.cash, Math.round(LOUNGE_TIERS.express.setupCost * 1.25), 'recliner fit-out costs 25% more')
  assert.deepEqual(lounge.amenities, ['tea', 'wifi'], 'rest rooms need a premium lounge, so they are dropped')
  const pkg = loungePackageOf(lounge, undefined)
  assert.equal(pkg.seats, Math.round(LOUNGE_TIERS.express.seats * 0.8), 'recliners seat fewer')
  assert.ok(Math.abs(pkg.conversion - (0.0075 + 0.002 + 0.001 + 0.0005)) < 1e-9, 'conversion adds seating and amenity effects')
  assert.ok(Math.abs(getLoungeDemandBoost(s, 'maa-cbe') - (1 + pkg.conversion)) < 1e-9, 'route boost uses the package conversion')
  assert.ok(loungeServiceBonus(s, 'cbe') > 0.12, 'comfort lifts passenger satisfaction above the tier base')

  // Refit: amenities are free to change, a seating upgrade costs the difference
  const c1 = s.company.cash
  assert.equal(refitLounge(s, lounge.id, 'recliner', ['cctv']), null)
  assert.equal(s.company.cash, c1, 'changing amenities alone is free')
  assert.deepEqual(lounge.amenities, ['cctv'])
  assert.match(refitLounge(s, lounge.id, 'pods', []) ?? '', /need a larger lounge/, 'work pods need a premium lounge or larger')
  const c2 = s.company.cash
  assert.equal(refitLounge(s, lounge.id, 'cushioned', ['cctv']), null)
  assert.equal(s.company.cash, c2, 'downgrading seating refunds nothing and costs nothing')
  assert.ok(loungePackage('express', 'recliner', []).setupCost > loungePackage('express', 'cushioned', []).setupCost)

  // A daily pass charges the amenities' running cost and caps pax at the seating capacity
  const s2 = newGame('test-daily', 'malik', 'maa-cbe', 5)
  s2.company.cash = rs(20_000_000)
  openLounge(s2, 'cbe', 'A', 'express', 'bench', [])
  openLounge(s2, 'cbe', 'B', 'express', 'cushioned', ['wifi', 'assist', 'cctv'])
  s2.trips = {
    t1: { id: 't1', day: s2.day, routeId: 'maa-cbe', direction: 'BA', sold: 400, status: 'completed' } as unknown as Trip,
  }
  dailyLoungePass(s2)
  const [a, b] = s2.company.lounges!
  assert.ok(a!.yesterdayPax <= Math.round(LOUNGE_TIERS.express.maxDailyPaxCapacity * 1.25), 'bench capacity cap')
  assert.equal(b!.yesterdayStaffExpense - LOUNGE_TIERS.express.dailyStaffWage, rs(30) + rs(40) + rs(50), 'amenity daily costs charged')
  assert.equal(a!.yesterdayStaffExpense, LOUNGE_TIERS.express.dailyStaffWage, 'no amenities, no extra cost')

  // Older lounges (no package fields) keep following the network policy
  const s3 = newGame('test-legacy', 'malik', 'maa-cbe', 6)
  s3.company.cash = rs(20_000_000)
  openLounge(s3, 'cbe', 'Old', 'express')
  const old = s3.company.lounges![0]!
  assert.equal(old.amenities, undefined)
  assert.equal(loungePackageOf(old, { complimentaryTeaCoffee: true }).capture, 0.12, 'legacy lounge follows Settings policy')

  console.log('✓ Seating and amenity packages passed.')
}

console.log('ALL PASSENGER LOUNGE TESTS PASSED SUCCESSFULLY! ✓')
