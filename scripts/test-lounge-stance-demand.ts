/**
 * Lounges and corridor stance against a rival front-runner must move the
 * trip's target fill (they used to be computed and thrown away).
 */
import { newGame } from '../src/engine/newGame'
import { createSchedule } from '../src/engine/sim/schedules'
import { tripLoadFactor } from '../src/engine/sim/demand'
import { openLounge, getLoungeDemandBoost } from '../src/engine/sim/lounge'
import { setCorridorStance } from '../src/engine/sim/rivalIntelligence'
import { rs } from '../src/engine/core/money'
import { ROUTES } from '../src/engine/data/routes'
import { marketFare } from '../src/engine/sim/pricing'
import type { Bus, Trip } from '../src/engine/types'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

const s = newGame('Lounge Stance', 'seth', 'maa-blr', 42)
s.company.cash = rs(5_00_00_000)
const bus = {
  id: 'bus_ls_1', reg: 'TN 01 LS 0001', modelId: 'bb1624', ownership: 'owned',
  acquiredDay: s.day, purchaseCost: rs(35_00_000), odometer: 80_000, lastServiceOdo: 80_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, electrical: 90, ac: 90, body: 90 },
  status: 'active', parkedCityId: s.company.homeCityId, qualityScore: 3.6, lifeTrips: 5,
  gpsDeviceFitted: true, busCleanliness: 80,
  insuranceExpiryDay: s.day + 180, fitnessExpiryDay: s.day + 180, pucExpiryDay: s.day + 180, roadTaxPayableDay: s.day + 180,
} as unknown as Bus
s.buses[bus.id] = bus

const route = ROUTES['maa-blr']!
const res = createSchedule(s, {
  routeId: 'maa-blr', depHour: 21, depMin: 0, baseFare: route.marketFareAC, autoPrice: true,
  cancellation: 'standard', redDeal: false,
})
if ('error' in res) throw new Error(res.error)
const sch = s.schedules[res.id]!

// Pick a quiet midweek day so the target sits inside its band, away from the caps.
let day = s.day + 3
while ([0, 5, 6].includes(((day % 7) + 7) % 7)) day++
const trip: Trip = {
  id: 'ls_trip', scheduleId: sch.id, routeId: 'maa-blr', direction: 'AB', busId: bus.id,
  day, depHour: 21, depMin: 0, fare: 0, seats: [], seatCount: 40, sold: 0, revenue: 0,
  cancelledRevenue: 0, channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }, status: 'open',
}
// Price the trip at today's going rate so only lounge and stance move the fill.
trip.fare = marketFare(s, route, bus.modelId, day, 'AB', bus, 21, 0, sch.serviceTier)
const target = () => tripLoadFactor(s, trip, 3).target

const base = target()
console.log(`     base target ${(base * 100).toFixed(1)}%`)

// Lounge
const err = openLounge(s, 'maa', 'Koyambedu Omni Bus Stand', 'express')
check(err === null, 'lounge opens')
const boost = getLoungeDemandBoost(s, 'maa-blr')
const withLounge = target()
console.log(`     lounge boost x${boost.toFixed(3)} -> target ${(withLounge * 100).toFixed(1)}%`)
check(withLounge > base, 'a lounge on the corridor raises the fill')
check(Math.abs(withLounge / base - boost) < 0.005, 'the lift matches the advertised lounge boost')
s.company.lounges = []

// Rival front-running this departure (15 minutes ahead of 21:00)
s.world.rivalActions = {
  'maa-blr': {
    rivalId: 'kpn', rivalName: 'KPN Travels', routeId: 'maa-blr', tactic: 'predatory_timing',
    targetDepartureClocks: ['20:45'], fareDiscountPct: 0, addedDailySeats: 0,
    startDay: s.day, untilDay: s.day + 30, intensity: 'moderate', headline: '', details: '',
  },
}
const stanceTarget = (stance: Parameters<typeof setCorridorStance>[2]) => { setCorridorStance(s, 'maa-blr', stance); return target() }
const neutral = stanceTarget('neutral')
const undercut = stanceTarget('undercut')
const premium = stanceTarget('premium_hold')
const bundle = stanceTarget('cargo_bundle')
console.log(`     front-run: neutral ${(neutral * 100).toFixed(1)}%  undercut ${(undercut * 100).toFixed(1)}%  premium_hold ${(premium * 100).toFixed(1)}%  cargo_bundle ${(bundle * 100).toFixed(1)}%`)
check(neutral < base, 'an unanswered front-runner takes shoppers')
check(undercut > base, 'matching the rival on price wins shoppers back')
check(premium < base, 'premium hold without a 4-star coach still loses shoppers')
check(bundle > neutral && bundle < base, 'a cargo bundle softens the hit but does not erase it')
check(neutral / base > 0.88 && neutral / base < 0.92, 'an unanswered front-runner costs about 10%, not more')
check(premium > neutral && bundle > premium, 'any stance beats doing nothing')

bus.qualityScore = 4.2
const premiumGood = stanceTarget('premium_hold')
setCorridorStance(s, 'maa-blr', 'neutral')
s.world.rivalActions = {}
const baseGood = target()
console.log(`     4.2-star coach: premium_hold vs front-run ${(premiumGood * 100).toFixed(1)}%, no rival ${(baseGood * 100).toFixed(1)}%`)
check(premiumGood > baseGood, 'premium hold with a 4-star coach keeps passengers loyal')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
