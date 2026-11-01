/**
 * Layout-vs-haul mismatch should be a discount, not a death sentence.
 *
 * A seater coach on a night haul, berths on a short day hop, and the rear
 * cabin of a hybrid on an overnight run all lose some demand — but they still
 * sell to price-led travellers. These checks pin the softened curves so a
 * future balance pass cannot quietly crush a whole layout again.
 */
import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { createSchedule } from '../src/engine/sim/schedules'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import type { Bus, GameState } from '../src/engine/types'

function makeBus(s: GameState, modelId: string): Bus {
  const model = BUS_MODELS[modelId]!
  return {
    id: 'b1',
    reg: 'TN 01 AB 1111',
    modelId,
    status: 'active',
    odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2,
    seatCount: model.seats,
    acquisitionDay: 1,
    purchasePrice: 6500000,
    parkedCityId: 'maa',
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    tyreKm: 5000,
    engineOilKm: 5000,
    brakeOilKm: 5000,
    coolantKm: 5000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
  } as unknown as Bus
}

function estimate(routeId: string, modelId: string, depHour: number) {
  const s = newGame('Layout Test', 'seth', routeId, 4242)
  refreshMarkets(s)
  s.buses['b1'] = makeBus(s, modelId)
  const res = createSchedule(s, {
    routeId,
    depHour,
    depMin: 0,
    autoPrice: true,
    redDeal: false,
    cancellation: 'standard',
  } as never)
  if ('error' in res) throw new Error(res.error)
  s.schedules[res.id]!.busIds = ['b1']
  generateTrips(s)
  // Weekly peak nights are priced ~12% higher and fill less by design; use the
  // cheapest (midweek base fare) departure so the check reads the normal night.
  const trip = Object.values(s.trips)
    .filter((t) => t.scheduleId === res.id && t.status === 'open')
    .sort((a, b) => a.fare - b.fare || a.day - b.day)[0]!
  return tripLoadFactor(s, trip, 5, buildBookingCtx(s))
}

function check(name: string, lf: number, lo: number, hi = 1) {
  const pct = (lf * 100).toFixed(1)
  if (lf < lo || lf > hi) {
    console.error(`FAIL: ${name} — expected ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%, got ${pct}%`)
    process.exit(1)
  }
  console.log(`✓ ${name}: ${pct}%`)
}

console.log('--- Layout mismatch penalties are discounts, not write-offs ---')

// Overnight haul (8h, 21:00): berths are the right product, a seater still half-sells.
// (Slightly under 70% since the booking window was shortened to 7 days — fares are
// now set from a shorter lead-time curve, which trims the sleeper target a little.)
const nightSleeper = estimate('mdu-maa', 'leyacsleep2', 21)
const nightSeater = estimate('mdu-maa', 'volvo9400semi', 21)
check('sleeper on an 8h night haul', nightSleeper.target, 0.70)
check('seater on an 8h night haul', nightSeater.target, 0.42, 0.62)
if (nightSeater.target >= nightSleeper.target) {
  console.error('FAIL: a seater on a night haul should still trail a sleeper')
  process.exit(1)
}

// Same coach in hybrid form: berths fill, the rear cabin still takes a real book.
const nightHybrid = estimate('mdu-maa', 'leyhybrid', 21)
if (!nightHybrid.hybrid) throw new Error('FAIL: expected hybrid zone targets')
const slp = nightHybrid.hybrid.sleeperTarget
const str = nightHybrid.hybrid.seaterTarget
if (slp < 0.90) {
  console.error(`FAIL: hybrid berths on a night haul should stay near-full, got ${(slp * 100).toFixed(0)}%`)
  process.exit(1)
}
if (str < 0.38 || str > 0.65) {
  console.error(`FAIL: hybrid rear cabin on a night haul expected 38-65%, got ${(str * 100).toFixed(0)}%`)
  process.exit(1)
}
console.log(`✓ hybrid night coach — berths ${(slp * 100).toFixed(0)}%, rear cabin ${(str * 100).toFixed(0)}%`)

// Mid haul (6.5h, 21:00): neither layout is wrong, so the gap stays narrow.
const midSeater = estimate('blr-maa', 'volvo9400semi', 21)
const midSleeper = estimate('blr-maa', 'leyacsleep2', 21)
check('seater on a 6.5h mid haul', midSeater.target, 0.44)
check('sleeper on a 6.5h mid haul', midSleeper.target, 0.50)
if (Math.abs(midSleeper.target - midSeater.target) > 0.18) {
  console.error('FAIL: mid-haul layout gap is too wide — both layouts work on a 6.5h run')
  process.exit(1)
}

// Short day hop (5.5h): seats win, but a sleeper still sells to night-shift demand.
check('sleeper on a 5.5h day hop', estimate('mys-cbe', 'leyacsleep2', 9).target, 0.43, 0.62)

console.log('\n--- ALL LAYOUT MISMATCH CHECKS PASSED ---')
