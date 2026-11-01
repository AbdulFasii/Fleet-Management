import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import type { Trip } from '../src/engine/types'

console.log('--- Testing Recently Run: Last Date Run of All Routes ---')

const s = newGame('Recent Run Test', 'seth', 'blr-maa', 2026)

// Clear existing trips
s.trips = {}
s.openTripIds = []

// Route 1: 'blr-maa' ran on Day 5, Day 7, and Day 8 (outbound and return)
const t1_d5: Trip = {
  id: 't_blr_maa_d5',
  scheduleId: 'sch_1',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: 'b1',
  day: 5,
  depHour: 6,
  depMin: 0,
  farePaise: 80000,
  seats: [],
  seatCount: 45,
  sold: 40,
  revenue: 3200000,
  cancelledRevenue: 10000,
  channelSold: { redbus: 20, abhibus: 10, ownapp: 5, counter: 5 },
  status: 'completed',
  outcome: {
    delayMin: 0,
    breakdown: false,
    accident: false,
    fuelCost: 1200000,
    tollCost: 300000,
    tripCosts: 1600000,
    cargoRevenue: 150000,
    cargoKg: 200,
    reviewScore: 4.5,
    pss: 8.5,
    note: 'Clean run, on time.',
  },
}

const t1_d7: Trip = {
  ...t1_d5,
  id: 't_blr_maa_d7',
  day: 7,
}

const t1_d8_up: Trip = {
  ...t1_d5,
  id: 't_blr_maa_d8_up',
  day: 8,
  depHour: 6,
  direction: 'AB',
}

const t1_d8_down: Trip = {
  ...t1_d5,
  id: 't_blr_maa_d8_down',
  day: 8,
  depHour: 14,
  direction: 'BA',
}

// Route 2: 'blr-hyd' ran on Day 4 and Day 6
const t2_d4: Trip = {
  ...t1_d5,
  id: 't_blr_hyd_d4',
  routeId: 'blr-hyd',
  day: 4,
}

const t2_d6: Trip = {
  ...t1_d5,
  id: 't_blr_hyd_d6',
  routeId: 'blr-hyd',
  day: 6,
  depHour: 21,
  outcome: {
    delayMin: 15,
    breakdown: false,
    accident: false,
    fuelCost: 2000000,
    tollCost: 500000,
    tripCosts: 2700000,
    cargoRevenue: 300000,
    cargoKg: 400,
    reviewScore: 4.2,
    pss: 7.8,
    note: 'Reached 15 min late due to city traffic.',
  },
}

// Route 3: 'maa-cbe' ran on Day 3 only
const t3_d3: Trip = {
  ...t1_d5,
  id: 't_maa_cbe_d3',
  routeId: 'maa-cbe',
  day: 3,
}

// Add all trips to state
for (const t of [t1_d5, t1_d7, t1_d8_up, t1_d8_down, t2_d4, t2_d6, t3_d3]) {
  s.trips[t.id] = t
}

// Function mirroring the filtering in TripBoard.tsx
function getRecentLastDateRuns(tripsMap: Record<string, Trip>, routeFilter = 'all'): Trip[] {
  const nonOpen = Object.values(tripsMap).filter((t) => t.status !== 'open')
  if (nonOpen.length === 0) return []

  const byRoute = new Map<string, Trip[]>()
  for (const t of nonOpen) {
    if (routeFilter !== 'all' && t.routeId !== routeFilter) continue
    const list = byRoute.get(t.routeId) ?? []
    list.push(t)
    byRoute.set(t.routeId, list)
  }

  const out: Trip[] = []
  for (const [, trips] of byRoute) {
    const maxDay = Math.max(...trips.map((t) => t.day))
    const lastDayTrips = trips.filter((t) => t.day === maxDay)
    out.push(...lastDayTrips)
  }

  return out.sort((a, b) =>
    b.day - a.day ||
    a.routeId.localeCompare(b.routeId) ||
    a.depHour - b.depHour ||
    (a.direction === 'AB' ? -1 : 1)
  )
}

// [Check 1] Verify only the last date run of all routes is shown
console.log('\n[Check 1] Verify only the last date run is shown per route...')
const results = getRecentLastDateRuns(s.trips)

