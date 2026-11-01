/**
 * Can a leased truck pay its rent? Signs a dry-leased cargo vehicle, runs it
 * one-way on the home corridor, and prints month-by-month economics.
 *
 *   npx tsx scripts/lease-cargo-check.ts
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { fmtCompact, rs } from '../src/engine/core/money'
import { startLease, usedPrice, syncCargoListings } from '../src/engine/sim/fleet'
import { hire, assignStaff } from '../src/engine/sim/staffing'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import type { GameState } from '../src/engine/types'

const DAYS = 150

function go(seed: number, minSeats: number) {
  const s = newGame('Cargo lease', 'seth', 'blr-hyd', seed)
  s.company.cash = rs(2_00_00_000)
  s.company.dedicatedCargoSubsidiary = true
  syncCargoListings(s)
  const offer = s.leaseOffers.find((o) => BUS_MODELS[o.modelId]!.cls === 'CARGO'
    && (BUS_MODELS[o.modelId]!.cargoCapKg ?? 0) >= minSeats)
  if (!offer) return null
  const rent = offer.monthlyRent
  const value = usedPrice(offer.modelId, offer.ageYears)
  if (startLease(s, offer.id) !== null) return null
  const bus = Object.values(s.buses)[0]!
  const d = s.hiringPool.find((x) => x.role === 'driver')
  if (d && hire(s, d.id) === null) assignStaff(s, d.id, bus.id)
  const made = createSchedule(s, {
    routeId: 'blr-hyd', depHour: 21, depMin: 0, baseFare: rs(800), autoPrice: true,
    cancellation: 'standard', redDeal: false, serviceKind: 'cargo',
  })
  if ('error' in made) return null
  if (assignBus(s, made.id, bus.id) !== null) return null
  for (let i = 0; i < DAYS; i++) {
    advanceDay(s)
    if (s.gameOver) break
  }
  const months = Math.max(1, (s.day - s.startDay) / 30)
  const rev = Math.round(bus.lifeRevenue / months)
  const cost = Math.round(bus.lifeCost / months)
  const m = BUS_MODELS[offer.modelId]!
  return {
    name: `${m.maker} ${m.name}`, age: offer.ageYears, odo: bus.odometer, value, rent,
    rev, cost, net: rev - cost, trips: bus.lifeTrips,
  }
}

console.log(`cargo lease check — ${DAYS} days, one-way cargo service, ₹/month\n`)
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const r = go(seed, 1000)
  if (!r) continue
  console.log(
    `${r.name.padEnd(28)} ${r.age}y ${String(Math.round(r.odo / 1000)).padStart(4)}k odo val ${fmtCompact(r.value).padStart(7)} ` +
    `RENT ${fmtCompact(r.rent).padStart(6)} (${(r.rent / r.value * 100).toFixed(2)}%/mo) ` +
    `rev ${fmtCompact(r.rev).padStart(7)} cost ${fmtCompact(r.cost).padStart(7)} net ${fmtCompact(r.net).padStart(7)} trips ${r.trips}`,
  )
}
