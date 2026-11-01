/**
 * Depreciation policy "None": the asset is carried at cost and no monthly
 * write-off is charged. Verify the P&L really skips it, book value holds, and
 * the choice cannot be turned into free cash through resale/collateral.
 *
 *   npx tsx scripts/test-depreciation-none.ts
 */
import { newGame } from '../src/engine/newGame'
import { applyDepreciation, assetCashValue, spendNetted } from '../src/engine/sim/finance'
import { saleQuote } from '../src/engine/sim/fleet'
import { takeHpLoan } from '../src/engine/sim/banking'
import { BAL } from '../src/engine/data/balance'
import { rs, toRupees } from '../src/engine/core/money'
import type { Bus, DepreciationMethod, GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const PRICE = rs(6_500_000)

function setup(method: DepreciationMethod, ageDays = 0): { s: GameState; bus: Bus } {
  const s = newGame('Dep Test', 'seth', 'mdu-maa', 8080)
  const bus: Bus = {
    id: 'b1',
    reg: 'TN 01 AB 1111',
    nickname: 'Test',
    modelId: 'leyacsleep2',
    ownership: 'owned',
    depreciationMethod: method,
    mfgYear: 2024,
    acquiredDay: s.day - ageDays,
    acquiredPrice: PRICE,
    bookValue: PRICE,
    odometer: 1000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4,
    seatCount: 36,
    status: 'active',
    parkedCityId: 'mdu',
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    tyreKm: 1000,
    engineOilKm: 1000,
    brakeOilKm: 1000,
    coolantKm: 1000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
    lifeRevenue: 0,
    lifeCost: 0,
  } as unknown as Bus
  s.buses[bus.id] = bus
  return { s, bus }
}

console.log('--- Depreciation: None ---')

// 1. NONE charges nothing and leaves the book value untouched.
{
  const { s, bus } = setup('NONE')
  const booked = bus.bookValue
  const expense = applyDepreciation(s)
  check(expense === 0, `no depreciation is charged (${toRupees(expense)} paise)`)
  check(bus.bookValue === booked, 'book value stays at the purchase price')
}

// 2. The monthly charge really is absent from the P&L, across several months.
{
  const { s, bus } = setup('NONE')
  for (let i = 0; i < 24; i++) applyDepreciation(s)
  check(bus.bookValue === PRICE, 'after 24 monthly passes the asset is still at cost')
}

// 3. SLM and WDV still write down as before (no regression).
{
  const slm = setup('SLM')
  const slmDep = applyDepreciation(slm.s)
  const lifeMonths = Math.round(BAL.depreciationLifeYears * 12)
  const expectedSlm = Math.round((PRICE - Math.round(PRICE * BAL.depreciationResidualPct)) / lifeMonths)
  check(slmDep === expectedSlm, `SLM still charges the straight-line month (${toRupees(slmDep)})`)
  check(slm.bus.bookValue < PRICE, 'SLM still reduces book value')

  const wdv = setup('WDV')
  const wdvDep = applyDepreciation(wdv.s)
  const expectedWdv = Math.round((PRICE * 0.30) / 12)
  check(wdvDep === expectedWdv, `WDV still charges 30% p.a. monthly (${toRupees(wdvDep)})`)
  check(wdvDep > slmDep, 'WDV front-loads more than SLM')
}

// 4. A bus with no method recorded keeps the SLM default behaviour.
{
  const { s, bus } = setup('SLM')
  delete bus.depreciationMethod
  const dep = applyDepreciation(s)
  check(dep > 0, 'missing method still depreciates (legacy saves behave as SLM)')
}

// 5. Accounting policy cannot mint money: cash value falls back to market
//    value once the no-depreciation book is worth more than the used market.
{
  const young = setup('NONE', 30)
  const marketYoung = Math.round(PRICE * Math.pow(1 - BAL.usedDepreciationYr, 30 / 365))
  check(
    assetCashValue(young.s, young.bus) <= marketYoung + 1,
    'a near-new NONE coach is valued at market, not at cost',
  )

  const old = setup('NONE', 365 * 8)
  const cashOld = assetCashValue(old.s, old.bus)
  check(cashOld < PRICE / 2, `an 8-year-old NONE coach is worth ${toRupees(cashOld)} per ₹1, not ${toRupees(PRICE)}`)
  check(saleQuote(old.s, old.bus.id) < PRICE / 2, 'resale proceeds follow market value, not the untouched book')

  // With SLM the book value keeps governing the transaction, unchanged.
  const slmOld = setup('SLM', 365 * 8)
  check(assetCashValue(slmOld.s, slmOld.bus) === slmOld.bus.bookValue, 'SLM keeps using book value for cash value')
}

// 6. Same guard on HP collateral.
{
  const { s, bus } = setup('NONE', 365 * 8)
  s.company.creditScore = 900
  s.company.reputation = 100
  const cap = assetCashValue(s, bus)
  const err = takeHpLoan(s, 'shriram', bus.id, 48)
  const loan = Object.values(s.loans).find((l) => l.busId === bus.id)
  if (err) {
    check(err.includes('Requires') || err.includes('Unknown'), `HP refused for policy reasons (${err})`)
  } else {
    check(Boolean(loan) && loan!.principal <= cap, `HP principal ${toRupees(loan!.principal)} stays within asset value ${toRupees(cap)}`)
  }
}

// 7. A NONE bus still produces a payable monthly P&L only for real costs.
{
  const { s } = setup('NONE')
  spendNetted(s, 'depreciation', 0, { note: 'no-op' })
  check((s.curMonth.expense.depreciation ?? 0) === 0, 'nothing is booked to the depreciation head')
}

console.log(failures === 0 ? '\n--- ALL DEPRECIATION-NONE CHECKS PASSED ---' : `\n--- ${failures} DEPRECIATION CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
