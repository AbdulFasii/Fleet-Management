/**
 * Dry-lease pricing realism.
 *
 * A rent has to do four things to read as a real Indian dry-lease quote:
 *   1. land in the market band for the coach (₹1.1–3.9L/mo for AC coaches),
 *   2. rise as a share of value with age (fewer years left to earn it back),
 *   3. never exceed the market ceiling share of value,
 *   4. fall in absolute terms as the bus wears out.
 * It must also fund the owner's upkeep, and the security deposit has to come
 * back in full when the lease runs to term.
 *
 *   npx tsx scripts/test-lease-pricing.ts
 */
import { newGame } from '../src/engine/newGame'
import { leaseMonthlyRent, usedPrice, startLease, endLease } from '../src/engine/sim/fleet'
import { BAL } from '../src/engine/data/balance'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { designsForModel } from '../src/engine/data/bodyBuilders'
import { rs } from '../src/engine/core/money'
import { advanceDay } from '../src/engine/tick'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const la = (m: number) => (m / 100 / 1_00_000).toFixed(2)

// Lease offers come with a body built on the chassis (as in the market), so
// price them with the first lease design for the model, like the game does.
const gs = newGame('Lease Bodies', 'seth', 'maa-mdu', 5)
const bodyFor = (id: string): string | undefined => designsForModel(gs, BUS_MODELS[id]!, { market: 'lease' })[0]?.design.id
const rentOf = (id: string, age: number, odo: number) => leaseMonthlyRent(id, age, odo, bodyFor(id), gs)
const valueOf = (id: string, age: number) => usedPrice(id, age, bodyFor(id), gs)

console.log('\nquotes vs market band (₹ lakh / month)')
for (const [id, age, odo, lo, hi] of [
  ['bb1824', 1, 72_000, 1.4, 2.2],
  ['bb1824', 3, 160_000, 1.2, 1.9],
  ['leyhybrid', 6, 390_000, 0.7, 1.35],
  ['volvo9600', 1, 80_000, 2.8, 4.2],
  ['volvo9600', 6, 350_000, 1.8, 3.0],
  ['eicher_pro', 1, 80_000, 0.7, 1.15],
  ['eicher_pro', 6, 470_000, 0.45, 0.85],
] as Array<[string, number, number, number, number]>) {
  const rent = rentOf(id, age, odo)
  const value = valueOf(id, age)
  const pct = (rent / value) * 100
  const model = BUS_MODELS[id]!
  console.log(`  ${`${model.maker} ${model.name}`.padEnd(24)} ${age}y ${String(Math.round(odo / 1000)).padStart(3)}k → ₹${la(rent)}L/mo  (${pct.toFixed(2)}% of ₹${la(value)}L)`)
  check(rent >= lo * 1_00_000 * 100 && rent <= hi * 1_00_000 * 100, `${id} ${age}y quote stays inside ₹${lo}–${hi}L`)
  check(pct <= BAL.leaseMaxPctOfValue * 100 + 0.01, `${id} ${age}y quote respects the ${(BAL.leaseMaxPctOfValue * 100).toFixed(1)}% market ceiling`)
}

console.log('\nage curve — same model, older bus')
const young = rentOf('bb1824', 1, 72_000)
const middle = rentOf('bb1824', 3, 160_000)
const old = rentOf('bb1824', 6, 400_000)
const pctOf = (age: number, odo: number) => rentOf('bb1824', age, odo) / valueOf('bb1824', age)
check(young > middle && middle > old, 'absolute rent falls as the coach ages')
check(pctOf(1, 72_000) < pctOf(3, 160_000) && pctOf(3, 160_000) < pctOf(6, 400_000), 'rent claims a bigger share of value as the coach ages')

console.log('\nowner upkeep is funded (service + tyres + insurance + tax)')
for (const [id, age, odo] of [['bb1824', 2, 140_000], ['leyhybrid', 6, 390_000]] as Array<[string, number, number]>) {
  const rent = rentOf(id, age, odo)
  const value = valueOf(id, age)
  const model = BUS_MODELS[id]!
  const insured = Math.max(BAL.insuranceMin, Math.round(Math.max(value, model.priceNew * 0.3) * BAL.insurancePctOfValue))
  const fixed = insured / 12 + BAL.fitnessRenewalCost / 12 + rs(42_000) / 12
  check(rent > fixed, `${id} ${age}y rent ${la(rent)}L clears its ${la(fixed)}L of fixed bills`)
}

console.log('\nsecurity deposit')
const s = newGame('Lease Test', 'malik', 'blr-hyd', 4242)
s.company.cash = rs(3_00_00_000)
const offer = s.leaseOffers[0]!
const deposit = offer.monthlyRent * offer.depositMonths
const cashBefore = s.company.cash
check(startLease(s, offer.id) === null, 'lease signs with cash for deposit + first rent')
const bus = Object.values(s.buses)[0]!
check(bus.leaseDeposit === deposit, `deposit of ₹${la(deposit)}L is recorded on the bus`)
check(s.company.cash === cashBefore - deposit, 'only the deposit is paid up front (rent is monthly)')
const day = bus.leaseEndDay ?? s.day
while (s.day < day) advanceDay(s)
const beforeRefund = s.company.cash
check(endLease(s, bus.id) === null, 'lease ends at term')
check(s.company.cash >= beforeRefund + deposit, `full ₹${la(deposit)}L deposit comes back (cash ${la(s.company.cash - beforeRefund)}L + month-end flows)`)

console.log(failures === 0 ? '\nAll lease pricing checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
