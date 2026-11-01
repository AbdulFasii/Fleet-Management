import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips, processCancellations, cancelTrip } from '../src/engine/sim/booking'
import { resolveGrievance, dailyCrmPass } from '../src/engine/sim/crm'
import { getMonthlyRefundBreakdown } from '../src/engine/sim/finance'
import { rs } from '../src/engine/core/money'
import { BAL } from '../src/engine/data/balance'
import type { Grievance } from '../src/engine/types'

function runTests() {
  console.log('=== TEST: Money Tab Refund Breakdown ===')

  const s = newGame('test-refunds', 'malik', 'maa-mdu', 42)
  s.day = 10

  const bus = {
    id: 'b1',
    reg: 'TN 01 AB 9999',
    modelId: 'cheetah',
    ownership: 'owned' as const,
    status: 'active' as const,
    condition: { body: 90, ac: 90, electrical: 90, engine: 90, tyres: 90, gearbox: 90 },
    odoKm: 10000,
    purchasedDay: 1,
    insuranceExpiryDay: 100,
    fitnessExpiryDay: 100,
    fitnessFailed: false,
    pucExpiryDay: 100,
  }
  s.buses['b1'] = bus

  // 1. Setup schedule and generate trips with bookings
  const res = createSchedule(s, {
    routeId: 'maa-mdu',
    depHour: 21,
    depMin: 0,
    baseFare: 500,
  })
  if ('error' in res) throw new Error(res.error)
  assignBus(s, res.id, bus.id)
  generateTrips(s)

  const trip = Object.values(s.trips).find((t) => t.scheduleId === res.id && t.day === 11)!
  // Manually sell 20 seats on trip at ₹500 each = ₹10,000
  for (let i = 0; i < 20; i++) {
    trip.seats[i].sale = {
      price: rs(500),
      channel: 'counter',
      day: 10,
    }
  }
  trip.sold = 20
  trip.revenue = rs(10000)
  trip.channelSold.counter = 20

  // 2. Test Passenger Cancellation Refund
  // Set flexible policy and force cancellation rate high for test
  s.schedules[res.id].cancellation = 'flexible'
  const origRate = BAL.dailyCancelRate
  BAL.dailyCancelRate = 0.25
  processCancellations(s, trip)
  BAL.dailyCancelRate = origRate

  const bd1 = getMonthlyRefundBreakdown(s, s.curMonth)
  console.log(`Check 1: Passenger cancellation refund:`)
  console.log(`  passenger: ₹${bd1.passenger}, crm: ₹${bd1.crm}, busCancel: ₹${bd1.busCancel}`)
  console.log(`  total expense.refund: ₹${s.curMonth.expense.refund ?? 0}`)
  if (bd1.passenger <= 0) throw new Error('Expected positive passenger cancellation refund')
  if ((s.curMonth.expense.refund ?? 0) !== bd1.passenger) throw new Error('expense.refund should equal passenger refund')

  // 3. Test CRM Refund
  // Appoint CRM manager
  s.staff['mgr_crm'] = {
    id: 'mgr_crm',
    name: 'Jagdish Fernandes',
    role: 'manager',
    wage: 35000,
    skill: 7,
    fatigue: 0,
    hiredDay: 1,
    happiness: 95,
  }
  s.company.crmId = 'mgr_crm'
  s.company.crmPolicy = 'suggest_refund'

  // Add grievances
  const grv1: Grievance = {
    id: 'grv_1',
    day: 10,
    tripId: trip.id,
    busId: bus.id,
    routeId: 'maa-mdu',
    passengerName: 'Karthik',
    cause: 'ac_failure',
    rating: 2,
    status: 'open',
    amount: rs(400),
  }
  const grv2: Grievance = {
    id: 'grv_2',
    day: 10,
    tripId: trip.id,
    busId: bus.id,
    routeId: 'maa-mdu',
    passengerName: 'Ananya',
    cause: 'delay',
    rating: 2,
    status: 'open',
    amount: rs(300),
  }
  s.company.grievances = [grv1, grv2]
  s.company.grievanceCount = 2

  // Run dailyCrmPass (auto-refunds under 'suggest_refund')
  dailyCrmPass(s)

  const bd2 = getMonthlyRefundBreakdown(s, s.curMonth)
  console.log(`Check 2: After CRM auto-refunds:`)
  console.log(`  passenger: ₹${bd2.passenger}, crm: ₹${bd2.crm}, busCancel: ₹${bd2.busCancel}`)
  console.log(`  CRM refund total on company: ₹${s.company.crmRefundTotal}, count: ${s.company.crmRefundCount}`)
  if (bd2.crm !== rs(700)) throw new Error(`Expected CRM refund to be ₹700, got ${bd2.crm}`)
  if (s.company.crmRefundTotal !== rs(700)) throw new Error(`Expected company.crmRefundTotal == 70000, got ${s.company.crmRefundTotal}`)
  if (s.company.crmRefundCount !== 2) throw new Error(`Expected company.crmRefundCount == 2, got ${s.company.crmRefundCount}`)

  // 4. Test Operator Bus / Trip Cancellation Refund
  // Cancel the rest of the trip
  const seatsRemaining = trip.sold
  cancelTrip(s, trip.id, 'breakdown')

  const bd3 = getMonthlyRefundBreakdown(s, s.curMonth)
  console.log(`Check 3: After Bus Cancellation:`)
  console.log(`  passenger: ₹${bd3.passenger / 100}, crm: ₹${bd3.crm / 100}, busCancel: ₹${bd3.busCancel / 100}`)
  console.log(`  total expense.refund: ₹${(s.curMonth.expense.refund ?? 0) / 100}`)
  const expectedBusCancel = seatsRemaining * rs(500)
  if (bd3.busCancel !== expectedBusCancel) throw new Error(`Expected busCancel == ${expectedBusCancel}, got ${bd3.busCancel}`)

  const totalSum = bd3.passenger + bd3.crm + bd3.busCancel
  if ((s.curMonth.expense.refund ?? 0) !== totalSum) {
    throw new Error(`Total sum (${totalSum}) does not match expense.refund (${s.curMonth.expense.refund})`)
  }

  // 5. Verify ledger transactions have refundCategory
  const refundTxns = s.txns.filter((t) => t.head === 'refund')
  console.log(`Check 4: Ledger refund transactions count: ${refundTxns.length}`)
  const categories = refundTxns.map((t) => t.refundCategory)
  console.log(`  categories found: ${categories.join(', ')}`)
  if (!categories.includes('passenger')) throw new Error('Missing passenger refund category in txns')
  if (!categories.includes('crm')) throw new Error('Missing crm refund category in txns')
  if (!categories.includes('busCancel')) throw new Error('Missing busCancel refund category in txns')

  console.log('ALL MONEY REFUND BREAKDOWN CHECKS PASSED!')
}

runTests()
