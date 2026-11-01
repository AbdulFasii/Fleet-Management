/**
 * Headless balance harness.
 *
 *   npm run sim -- --seed 42 --years 2 --bot competent
 *   npm run sim -- --seed 7 --years 2 --bot careless
 *
 * The "competent" bot plays sensibly (inspected used sleepers on loan,
 * crews them, services on time, expands when cash allows). The "careless"
 * bot overleverages into a Volvo, skips maintenance and underprices.
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { fmtCompact, toRupees, rs } from '../src/engine/core/money'
import { ymKey } from '../src/engine/core/calendar'
import { netWorth } from '../src/engine/sim/finance'
import { buyUsed, inspectListing, signAttach } from '../src/engine/sim/fleet'
import { hire, assignStaff } from '../src/engine/sim/staffing'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { serviceBus, replaceTyres } from '../src/engine/sim/maintenance'
import { applyDecision } from '../src/engine/sim/events'
import { rollLot, surveyLot, type LotSpec } from '../src/engine/sim/eventFleet'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES, isOvernight } from '../src/engine/data/routes'
import { BAL } from '../src/engine/data/balance'
import { worstSubsystem } from '../src/engine/sim/fleet'
import { dow } from '../src/engine/core/calendar'
import type { Decision, GameState } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const seed = Number(arg('seed', '42'))
const years = Number(arg('years', '2'))
const bot = arg('bot', 'competent') as 'competent' | 'careless'
const quiet = process.argv.includes('--quiet')

const s = newGame(bot === 'competent' ? 'Sensible Travels' : 'Reckless Roadways', 'malik', 'blr-hyd', seed)

/* ------------------------- occupancy sampling ------------------------- */

const occSamples: number[] = []
const occByDow: number[][] = Array.from({ length: 7 }, () => [])
const sampledTripIds = new Set<string>()

