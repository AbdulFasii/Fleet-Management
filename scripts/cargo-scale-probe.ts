/**
 * Prints the parcel/bulk market, our book, and going rates for a few lanes.
 *   npx tsx scripts/cargo-scale-probe.ts
 */
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import {
  cargoBookKg,
  cargoGoingRateRs,
  cargoPriceFillMult,
  corridorCargoMarketKg,
  parcelRatePerKg100Km,
  truckRatePerKg100Km,
} from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Staff } from '../src/engine/types'

const s = newGame('Cargo scale', 'seth', 'mdu-maa', 42)
s.company.dedicatedCargoSubsidiary = true

const mgr: Staff = {
  id: 'mgr1', name: 'Biju Sen', role: 'manager', skill: 8, experienceYears: 6,
  salary: 3500000, loyalty: 80, morale: 80, fatigue: 10, safety: 7, hiredDay: s.day,
}
s.staff[mgr.id] = mgr
appointCargoManager(s, mgr.id)

console.log('lane                 km   pax/day  parcelMkt  bulkMkt   parcelBook bulkBook  going₹  demand×  spot₹/kg  truck₹/kg')
for (const id of ['mdu-maa', 'maa-mdu', 'blr-hyd', 'maa-pdy', 'maa-blr']) {
  const route = ROUTES[id]
  if (!route) continue
  const dir = 'AB'
  const m = corridorCargoMarketKg(s, route, dir, s.day)
  const b = cargoBookKg(s, route, dir, s.day)
  const going = cargoGoingRateRs(s, route, dir, s.day)
  const demandMult = cargoPriceFillMult(s, route, dir, s.day)
  const spot = (parcelRatePerKg100Km(s) / 100) * route.km
  const truck = (truckRatePerKg100Km(s) / 100) * route.km
  console.log(
    `${id.padEnd(20)} ${String(route.km).padStart(4)} ${String(Math.round(route.baseDemand)).padStart(8)} ` +
    `${String(m.parcelMarketKg).padStart(10)} ${String(m.bulkMarketKg).padStart(8)} ` +
    `${String(b.parcelBookKg).padStart(11)} ${String(b.bulkBookKg).padStart(8)} ` +
    `${going.toFixed(2).padStart(8)} ${demandMult.toFixed(2).padStart(8)} ${spot.toFixed(2).padStart(9)} ${truck.toFixed(2).padStart(10)}`,
  )
}

// Price elasticity: what the three pricing strategies do to the parcel book.
const lane = ROUTES['mdu-maa']!
console.log('\nprice response on mdu→maa (parcel book kg / demand multiplier / spot ₹ per kg)')
for (const type of ['discount', 'normal', 'aggressive'] as const) {
  s.config.cargoPricingType = type
  const book = cargoBookKg(s, lane, 'AB', s.day).parcelBookKg
  const mult = cargoPriceFillMult(s, lane, 'AB', s.day)
  const spot = (parcelRatePerKg100Km(s) / 100) * lane.km
  console.log(`  ${type.padEnd(11)} book ${String(book).padStart(6)} kg · demand ${mult.toFixed(2)}× · spot ₹${spot.toFixed(2)}/kg`)
}
s.config.cargoPricingType = 'normal'
