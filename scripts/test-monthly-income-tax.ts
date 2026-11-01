/**
 * Income tax is provided and paid every month end, not settled in one lump
 * when the financial year closes.
 *   npx tsx scripts/test-monthly-income-tax.ts
 */
import { newGame } from '../src/engine/newGame'
import { earn, spend, closeMonth } from '../src/engine/sim/finance'
import { monthlyTaxPass, incomeTaxOn } from '../src/engine/sim/tax'
import { isMonthEnd, toCivil, MONTH_SHORT } from '../src/engine/core/calendar'
import { BAL } from '../src/engine/data/balance'
import { rs } from '../src/engine/core/money'
import type { GameState, MonthlySummary } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const RATE = BAL.incomeTaxRate
const lakh = (v: number) => `₹${(v / 1_00_00_000).toFixed(1)}L`
const monthOf = (ym: string) => Number(ym.split('-')[1]!)
const monthLabel = (ym: string) => {
  const [y] = ym.split('-')
  return `${MONTH_SHORT[monthOf(ym) - 1]}${String(y).slice(2)}`
}
const yearOf = (ym: string) => Number(ym.split('-')[0]!)

interface Closed {
  summary: MonthlySummary
  day: number
  fyProfitAfter: number
  taxPaidAfter: number
}

/**
 * Walk calendar days, booking a daily P&L result, and run the real month-end
 * sequence (tax provision, then close the month).
 */
function play(
  seed: number,
  days: number,
  daily: (day: number) => number,
): { s: GameState; closed: Closed[] } {
  const s: GameState = newGame('Tax', 'seth', 'blr-hyd', seed)
  s.company.cash = rs(5_00_00_000)
  const firstDay = s.day + 1
  const closed: Closed[] = []
  for (let i = 0; i < days; i++) {
    const d = firstDay + i
    s.day = d
    const p = daily(d)
    if (p >= 0) earn(s, 'ticket', p)
    else spend(s, 'office_admin', -p, { note: 'test loss' })
    if (isMonthEnd(d)) {
      monthlyTaxPass(s)
      const summary = closeMonth(s)
      closed.push({
        summary,
        day: d,
        fyProfitAfter: s.company.fyProfit,
        taxPaidAfter: s.company.advanceTaxPaid,
      })
    }
  }
  return { s, closed }
}

// --- a steady, profitable year ---------------------------------------------
const steady = play(7, 400, () => rs(9_00_000))
const steadyMonths = steady.closed.map((c) => c.summary)
const taxByMonth = steadyMonths.map((m) => m.expense.income_tax ?? 0)
console.log('\nSteady profitable year (₹9L revenue a day)')
console.log('   ' + steadyMonths.map((m, i) => `${monthLabel(m.ym)} ${lakh(taxByMonth[i]!)}`).join(' · '))

check(taxByMonth.every((t) => t > 0), 'income tax is charged in every profitable month, not only at FY close')
const avg = taxByMonth.reduce((a, b) => a + b, 0) / taxByMonth.length
const max = Math.max(...taxByMonth)
check(max / avg < 1.6, `monthly charges are even, no year-end lump (max ${lakh(max)} vs mean ${lakh(avg)})`)

const drift = steadyMonths.slice(1, 8).map((m) => {
  const preTax = m.profit + (m.expense.income_tax ?? 0)
  return Math.abs((m.expense.income_tax ?? 0) - preTax * RATE) / Math.max(1, preTax * RATE)
})
check(drift.every((d) => d < 0.05), `each month carries about ${Math.round(RATE * 100)}% of that month’s own pre-tax profit`)

