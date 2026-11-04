import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { dailyStaffPass, monthlyStaffPass } from '../src/engine/sim/staffing'
import { rs } from '../src/engine/core/money'
import type { Staff } from '../src/engine/types'

console.log('Testing Driver Morale, Crew Quarters & Union Strikes...')

// 1. Test Driver Dormitory Tiers
{
  const s = newGame('test-dorm', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)

  // Clear existing staff and add controlled drivers
  s.staff = {}

  const d1: Staff = {
    id: 'drv1',
    name: 'Murugan',
    role: 'driver',
    salary: rs(22_000),
    skill: 7,
    fatigue: 85,
    morale: 70,
    loyalty: 60,
    lastPaidDay: s.day,
    lastTripDay: s.day, // Drove today
  }
  const d2: Staff = {
    id: 'drv2',
    name: 'Senthil',
    role: 'driver',
    salary: rs(22_000),
    skill: 7,
    fatigue: 60,
    morale: 70,
    loyalty: 60,
    lastPaidDay: s.day,
    lastTripDay: s.day - 1, // Resting today
  }

  s.staff[d1.id] = { ...d1 }
  s.staff[d2.id] = { ...d2 }

  // Case A: dormTier = 'none'
  s.config = { ...s.config, driverDormitoryTier: 'none' }
  dailyStaffPass(s)

  assert.equal(s.staff['drv1'].morale, 67, 'Without dorm bunks, 85+ fatigue on duty day burns out morale (-3)')
  assert.equal(s.staff['drv1'].fatigue, 85, 'Without dorm bunks, no layover relief (fatigue remains 85)')
  assert.equal(s.staff['drv2'].fatigue, 0, 'Rest day fully discharges 60 fatigue to 0')

  // Case B: dormTier = 'basic'
  s.staff['drv1'] = { ...d1, fatigue: 90, morale: 70 }
  s.staff['drv2'] = { ...d2, fatigue: 105, morale: 70 }
  s.config.driverDormitoryTier = 'basic'
  const cashBeforeBasic = s.company.cash
  dailyStaffPass(s)

  assert.equal(s.staff['drv1'].fatigue, 82, 'Basic bunks provide 8 layover relief on duty day (90 - 8 = 82)')
  assert.equal(s.staff['drv1'].morale, 69, 'With basic depot bunks, burnout is buffered to only -1')
  assert.equal(s.staff['drv2'].fatigue, 0, 'Basic bunks recover 100+10 fatigue (105 - 110 <= 0)')
  assert.equal(s.staff['drv2'].morale, 71, 'Resting in depot bunks gives +1 morale daily')
  assert.equal(cashBeforeBasic - s.company.cash, rs(24), 'Basic bunks cost ₹12/crew/day (2 crew × 12 = 24)')

  // Case C: dormTier = 'ac_canteen'
  s.staff['drv1'] = { ...d1, fatigue: 95, morale: 70 }
  s.staff['drv2'] = { ...d2, fatigue: 60, morale: 70 }
  s.config.driverDormitoryTier = 'ac_canteen'
  const cashBeforeAc = s.company.cash
  dailyStaffPass(s)

  assert.equal(s.staff['drv1'].fatigue, 80, 'AC bunks provide 15 layover relief on duty day (95 - 15 = 80)')
  assert.equal(s.staff['drv1'].morale, 70, 'Executive AC bunks give complete burnout immunity on heavy shifts')
  assert.equal(s.staff['drv2'].morale, 72, 'Resting in executive bunks gives +2 morale daily')
  assert.equal(cashBeforeAc - s.company.cash, rs(50), 'AC bunks cost ₹25/crew/day (2 crew × 25 = 50)')

  console.log('✓ Driver Dormitory Tiers passed (burnout immunity, accelerated recovery, daily costs).')
}

// 2. Test Festival Bonus Policy Tiers
{
  const s = newGame('test-fest', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)
  s.staff = {
    drv1: { id: 'drv1', name: 'Raju', role: 'driver', salary: rs(20_000), skill: 6, morale: 60, loyalty: 50 },
    drv2: { id: 'drv2', name: 'Mani', role: 'driver', salary: rs(20_000), skill: 6, morale: 60, loyalty: 50 },
  }

  // Set day to exactly 7 days before Diwali (Diwali is month 11, day 12 -> day 316)
  // Let's compute day 7 days before Diwali
  // In calendar.ts, month 11 day 12
  const diwaliMonth = 11
  const diwaliDay = 12
  // We can locate festival from FESTIVALS
  const { FESTIVALS, fromCivil, toCivil } = await import('../src/engine/core/calendar')
  const f = FESTIVALS.find(x => x.name.toLowerCase().includes('diwali'))!
  const civ = toCivil(s.day)
  const festDay = fromCivil(civ.y, f.month, f.day)
  s.day = festDay - 7

  // Test Tier: 'full'
  s.config = { ...s.config, festivalBonusTier: 'full' }
  const cashBefore = s.company.cash
  dailyStaffPass(s)

  assert.equal(s.staff['drv1'].morale, 80, 'Full bonus grants +20 morale')
  assert.equal(s.staff['drv1'].loyalty, 60, 'Full bonus grants +10 loyalty')
  assert.equal(cashBefore - s.company.cash, rs(40_000), 'Full bonus pays 100% payroll (2 × 20k = 40k)')

  // Reset decision year
  s.company.festivalBonusDecidedYear = undefined
  s.staff['drv1'].morale = 60
  s.staff['drv1'].loyalty = 50

  // Test Tier: 'skip'
  s.config.festivalBonusTier = 'skip'
  dailyStaffPass(s)

  assert.equal(s.staff['drv1'].morale, 45, 'Skipped bonus reduces morale by 15')
  assert.equal(s.staff['drv1'].loyalty, 45, 'Skipped bonus reduces loyalty by 5')

  console.log('✓ Festival Bonus Policy Tiers passed (full, skip, morale & loyalty impacts).')
}

// 3. Test Strike Mitigation with AC Dormitories
{
  const s = newGame('test-strike', 'malik', 'maa-cbe', 42)
  s.company.cash = rs(5_000_000)
  s.staff = {
    drv1: { id: 'drv1', name: 'Raju', role: 'driver', salary: 20_000, skill: 6, morale: 28, loyalty: 20 },
    drv2: { id: 'drv2', name: 'Mani', role: 'driver', salary: 20_000, skill: 6, morale: 28, loyalty: 20 },
  }

  // Baseline threshold is BAL.strikeMoraleThreshold = 35.
  // With morale 28:
  // Under 'none': 28 < 35 triggers strike risk.
  // Under 'ac_canteen': threshold is lowered to 22. 28 >= 22 does NOT trigger strike!
  s.config = { ...s.config, driverDormitoryTier: 'ac_canteen' }
  s.world.strikeUntilDay = 0
  monthlyStaffPass(s)

  assert.ok(s.world.strikeUntilDay < s.day, 'With executive AC canteen dormitories, strike is prevented at 28% morale (threshold lowered to 22%)')

  console.log('✓ Union Strike Mitigation with Dormitories passed.')
}

console.log('ALL DRIVER MORALE & WELFARE TESTS PASSED SUCCESSFULLY!')
