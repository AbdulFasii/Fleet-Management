/**
 * Per-pass timing for one game day on a large fleet.
 *
 *   npx tsx scripts/pass-profile.ts [--fleet 70]
 *
 * Mirrors the advanceDay pipeline in tick.ts and prints how long each pass
 * takes, so the hot pass is obvious before optimising.
 */
import { newGame } from '../src/engine/newGame'
import { isMonthEnd } from '../src/engine/core/calendar'
import { dailyWorldPass, dailyEventRoll, accountantDecisionPass } from '../src/engine/sim/events'
import { dailyCargoPass, settleCargoShortfall } from '../src/engine/sim/cargo'
import { deliverOrdersPass, refreshMarkets, orderNewBus } from '../src/engine/sim/fleet'
import { permitPass, pruneRetiredRoutes, sanitizeScheduleAssignments, createSchedule, assignBus, applySeasonalPermit } from '../src/engine/sim/schedules'
import { festivalFleetPass, dailyCharterPass } from '../src/engine/sim/festival'
import { generateTrips, bookingPass } from '../src/engine/sim/booking'
import { dispatchPass } from '../src/engine/sim/dispatch'
import { dailyCheckpostPass } from '../src/engine/sim/checkpost'
import { dailyDepotPass } from '../src/engine/sim/depot'
import { dailyMaintenancePass, monthlyFleetCosts } from '../src/engine/sim/maintenance'
import { dailyClaimsPass } from '../src/engine/sim/insurance'
import { dailyStaffPass, hrFatiguePass, opsAutoStaffPass, monthlyStaffPass, refreshHiringPool, cmvrResetPass, recruitVeteran, assignStaff } from '../src/engine/sim/staffing'
import { settleReceivables, applyDepreciation, closeMonth, spendNetted, earn } from '../src/engine/sim/finance'
import { dailyBankingPass, monthlyBankingPass, coverWithOd } from '../src/engine/sim/banking'
import { monthlyAppPass } from '../src/engine/sim/channels'
import { dailyTaxPass, monthlyTaxPass } from '../src/engine/sim/tax'
import { checkPrimo, checkCertifications, checkAchievements } from '../src/engine/sim/reputation'
import { bankruptcyCheck } from '../src/engine/sim/bankruptcy'
import { snapshotKpis } from '../src/engine/sim/kpi'
import { retainDay } from '../src/engine/sim/retain'
import { dailyCrmPass } from '../src/engine/sim/crm'
import { applyDecision } from '../src/engine/sim/events'
import { ROUTES } from '../src/engine/data/routes'
import type { GameState } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const fleetTarget = Number(arg('fleet', '70'))

const s: GameState = newGame('Pass Probe', 'malik', 'maa-mdu', 4242)
s.company.cash = 100_000_000_000
const ROUTE_IDS = Object.keys(ROUTES).filter((id) => {
  const r = ROUTES[id]!
  return r.hours >= 4
})

function openPermit(routeId: string): void {
  if (s.permits[routeId]?.status === 'active') return
  s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 5, expiryDay: s.day + 20_000 }
  applySeasonalPermit(s, routeId)
  const sea = s.permits[routeId]!.seasonal
  if (sea) { sea.status = 'active'; sea.expiryDay = s.day + 20_000 }
}

function topUpFleet(): void {
  const live = Object.values(s.buses).filter((b) => b.status !== 'sold' && b.status !== 'delivery')
  const need = fleetTarget - live.length - s.busOrders.length
  for (let i = 0; i < need; i++) {
    const modelId = i % 3 === 0 ? 'leyacsleep2' : i % 3 === 1 ? 'volvo9400semi' : 'volvo9400'
    if (orderNewBus(s, modelId, {})) continue
  }
  for (const o of s.busOrders) o.deliveryDay = s.day
}

function crewFleet(): void {
  for (const bus of Object.values(s.buses)) {
    if (bus.status === 'delivery' || bus.status === 'sold') continue
    const crew = Object.values(s.staff).filter((st) => st.busId === bus.id)
    const drivers = crew.filter((st) => st.role === 'driver' || st.role === 'co_driver')
    for (let i = drivers.length; i < 2; i++) {
      const st = recruitVeteran(s, 'driver', { skill: [6, 7] })
      assignStaff(s, st.id, bus.id)
    }
    if (!crew.some((st) => st.role === 'conductor')) assignStaff(s, recruitVeteran(s, 'conductor', { skill: [5, 7] }).id, bus.id)
  }
}

function assignSchedules(): void {
  for (const bus of Object.values(s.buses)) {
    if (bus.status !== 'active' || bus.scheduleId) continue
    for (const routeId of ROUTE_IDS) {
      openPermit(routeId)
      const existing = Object.values(s.schedules).filter((sch) => sch.active && sch.routeId === routeId)
      const route = ROUTES[routeId]!
      let sch = existing.find((x) => x.busIds.length < (route.hours > 6 ? 2 : 1))
      if (!sch) {
        const res = createSchedule(s, {
          routeId, depHour: 18 + (existing.length % 6), depMin: ((existing.length % 2) * 30) as 0 | 30,
          baseFare: Math.round(route.marketFareAC * 1.1), autoPrice: true, cancellation: 'standard', redDeal: false,
          paired: route.hours > 5, returnDepHour: 7 + (existing.length % 4), returnDepMin: 0 as 0 | 30,
        })
        if ('error' in res) continue
        sch = s.schedules[res.id]!
      }
      if (!assignBus(s, sch.id, bus.id)) break
    }
  }
}

function settle(): void {
  while (s.decisions.length > 0) {
    const d = s.decisions[0]!
    if (applyDecision(s, d.id, d.options[0]?.id ?? 'pass')) s.decisions.shift()
  }
}