// --- a full financial year: total provided == statutory charge --------------
{
  const { s, closed } = play(11, 420, () => rs(7_00_000))
  // Group closed months into FYs (Apr..Mar) and compare tax to the statutory rate of pre-tax profit.
  const byFy = new Map<number, { preTax: number; tax: number }>()
  for (const { summary: m } of closed) {
    const mo = monthOf(m.ym)
    const fy = mo >= 4 ? yearOf(m.ym) : yearOf(m.ym) - 1
    const row = byFy.get(fy) ?? { preTax: 0, tax: 0 }
    const tax = m.expense.income_tax ?? 0
    row.preTax += m.profit + tax
    row.tax += tax
    byFy.set(fy, row)
  }
  console.log('\nProvision vs statutory charge by financial year')
  for (const [fy, row] of [...byFy.entries()].sort((a, b) => a[0] - b[0])) {
    const expected = incomeTaxOn(row.preTax)
    const ok = Math.abs(row.tax - expected) <= Math.max(2, Math.round(expected * 0.02))
    console.log(`   FY${fy}: pre-tax ${lakh(row.preTax)} · provided ${lakh(row.tax)} · statutory ${lakh(expected)} ${ok ? '✓' : '✗'}`)
    check(ok, `FY${fy} provisions add up to the year's tax charge`)
  }
  const march = closed.find((c) => monthOf(c.summary.ym) === 3)
  check(march !== undefined, 'walked through a March close')
  check(march!.fyProfitAfter === 0, 'fyProfit reset to zero at FY close')
  check(s.company.fyProfit > 0, 'the new financial year has started accruing')
}

// --- a loss month pays nothing ---------------------------------------------
{
  const { s, closed } = play(13, 260, (d) => {
    const civ = toCivil(d)
    // Two solid months, a deep loss month, then normal trading.
    return civ.m === 6 ? -rs(12_00_000) : rs(6_00_000)
  })
  const tax = closed.map((c) => c.summary.expense.income_tax ?? 0)
  console.log('\nLoss month (Jun): ' + closed.map((c, i) => `${monthLabel(c.summary.ym)} ${lakh(tax[i]!)}`).join(' · '))
  const lossIdx = closed.findIndex((c) => monthOf(c.summary.ym) === 6)
  const normal = tax[lossIdx - 1]!
  check(lossIdx >= 0, 'found the loss month')
  check(tax[lossIdx] === 0, 'a loss month is not taxed')
  check(
    tax.slice(lossIdx, lossIdx + 3).every((t) => t <= normal),
    'the months after it pay no catch-up lump',
  )
  check(tax.slice(lossIdx + 1).some((t) => t > 0), 'provisioning resumes once cumulative profit recovers')
  check(s.company.advanceTaxPaid >= 0, 'provided total never goes negative')
}

// --- over-provision carries into the next FY -------------------------------
{
  const { s, closed } = play(17, 420, (d) => {
    const civ = toCivil(d)
    // Profitable, then a heavy loss right at the March close.
    return civ.m === 3 && civ.d > 24 ? -rs(25_00_000) : rs(5_00_000)
  })
  const march = closed.find((c) => monthOf(c.summary.ym) === 3)!
  console.log('\nOver-provision at FY close: advance-tax credit carried = ' + lakh(march.taxPaidAfter))
  check(march !== undefined, 'walked through a March close')
  check(march.fyProfitAfter === 0, 'FY closed and reset')
  check(s.company.taxProvision === 0, 'no stale tax liability left on the balance sheet')
  check(march.taxPaidAfter > 0, 'excess provision is carried forward as an advance-tax credit')
}

// --- tax never feeds back into its own base --------------------------------
{
  const s: GameState = newGame('Tax', 'seth', 'blr-hyd', 19)
  s.day += 1
  const preTax = rs(10_00_00_000)
  earn(s, 'ticket', preTax)
  const before = s.company.fyProfit
  const tax = incomeTaxOn(preTax)
  s.company.cash = rs(5_00_00_000)
  spend(s, 'income_tax', tax, { note: 'test provision' })
  check(s.company.fyProfit === before, 'income tax does not shrink the taxable base it is computed from')
  check(Math.abs(s.curMonth.profit - (preTax - tax)) <= 1, 'but it does reduce net profit in the month')
  check(tax === Math.round(preTax * RATE), `charge is ${Math.round(RATE * 100)}% of pre-tax profit`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
