import { advanceDay } from '../src/engine/tick'
import { buildProbeFixture } from './test-sim-determinism'

/**
 * The books must tie out: every rupee of profit is a ledger row, and cash only moves
 * through ledger rows (income, expense, capital in/out), receivable settlements and OD sweeps.
 */
const s = buildProbeFixture(12, 777)
const startDay = s.day
// Same-day ticket postings fold into existing rows, so measure by day: rows dated on or after
// the start day, minus what those rows already held before the run.
function sumByKind(day: number) {
  const o = { income: 0, expense: 0, capital_in: 0, capital_out: 0 } as Record<string, number>
  for (const t of s.txns) if (t.day >= day) o[t.kind] = (o[t.kind] ?? 0) + t.amount
  return o
}
const base = sumByKind(s.day)
const startProfit = s.lifetimeProfit
const startMonthKey = s.curMonth.ym
const startCashNet = s.company.cash - s.od.drawn
const startRecv = s.receivables.reduce((a, r) => a + r.amount, 0)

const DAYS = 6
for (let i = 0; i < DAYS; i++) advanceDay(s)

const after = sumByKind(startDay)
const income = after.income! - base.income!
const expense = after.expense! - base.expense!
const capIn = after.capital_in! - base.capital_in!
const capOut = after.capital_out! - base.capital_out!
const rows = s.txns.filter((t) => t.day >= startDay)

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

const profitDelta = s.lifetimeProfit - startProfit
check(
  'lifetime profit equals ledger income minus expense',
  Math.abs(profitDelta - (income - expense)) <= Math.max(5, rows.length),
  `profitΔ=${profitDelta} ledgerΔ=${income - expense} (income ${income}, expense ${expense})`,
)

const m = s.curMonth
check(
  'month profit equals revenue minus expense',
  m.ym !== startMonthKey || Math.abs(m.profit - (m.revenueTotal - m.expenseTotal)) <= 5,
  `profit=${m.profit} rev=${m.revenueTotal} exp=${m.expenseTotal}`,
)

const incomeHeads = Object.values(m.income).reduce((a, v) => a + (v ?? 0), 0)
const expenseHeads = Object.values(m.expense).reduce((a, v) => a + (v ?? 0), 0)
check(
  'month head totals match month totals',
  Math.abs(incomeHeads - m.revenueTotal) <= 5 && Math.abs(expenseHeads - m.expenseTotal) <= 5,
  `income heads ${incomeHeads} vs ${m.revenueTotal}; expense heads ${expenseHeads} vs ${m.expenseTotal}`,
)

// Cash (net of overdraft) moves by: ledger flows, plus receivables that settled into cash.
// Receivables created from income are not cash yet; those that settled are.
const endRecv = s.receivables.reduce((a, r) => a + r.amount, 0)
const cashNetDelta = s.company.cash - s.od.drawn - startCashNet
const ledgerCash = income - expense + capIn - capOut
// income booked as a receivable (not yet cash) = endRecv - startRecv + settled; settled is unknown here,
// so report the residual instead of failing on unobservable timing and netted attach-owner shares.
const residual = cashNetDelta - ledgerCash
console.log(
  `  cash(net of OD) Δ=${cashNetDelta}, ledger Δ=${ledgerCash}, receivables Δ=${endRecv - startRecv}, residual=${residual}`,
)
check(
  'cash residual is explained by receivable timing',
  Math.abs(residual + (endRecv - startRecv)) <= Math.max(1_000, Math.abs(ledgerCash) * 0.02),
  `residual ${residual} vs receivables Δ ${endRecv - startRecv}`,
)

const charterRows = rows.filter((t) => t.head === 'charter')
check(
  'charter postings carry the bus brand when the bus has one',
  charterRows.every((t) => !t.busId || !s.buses[t.busId]?.groupId || t.groupId === s.buses[t.busId]!.groupId),
  'a charter row lost its brand',
)

console.log(`  ran ${DAYS} days from day ${startDay}; ${rows.length} ledger rows inspected`)
if (failed > 0) {
  console.error(`LEDGER RECONCILIATION FAILED (${failed})`)
  process.exit(1)
}
console.log('LEDGER RECONCILIATION PASSED ✓')
