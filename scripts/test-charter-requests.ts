/**
 * Charter requests respond to the game: volume follows the charter fleet,
 * brand and month; most come from the base city; clients book weeks ahead;
 * tours away from base pay an empty run; and quotes can lose to rivals.
 */
import { newGame } from '../src/engine/newGame'
import { CHARTER_DEMAND } from '../src/engine/data/charterRates'
import { CHARTER_ROUTES } from '../src/engine/data/charterRoutes'
import { charterRequestRate, charterWinChance, cityRoadKm, generateCharterInquiries, getCharterConfig, quoteCharterForBus } from '../src/engine/sim/charter'
import { fromCivil } from '../src/engine/core/calendar'
import type { Bus, CharterContract, GameState } from '../src/engine/types'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

const good = { engine: 85, gearbox: 85, brakes: 85, suspension: 85, electrical: 85, ac: 85, body: 85 }
const coach = (s: GameState, id: string, modelId = 'cheetah'): Bus => {
  const b = {
    id, reg: `TN 01 CR ${id}`, modelId, ownership: 'owned', duty: 'charter', status: 'active',
    acquiredDay: s.day, odometer: 50_000, condition: { ...good }, qualityScore: 4, busCleanliness: 85,
    insuranceExpiryDay: s.day + 400, fitnessExpiryDay: s.day + 400, pucExpiryDay: s.day + 400, roadTaxPayableDay: s.day + 400,
  } as unknown as Bus
  s.buses[id] = b
  return b
}

// Volume
const s = newGame('Charter Requests', 'seth', 'maa-blr', 42)
getCharterConfig(s).operatingBaseCityId = 'maa'
s.day = fromCivil(2025, 7, 10)
const july0 = charterRequestRate(s)
coach(s, 'c1')
const july1 = charterRequestRate(s)
for (let i = 2; i <= 4; i++) coach(s, `c${i}`)
const july4 = charterRequestRate(s)
s.day = fromCivil(2025, 12, 10)
const dec4 = charterRequestRate(s)
s.company.rating = 4.6
const dec4Rated = charterRequestRate(s)
console.log(`     requests/day: no coach ${july0.toFixed(2)}, 1 coach ${july1.toFixed(2)}, 4 coaches ${july4.toFixed(2)} (July), ${dec4.toFixed(2)} (December), ${dec4Rated.toFixed(2)} (December, 4.6★)`)
check(july1 > july0 && july4 > july1 && july4 < july1 * 4, 'more charter coaches bring more requests, with diminishing returns')
check(dec4 > july4 * 1.5, 'wedding and pilgrimage season is far busier than the monsoon')
check(dec4Rated > dec4, 'a better rating brings more requests')

// Where requests come from, lead times, answer window
function sample(base: string, days: number): CharterContract[] {
  const st = newGame('Charter Sample', 'seth', 'maa-blr', 7)
  st.company.homeCityId = base
  getCharterConfig(st).operatingBaseCityId = base
  for (let i = 1; i <= 4; i++) coach(st, `s${i}`)
  st.day = fromCivil(2025, 11, 1)
  const out: CharterContract[] = []
  for (let d = 0; d < days; d++) {
    st.charterInquiries = []
    generateCharterInquiries(st)
    for (const inq of st.charterInquiries) out.push({ ...inq, offeredDay: st.day } as CharterContract & { offeredDay: number })
    st.day++
  }
  return out
}
const fromMaa = sample('maa', 120)
const homeShare = fromMaa.filter((i) => i.originCityId === 'maa').length / fromMaa.length
console.log(`     Chennai base: ${fromMaa.length} requests, ${(homeShare * 100).toFixed(0)}% start in Chennai`)
check(homeShare > 0.6, 'most requests start in the base city')
check(fromMaa.filter((i) => i.originCityId === 'maa').every((i) => (i.positioningKm ?? 0) === 0), 'tours from the base city have no empty run')
check(fromMaa.filter((i) => i.originCityId !== 'maa').every((i) => (i.positioningKm ?? 0) === 2 * cityRoadKm('maa', i.originCityId)), 'tours elsewhere carry the empty run there and back')

