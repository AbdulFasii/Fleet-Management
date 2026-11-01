/**
 * One-off occupancy diagnosis for a comfort-7, quality-3.4, rating-3.4 coach.
 */
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { BAL } from '../src/engine/data/balance'
import { buildBookingCtx, tripLoadFactor, tripArrivals, equilibriumLf } from '../src/engine/sim/demand'
import { marketFare } from '../src/engine/sim/pricing'
import { bookingPass, generateTrips } from '../src/engine/sim/booking'
import type { Bus, Schedule, Trip } from '../src/engine/types'

const seed = 42
const s = newGame('Diag Travels', 'malik', 'blr-maa', seed)
s.company.rating = 3.4
s.company.ratingCount = 40
s.company.punctuality = 0.88
s.company.brandAwareness = 0.08

const FULL = { engine: 82, gearbox: 84, brakes: 80, suspension: 78, ac: 80, body: 75, electrical: 78 }

function makeBus(id: string, modelId: string, comfortBonus = 0): Bus {
  const model = BUS_MODELS[modelId]!
  const bus: Bus = {
    id, reg: `KA01AB${id}`, nickname: id, modelId,
    ownership: 'owned', mfgYear: 2019, acquiredDay: s.day - 40, acquiredPrice: 0, bookValue: 0,
    odometer: 220_000, condition: { ...FULL }, tyreKm: 40_000, tyresRetreaded: false,
    lastServiceOdo: 200_000, insuranceExpiryDay: s.day + 200, fitnessExpiryDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200, status: 'active', duty: 'line',
    accidentHistory: false, lifeRevenue: 0, lifeCost: 0, lifeTrips: 12, qualityScore: 3.4,
    busCleanliness: 70,
    ...(comfortBonus ? { comfortBonus } : {}),
  }
  // Comfort display is model.comfort + bonus. Force displayed comfort to 7.
  const bonus = 7 - model.comfort
  if (bonus) bus.comfortBonus = bonus
  s.buses[id] = bus
  return bus
}

function makeSchedule(id: string, routeId: string, depHour: number, depMin: 0 | 30, busIds: string[]): Schedule {
  const sch: Schedule = {
    id, routeId, busIds, depHour, depMin,
    baseFare: ROUTES[routeId]!.marketFareAC, autoPrice: true, boardingPoints: 2,
    cancellation: 'standard', channels: { redbus: true, abhibus: false, ownapp: false, counter: true },
    redDeal: false, active: true, createdDay: s.day, occRecent: [],
  }
  s.schedules[id] = sch
  return sch
}