console.log(`Building ${fleetTarget} coaches…`)
for (let i = 0; i < 60; i++) { settle(); topUpFleet(); advanceDay(s); crewFleet(); assignSchedules() }
function advanceDay(s: GameState): void {
  if (s.gameOver) return
  pruneRetiredRoutes(s)
  s.day += 1
  dailyWorldPass(s); dailyEventRoll(s); dailyCargoPass(s)
  deliverOrdersPass(s); permitPass(s)
  if (s.day >= s.marketRefreshDay) refreshMarkets(s)
  if (s.day >= s.poolRefreshDay) refreshHiringPool(s)
  festivalFleetPass(s); dailyCharterPass(s)
  cmvrResetPass(s); sanitizeScheduleAssignments(s); generateTrips(s); bookingPass(s)
  hrFatiguePass(s); opsAutoStaffPass(s); dispatchPass(s); settleCargoShortfall(s)
  dailyCheckpostPass(s); dailyDepotPass(s)
  dailyMaintenancePass(s); dailyClaimsPass(s); dailyStaffPass(s); dailyCrmPass(s); opsAutoStaffPass(s)
  settleReceivables(s); accountantDecisionPass(s); dailyBankingPass(s); dailyTaxPass(s)
  if (isMonthEnd(s.day)) {
    monthlyStaffPass(s); monthlyFleetCosts(s); monthlyAppPass(s)
    const dep = applyDepreciation(s)
    if (dep > 0) spendNetted(s, 'depreciation', dep, { note: 'Depreciation (non-cash)' })
    if (s.company.fuelCashbackAccrued && s.company.fuelCashbackAccrued > 0) {
      earn(s, 'fuel_cashback', s.company.fuelCashbackAccrued, { note: 'rebate' })
      s.company.fuelCashbackAccrued = 0
    }
    monthlyTaxPass(s); monthlyBankingPass(s); closeMonth(s); coverWithOd(s)
  }
  checkPrimo(s); checkCertifications(s); checkAchievements(s); bankruptcyCheck(s)
  snapshotKpis(s, 0, 0, 0)
  retainDay(s)
}
for (let i = 0; i < 20; i++) { settle(); advanceDay(s); assignSchedules() }
settle()

const trips = Object.keys(s.trips).length
const staff = Object.values(s.staff).length
console.log(`Ready: ${Object.keys(s.buses).length} coaches, ${Object.keys(s.schedules).length} schedules, ${trips} trips, ${staff} staff, day ${s.day}\n`)

type Phase = [string, (x: GameState) => void]
const phases: Phase[] = [
  ['dailyWorldPass', dailyWorldPass],
  ['dailyEventRoll', dailyEventRoll],
  ['dailyCargoPass', dailyCargoPass],
  ['deliverOrdersPass', deliverOrdersPass],
  ['permitPass', permitPass],
  ['festivalFleetPass', festivalFleetPass],
  ['dailyCharterPass', dailyCharterPass],
  ['cmvrResetPass', cmvrResetPass],
  ['sanitizeScheduleAssignments', sanitizeScheduleAssignments],
  ['generateTrips', generateTrips],
  ['bookingPass', bookingPass],
  ['hrFatiguePass', hrFatiguePass],
  ['opsAutoStaffPass#1', opsAutoStaffPass],
  ['dispatchPass', dispatchPass],
  ['settleCargoShortfall', settleCargoShortfall],
  ['dailyCheckpostPass', dailyCheckpostPass],
  ['dailyDepotPass', dailyDepotPass],
  ['dailyMaintenancePass', dailyMaintenancePass],
  ['dailyClaimsPass', dailyClaimsPass],
  ['dailyStaffPass', dailyStaffPass],
  ['dailyCrmPass', dailyCrmPass],
  ['opsAutoStaffPass#2', opsAutoStaffPass],
  ['settleReceivables', settleReceivables],
  ['accountantDecisionPass', accountantDecisionPass],
  ['dailyBankingPass', dailyBankingPass],
  ['dailyTaxPass', dailyTaxPass],
  ['checkPrimo', checkPrimo],
  ['checkCertifications', checkCertifications],
  ['checkAchievements', checkAchievements],
  ['bankruptcyCheck', bankruptcyCheck],
  ['snapshotKpis', (x) => snapshotKpis(x, 0, 0, 0)],
  ['retainDay', retainDay],
]

const totals = new Map<string, number>()
const DAYS = 6
if (process.argv.includes('--profile')) {
  const { Session } = await import('node:inspector')
  const { writeFileSync } = await import('node:fs')
  const session = new Session()
  session.connect()
  const post = (method: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) =>
      session.post(method, (err, res) => (err ? reject(err) : resolve(res as Record<string, unknown>))),
    )
  await post('Profiler.enable')
  await post('Profiler.start')
  runPhases()
  const { profile } = await post('Profiler.stop')
  writeFileSync('day.cpuprofile', JSON.stringify(profile))
  console.log('wrote day.cpuprofile')
} else {
  runPhases()
}

function runPhases(): void {
  for (let d = 0; d < DAYS; d++) {
    s.day += 1
    for (const [name, fn] of phases) {
      const t0 = performance.now()
      fn(s)
      const ms = performance.now() - t0
      totals.set(name, (totals.get(name) ?? 0) + ms)
    }
    settle()
  }
}
const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
console.log(`Average per day over ${DAYS} days:`)
let sum = 0
for (const [name, total] of rows) {
  sum += total
  console.log(`  ${name.padEnd(30)} ${(total / DAYS).toFixed(1).padStart(8)} ms`)
}
console.log(`  ${'TOTAL'.padEnd(30)} ${(sum / DAYS).toFixed(1).padStart(8)} ms`)
