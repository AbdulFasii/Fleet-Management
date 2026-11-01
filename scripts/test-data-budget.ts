/**
 * Data-budget checks: a long game must keep a flat working set.
 *
 *   npx tsx scripts/test-data-budget.ts
 *
 * Every list that grows with the calendar has an explicit cap, and the two
 * high-volume postings (ticket batches, channel settlements) fold into one row
 * per day/channel. This guards the retention pass against regressions, which
 * otherwise show up as a browser out-of-memory crash five years into a game.
 */
import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { retainDay, stateFootprint } from '../src/engine/sim/retain'
import { pushTxn, earn, settleReceivables } from '../src/engine/sim/finance'
import { BAL } from '../src/engine/data/balance'
import type { Txn, Trip } from '../src/engine/types'

const s = newGame('Budget Co', 'malik', 'maa-mdu', 99)
s.company.cash = 10_000_000_000

let checks = 0
function check(cond: boolean, label: string): void {
  assert.ok(cond, label)
  checks++
  console.log(`  ✓ ${label}`)
}

// ---------- ledger folding ----------
console.log('\n[1] Ticket batches fold, expense rows do not')
{
  const before = s.txns.length
  for (let i = 0; i < 500; i++) {
    earn(s, 'ticket', 10_000, { busId: 'foldbus', routeId: 'maa-mdu' }, 0, 'counter')
  }
  const ticketRows = s.txns.slice(before).filter((t) => t.head === 'ticket')
  check(ticketRows.length === 1, `500 ticket postings kept as 1 ledger row (got ${ticketRows.length})`)
  check(ticketRows[0]!.amount === 5_000_000, 'folded row keeps the full amount')
  check(ticketRows[0]!.count === 500, 'folded row counts its postings')

  const beforePark = s.txns.length
  for (let i = 0; i < 3; i++) {
    pushTxn(s, { day: s.day, head: 'parking_cleaning', kind: 'expense', amount: 500, note: `outstation overnight parking (Mumbai)`, busId: 'foldbus' })
  }
  check(s.txns.length - beforePark === 3, 'expense rows never fold (audit trail intact)')
}

// ---------- receivables folding ----------
console.log('\n[2] Channel settlements fold per settle day')
{
  const before = s.receivables.length
  for (let i = 0; i < 100; i++) {
    earn(s, 'ticket', 25_000, { busId: 'foldbus', routeId: 'maa-mdu' }, 3, 'redbus')
  }
  const added = s.receivables.slice(before)
  check(added.length === 1, `100 RedBus batches queued as 1 settlement row (got ${added.length})`)
  check(added[0]!.amount === 2_500_000, 'settlement row carries the full gross')
  const cashBefore = s.company.cash
  s.day = added[0]!.settleDay
  const settled = settleReceivables(s)
  check(settled >= 2_500_000 && s.company.cash === cashBefore + settled, 'settlement still credits the treasury in full')
}

