/**
 * Depreciation rate is a separate choice from the depreciation method:
 * 5–30% p.a., locked in per coach at purchase, with NONE booking nothing.
 *
 *   npx tsx scripts/test-depreciation-rate.ts
 */
import { newGame } from '../src/engine/newGame'
import { applyDepreciation, monthlyDepreciationFor, depreciationLifeYears } from '../src/engine/sim/finance'
import { clampDepRate, purchaseDepRate, orderNewBus, deliverOrdersPass } from '../src/engine/sim/fleet'
import { BAL } from '../src/engine/data/balance'
import { rs, toRupees } from '../src/engine/core/money'
import type { Bus, DepreciationMethod, GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const MODEL = 'bb1824'

function buyNew(s: GameState): Bus {
  s.company.cash = rs(3_00_00_000)
  if (orderNewBus(s, MODEL, {}) !== null) throw new Error('order failed')
  s.day += 60
  deliverOrdersPass(s)
  const ids = Object.keys(s.buses)
  return s.buses[ids[ids.length - 1]!]!
}

// What a coach actually costs on order: the default body design is built on
// the chassis, so this is more than the bare chassis list price.
const COST = toRupees(buyNew(newGame('x', 'seth', 'mdu-maa', 90210)).acquiredPrice)

function run(rate: number, method: DepreciationMethod, months: number): { book: number; bus: Bus } {
  const s = newGame('Dep Rate', 'seth', 'mdu-maa', 90210)
  s.company.depreciationDefault = method
  s.company.depreciationRatePct = rate
  const bus = buyNew(s)
  for (let i = 0; i < months; i++) applyDepreciation(s)
  return { book: toRupees(bus.bookValue), bus }
}

const lac = (n: number) => (n / 1_00_000).toFixed(2)

console.log(`\ncoach price used: ₹${lac(COST)}L\n`)
console.log('rate band is 5–30, half-point steps')
check(BAL.depreciationRateMinPct === 5 && BAL.depreciationRateMaxPct === 30, 'the selectable band is 5% to 30%')
check(clampDepRate(1) === 5, 'below 5% clamps to 5%')
check(clampDepRate(99) === 30, 'above 30% clamps to 30%')
check(clampDepRate(12.3) === 12.5, 'rate snaps to the nearest 0.5%')
check(clampDepRate(Number.NaN) === BAL.depreciationStandardRate.SLM, 'garbage falls back to the standard rate')

console.log('\nSLM — the rate is the annual write-off')
const slm5 = run(5, 'SLM', 12).book
const slm30 = run(30, 'SLM', 12).book
console.log(`  book after year 1: 5% → ₹${lac(slm5)}L, 30% → ₹${lac(slm30)}L`)
check(Math.abs((COST - slm5) - COST * 0.05) < 2_000, `5% SLM writes off about ₹${lac(COST * 0.05)}L in year one`)
check(Math.abs((COST - slm30) - COST * 0.30) < 2_000, `30% SLM writes off about ₹${lac(COST * 0.30)}L in year one`)
check(slm5 > slm30, 'a lower rate leaves a higher book value')

console.log('\nWDV — the rate bites into the falling book')
const wdv5 = run(5, 'WDV', 24).book
const wdv30 = run(30, 'WDV', 24).book
console.log(`  book after year 2: 5% → ₹${lac(wdv5)}L, 30% → ₹${lac(wdv30)}L`)
check(wdv5 > wdv30, 'WDV at 5% keeps more book than at 30%')
check(wdv5 < COST, 'WDV still writes something off')
// Charged monthly, so 30% p.a. compounds to 80L × (1 − .30/12)^24 ≈ 43.6L.
check(
  Math.abs(wdv30 - COST * Math.pow(1 - 0.30 / 12, 24)) < 20_000,
  '30% WDV compounds on the falling book (≈55% of cost left after two years)',
)

console.log('\nNONE ignores the rate')
const none = run(30, 'NONE', 24).book
check(none === COST, 'a NONE coach still books at cost after two years')

console.log('\nsalvage floor and useful life')
check(monthlyDepreciationFor(rs(70_00_000), 'NONE', 30) === 0, 'no monthly write-off under NONE')
check(monthlyDepreciationFor(rs(70_00_000), 'SLM', 12) === Math.round(rs(70_00_000) * 0.12 / 12), 'SLM monthly = cost × rate ÷ 12')
check(monthlyDepreciationFor(rs(70_00_000), 'WDV', 30) === Math.round(rs(70_00_000) * 0.30 / 12), 'WDV monthly starts at cost × rate ÷ 12')
const life30 = depreciationLifeYears('SLM', 30)
const life5 = depreciationLifeYears('SLM', 5)
console.log(`  years to the 15% floor: 5% → ${life5.toFixed(1)}y, 30% → ${life30.toFixed(1)}y`)
check(life30 < life5, 'a higher rate reaches the salvage floor sooner')
const deep = run(30, 'SLM', 12 * 12).book
check(Math.abs(deep - COST * BAL.depreciationResidualPct) < 50_000, 'a 30% coach stops at the 15% salvage floor')

console.log('\npolicy is locked in per coach at purchase')
const s = newGame('Dep Lock', 'seth', 'mdu-maa', 555)
s.company.depreciationDefault = 'WDV'
s.company.depreciationRatePct = 20
const first = buyNew(s)
check(first.depreciationMethod === 'WDV' && first.depreciationRatePct === 20, 'coach stamps WDV at 20%')
s.company.depreciationDefault = 'SLM'
s.company.depreciationRatePct = 10
const second = buyNew(s)
check(first.depreciationRatePct === 20 && first.depreciationMethod === 'WDV', 'the older coach keeps its original policy')
check(second.depreciationRatePct === 10 && second.depreciationMethod === 'SLM', 'the next coach picks up the new policy')
check(purchaseDepRate(s) === 10, 'purchase rate follows the settings')

console.log('\nunset rate follows the standard for the method')
const s2 = newGame('Dep Std', 'seth', 'mdu-maa', 556)
s2.company.depreciationDefault = 'SLM'
delete s2.company.depreciationRatePct
check(purchaseDepRate(s2) === BAL.depreciationStandardRate.SLM, 'SLM falls back to its standard rate')
s2.company.depreciationDefault = 'WDV'
check(purchaseDepRate(s2) === BAL.depreciationStandardRate.WDV, 'WDV falls back to its standard rate')

console.log(failures === 0 ? '\nAll depreciation rate checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