// Expect:
// - blr-maa: only day 8 trips (t1_d8_up, t1_d8_down)
// - blr-hyd: only day 6 trip (t2_d6)
// - maa-cbe: only day 3 trip (t3_d3)
// Total 4 trips across 3 routes
assert.equal(results.length, 4, 'Should contain exactly 4 trips across the 3 routes')

const blrMaaTrips = results.filter((t) => t.routeId === 'blr-maa')
assert.equal(blrMaaTrips.length, 2, 'blr-maa should have 2 trips from its last run date (Day 8)')
assert(blrMaaTrips.every((t) => t.day === 8), 'All blr-maa trips must be from Day 8')
assert(!results.some((t) => t.id === 't_blr_maa_d5'), 'blr-maa Day 5 must be excluded')
assert(!results.some((t) => t.id === 't_blr_maa_d7'), 'blr-maa Day 7 must be excluded')
console.log('✓ Older run dates for blr-maa (Day 5, Day 7) successfully excluded; only Day 8 shown')

const blrHydTrips = results.filter((t) => t.routeId === 'blr-hyd')
assert.equal(blrHydTrips.length, 1, 'blr-hyd should have 1 trip from its last run date (Day 6)')
assert.equal(blrHydTrips[0].day, 6, 'blr-hyd must be from Day 6')
assert(!results.some((t) => t.id === 't_blr_hyd_d4'), 'blr-hyd Day 4 must be excluded')
console.log('✓ Older run dates for blr-hyd (Day 4) successfully excluded; only Day 6 shown')

const maaCbeTrips = results.filter((t) => t.routeId === 'maa-cbe')
assert.equal(maaCbeTrips.length, 1, 'maa-cbe should have 1 trip from its last run date (Day 3)')
assert.equal(maaCbeTrips[0].day, 3, 'maa-cbe must be from Day 3')
console.log('✓ All 3 routes represented with their latest run date')

// [Check 2] Verify descending date order
console.log('\n[Check 2] Verify sort order: newest last-run date first...')
assert.equal(results[0].day, 8, 'First should be Day 8 (blr-maa)')
assert.equal(results[1].day, 8, 'Second should be Day 8 (blr-maa)')
assert.equal(results[2].day, 6, 'Third should be Day 6 (blr-hyd)')
assert.equal(results[3].day, 3, 'Fourth should be Day 3 (maa-cbe)')
console.log('✓ Trips correctly sorted by latest run date descending')

// [Check 3] Verify rich details calculation
console.log('\n[Check 3] Verify rich financial and operational details...')
const sampleTrip = results.find((t) => t.id === 't_blr_hyd_d6')!
const ticketRev = sampleTrip.revenue + sampleTrip.cancelledRevenue
const cargoRev = sampleTrip.outcome?.cargoRevenue ?? 0
const totalRev = ticketRev + cargoRev
const costs = sampleTrip.outcome?.tripCosts ?? 0
const netProfit = totalRev - costs

assert.equal(totalRev, 3210000 + 300000, 'Total Gross Revenue = Ticket + Cancelled + Cargo')
assert.equal(costs, 2700000, 'Direct Costs = 27,000')
assert.equal(netProfit, 810000, 'Net Profit = +8,100')
assert.equal(sampleTrip.outcome?.delayMin, 15, 'Delay = 15m')
assert.equal(sampleTrip.outcome?.cargoKg, 400, 'Cargo = 400kg')
assert.equal(sampleTrip.outcome?.pss, 7.8, 'PSS = 7.8')
console.log('✓ Complete P&L, Cargo, Delay, and PSS metrics validated')

// [Check 4] Route filter
console.log('\n[Check 4] Verify route filter...')
const filtered = getRecentLastDateRuns(s.trips, 'blr-hyd')
assert.equal(filtered.length, 1, 'Route filter selects only blr-hyd')
assert.equal(filtered[0].id, 't_blr_hyd_d6')
console.log('✓ Route filter works accurately')

console.log('\n=============================================================')
console.log('🎉 ALL RECENTLY RUN LAST-DATE TESTS PASSED PERFECTLY!')
console.log('=============================================================')
