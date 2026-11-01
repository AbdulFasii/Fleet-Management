/**
 * Demand calibration probe.
 *
 *   npm run probe
 *   npm run probe -- --seed 7
 *
 * Prints the target load factor the booking pass would aim at for one
 * mid-tier operator (4.0★ with reviews, decent coach, RedBus + counter) under
 * conditions we have real-world expectations for: departure clock, haul length
 * vs layout, weekday vs festival, fare vs market, and own buses stacked in the
 * same slot. Use it to check the model against the anchors in balance.ts
 * before and after touching demand.
 */
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { fromCivil, dow } from '../src/engine/core/calendar'
import { buildBookingCtx, tripLoadFactor, equilibriumLf, demandFactors } from '../src/engine/sim/demand'
import { marketFare } from '../src/engine/sim/pricing'
import { slotStrength } from '../src/engine/sim/corridor'
import type { Bus, Schedule, Trip } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const seed = Number(arg('seed', '42'))
const tier = arg('tier', 'established') as 'normal' | 'established'
const s = newGame('Probe Travels', 'malik', 'blr-hyd', seed)

if (tier === 'normal') {
  // exactly the market's average operator: every appeal term should land on 1.00
  s.company.rating = 3.5
  s.company.ratingCount = 0
  s.company.punctuality = 0.85
  s.company.brandAwareness = 0
} else {
  // an operator the market has an opinion about: 4.0★ with reviews behind it
  s.company.rating = 4.0
  s.company.ratingCount = 300
  s.company.punctuality = 0.90
  s.company.brandAwareness = 0.25
}

const FULL = { engine: 88, gearbox: 90, brakes: 85, suspension: 86, ac: 90, body: 88, electrical: 90 }

function makeBus(id: string, modelId: string): Bus {
  const bus: Bus = {
    id, reg: `KA01AB${id}`, nickname: id, modelId,
    ownership: 'owned', mfgYear: 2023, acquiredDay: s.day - 200, acquiredPrice: 0, bookValue: 0,
    odometer: 150_000, condition: { ...FULL }, tyreKm: 40_000, tyresRetreaded: false,
    lastServiceOdo: 130_000, insuranceExpiryDay: s.day + 200, fitnessExpiryDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200, status: 'active', duty: 'line',
    accidentHistory: false, lifeRevenue: 0, lifeCost: 0, lifeTrips: 0, qualityScore: 3,
    busCleanliness: 90,
  }
  s.buses[id] = bus
  return bus
}

