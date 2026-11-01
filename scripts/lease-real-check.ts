/**
 * Are leased-bus rents realistic?
 *
 * Runs the same vehicle twice on the home corridor — once dry-leased (we pay
 * rent; owner pays service/tyres/insurance/tax) and once owned outright (we
 * pay all of that) — and prints the owner's real monthly cost stack next to
 * the rent being asked.
 *
 *   npx tsx scripts/lease-real-check.ts
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { fmtCompact, rs } from '../src/engine/core/money'
import { startLease, usedPrice } from '../src/engine/sim/fleet'
import { hire, assignStaff } from '../src/engine/sim/staffing'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { serviceBus } from '../src/engine/sim/maintenance'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES, isOvernight } from '../src/engine/data/routes'
import { BAL } from '../src/engine/data/balance'
import type { GameState, LeaseOffer, MonthlySummary, TxnHead } from '../src/engine/types'

const DAYS = 180

type Pick = (o: LeaseOffer) => boolean

function crewUp(s: GameState, busId: string, driversNeeded: number, conductor: boolean): void {
  for (let need = driversNeeded; need > 0; need--) {
    const c = s.hiringPool.find((x) => x.role === 'driver')
    if (c && hire(s, c.id) === null) assignStaff(s, c.id, busId)
  }
  if (conductor) {
    const c = s.hiringPool.find((x) => x.role === 'conductor')
    if (c && hire(s, c.id) === null) assignStaff(s, c.id, busId)
  }
}

interface Result {
  label: string
  route: string
  age: number
  odo: number
  value: number
  rent: number
  revPm: number
  expensePm: Partial<Record<TxnHead, number>>
  lf: number
}

function scenario(seed: number, routeId: string, pick: Pick, owned: boolean): Result | null {
  const s = newGame('Lease probe', 'malik', routeId, seed)
  s.company.cash = rs(2_00_00_000)
  const offer = s.leaseOffers.find(pick)
  if (!offer) return null
  const rent = offer.monthlyRent
  const value = usedPrice(offer.modelId, offer.ageYears)
  const model = BUS_MODELS[offer.modelId]!
  if (startLease(s, offer.id) !== null) return null
  const bus = Object.values(s.buses)[0]!
  if (owned) {
    // same vehicle, but we carry service / tyres / insurance / road tax ourselves
    bus.ownership = 'owned'
    bus.leaseOfferRent = undefined
    bus.leaseEndDay = undefined
    bus.bookValue = value
    bus.acquiredPrice = value
    bus.depreciationMethod = 'SLM'
  }
  const route = ROUTES[routeId]!
  const overnight = isOvernight(route)
  crewUp(s, bus.id, overnight ? 2 : 1, model.seats >= 30)
  const created = createSchedule(s, {
    routeId, depHour: overnight ? 21 : 8, baseFare: route.marketFareAC, autoPrice: true,
    boardingPoints: 3, cancellation: 'standard',
    channels: { redbus: true, abhibus: false, ownapp: false, counter: true }, redDeal: false, paired: false,
  })
  if ('error' in created) return null
  if (assignBus(s, created.id, bus.id) !== null) return null

  let paxKm = 0
  let seatKm = 0
  for (let d = 0; d < DAYS; d++) {
    if (!owned) {
      const overdue = bus.odometer - bus.lastServiceOdo - BAL.serviceIntervalKm
      if (overdue > -2000) serviceBus(s, bus.id)
    }
    advanceDay(s)
    if (s.gameOver) break
    const m: MonthlySummary | undefined = s.monthly[s.monthly.length - 1]
    if (m) { paxKm = m.paxKm; seatKm = m.seatKm }
  }
  const full = s.monthly.slice(1)
  const expensePm: Partial<Record<TxnHead, number>> = {}
  for (const m of full) {
    for (const [k, v] of Object.entries(m.expense)) {
      if (v) expensePm[k as TxnHead] = (expensePm[k as TxnHead] ?? 0) + v
    }
  }
  for (const k of Object.keys(expensePm) as TxnHead[]) expensePm[k] = Math.round(expensePm[k]! / Math.max(1, full.length))
  const revPm = Math.round(full.reduce((a, m) => a + m.revenueTotal, 0) / Math.max(1, full.length))
  return {
    label: `${model.maker} ${model.name}`, route: routeId, age: offer.ageYears, odo: bus.odometer,
    value, rent, revPm, expensePm, lf: seatKm > 0 ? paxKm / seatKm : 0,
  }
}

const HEAD_LABELS: Partial<Record<TxnHead, string>> = {
  fuel: 'fuel', toll: 'toll', salary: 'crew', redbus_commission: 'commission', maintenance: 'maint',
  tyres: 'tyres', insurance: 'insur', road_tax: 'rdtax', lease_rent: 'RENT', depreciation: 'depr',
}

function show(r: Result, owned: boolean) {
  const heads = Object.entries(r.expensePm)
    .filter(([k, v]) => v! > 2000 && HEAD_LABELS[k as TxnHead])
    .map(([k, v]) => `${HEAD_LABELS[k as TxnHead]}=${fmtCompact(v!)}`)
    .join(' ')
  const total = Object.values(r.expensePm).reduce((a, b) => a + (b ?? 0), 0)
  console.log(
    `${owned ? 'owned ' : 'leased'} ${r.label.padEnd(20)} ${r.age}y ${String(Math.round(r.odo / 1000)).padStart(4)}k odo ` +
    `val ${fmtCompact(r.value).padStart(7)} LF ${String(Math.round(r.lf * 100)).padStart(3)}% ` +
    `rev ${fmtCompact(r.revPm).padStart(8)} cost ${fmtCompact(total).padStart(8)} net ${fmtCompact(r.revPm - total).padStart(8)}  ${heads}`,
  )
}

const picks: Array<{ route: string; pick: Pick }> = [
  { route: 'blr-hyd', pick: (o) => BUS_MODELS[o.modelId]!.seats >= 30 && BUS_MODELS[o.modelId]!.seats <= 36 },
  { route: 'blr-hyd', pick: (o) => BUS_MODELS[o.modelId]!.cls === 'AC_HYBRID' },
  { route: 'blr-hyd', pick: (o) => BUS_MODELS[o.modelId]!.cls === 'AC_SEMI' },
]

console.log(`Lease realism probe — ${DAYS} days per run, auto-priced fares, ₹/month\n`)
for (const p of picks) {
  for (const seed of [1, 2, 3, 5, 7, 11, 13]) {
    const leased = scenario(seed, p.route, p.pick, false)
    const own = scenario(seed, p.route, p.pick, true)
    if (!leased || !own) continue
    show(leased, false)
    show(own, true)
    console.log('')
    break
  }
}