// ---------- artificial bloat, then one retention pass ----------
console.log('\n[3] Retention caps every calendar-growing list')
{
  for (let i = 0; i < 9_000; i++) {
    s.txns.push({ id: `t${i}`, day: s.day - (i % 40), head: 'fuel', kind: 'expense', amount: 100 } as Txn)
  }
  for (let i = 0; i < 900; i++) s.kpis.push({ day: s.day - i, revenue: 0, cost: 0, profit: 0, loadFactor: 0, pax: 0 } as never)
  for (let i = 0; i < 300; i++) s.inbox.push({ id: `m${i}`, day: s.day, cat: 'info', text: 'x', read: true })
  for (let i = 0; i < 90; i++) {
    s.monthly.push({
      ym: `2020-${String((i % 12) + 1).padStart(2, '0')}`, revenue: 0, profit: 0, loadFactor: 0,
      revenueTotal: 0, expenseTotal: 0, paxKm: 0, seatKm: 0, trips: 0,
      income: {}, expense: {},
    } as never)
  }
  for (let i = 0; i < 120; i++) {
    s.insuranceClaims.push({ id: `c${i}`, busId: 'foldbus', filedDay: s.day - 400, surveyorUntilDay: s.day - 390, repairEstimate: 100, status: 'settled' })
  }
  s.company.grievances = Array.from({ length: 150 }, (_, i) => ({
    id: `g${i}`, day: s.day - (i % 90), busId: 'foldbus', routeId: 'maa-mdu', cause: 'delay', status: i < 3 ? 'open' : 'refunded', amount: 100,
  })) as never
  s.usedMarket.push({ id: 'expired', reg: 'TN 00 XX 0000', modelId: 'cheetah', ageYears: 9, odometer: 1, askPrice: 1, expiresDay: s.day - 1, condition: {} as never, accidentHistory: false, inspected: false, sellerNote: '' })
  s.leaseOffers.push({ id: 'expired', modelId: 'cheetah', monthlyRent: 1, depositMonths: 1, minMonths: 1, ageYears: 9, odometer: 1, expiresDay: s.day - 1 })
  s.world.demandShock['maa-mdu'] = { mult: 1.2, untilDay: s.day - 1, reason: 'old' }
  const openTrip = Object.values(s.trips)[0]
  if (openTrip) {
    openTrip.seats = openTrip.seats.map((seat) => ({ ...seat }))
  }
  s.trips['beyond-window'] = {
    id: 'beyond-window', scheduleId: 'none', routeId: 'maa-mdu', direction: 'AB', busId: 'foldbus',
    day: s.day + BAL.bookingWindowDays + 90, depHour: 20, fare: 1, seats: [], seatCount: 0,
    sold: 0, revenue: 0, cancelledRevenue: 0, channelSold: {} as never, status: 'open',
  } as Trip
  s.trips['old-finished'] = {
    id: 'old-finished', scheduleId: 'none', routeId: 'maa-mdu', direction: 'AB', busId: 'foldbus',
    day: s.day - 40, depHour: 20, fare: 1, seats: [{ id: '1A', mult: 1, ladies: false }], seatCount: 1,
    sold: 0, revenue: 0, cancelledRevenue: 0, channelSold: {} as never, status: 'completed',
  } as Trip

  retainDay(s)

  check(s.txns.length <= BAL.txnMaxCount, `ledger capped at ${BAL.txnMaxCount} (now ${s.txns.length})`)
  check(s.kpis.length <= BAL.kpiHistoryDays, `KPI strip capped at ${BAL.kpiHistoryDays} days (now ${s.kpis.length})`)
  check(s.inbox.length <= BAL.inboxKeep, `inbox capped at ${BAL.inboxKeep} (now ${s.inbox.length})`)
  check(s.monthly.length <= BAL.monthlyKeep, `month summaries capped at ${BAL.monthlyKeep} (now ${s.monthly.length})`)
  check(s.insuranceClaims.length <= BAL.insuranceClaimKeep, `claims capped at ${BAL.insuranceClaimKeep} (now ${s.insuranceClaims.length})`)
  check(s.company.grievances!.length <= 60, `grievance queue trimmed to open + recent (now ${s.company.grievances!.length})`)
  check(!s.usedMarket.some((l) => l.expiresDay < s.day), 'expired used listings dropped')
  check(!s.leaseOffers.some((o) => o.expiresDay < s.day), 'expired lease offers dropped')
  check(!s.world.demandShock['maa-mdu'], 'expired demand shock dropped')
  check(!s.trips['beyond-window'], 'open trips outside the sale window dropped')
  check(!s.trips['old-finished'], 'finished trips past the keep window dropped')

  const foot = stateFootprint(s)
  check(foot.tripSeats === 0 || foot.tripSeats > 0, 'footprint reports seat maps')
  console.log(`    footprint: ${foot.trips} trips · ${foot.tripSeats} seats · ${foot.txns} ledger rows · ${foot.routeDays} route-days`)
  check(foot.totalRows < 9_000, `working set stays under 9k rows (now ${foot.totalRows})`)
}

console.log(`\n🎉 ALL ${checks} DATA-BUDGET CHECKS PASSED`)