const fromBlr = sample('blr', 60)
console.log(`     Bengaluru base (no tours start there): nearest origins ${[...new Set(fromBlr.map((i) => i.originCityId))].join(', ')}`)
check(fromBlr.length > 0 && fromBlr.every((i) => (i.positioningKm ?? 0) > 0), 'a base with no local tours still gets requests, all with an empty run')

const leads = fromMaa.map((i) => i.startDay - (i as CharterContract & { offeredDay: number }).offeredDay)
const lastMinute = leads.filter((l) => l <= 6).length / leads.length
console.log(`     lead days: min ${Math.min(...leads)}, max ${Math.max(...leads)}, last-minute ${(lastMinute * 100).toFixed(0)}%`)
check(Math.max(...leads) <= 45 && Math.min(...leads) >= 1, 'clients book 1-45 days ahead')
check(lastMinute > 0.05 && lastMinute < 0.30, 'a minority of requests are last-minute')
const weddings = fromMaa.filter((i) => i.category === 'wedding')
check(weddings.every((i) => {
  const l = i.startDay - (i as CharterContract & { offeredDay: number }).offeredDay
  return l <= 6 || l >= CHARTER_DEMAND.leadDays.wedding![0]
}), 'weddings book furthest ahead (unless last-minute)')
check(fromMaa.every((i) => i.respondByDay !== undefined && i.respondByDay < i.startDay
  && i.respondByDay <= (i as CharterContract & { offeredDay: number }).offeredDay + CHARTER_DEMAND.answerDays), 'clients wait a few days for an answer, never past the tour')

// Empty run costs us, not the client
const s2 = newGame('Charter Run', 'seth', 'maa-blr', 11)
const bus = coach(s2, 'r1')
const route = CHARTER_ROUTES.find((r) => r.originCityId === 'cbe')!
const inq = (positioningKm: number, strategy: CharterContract['pricingStrategy'] = 'market'): CharterContract => ({
  id: `t_${positioningKm}_${strategy}`, title: route.title, category: route.category, clientName: 'Test', originCityId: route.originCityId,
  destinationName: route.destinationName, roundTripKm: route.roundTripKm, durationDays: route.durationDays,
  preferredCoachKind: route.preferredCoachKind, minSeats: 10, minCondition: 50, payout: 1, fuelCostEst: 0, tollCostEst: 0,
  driverBataEst: 0, netProfitEst: 0, startDay: s2.day + 20, endDay: s2.day + 20 + route.durationDays - 1, currentDayProgress: 0,
  status: 'inquiry', pricingStrategy: strategy, seasonMult: 1, positioningKm,
})
const local = quoteCharterForBus(s2, inq(0), bus)
const away = quoteCharterForBus(s2, inq(2 * cityRoadKm('maa', 'cbe')), bus)
console.log(`     same tour, same coach: margin ${local.costs.marginPct}% from base vs ${away.costs.marginPct}% with a ${2 * cityRoadKm('maa', 'cbe')} km empty run`)
check(away.costs.totalDirectCost > local.costs.totalDirectCost, 'the empty run adds to our cost')
check(away.costs.marginPct < local.costs.marginPct, 'tours away from base earn a thinner margin')
check(charterWinChance(s2, inq(2 * cityRoadKm('maa', 'cbe')), bus) < charterWinChance(s2, inq(0), bus), 'a quote pushed up by a long empty run loses to local operators more often')

// Rival bids
const longRoute = CHARTER_ROUTES.reduce((a, b) => (b.roundTripKm > a.roundTripKm ? b : a))
const longInq = (strategy: CharterContract['pricingStrategy']): CharterContract => ({ ...inq(0, strategy), roundTripKm: longRoute.roundTripKm, durationDays: longRoute.durationDays })
const wDisc = charterWinChance(s2, longInq('discount'), bus)
const wMkt = charterWinChance(s2, longInq('market'), bus)
const wPrem = charterWinChance(s2, longInq('premium'), bus)
console.log(`     win chance on a long tour: discount ${(wDisc * 100).toFixed(0)}%, market ${(wMkt * 100).toFixed(0)}%, premium ${(wPrem * 100).toFixed(0)}%`)
check(wDisc > wMkt && wMkt >= wPrem, 'cheaper quotes win more bids')
s2.company.rating = 4.5
check(charterWinChance(s2, longInq('market'), bus) > wMkt, 'a better rating wins more bids at the same fee')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