function makeTrip(
  id: string, schId: string, routeId: string, busId: string, modelId: string,
  day: number, depHour: number, depMin: 0 | 30, relFare = 1,
): Trip {
  const route = ROUTES[routeId]!
  const trip: Trip = {
    id, scheduleId: schId, routeId, direction: 'AB', busId, day, depHour, depMin,
    fare: 0, seats: [], seatCount: BUS_MODELS[modelId]!.seats, sold: 0,
    revenue: 0, cancelledRevenue: 0, channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
    status: 'open',
  }
  trip.fare = Math.round(marketFare(s, route, modelId, day, 'AB', s.buses[busId]) * relFare)
  s.trips[id] = trip
  if (!s.openTripIds.includes(id)) s.openTripIds.push(id)
  return trip
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

console.log('player share blr-maa', s.world.share['blr-maa']?.player)
console.log('home route', 'blr-maa', 'eqLF', equilibriumLf(ROUTES['blr-maa']!).toFixed(3))
console.log('booking window', BAL.bookingWindowDays, 'catchUp', BAL.market.catchUpRate, BAL.market.catchUpMaxFrac)

for (const routeId of ['blr-maa', 'blr-hyd']) {
  const route = ROUTES[routeId]!
  console.log(`\n==== ${routeId} ${route.hours}h comp ${route.competition} base ${route.baseDemand} fare bench ${route.marketFareAC} ====`)
  for (const modelId of ['volvo9400semi', 'metrolink', 'bb917', 'leyacsleep']) {
    const model = BUS_MODELS[modelId]
    if (!model) continue
    s.trips = {}
    s.openTripIds = []
    s.schedules = {}
    s.buses = {}
    makeBus('b0', modelId)
    makeSchedule('sc', routeId, 21, 0, ['b0'])
    const day = s.day + 10
    makeTrip('t0', 'sc', routeId, 'b0', modelId, day, 21, 0)
    const est = tripLoadFactor(s, s.trips['t0']!, 10, buildBookingCtx(s))
    const fareRs = Math.round(s.trips['t0']!.fare / 100)
    console.log(`  ${modelId} comfort ${model.comfort}+${s.buses['b0']!.comfortBonus ?? 0} fare ₹${fareRs} seats ${model.seats}`)
    console.log(`    target ${pct(est.target)} attr ${est.attr.toFixed(3)} pool ${Math.round(est.pool)} own ${est.ownSeats.toFixed(0)} rival ${Math.round(est.rivalSeats)}`)
    console.log('    ' + Object.entries(est.parts).map(([k, v]) => `${k} ${v.toFixed(3)}`).join('  '))
  }
}

console.log('\n==== blr-maa volvo9400semi by hour, day+7 / day+2 / day+10 ====')
for (const h of [6, 8, 10, 14, 16, 18, 20, 21, 22]) {
  const bits: string[] = []
  for (const ahead of [14, 10, 7, 2, 1, 0]) {
    s.trips = {}
    s.openTripIds = []
    s.schedules = {}
    s.buses = {}
    makeBus('b0', 'volvo9400semi')
    makeSchedule('sc', 'blr-maa', h, 0, ['b0'])
    makeTrip('t0', 'sc', 'blr-maa', 'b0', 'volvo9400semi', s.day + ahead, h, 0)
    const est = tripLoadFactor(s, s.trips['t0']!, ahead, buildBookingCtx(s))
    bits.push(`d${ahead} ${pct(est.target)}`)
  }
  console.log(`  ${String(h).padStart(2)}h  ${bits.join('  ')}`)
}

console.log('\n==== price sensitivity blr-maa 21:00 volvo semi ====')
for (const rel of [0.85, 1, 1.15, 1.35]) {
  s.trips = {}
  s.openTripIds = []
  s.schedules = {}
  s.buses = {}
  makeBus('b0', 'volvo9400semi')
  makeSchedule('sc', 'blr-maa', 21, 0, ['b0'])
  makeTrip('t0', 'sc', 'blr-maa', 'b0', 'volvo9400semi', s.day + 7, 21, 0, rel)
  const est = tripLoadFactor(s, s.trips['t0']!, 7, buildBookingCtx(s))
  console.log(`  ${rel}x ₹${Math.round(s.trips['t0']!.fare / 100)}  target ${pct(est.target)} price ${est.parts.price.toFixed(3)}`)
}

console.log('\n==== arrivals if schedule opened today, no backfill (21:00 semi) ====')
s.trips = {}
s.openTripIds = []
s.schedules = {}
s.buses = {}
s.permits['blr-maa'] = { routeId: 'blr-maa', status: 'active', appliedDay: s.day - 30, activeFromDay: s.day, expiryDay: s.day + 365 }
makeBus('b0', 'volvo9400semi')
makeSchedule('sc', 'blr-maa', 21, 0, ['b0'])
generateTrips(s)
const open = s.openTripIds.map((id) => s.trips[id]!).filter((t) => t && t.status === 'open').sort((a, b) => a.day - b.day)
console.log(`open trips ${open.length}`)
for (const t of open.slice(0, 8)) {
  const dtd = t.day - s.day
  const est = tripLoadFactor(s, t, dtd, buildBookingCtx(s))
  const arr = tripArrivals(s, t, dtd, buildBookingCtx(s))
  console.log(`  day+${dtd} sold ${t.sold}/${t.seatCount} target ${pct(est.target)} lambda ${arr.lambda.toFixed(2)} fare ₹${Math.round(t.fare / 100)}`)
}
console.log('--- one booking pass ---')
bookingPass(s)
for (const t of open.slice(0, 8)) {
  console.log(`  day+${t.day - s.day} sold ${t.sold}/${t.seatCount} (${pct(t.sold / t.seatCount)})`)
}