function sampleCompletedTrips(state: GameState): void {
  for (const trip of Object.values(state.trips)) {
    if (trip.status !== 'completed' || !trip.outcome || sampledTripIds.has(trip.id)) continue
    sampledTripIds.add(trip.id)
    const cap = trip.seatCount || trip.seats.length
    if (cap <= 0) continue
    const lf = trip.sold / cap
    occSamples.push(lf)
    occByDow[dow(trip.day)]!.push(lf)
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.floor(p * (sorted.length - 1))
  return sorted[idx]!
}

function printOccStats(): void {
  if (occSamples.length === 0) {
    console.log('Occupancy: no completed trips sampled')
    return
  }
  const avg = occSamples.reduce((a, b) => a + b, 0) / occSamples.length
  const p10 = percentile(occSamples, 0.10)
  const p50 = percentile(occSamples, 0.50)
  const p90 = percentile(occSamples, 0.90)
  const under40 = occSamples.filter((x) => x < 0.40).length
  const over90 = occSamples.filter((x) => x >= 0.90).length
  console.log(
    `Occupancy (${occSamples.length} trips): avg ${Math.round(avg * 100)}%  ` +
    `p10 ${Math.round(p10 * 100)}%  p50 ${Math.round(p50 * 100)}%  p90 ${Math.round(p90 * 100)}%  ` +
    `<40% ${under40}  ≥90% ${over90}`,
  )
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dowLine = dowNames.map((name, i) => {
    const xs = occByDow[i]!
    if (xs.length === 0) return `${name} —`
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return `${name} ${Math.round(m * 100)}%`
  }).join('  ')
  console.log(`By DOW: ${dowLine}`)
}

/* ----------------------------- bot helpers ----------------------------- */

function crewUp(state: GameState, busId: string, driversNeeded: number, withConductor: boolean): boolean {
  const assignedDrivers = Object.values(state.staff).filter((x) => x.busId === busId && x.role === 'driver').length
  let need = driversNeeded - assignedDrivers
  for (const c of [...state.hiringPool]) {
    if (need <= 0) break
    if (c.role === 'driver') {
      if (hire(state, c.id) === null) {
        assignStaff(state, c.id, busId)
        need--
      }
    }
  }
  if (withConductor && !Object.values(state.staff).some((x) => x.busId === busId && x.role === 'conductor')) {
    const c = state.hiringPool.find((x) => x.role === 'conductor')
    if (c && hire(state, c.id) === null) assignStaff(state, c.id, busId)
  }
  const drivers = Object.values(state.staff).filter((x) => x.busId === busId && x.role === 'driver').length
  return drivers >= driversNeeded
}

function freeIdleStaffTo(state: GameState, busId: string) {
  for (const st of Object.values(state.staff)) {
    if (!st.busId && st.role === 'driver') {
      assignStaff(state, st.id, busId)
      return
    }
  }
}

function ensureSchedule(state: GameState, busId: string) {
  const route = ROUTES['blr-hyd']
  // reuse a schedule with a free slot, else create one
  for (const sch of Object.values(state.schedules)) {
    if (sch.busIds.length < 2) {
      if (assignBus(state, sch.id, busId) === null) return
    }
  }
  createSchedule(state, {
    routeId: route.id,
    depHour: 20 + (Object.keys(state.schedules).length % 3),
    baseFare: route.marketFareAC,
    autoPrice: bot === 'competent',
    boardingPoints: 3,
    cancellation: 'standard',
    channels: { redbus: true, abhibus: false, ownapp: false, counter: true },
    redDeal: false,
  })
  const sch = Object.values(state.schedules)[Object.keys(state.schedules).length - 1]
  if (sch) assignBus(state, sch.id, busId)
}

/**
 * How a careful owner answers the deck: pay for the inspection before buying a
 * lot, walk away from a rough one, take crew when the roster is short, and
 * leave the speculative stuff alone.
 */
function competentChoice(state: GameState, d: Decision): string {
  const has = (id: string) => d.options.some((o) => o.id === id)
  switch (d.kind) {
    case 'poach': return 'match'
    case 'primo': return 'accept'
    case 'distress_lot':
    case 'distress_lot_seen': {
      const lot = d.data?.lot as LotSpec
      if (!lot) return 'pass'
      const survey = surveyLot(rollLot(state, lot))
      const good = survey.worst >= 45 && survey.avgCondition >= 60 && survey.accidents <= Math.max(1, Math.round(lot.count * 0.25))
      if (!good) return 'pass'
      return has('cash') ? 'cash' : has('finance') ? 'finance' : 'pass'
    }
    case 'distress_crew': {
      const drivers = Object.values(state.staff).filter((st) => st.role === 'driver').length
      return drivers < Object.keys(state.buses).length * 2 ? 'take' : 'pass'
    }
    default: return 'pass'
  }
}

function competentDay(state: GameState) {
  for (const d of [...state.decisions]) {
    applyDecision(state, d.id, competentChoice(state, d))
  }

  // buy an inspected, decent used sleeper when genuinely liquid (cash reserve, not borrowed OD)
  const cash = state.company.cash
  const fleetSize = Object.keys(state.buses).length
  if (fleetSize < 8 && cash > rs(25_00_000)) {
    const candidates = state.usedMarket.filter((l) => BUS_MODELS[l.modelId].sleeper && l.ageYears <= 7)
    for (const l of candidates) {
      if (!l.inspected) inspectListing(state, l.id)
      if (l.inspected && worstSubsystem(l.condition) >= 55 && !l.accidentHistory) {
        if (buyUsed(state, l.id, { loanProductId: 'shriram', months: 48 }) === null) break
      }
    }
  }

  // crew, schedule, maintain
  for (const bus of Object.values(state.buses)) {
    const drivers = isOvernight(ROUTES['blr-hyd']) ? 2 : 1
    crewUp(state, bus.id, drivers, true)
    freeIdleStaffTo(state, bus.id)
    if (!bus.scheduleId && bus.status === 'active') ensureSchedule(state, bus.id)
    if (bus.status === 'active') {
      const overdue = bus.odometer - bus.lastServiceOdo - BAL.serviceIntervalKm
      if (overdue > -2000) serviceBus(state, bus.id)
      const tyreLife = bus.tyresRetreaded ? BAL.tyreLifeRetreadKm : BAL.tyreLifeKm
      if (bus.tyreKm > tyreLife * 0.95) replaceTyres(state, bus.id, false)
    }
  }
}

let carelessBought = false
function carelessDay(state: GameState) {
  for (const d of [...state.decisions]) {
    applyDecision(state, d.id, d.options[0].id) // always the first (usually expensive) option
  }
  if (!carelessBought) {
    // an uninspected used sleeper on a max loan, plus a rough attach
    const l = state.usedMarket.find((x) => BUS_MODELS[x.modelId].sleeper)
    if (l) {
      buyUsed(state, l.id, { loanProductId: 'shriram', months: 36 })
      if (state.attachOffers[0]) signAttach(state, state.attachOffers[0].id)
      carelessBought = true
    }
  }
  for (const bus of Object.values(state.buses)) {
    crewUp(state, bus.id, 2, false)
    if (!bus.scheduleId && bus.status === 'active') {
      createSchedule(state, {
        routeId: 'blr-hyd', depHour: 21,
        baseFare: Math.round(ROUTES['blr-hyd'].marketFareAC * 0.9), // thin yields
        autoPrice: false, boardingPoints: 1, cancellation: 'flexible',
        channels: { redbus: true, abhibus: false, ownapp: false, counter: false }, redDeal: true,
      })
      const sch = Object.values(state.schedules).pop()
      if (sch) assignBus(state, sch.id, bus.id)
    }
    // never services, never changes tyres, never repairs the AC
  }
}

/* ------------------------------- run loop ------------------------------- */

let lastYm = ymKey(s.day)
const days = Math.round(years * 365)
for (let i = 0; i < days; i++) {
  if (bot === 'competent') competentDay(s)
  else carelessDay(s)
  advanceDay(s)
  sampleCompletedTrips(s)
  if (s.gameOver) break
  const ym = ymKey(s.day)
  if (ym !== lastYm && !quiet) {
    lastYm = ym
    const m = s.monthly[s.monthly.length - 1]
    const lf = m && m.seatKm > 0 ? Math.round((m.paxKm / m.seatKm) * 100) : 0
    console.log(
      `${ym}  cash ${fmtCompact(s.company.cash).padStart(10)}  nw ${fmtCompact(netWorth(s)).padStart(10)}  ` +
      `rev ${fmtCompact(m?.revenueTotal ?? 0).padStart(10)}  pnl ${fmtCompact(m?.profit ?? 0).padStart(10)}  ` +
      `LF ${String(lf).padStart(3)}%  trips ${m?.trips ?? 0}  fleet ${Object.keys(s.buses).length}  rating ${s.company.rating.toFixed(2)}  ` +
      `credit ${s.company.creditScore}  od ${fmtCompact(s.od.drawn)}`,
    )
  }
}

console.log('\n================ RESULT ================')
if (s.gameOver) {
  console.log(`BANKRUPT after ${s.gameOver.day - s.startDay} days (${((s.gameOver.day - s.startDay) / 30).toFixed(1)} months)`)
  console.log(s.gameOver.reason)
} else {
  console.log(`Survived ${days} days. Net worth ${fmtCompact(netWorth(s))}, cash ${fmtCompact(s.company.cash)}, fleet ${Object.keys(s.buses).length}, rating ${s.company.rating.toFixed(2)}`)
  console.log(`Lifetime P&L ${fmtCompact(s.lifetimeProfit)} | monthly avg pnl (last 6): ${fmtCompact(s.monthly.slice(-6).reduce((a, m) => a + m.profit, 0) / Math.max(1, Math.min(6, s.monthly.length)))}`)
}
printOccStats()
console.log(`(bot=${bot}, seed=${seed}, years=${years}, ₹ figures in lakh/crore)`)
void toRupees
