/**
 * After-fix check: ordinary comfort-7 / quality-3.4 coach on blr-maa.
 * Prints target LF and the sold book a new schedule shows after one booking pass.
 */
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { fromCivil } from '../src/engine/core/calendar'
import { buildBookingCtx, elapsedBookingFrac, tripArrivals, tripLoadFactor } from '../src/engine/sim/demand'
import { marketFare } from '../src/engine/sim/pricing'
import { bookingPass, generateTrips } from '../src/engine/sim/booking'
import type { Bus, GameState, Schedule, Trip } from '../src/engine/types'

const pct = (x: number) => `${Math.round(x * 100)}%`

function coach(s: GameState, id: string, modelId: string): Bus {
  const bus: Bus = {
    id, reg: `KA01AB${id}`, nickname: id, modelId,
    ownership: 'owned', mfgYear: 2019, acquiredDay: s.day - 40, acquiredPrice: 0, bookValue: 0,
    odometer: 220_000,
    condition: { engine: 82, gearbox: 84, brakes: 80, suspension: 78, ac: 80, body: 75, electrical: 78 },
    tyreKm: 40_000, tyresRetreaded: false,
    lastServiceOdo: 200_000, insuranceExpiryDay: s.day + 200, fitnessExpiryDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200, status: 'active', duty: 'line',
    accidentHistory: false, lifeRevenue: 0, lifeCost: 0, lifeTrips: 12, qualityScore: 3.4,
    busCleanliness: 70,
  }
  s.buses[id] = bus
  return bus
}

function schedule(s: GameState, routeId: string, depHour: number, busIds: string[], relFare = 1): void {
  const sch: Schedule = {
    id: 'sc', routeId, busIds, depHour, depMin: 0,
    baseFare: Math.round(ROUTES[routeId]!.marketFareAC * relFare),
    autoPrice: relFare === 1, boardingPoints: 3,
    cancellation: 'standard', channels: { redbus: true, abhibus: false, ownapp: false, counter: true },
    redDeal: false, active: true, createdDay: s.day, occRecent: [],
  }
  s.schedules.sc = sch
}

function arm(seed: number, routeId: string, modelId: string, depHour: number, relFare = 1): GameState {
  const s = newGame('After Travels', 'malik', routeId, seed)
  s.company.rating = 3.4
  s.company.ratingCount = 40
  s.company.punctuality = 0.88
  s.company.brandAwareness = 0.08
  s.trips = {}
  s.openTripIds = []
  s.schedules = {}
  s.buses = {}
  coach(s, 'b0', modelId)
  schedule(s, routeId, depHour, ['b0'], relFare)
  if (!s.permits[routeId]) {
    s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 30, activeFromDay: s.day, expiryDay: s.day + 365 }
  }
  generateTrips(s)
  return s
}

function targets(s: GameState, hour: number): void {
  const ctx = buildBookingCtx(s)
  const rows = s.openTripIds
    .map((id) => s.trips[id]!)
    .filter((t) => t && t.depHour === hour && t.direction === 'AB')
    .sort((a, b) => a.day - b.day)
  const want = [14, 7, 2, 1]
  const bits = want.map((d) => {
    const t = rows.find((trip) => trip.day - s.day === d)
    if (!t) return `d${d} —`
    const est = tripLoadFactor(s, t, d, ctx)
    return `d${d} tgt ${pct(est.target)}`
  })
  console.log(`  seed ${s.seed} share ${s.world.share[rows[0]!.routeId]?.player ?? '?'}%  ${bits.join('  ')}`)
}

console.log('elapsed curve  d14', elapsedBookingFrac(14).toFixed(3), 'd7', elapsedBookingFrac(7).toFixed(3), 'd2', elapsedBookingFrac(2).toFixed(3), 'd1', elapsedBookingFrac(1).toFixed(3))

console.log('\n=== target LF, comfort-7 semi, blr-maa 21:00, rating 3.4 ===')
for (const seed of [7, 42, 99]) {
  const s = arm(seed, 'blr-maa', 'volvo9400semi', 21)
  targets(s, 21)
}

