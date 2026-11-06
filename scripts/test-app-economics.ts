import { newGame } from '../src/engine/newGame'
import { L, rs } from '../src/engine/core/money'
import {
  appCacPerInstall,
  appMonthTally,
  appOrganicRate,
  appPaidInstalls,
  monthlyAppPass,
  setMarketingBudget,
} from '../src/engine/sim/channels'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
  console.log(`  ok  ${msg}`)
}

const s = newGame('App Economics', 'seth', 'blr_che', 11)
s.company.app.tier = 1
s.company.cash = L(5000)

// rising cost per install
const c1 = appCacPerInstall(s, L(1))
const c5 = appCacPerInstall(s, L(5))
const c20 = appCacPerInstall(s, L(20))
assert(c1 < c5 && c5 < c20, 'cost per install rises with monthly spend')
assert(appCacPerInstall(s, 0) <= c1, 'a tiny budget pays the lowest price')
const i1 = appPaidInstalls(s, L(1))
const i5 = appPaidInstalls(s, L(5))
const i20 = appPaidInstalls(s, L(20))
assert(i1 < i5 && i5 < i20, 'more spend still buys more installs')
assert(i5 < 5 * i1 && i20 < 4 * i5, 'but each rupee buys fewer (diminishing returns)')
assert(appPaidInstalls(s, 0) === 0, 'no spend, no paid installs')

// rating and awareness
s.company.rating = 3
const poor = appCacPerInstall(s, L(2))
s.company.rating = 4.8
assert(appCacPerInstall(s, L(2)) < poor, 'a better rating cheapens installs')
const lowAware = appCacPerInstall(s, L(2))
s.company.brandAwareness = 0.6
assert(appCacPerInstall(s, L(2)) < lowAware, 'brand awareness cheapens installs')

// organic discovery
s.company.rating = 3
s.company.app.tier = 1
const o1 = appOrganicRate(s)
s.company.rating = 4.8
assert(appOrganicRate(s) > o1, 'happier riders find the app more often')
const o4 = appOrganicRate(s)
s.company.app.tier = 3
assert(appOrganicRate(s) > o4, 'a better app listing is found more often')

// month close
s.company.app.tier = 2
s.company.rating = 4.5
setMarketingBudget(s, L(2))
const t = appMonthTally(s.company.app)
t.organicInstalls = 700
t.seats = 1200
t.gross = L(6)
t.pgFees = rs(12_000)
t.commissionSaved = L(0.5)
const installsBefore = s.company.app.installs
monthlyAppPass(s)
const hist = s.company.app.history!
assert(hist.length === 1, 'month closed into history')
const rec = hist[0]
assert(rec.organicInstalls === 700 && rec.seats === 1200, 'tally carried into the record')
assert(rec.paidInstalls > 0 && rec.cac > 0, 'record holds the paid installs and what each cost')
assert(Math.abs(s.company.app.installs - installsBefore - rec.paidInstalls) < 1e-6, 'paid installs added to downloads')
assert(rec.net === rec.commissionSaved - rec.marketing - rec.opex, 'net = commission saved - ad spend - hosting')
assert(s.company.app.month!.seats === 0 && s.company.app.month!.organicInstalls === 0, 'new month starts empty')
for (let i = 0; i < 14; i++) monthlyAppPass(s)
assert(s.company.app.history!.length === 12, 'history keeps the last 12 months')
console.log('App economics checks passed.')
