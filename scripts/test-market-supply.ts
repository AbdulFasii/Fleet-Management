/**
 * Step 1 market rules: our extra coaches and rival floods move the fill,
 * thin corridors flood faster than metro pairs, price counts once, and our
 * parcel book grows with our departures instead of being a fixed slice.
 */
import { ROUTES } from '../src/engine/data/routes'
import { equilibriumLf, fareElasticityMult, inducedDemandRate, marketSupplyPressure } from '../src/engine/sim/demand'
import { cargoBookKg, corridorCargoMarketKg } from '../src/engine/sim/cargo'
import { newGame } from '../src/engine/newGame'
import { createSchedule } from '../src/engine/sim/schedules'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

/** A peak evening window: ~15% of the day's shoppers and seats can reach it. */
function pressure(routeId: string, coachesInWindow: number, rivalFloodDaily = 0): number {
  const r = ROUTES[routeId]!
  const mass = 0.15
  const pool = r.baseDemand * mass
  const rivalSeats = (r.baseDemand / equilibriumLf(r)) * mass
  const cap = 36
  return marketSupplyPressure(r, pool, rivalSeats, rivalFloodDaily * mass * 2, cap * coachesInWindow, cap)
}

// Supply
check(Math.abs(pressure('maa-blr', 1) - 1) < 1e-9, 'a lone coach sits exactly on the occupancy bands')
check(Math.abs(pressure('maa-goa', 1) - 1) < 1e-9, 'a lone coach on a thin corridor is also neutral')
const big4 = pressure('maa-blr', 4)
const thin4 = pressure('maa-goa', 4)
console.log(`     4 coaches in one window: Chennai–Bengaluru x${big4.toFixed(3)}, Chennai–Goa x${thin4.toFixed(3)}`)
check(big4 > 0.95, 'four coaches barely dent a 350-departure corridor')
check(thin4 < 0.85, 'four coaches flood a 12-departure corridor')
check(pressure('maa-goa', 8) < thin4, 'more coaches always fill less')
check(pressure('maa-mdu', 1, 300) < 1, 'a rival capacity flood lowers the fill')
check(inducedDemandRate(12) > inducedDemandRate(100) && inducedDemandRate(100) > inducedDemandRate(350), 'thin corridors induce more new riders')
check(Math.abs(inducedDemandRate(30) - 0.35) < 1e-9 && Math.abs(inducedDemandRate(200) - 0.10) < 1e-9, 'induced-demand anchors hold')

// Price, once
check(fareElasticityMult(1, 5) === 1, 'market fare is neutral')
check(fareElasticityMult(1.2, 5) < 0.75, '20% over market loses about a quarter of the fill')
check(fareElasticityMult(1.2, 1) > fareElasticityMult(1.2, 5), 'last-minute shoppers care less about price')
check(fareElasticityMult(0.6, 5) <= 1.35 + 1e-9, 'deep discounts stop adding fill at +35%')
check(fareElasticityMult(1.2, 5, 1.3) < fareElasticityMult(1.2, 5, 0.85), 'pilgrim crowds are more price-sensitive than tech crowds')

// Cargo grows with our departures
const s = newGame('Supply Probe', 'malik', 'maa-blr', 7)
const route = ROUTES['maa-blr']!
const before = cargoBookKg(s, route, 'AB', s.day).parcelBookKg
const mk = (h: number) => createSchedule(s, {
  routeId: 'maa-blr', depHour: h, depMin: 0, baseFare: route.marketFareAC, autoPrice: true,
  cancellation: 'standard', redDeal: false, paired: false,
})
mk(21)
for (const sch of Object.values(s.schedules)) sch.busIds = sch.busIds.length ? sch.busIds : ['probe-bus-1']
const one = cargoBookKg(s, route, 'AB', s.day).parcelBookKg
mk(22)
for (const sch of Object.values(s.schedules)) if (!sch.busIds.length) sch.busIds = ['probe-bus-2']
const two = cargoBookKg(s, route, 'AB', s.day).parcelBookKg
const market = corridorCargoMarketKg(s, route, 'AB', s.day).parcelMarketKg
console.log(`     parcel book: 0 deps ${before} kg, 1 dep ${one} kg, 2 deps ${two} kg (market ${market} kg)`)
check(before === 0, 'no departures, no parcel book')
check(one > 0 && Math.abs(two / one - 2) < 0.05, 'a second daily departure roughly doubles the parcel book')
check(market > 50_000, 'Chennai–Bengaluru parcel market is real-world sized')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
