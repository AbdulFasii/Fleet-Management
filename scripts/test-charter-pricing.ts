/**
 * Charter pricing: priced by the vehicle rented, never more than 50% profit,
 * never below cost + 5%, and the fee is fixed when a coach is chosen.
 */
import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { CHARTER_ROUTES } from '../src/engine/data/charterRoutes'
import { CHARTER_MAX_MARGIN, CHARTER_MIN_MARKUP, charterRateBand, charterRatePerKm } from '../src/engine/data/charterRates'
import { acceptCharterInquiry, priceCharterForVehicle, quoteCharterForBus } from '../src/engine/sim/charter'
import { calculateCharterQuote as festivalQuote } from '../src/engine/sim/festival'
import { ROUTES } from '../src/engine/data/routes'
import { recruitVeteran } from '../src/engine/sim/staffing'
import { rs } from '../src/engine/core/money'
import type { Bus, CharterContract, CharterPricingStrategy } from '../src/engine/types'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

const s = newGame('Charter Pricing', 'seth', 'maa-blr', 42)
const good = { engine: 85, gearbox: 85, brakes: 85, suspension: 85, electrical: 85, ac: 85, body: 85 }

// Rates rank by vehicle
const ladder = ['winger12', 'traveller17', 'urbania13', 'eicher32', 'bb1017_39', 'bb1017_24slp', 'cheetah', 'leyacsleep', 'volvo9400semi', 'volvo9600']
const rates = ladder.map((id) => charterRatePerKm(BUS_MODELS[id]!, 75))
console.log('     ₹/km:', ladder.map((id, i) => `${id} ${rates[i]}`).join(', '))
check(rates.every((r, i) => i === 0 || r > rates[i - 1]!), 'rates climb from vans to Volvo sleepers')
check(charterRateBand(BUS_MODELS['volvo9600']!).band[0] === 100, 'Volvo sleeper sits in the ₹100-120 band')
check(charterRatePerKm(BUS_MODELS['cheetah']!, 100) > charterRatePerKm(BUS_MODELS['cheetah']!, 50), 'a coach in better condition charges more')

// Fees rank by vehicle on a long tour, where the cap rarely binds
const tour = { roundTripKm: 1180, durationDays: 4 }
const fees = ladder.map((id) => priceCharterForVehicle(s, tour, 'market', 1, { modelId: id, condition: good }).payout)
check(fees.every((f, i) => i === 0 || f >= fees[i - 1]!), 'a bigger, better vehicle never quotes less on the same tour')

// Cap and floor across every route, vehicle and strategy
let worstHigh = 0
let worstLow = 1
let n = 0
for (const route of CHARTER_ROUTES) {
  for (const id of Object.keys(BUS_MODELS)) {
    const m = BUS_MODELS[id]!
    if (m.cls === 'CARGO') continue
    for (const strategy of ['discount', 'market', 'premium'] as CharterPricingStrategy[]) {
      for (const season of [1, 1.15 * 1.2]) {
        const q = priceCharterForVehicle(s, route, strategy, season, { modelId: id, condition: good })
        const margin = q.costs.netProfit / q.payout
        worstHigh = Math.max(worstHigh, margin)
        worstLow = Math.min(worstLow, q.payout / q.costs.totalDirectCost - 1)
        n++
      }
    }
  }
}
console.log(`     ${n} quotes: highest margin ${(worstHigh * 100).toFixed(2)}%, lowest markup ${(worstLow * 100).toFixed(2)}%`)
check(worstHigh <= CHARTER_MAX_MARGIN + 1e-9, 'no quote earns more than 50% profit')
check(worstLow >= CHARTER_MIN_MARKUP - 1e-9, 'no quote goes below cost + 5%')

// The fee is set by the coach actually chosen
const mk = (id: string, modelId: string): Bus => ({
  id, reg: `TN 01 CP ${id}`, modelId, ownership: 'owned', duty: 'charter', status: 'active',
  acquiredDay: s.day, odometer: 50_000, condition: { ...good }, qualityScore: 4, busCleanliness: 85,
  insuranceExpiryDay: s.day + 365, fitnessExpiryDay: s.day + 365, pucExpiryDay: s.day + 365, roadTaxPayableDay: s.day + 365,
} as unknown as Bus)
const van = mk('v1', 'traveller17')
const volvo = mk('v2', 'volvo9600')
s.buses[van.id] = van
s.buses[volvo.id] = volvo
const route = CHARTER_ROUTES.find((r) => r.minSeats <= 17)!
const base = makeInquiry(route)
function makeInquiry(r: typeof route): CharterContract {
  return {
    id: 'inq_test', title: r.title, category: r.category, clientName: 'Test', originCityId: r.originCityId,
    destinationName: r.destinationName, roundTripKm: r.roundTripKm, durationDays: r.durationDays,
    preferredCoachKind: r.preferredCoachKind, minSeats: r.minSeats, minCondition: 50, payout: rs(1),
    fuelCostEst: 0, tollCostEst: 0, driverBataEst: 0, netProfitEst: 0, startDay: s.day + 5, endDay: s.day + 5 + r.durationDays - 1,
    currentDayProgress: 0, status: 'inquiry', pricingStrategy: 'market', seasonMult: 1,
  }
}
const vanFee = quoteCharterForBus(s, base, van).payout
const volvoFee = quoteCharterForBus(s, base, volvo).payout
check(volvoFee > vanFee, 'the same tour costs the client more in a Volvo than in a van')
recruitVeteran(s, 'driver', { skill: [6, 7] })
recruitVeteran(s, 'driver', { skill: [6, 7] })
s.charterInquiries = [{ ...base }]
const err = acceptCharterInquiry(s, 'inq_test', volvo.id)
const signed = s.charterContracts?.find((c) => c.id === 'inq_test')
if (err) console.log(`     accept refused: ${err}`)
check(!err && signed?.payout === volvoFee, 'signing locks in the fee for the chosen coach')
check(!!signed && signed.netProfitEst / signed.payout <= CHARTER_MAX_MARGIN + 1e-9, 'the signed tour respects the profit cap')

// Festival group charters use the same rules
const fq = festivalQuote(s, volvo, ROUTES['maa-mdu']!)
check(fq.profit / fq.fee <= CHARTER_MAX_MARGIN + 1e-9 && fq.fee >= fq.totalExpenses * (1 + CHARTER_MIN_MARKUP) - rs(100), 'festival group charters are capped the same way')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