function makeSchedule(id: string, routeId: string, depHour: number, depMin: 0 | 30, busIds: string[]): Schedule {
  const sch: Schedule = {
    id, routeId, busIds, depHour, depMin,
    baseFare: ROUTES[routeId]!.marketFareAC, autoPrice: true, boardingPoints: 3,
    cancellation: 'standard', channels: { redbus: true, abhibus: false, ownapp: false, counter: true },
    redDeal: false, active: true, createdDay: s.day - 200, occRecent: [],
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
  trip.fare = Math.round(marketFare(s, route, modelId, day, 'AB') * relFare)
  s.trips[id] = trip
  if (!s.openTripIds.includes(id)) s.openTripIds.push(id)
  return trip
}

function reset(): void {
  s.trips = {}
  s.openTripIds = []
  s.schedules = {}
  s.buses = {}
}

/** Target LF for a single bus, freshly set up, 10 days out. */
function probe(
  routeId: string, modelId: string, depHour: number, depMin: 0 | 30 = 0,
  day = s.day + 10, relFare = 1, stack = 1,
): number {
  reset()
  const busIds: string[] = []
  for (let i = 0; i < stack; i++) {
    const bid = `b${i}`
    makeBus(bid, modelId)
    busIds.push(bid)
  }
  makeSchedule('sc', routeId, depHour, depMin, busIds)
  busIds.forEach((bid, i) => {
    makeTrip(`t${i}`, 'sc', routeId, bid, modelId, day, depHour, depMin, relFare)
  })
  const ctx = buildBookingCtx(s)
  return tripLoadFactor(s, s.trips['t0']!, day - s.day, ctx).target
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)

/* ----------------------------- the corridors ----------------------------- */

const SLEEPER = 'bb1624'
const SEMI = 'bb917'
const HYBRID = 'bb1624hybrid'

function pickModels(): void {
  const have = (id: string) => (BUS_MODELS[id] ? id : null)
  const anyOf = (pred: (m: (typeof BUS_MODELS)[string]) => boolean) =>
    Object.values(BUS_MODELS).find(pred)?.id
  const sleeper = have(SLEEPER) ?? anyOf((m) => m.cls === 'AC_SLEEPER')!
  const semi = have(SEMI) ?? anyOf((m) => m.cls === 'AC_SEMI')!
  const hybrid = have(HYBRID) ?? anyOf((m) => m.cls === 'AC_HYBRID')!
  models.sleeper = sleeper
  models.semi = semi
  models.hybrid = hybrid
}
const models = { sleeper: SLEEPER, semi: SEMI, hybrid: HYBRID }
pickModels()

console.log(`seed ${seed}  tier ${tier}  models: sleeper=${models.sleeper} semi=${models.semi} hybrid=${models.hybrid}`)

/* 0 — appeal breakdown, so an off-centre term is obvious */
reset()
makeBus('b0', models.sleeper)
makeSchedule('sc', 'blr-hyd', 21, 0, ['b0'])
makeTrip('t0', 'sc', 'blr-hyd', 'b0', models.sleeper, s.day + 10, 21, 0)
const est = tripLoadFactor(s, s.trips['t0']!, 10, buildBookingCtx(s))
console.log(`\n=== Appeal vs the market average (blr-hyd sleeper, 21:00) ===`)
console.log('  ' + Object.entries(est.parts).map(([k, v]) => `${k} ${v.toFixed(3)}`).join('  '))
console.log(`  total ${est.attr.toFixed(3)}   pool ${Math.round(est.pool)} pax  own ${Math.round(est.ownSeats)} seats  rivals ${Math.round(est.rivalSeats)} seats`)

/* 1 — departure clock */
console.log('\n=== Target LF by departure hour (10 days out) ===')
for (const routeId of ['blr-hyd', 'maa-pdy']) {
  const r = ROUTES[routeId]!
  const hours = [0, 3, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23]
  console.log(`${routeId} (${r.hours}h, comp ${r.competition}, eqLF ${pct(equilibriumLf(r))}, peak ${r.hours >= 7.5 ? 'overnight' : r.hours <= 6 ? 'day' : 'mid'})`)
  for (const [label, modelId] of [['sleeper', models.sleeper], ['semi   ', models.semi]] as [string, string][]) {
    console.log(`  ${label} ${hours.map((h) => `${String(h).padStart(2, '0')}h ${pct(probe(routeId, modelId, h))}`).join(' ')}`)
  }
  console.log(`  slot strength 21:00 ${slotStrength(seed, r, 21).toFixed(2)}  09:00 ${slotStrength(seed, r, 9).toFixed(2)}  03:00 ${slotStrength(seed, r, 3).toFixed(2)}`)
}

/* 2 — layout vs haul length */
console.log('\n=== Layout vs haul length (evening departure, at market fare) ===')
console.log('route        hours  sleeper  semi  hybrid')
for (const routeId of ['maa-pdy', 'maa-try', 'maa-mdu', 'blr-hyd', 'maa-koc', 'maa-mum']) {
  const r = ROUTES[routeId]
  if (!r) continue
  const h = r.hours <= 6 ? 7 : 21
  const row = [models.sleeper, models.semi, models.hybrid]
    .map((m) => pct(probe(routeId, m, h)))
    .join('   ')
  console.log(`${routeId.padEnd(12)} ${String(r.hours).padStart(4)}   ${row}`)
}

/* 3 — calendar */
console.log('\n=== Calendar (blr-hyd, AC sleeper, 21:00) ===')
const route = ROUTES['blr-hyd']!
/** First `want` weekday on/after a date. */
const onDow = (y: number, m: number, d: number, want: number) => {
  const start = fromCivil(y, m, d)
  return start + ((want - dow(start) + 7) % 7)
}
const days: [string, number][] = [
  ['monsoon Tue', onDow(2025, 7, 1, 2)],
  ['monsoon Fri', onDow(2025, 7, 1, 5)],
  ['shoulder Wed', onDow(2025, 10, 15, 3)],
  ['shoulder Fri', onDow(2025, 10, 15, 5)],
  ['shoulder Sat', onDow(2025, 10, 15, 6)],
  ['Diwali eve', fromCivil(2025, 10, 31)],
  ['summer Sun', onDow(2026, 5, 17, 0)],
  ['wedding Tue', onDow(2025, 12, 2, 2)],
]
for (const [label, day] of days) {
  const f = demandFactors(s, route, 'AB', day)
  const tag = [f.season, f.festival].filter(Boolean).join(' / ') || 'plain'
  console.log(`  ${label.padEnd(14)} ${pct(probe('blr-hyd', models.sleeper, 21, 0, day))}   weekly ${f.weekly.toFixed(2)} seasonal ${f.seasonal.toFixed(2)}  ${tag}`)
}

/* 4 — price */
console.log('\n=== Fare vs market (blr-hyd, AC sleeper, 21:00) ===')
console.log('  ' + [0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.35]
  .map((rel) => `${rel.toFixed(2)}x ${pct(probe('blr-hyd', models.sleeper, 21, 0, s.day + 10, rel))}`)
  .join('  '))

/* 5 — own buses stacked in one slot, dense corridor vs thin one */
console.log('\n=== Own buses stacked in the same 21:00 slot ===')
for (const routeId of ['blr-hyd', 'maa-goa']) {
  const r = ROUTES[routeId]
  if (!r) continue
  const row = [1, 2, 3, 4]
    .map((n) => `${n} bus ${pct(probe(routeId, models.sleeper, 21, 0, s.day + 10, 1, n))}`)
    .join('  ')
  console.log(`  ${routeId.padEnd(9)} (${r.baseDemand} pax/day)  ${row}`)
}
