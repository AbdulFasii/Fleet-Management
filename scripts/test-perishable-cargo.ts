/**
 * Perishable cargo: produce flows from producing towns into bigger markets,
 * peaks and dips with its season, only boards departures that reach the
 * morning wholesale market, and pays a time premium.
 */
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { PERISHABLE_RATE_PREMIUM, perishableShare, reachesMorningMarket } from '../src/engine/data/perishables'
import { allocateCargoForTrip, makeCorridorCargoPool } from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import { fromCivil } from '../src/engine/core/calendar'
import type { Staff, Trip } from '../src/engine/types'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

// Lanes and seasons
check(perishableShare('mdu', 'maa', 4) > perishableShare('mdu', 'maa', 9), 'Madurai jasmine peaks in spring')
check(perishableShare('maa', 'mdu', 4) === 0, 'produce does not flow from the metro back to the farm town')
check(perishableShare('koc', 'blr', 7) < perishableShare('koc', 'blr', 10) * 0.5, 'the monsoon fishing ban thins Kochi fish')
check(perishableShare('blr', 'maa', 4) === 0, 'metro-to-metro lanes carry no produce')

// Market timing
check(reachesMorningMarket(21, 0, 8), 'a 21:00 overnight run lands 05:00 for the market')
check(!reachesMorningMarket(9, 0, 8), 'a 09:00 departure lands 17:00, too late')

// Loading: Madurai -> Chennai in April
const s = newGame('Perishables', 'seth', 'mdu-maa', 11)
s.day = fromCivil(2025, 4, 10)
const mgr = { id: 'm1', name: 'Desk', role: 'manager', skill: 8, salary: 3_000_000, loyalty: 80, morale: 80, fatigue: 0, safety: 7, hiredDay: s.day } as unknown as Staff
s.staff[mgr.id] = mgr
appointCargoManager(s, mgr.id)
const route = ROUTES['mdu-maa']!
// Madurai is the origin of 'mdu-maa' in the AB direction.
const dir: 'AB' | 'BA' = route.from === 'mdu' ? 'AB' : 'BA'
const mkTrip = (id: string, depHour: number) => {
  s.trips[id] = { id, scheduleId: 'x', routeId: route.id, direction: dir, busId: 'b', day: s.day, depHour, depMin: 0, fare: 0, seats: [], seatCount: 36, sold: 0, revenue: 0, cancelledRevenue: 0, channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }, status: 'open' } as Trip
}
mkTrip('night', 21)
mkTrip('day', 9)
const deps = (['night', 'day'] as const).map((id) => ({ tripId: id, routeId: route.id, capKg: 400, depHour: id === 'night' ? 21 : 9, depMin: 0, isCargo: false }))
const poolA = makeCorridorCargoPool(s, route, dir, deps)
poolA.state.parcelBookKg = 2_000
const night = allocateCargoForTrip(s, poolA, route, 'night', 400, false)
const poolB = makeCorridorCargoPool(s, route, dir, deps)
poolB.state.parcelBookKg = 2_000
const day = allocateCargoForTrip(s, poolB, route, 'day', 400, false)
console.log(`     night: ${night.walkupKg} kg (perishable ${night.perishableKg}), ₹${Math.round(night.walkupRevenue / 100)} · day: ${day.walkupKg} kg (perishable ${day.perishableKg}), ₹${Math.round(day.walkupRevenue / 100)}`)
check((night.perishableKg ?? 0) > 0, 'the overnight coach carries jasmine')
check((day.perishableKg ?? 0) === 0, 'the 09:00 coach carries no produce')
const perRate = (night.perishableRevenue ?? 0) / Math.max(1, night.perishableKg ?? 0)
const plainRate = (night.walkupRevenue - (night.perishableRevenue ?? 0)) / Math.max(1, night.walkupKg - (night.perishableKg ?? 0))
check(Math.abs(perRate / plainRate - (1 + PERISHABLE_RATE_PREMIUM)) < 0.02, `perishables pay the ${Math.round(PERISHABLE_RATE_PREMIUM * 100)}% time premium`)
check(night.walkupRevenue > day.walkupRevenue, 'the market-timed departure earns more from its parcels')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
