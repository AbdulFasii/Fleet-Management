import { newGame } from '../src/engine/newGame'
import { applyForPermit, applySeasonalPermit, renewSeasonalPermit, withdrawSeasonalPermit, permitPass, createSchedule } from '../src/engine/sim/schedules'
import { isScheduleFestivalOpen, isFestivalDay } from '../src/engine/sim/festival'
import { fromCivil } from '../src/engine/core/calendar'
import { BAL } from '../src/engine/data/balance'

console.log('--- Testing Unified Seasonal Permit & Schedules ---')

const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)
const routeId = 'blr-maa'
s.permits[routeId] = {
  routeId,
  status: 'active',
  appliedDay: s.day - 30,
  expiryDay: s.day + 335,
}

// 3. Apply seasonal permit WITHOUT seasonId argument
console.log('\n[Check 1] Apply unified seasonal permit without seasonId argument...')
const applyErr = applySeasonalPermit(s, routeId)
if (applyErr) throw new Error(`applySeasonalPermit failed: ${applyErr}`)
if (s.permits[routeId]!.seasonal?.status !== 'applied') throw new Error('Status not applied')
console.log('✓ Successfully applied for seasonal permit without seasonId')

// Test withdrawal
const withdrawErr = withdrawSeasonalPermit(s, routeId)
if (withdrawErr || s.permits[routeId]!.seasonal) throw new Error('Withdrawal failed')
console.log('✓ Successfully withdrew pending seasonal permit')

// Re-apply and activate
applySeasonalPermit(s, routeId)
s.permits[routeId]!.seasonal!.status = 'active'
s.permits[routeId]!.seasonal!.expiryDay = s.day + 180

// 4. Create a seasonal schedule
console.log('\n[Check 2] Create a seasonal schedule on the permitted route...')
const schRes = createSchedule(s, {
  routeId,
  depHour: 21,
  baseFare: 80_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  outboundDuty: 'festival',
  returnDuty: 'festival',
  paired: true,
  returnDepHour: 15,
})
if ('error' in schRes) throw new Error(`createSchedule failed: ${schRes.error}`)
const sch = s.schedules[schRes.id]!
console.log('✓ Seasonal schedule created:', sch.id)

// 5. Test running across ALL festivals throughout the year
console.log('\n[Check 3] Verifying seasonal schedule runs on ALL festivals across the entire calendar...')
const testFestivals = [
  { name: 'Republic Day', month: 1, day: 26 },
  { name: 'Holi', month: 3, day: 14 },
  { name: 'Ugadi', month: 4, day: 9 },
  { name: 'Independence Day', month: 8, day: 15 },
  { name: 'Onam', month: 9, day: 5 },
  { name: 'Pooja Holidays', month: 10, day: 15 },
  { name: 'Diwali', month: 11, day: 1 },
  { name: 'Christmas', month: 12, day: 28 },
]

for (const fest of testFestivals) {
  const festDay = fromCivil(2025, fest.month, fest.day)
  s.day = festDay
  // ensure permit is active on this day
  s.permits[routeId]!.seasonal!.expiryDay = festDay + 100
  if (!isFestivalDay(festDay)) {
    throw new Error(`Expected ${fest.name} to be festival day`)
  }
  const isOpen = isScheduleFestivalOpen(s, sch)
  if (!isOpen) {
    throw new Error(`Seasonal schedule failed to open on ${fest.name} (day ${festDay})`)
  }
  console.log(`  ✓ Open on ${fest.name} (${fest.day}/${fest.month})`)
}

// 6. Test that it does NOT run on ordinary non-festival days
console.log('\n[Check 4] Verifying seasonal schedule does NOT run on ordinary non-festival days...')
const nonFestDays = [
  fromCivil(2025, 2, 10),
  fromCivil(2025, 5, 20),
  fromCivil(2025, 7, 10),
  fromCivil(2025, 11, 20),
]
for (const d of nonFestDays) {
  s.day = d
  s.permits[routeId]!.seasonal!.expiryDay = d + 100
  const isOpen = isScheduleFestivalOpen(s, sch)
  if (isOpen) {
    throw new Error(`Seasonal schedule opened on non-festival day ${d}`)
  }
}
console.log('✓ Seasonal schedule is closed on all non-festival days')

// 7. Test renewal
console.log('\n[Check 5] Renew seasonal permit...')
s.day = fromCivil(2025, 5, 1)
s.permits[routeId]!.seasonal!.status = 'expired'
s.permits[routeId]!.seasonal!.expiryDay = s.day - 2
const renewErr = renewSeasonalPermit(s, routeId)
if (renewErr) throw new Error(`Renew error: ${renewErr}`)
if (s.permits[routeId]!.seasonal!.status !== 'active') throw new Error('Renew did not activate')
if (s.permits[routeId]!.seasonal!.expiryDay !== s.day + 180) throw new Error('Expiry not set to +180 days')
console.log(`✓ Seasonal permit successfully renewed until Day ${s.permits[routeId]!.seasonal!.expiryDay}`)

console.log('\n--- ALL UNIFIED SEASONAL PERMIT & SCHEDULE CHECKS PASSED! ---')
