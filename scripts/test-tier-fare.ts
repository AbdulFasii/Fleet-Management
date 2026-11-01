import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus, updateSchedule } from '../src/engine/sim/schedules'
import { resolveTripFare, marketFare, serviceTierFareMult } from '../src/engine/sim/pricing'
import { generateTrips } from '../src/engine/sim/booking'
import { rs, toRupees } from '../src/engine/core/money'
import { ROUTES } from '../src/engine/data/routes'
import type { ServiceTier, Trip } from '../src/engine/types'

console.log('=== TIER FARE DIFFERENTIATION ===\n')

const s = newGame('Tier Fares', 'seth', 'maa-blr', 42)
s.company.cash = rs(50_00_000)

const bus = {
  id: 'bus_tier_1',
  reg: 'TN 01 TF 0001',
  modelId: 'bb1624',
  ownership: 'owned' as const,
  acquiredDay: s.day,
  purchaseCost: rs(35_00_000),
  odometer: 80_000,
  lastServiceOdo: 80_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, electrical: 90, ac: 90, body: 90 },
  status: 'active' as const,
  parkedCityId: s.company.homeCityId,
  qualityScore: 4.4,
  lifeTrips: 5,
  gpsDeviceFitted: true,
  busCleanliness: 80,
  insuranceExpiryDay: s.day + 180,
  fitnessExpiryDay: s.day + 180,
  pucExpiryDay: s.day + 180,
  roadTaxPayableDay: s.day + 180,
}
s.buses[bus.id] = bus

const route = ROUTES['maa-blr']!
const tiers: ServiceTier[] = ['economy', 'standard', 'premium', 'gold']
const marketByTier: Record<string, number> = {}
const ticketByTier: Record<string, number> = {}

const res = createSchedule(s, {
  routeId: 'maa-blr',
  depHour: 21,
  depMin: 0,
  baseFare: rs(Math.round(toRupees(route.marketFareAC))),
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  serviceTier: 'economy',
})
if ('error' in res) throw new Error(res.error)
const sch = s.schedules[res.id]!

const stub: Trip = {
  id: 'stub_same_trip',
  scheduleId: sch.id,
  routeId: sch.routeId,
  direction: 'AB',
  busId: bus.id,
  day: s.day + 3,
  depHour: 21,
  depMin: 0,
  fare: 0,
  seats: [],
  seatCount: 40,
  sold: 0,
  revenue: 0,
  cancelledRevenue: 0,
  channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
  status: 'open',
}

for (const tier of tiers) {
  sch.serviceTier = tier
  const fare = resolveTripFare(s, stub, sch, bus, 3)
  const mkt = marketFare(s, route, bus.modelId, stub.day, 'AB', bus, 21, 0, tier)
  marketByTier[tier] = toRupees(mkt)
  ticketByTier[tier] = toRupees(fare)
  console.log(`${tier.padEnd(9)} mult=${serviceTierFareMult(tier).toFixed(2)}  ticket=₹${toRupees(fare)}  market=₹${toRupees(mkt)}`)
}

if (!(
  marketByTier.economy! < marketByTier.standard!
  && marketByTier.standard! < marketByTier.premium!
  && marketByTier.premium! < marketByTier.gold!
)) {
  throw new Error(`Market fare not ordered by tier: ${JSON.stringify(marketByTier)}`)
}

if (!(
  ticketByTier.economy! < ticketByTier.standard!
  && ticketByTier.standard! < ticketByTier.premium!
  && ticketByTier.premium! < ticketByTier.gold!
)) {
  throw new Error(`Auto ticket not ordered by tier (same trip): ${JSON.stringify(ticketByTier)}`)
}

sch.serviceTier = 'economy'
assignBus(s, sch.id, bus.id)
generateTrips(s)
const trip = Object.values(s.trips).find((t) => t.scheduleId === sch.id && t.status === 'open')
if (!trip) throw new Error('No open trip after assign')
const before = toRupees(trip.fare)
updateSchedule(s, sch.id, { serviceTier: 'gold' })
const after = toRupees(trip.fare)
console.log(`\nEconomy→Deluxe reprice: ₹${before} → ₹${after}`)
if (after <= before) throw new Error('Expected Deluxe reprice to raise auto fare')

console.log('\n✓ Brand service tier differentiates ticket pricing.')
