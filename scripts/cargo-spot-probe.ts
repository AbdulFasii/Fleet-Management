/**
 * Posted spot rate vs contract rate on the same lane.
 *   npx tsx scripts/cargo-spot-probe.ts
 */
import { newGame } from '../src/engine/newGame'
import { BAL } from '../src/engine/data/balance'
import { ROUTES } from '../src/engine/data/routes'
import {
  cargoFreightRupees,
  cargoLegLabel,
  cargoRouteMult,
  getAvailableContracts,
  openCargoPermit,
  parcelRatePerKg100Km,
  truckRatePerKg100Km,
} from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Staff } from '../src/engine/types'

const s = newGame('Spot rates', 'seth', 'mdu-maa', 42)
s.company.dedicatedCargoSubsidiary = true

const route = ROUTES['mdu-maa']!
const parcel = parcelRatePerKg100Km(s)
const truck = truckRatePerKg100Km(s)
const contractLo = (BAL.cargoContractRateLo + BAL.cargoContractRateHi) / 2

const perKg = (ratePer100: number) =>
  cargoFreightRupees(1000, route.km, ratePer100, cargoRouteMult(route.km)) / 1000

console.log(`lane mdu→maa ${route.km} km`)
console.log(`parcel posted  ₹${parcel.toFixed(2)}/kg/100km → ₹${perKg(parcel).toFixed(2)}/kg  (spot & walk-up)`)
console.log(`parcel contract ₹${(parcel * contractLo).toFixed(2)}/kg/100km → ₹${perKg(parcel * contractLo).toFixed(2)}/kg`)
console.log(`truck posted   ₹${truck.toFixed(2)}/kg/100km → ₹${perKg(truck).toFixed(2)}/kg  (bulk spot)`)
console.log(`truck contract ₹${(truck * contractLo).toFixed(2)}/kg/100km → ₹${perKg(truck * contractLo).toFixed(2)}/kg`)
console.log(`1,000 kg parcel spot: ₹${Math.round(cargoFreightRupees(1000, route.km, parcel, cargoRouteMult(route.km))).toLocaleString('en-IN')}`)
console.log(`1,000 kg parcel contract: ₹${Math.round(cargoFreightRupees(1000, route.km, parcel * contractLo, cargoRouteMult(route.km))).toLocaleString('en-IN')}`)

// What the desk actually puts on the table today.
const mgr: Staff = {
  id: 'mgr1', name: 'Biju Sen', role: 'manager', skill: 8, experienceYears: 6,
  salary: 3500000, loyalty: 80, morale: 80, fatigue: 10, safety: 7, hiredDay: s.day,
}
s.staff[mgr.id] = mgr
appointCargoManager(s, mgr.id)
for (const r of Object.values(ROUTES).filter((x) => x.id.startsWith('mdu') || x.id.startsWith('maa')).slice(0, 4)) {
  s.permits[r.id] = { routeId: r.id, status: 'active', appliedDay: s.day, activeFromDay: s.day, expiryDay: s.day + 400 }
  openCargoPermit(s, r.id)
}
const proposals = getAvailableContracts(s).slice(0, 6)
console.log('\nopen proposals')
for (const p of proposals) {
  const r = ROUTES[p.routeId]!
  const per = cargoFreightRupees(1000, r.km, p.ratePerKg100Km, cargoRouteMult(r.km)) / 1000
  console.log(
    `  ${p.partner.padEnd(20)} ${cargoLegLabel(r, p.direction).padEnd(24)} ` +
    `${String(p.guaranteedKgPerDay).padStart(6)} kg/day · ₹${p.ratePerKg100Km}/kg/100km = ₹${per.toFixed(2)}/kg`,
  )
}
