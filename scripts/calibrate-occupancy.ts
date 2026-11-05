/**
 * Occupancy calibration for a sensibly run fleet: several corridors, overnight
 * departures in both directions (day hops run morning out, evening back),
 * crewed coaches, run past the new-route ramp. Prints load factor by route
 * and overall so balance changes can be checked against the 60-70% target.
 *
 *   npx tsx scripts/calibrate-occupancy.ts [--days 150] [--seed 4242]
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { ROUTES } from '../src/engine/data/routes'
import { applySeasonalPermit, createSchedule, assignBus } from '../src/engine/sim/schedules'
import { orderNewBus } from '../src/engine/sim/fleet'
import { recruitVeteran, assignStaff } from '../src/engine/sim/staffing'
import { applyDecision } from '../src/engine/sim/events'
import { serviceBus, replaceTyres, deepCleanBus } from '../src/engine/sim/maintenance'
import { BAL } from '../src/engine/data/balance'
import { dow } from '../src/engine/core/calendar'
import type { GameState } from '../src/engine/types'

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}

/** [route, model, departures]: overnight runs get two coaches (one each way), day hops one paired coach. */
const PLAN: [string, string, number[]][] = [
  ['maa-blr', 'cheetah', [22]],
  ['maa-mdu', 'leyacsleep2', [21, 22]],
  ['maa-cbe', 'leyacsleep2', [21]],
  ['blr-hyd', 'leyacsleep2', [21, 22]],
  ['blr-koc', 'leyacsleep2', [20]],
  ['blr-goa', 'leyacsleep2', [20]],
  ['maa-tir', 'cheetah', [7]],
  ['hyd-vga', 'cheetah', [22]],
]

export function buildCalibrationFleet(seed = 4242): GameState {
  const s = newGame('Calibration Travels', 'malik', 'maa-blr', seed)
  s.company.cash = 100_000_000_000

  const crew = (busId: string) => {
    for (let i = 0; i < 2; i++) assignStaff(s, recruitVeteran(s, 'driver', { skill: [6, 7] }).id, busId)
    assignStaff(s, recruitVeteran(s, 'conductor', { skill: [5, 7] }).id, busId)
  }
  const buy = (modelId: string): string => {
    const before = new Set(Object.keys(s.buses))
    const err = orderNewBus(s, modelId, {})
    if (err) throw new Error(`order ${modelId}: ${err}`)
    for (const o of s.busOrders) o.deliveryDay = s.day
    settle(s)
    advanceDay(s)
    const id = Object.keys(s.buses).find((k) => !before.has(k))
    if (!id) throw new Error('bus not delivered')
    crew(id)
    return id
  }

  for (const [routeId, modelId, deps] of PLAN) {
    const route = ROUTES[routeId]!
    s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 5, expiryDay: s.day + 20_000 }
    applySeasonalPermit(s, routeId)
    const sea = s.permits[routeId]!.seasonal
    if (sea) { sea.status = 'active'; sea.expiryDay = s.day + 20_000 }
    const dayHop = route.hours <= 6
    for (const h of deps) {
      const res = createSchedule(s, {
        routeId,
        depHour: h,
        depMin: 0,
        baseFare: route.marketFareAC,
        autoPrice: true,
        cancellation: 'standard',
        redDeal: false,
        paired: dayHop,
        ...(dayHop ? { returnDepHour: 17, returnDepMin: 0 as const } : {}),
      })
      if ('error' in res) throw new Error(`${routeId} ${h}: ${res.error}`)
      const coaches = dayHop ? 1 : 2
      for (let i = 0; i < coaches; i++) {
        const err = assignBus(s, res.id, buy(modelId))
        if (err) throw new Error(`assign ${routeId}: ${err}`)
      }
    }
  }
  return s
}

/** Routine upkeep a sensible operator does: service on time, tyres, deep clean when grubby. */
function upkeep(s: GameState): void {
  for (const bus of Object.values(s.buses)) {
    if (bus.status !== 'active') continue
    if (bus.odometer - bus.lastServiceOdo - BAL.serviceIntervalKm > -2000) serviceBus(s, bus.id)
    const tyreLife = bus.tyresRetreaded ? BAL.tyreLifeRetreadKm : BAL.tyreLifeKm
    if (bus.tyreKm > tyreLife * 0.95) replaceTyres(s, bus.id, false)
    if ((bus.busCleanliness ?? 100) < 60) deepCleanBus(s, bus.id)
  }
}

function settle(s: GameState): void {
  let guard = 0
  while (s.decisions.length > 0 && guard++ < 50) {
    const d = s.decisions[0]!
    const o = d.kind === 'cheque_bounce' ? d.options.find((x) => x.id !== 'collector') : d.options[0]
    if (applyDecision(s, d.id, o?.id ?? 'pass')) s.decisions.shift()
    else break
  }
}

type Agg = { sold: number; cap: number; n: number }
const add = (m: Map<string, Agg>, k: string, sold: number, cap: number) => {
  const a = m.get(k) ?? { sold: 0, cap: 0, n: 0 }
  a.sold += sold; a.cap += cap; a.n++
  m.set(k, a)
}
const pct = (a: Agg) => `${((100 * a.sold) / a.cap).toFixed(1)}%`

export function runCalibration(days = 150, seed = 4242, measureFrom = 95): { overall: number; byRoute: Map<string, Agg> } {
  const s = buildCalibrationFleet(seed)
  const start = s.day
  const seen = new Set<string>()
  const byRoute = new Map<string, Agg>()
  const byDow = new Map<string, Agg>()
  const all: Agg = { sold: 0, cap: 0, n: 0 }
  for (let d = 0; d < days; d++) {
    settle(s)
    upkeep(s)
    advanceDay(s)
    for (const t of Object.values(s.trips)) {
      if (t.status !== 'completed' || seen.has(t.id)) continue
      seen.add(t.id)
      if (s.day - start < measureFrom) continue
      const cap = t.seatCount || t.seats.length
      if (!cap) continue
      add(byRoute, t.routeId, t.sold, cap)
      add(byDow, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(t.day)]!, t.sold, cap)
      all.sold += t.sold; all.cap += cap; all.n++
    }
  }
  const overall = all.cap ? all.sold / all.cap : 0
  if (process.argv[1]?.endsWith('calibrate-occupancy.ts')) {
    console.log(`${Object.keys(s.buses).length} coaches, ${days} days, measured from day ${measureFrom}`)
    console.log(`company rating ${s.company.rating.toFixed(2)}, brand ${s.company.brandAwareness.toFixed(2)}`)
    for (const [k, a] of [...byRoute].sort()) console.log(`  ${k.padEnd(10)} ${pct(a).padStart(6)}  (${a.n} trips)`)
    console.log(`  by day: ${[...byDow].map(([k, a]) => `${k} ${pct(a)}`).join('  ')}`)
    console.log(`OVERALL ${pct(all)} over ${all.n} trips`)
  }
  return { overall, byRoute }
}

if (process.argv[1]?.endsWith('calibrate-occupancy.ts')) {
  runCalibration(arg('days', 150), arg('seed', 4242))
}