console.log('\n=== board after one booking pass (new schedule, seed 42, 21:00) ===')
{
  const s = arm(42, 'blr-maa', 'volvo9400semi', 21)
  bookingPass(s)
  const rows = s.openTripIds.map((id) => s.trips[id]!).filter((t) => t.direction === 'AB').sort((a, b) => a.day - b.day)
  for (const t of rows) {
    const d = t.day - s.day
    if (d > 14) continue
    console.log(`  day+${String(d).padStart(2)}  ${t.sold}/${t.seatCount}  ${pct(t.sold / t.seatCount).padStart(4)}  fare ₹${Math.round(t.fare / 100)}`)
  }
}

console.log('\n=== same coach, thin cases (seed 42) ===')
for (const [label, hour, rel] of [['06:00 fair', 6, 1], ['21:00 +35% fare', 21, 1.35], ['03:00 fair', 3, 1]] as [string, number, number][]) {
  const s = arm(42, 'blr-maa', 'volvo9400semi', hour, rel)
  bookingPass(s)
  const rows = s.openTripIds.map((id) => s.trips[id]!).filter((t) => t.direction === 'AB')
  const at = (d: number) => rows.find((t) => t.day - s.day === d)
  const a7 = at(7)
  const a2 = at(2)
  const ctx = buildBookingCtx(s)
  const t7 = a7 ? tripLoadFactor(s, a7, 7, ctx).target : 0
  console.log(`  ${label.padEnd(18)} tgt d7 ${pct(t7).padStart(4)}  sold d7 ${a7 ? pct(a7.sold / a7.seatCount) : '—'}  sold d2 ${a2 ? pct(a2.sold / a2.seatCount) : '—'}`)
}

console.log('\n=== festival vs Tuesday target (blr-hyd sleeper 21:00, seed 42) ===')
{
  const s = arm(42, 'blr-hyd', 'leyacsleep', 21)
  const tue = fromCivil(2025, 7, 1)
  const diwali = fromCivil(2025, 10, 31)
  // synthesize two trips on those dates using the armed bus
  for (const [label, day] of [['monsoon Tue', tue], ['Diwali eve', diwali]] as [string, number][]) {
    const trip: Trip = {
      id: label, scheduleId: 'sc', routeId: 'blr-hyd', direction: 'AB', busId: 'b0',
      day, depHour: 21, depMin: 0, fare: 0, seats: [], seatCount: BUS_MODELS.leyacsleep!.seats,
      sold: 0, revenue: 0, cancelledRevenue: 0,
      channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }, status: 'open',
    }
    trip.fare = marketFare(s, ROUTES['blr-hyd']!, 'leyacsleep', day, 'AB', s.buses.b0)
    s.trips[trip.id] = trip
    s.openTripIds.push(trip.id)
    const est = tripLoadFactor(s, trip, 10, buildBookingCtx(s))
    console.log(`  ${label.padEnd(14)} target ${pct(est.target)}`)
  }
}

console.log('\n=== catch-up: week-out trip stuck at ~8% sold ===')
{
  const s = arm(42, 'blr-maa', 'volvo9400semi', 21)
  const trip = s.openTripIds.map((id) => s.trips[id]!).find((t) => t.day - s.day === 7 && t.direction === 'AB')!
  const cap = trip.seatCount
  const stuck = Math.max(1, Math.round(cap * 0.08))
  trip.sold = stuck
  console.log(`  start d7 ${trip.sold}/${cap} (${pct(trip.sold / cap)}) target ${pct(tripLoadFactor(s, trip, 7, buildBookingCtx(s)).target)}`)
  for (let i = 0; i < 4; i++) {
    const dtd = trip.day - s.day
    const before = trip.sold
    const arr = tripArrivals(s, trip, dtd, buildBookingCtx(s))
    const add = Math.min(cap - trip.sold, Math.round(arr.lambda))
    trip.sold += add
    console.log(`  day ${i} (d${dtd}) +${add} → ${trip.sold}/${cap} (${pct(trip.sold / cap)}) lambda ${arr.lambda.toFixed(1)}`)
    s.day += 1
    if (before === trip.sold && arr.lambda < 0.5) break
  }
}
