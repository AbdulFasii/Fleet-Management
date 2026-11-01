/**
 * Performance / storage probe for a large fleet.
 *
 *   npx tsx scripts/perf-probe.ts [--fleet 70] [--skip 7]
 *
 * Builds a big fleet, plays a few days to fill the booking window, then times
 * the operations a day-skip performs: deep clone, daily advance, save encode,
 * and the JSON footprint of every state slice.
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { applyDecision } from '../src/engine/sim/events'
import { assignBus, createSchedule, applySeasonalPermit } from '../src/engine/sim/schedules'
import { orderNewBus } from '../src/engine/sim/fleet'
import { recruitVeteran, assignStaff } from '../src/engine/sim/staffing'
import { ROUTES } from '../src/engine/data/routes'
import { stateFootprint } from '../src/engine/sim/retain'
import { encodeSaveString, toSaveDto } from '../src/store/saveCodec'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import type { GameState } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const fleetTarget = Number(arg('fleet', '70'))
const skipDays = Number(arg('skip', '7'))

const s: GameState = newGame('Perf Probe', 'malik', 'maa-mdu', 4242)
s.company.cash = 100_000_000_000

const ROUTE_IDS = ['maa-mdu', 'maa-blr', 'blr-hyd', 'maa-cbe', 'mdu-trv', 'maa-tir', 'maa-hyd', 'blr-goa']

function openPermit(routeId: string): void {
  if (s.permits[routeId]?.status === 'active') return
  s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 5, expiryDay: s.day + 20_000 }
  applySeasonalPermit(s, routeId)
  const sea = s.permits[routeId]!.seasonal
  if (sea) {
    sea.status = 'active'
    sea.expiryDay = s.day + 20_000
  }
}

function sizeOf(value: unknown): number {
  if (value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return -1
  }
}

function report(label: string): void {
  const keys: (keyof GameState)[] = [
    'trips', 'openTripIds', 'txns', 'monthly', 'kpis', 'decisions', 'inbox',
    'routeStats', 'routeHistory', 'seasonalStats', 'receivables', 'insuranceClaims',
    'buses', 'staff', 'schedules', 'permits', 'loans', 'busOrders', 'usedMarket',
    'leaseOffers', 'attachOffers', 'hiringPool', 'world', 'company',
  ]
  let total = 0
  const rows: [string, number][] = []
  for (const k of keys) {
    const bytes = sizeOf(s[k])
    total += bytes
    rows.push([String(k), bytes])
  }
  rows.sort((a, b) => b[1] - a[1])
  const foot = stateFootprint(s)
  console.log(`\n--- ${label} (day ${s.day}) ---`)
  for (const [k, bytes] of rows.slice(0, 12)) {
    console.log(`  ${k.padEnd(16)} ${String(bytes).padStart(10)} B`)
  }
  console.log(`  ${'TOTAL'.padEnd(16)} ${String(total).padStart(10)} B (${(total / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`  footprint: ${foot.trips} trips · ${foot.tripSeats} seats · ${foot.txns} txns · ${foot.routeDays} route-days`)
}

function topUpFleet(): void {
  const live = Object.values(s.buses).filter((b) => b.status !== 'sold' && b.status !== 'delivery')
  const need = fleetTarget - live.length - s.busOrders.length
  for (let i = 0; i < need; i++) {
    const modelId = i % 3 === 0 ? 'leyacsleep2' : i % 3 === 1 ? 'volvo9400semi' : 'cheetah'
    const err = orderNewBus(s, modelId, {})
    if (err) {
      console.log(`  (order refused: ${err})`)
      break
    }
  }
  // Force immediate delivery so the probe does not wait out lead times.
  for (const o of s.busOrders) o.deliveryDay = s.day
}

function crewFleet(): void {
  for (const bus of Object.values(s.buses)) {
    if (bus.status === 'delivery' || bus.status === 'sold') continue
    const crew = Object.values(s.staff).filter((st) => st.busId === bus.id)
    const drivers = crew.filter((st) => st.role === 'driver' || st.role === 'co_driver')
    if (drivers.length < 2) {
      for (let i = drivers.length; i < 2; i++) {
        const st = recruitVeteran(s, 'driver', { skill: [6, 7] })
        assignStaff(s, st.id, bus.id)
      }
    }
    if (!crew.some((st) => st.role === 'conductor')) {
      const st = recruitVeteran(s, 'conductor', { skill: [5, 7] })
      assignStaff(s, st.id, bus.id)
    }
  }
}

function assignSchedules(): void {
  const idle = Object.values(s.buses).filter((b) => b.status === 'active' && !b.scheduleId)
  if (idle.length === 0) return
  for (const bus of idle) {
    for (const routeId of ROUTE_IDS) {
      openPermit(routeId)
      const existing = Object.values(s.schedules).filter((sch) => sch.active && sch.routeId === routeId)
      const route = ROUTES[routeId]!
      let sch = existing.find((x) => x.busIds.length < (route.hours > 6 ? 2 : 1))
      if (!sch) {
        const res = createSchedule(s, {
          routeId,
          depHour: 18 + (existing.length % 6),
          depMin: (existing.length % 2) * 30 as 0 | 30,
          baseFare: Math.round(route.marketFareAC * 1.1),
          autoPrice: true,
          cancellation: 'standard',
          redDeal: false,
          paired: route.hours > 5,
          returnDepHour: 7 + (existing.length % 4),
          returnDepMin: 0 as 0 | 30,
        })
        if ('error' in res) continue
        sch = s.schedules[res.id]!
      }
      const err = assignBus(s, sch.id, bus.id)
      if (!err) break
    }
  }
}

function settleDecisions(): void {
  while (s.decisions.length > 0) {
    const dec = s.decisions[0]!
    const optId = dec.options[0]?.id ?? 'pass'
    const err = applyDecision(s, dec.id, optId)
    if (err) s.decisions.shift()
  }
}

/** Grow to target, then run warm-up days so the booking window is full. */
console.log(`Building a ${fleetTarget}-bus fleet…`)
for (let day = 0; day < 60; day++) {
  settleDecisions()
  topUpFleet()
  advanceDay(s)
  crewFleet()
  assignSchedules()
}
settleDecisions()
// Let the boards fill out across the 30-day window.
for (let day = 0; day < 20; day++) {
  settleDecisions()
  advanceDay(s)
}

const fleet = Object.values(s.buses).filter((b) => b.status !== 'sold').length
const schedules = Object.values(s.schedules).filter((x) => x.active).length
console.log(`Ready: ${fleet} coaches, ${schedules} active schedules, day ${s.day}`)
report('after warm-up')

// ---------- timings ----------
function time(label: string, times: number, fn: () => void): number {
  // warm once
  fn()
  const t0 = performance.now()
  for (let i = 0; i < times; i++) fn()
  const ms = (performance.now() - t0) / Math.max(1, times)
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1)} ms`)
  return ms
}

console.log('\n--- single-operation timings ---')
time('structuredClone(state)', 3, () => { structuredClone(s) })
time('JSON.stringify(state)', 3, () => { JSON.stringify(s) })
time('toSaveDto(state)', 3, () => { toSaveDto(s) })
time('JSON save DTO', 3, () => { JSON.stringify(toSaveDto(s)) })
time('encodeSaveString(state)', 3, () => { encodeSaveString(s) })

{
  const ctx = buildBookingCtx(s)
  const sample = s.openTripIds.slice(-4000)
  const run = () => {
    for (const id of sample) {
      const t = s.trips[id]
      if (t) tripLoadFactor(s, t, t.day - s.day, ctx)
    }
  }
  time(`tripLoadFactor ×${sample.length}`, 2, run)
}

console.log(`\n--- ${skipDays}-day skip ---`)
const before = structuredClone(s) as GameState
let t0 = performance.now()
const draft = structuredClone(before) as GameState
console.log(`  clone          ${(performance.now() - t0).toFixed(0)} ms`)
t0 = performance.now()
for (let i = 0; i < skipDays; i++) {
  advanceDay(draft)
  settleDecisions()
}
const tickMs = performance.now() - t0
console.log(`  advanceDay ×${skipDays} ${tickMs.toFixed(0)} ms (${(tickMs / skipDays).toFixed(0)} ms/day)`)
t0 = performance.now()
const payload = encodeSaveString(draft)
console.log(`  encode save    ${(performance.now() - t0).toFixed(0)} ms (${(payload.length / 1024 / 1024).toFixed(2)} MB)`)
t0 = performance.now()
structuredClone(draft)
console.log(`  clone after    ${(performance.now() - t0).toFixed(0)} ms`)
report('after skip')

// Per-slice daily growth for one more day on the draft.
const sizesBefore = new Map<keyof GameState, number>()
for (const k of Object.keys(draft) as (keyof GameState)[]) sizesBefore.set(k, sizeOf(draft[k]))
const dayStart = performance.now()
advanceDay(draft)
console.log(`\n  one more advanceDay: ${(performance.now() - dayStart).toFixed(0)} ms`)
const growth: [string, number][] = []
for (const k of Object.keys(draft) as (keyof GameState)[]) {
  const delta = sizeOf(draft[k]) - (sizesBefore.get(k) ?? 0)
  if (Math.abs(delta) > 2_000) growth.push([String(k), delta])
}
growth.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
console.log('  biggest per-day slice deltas:')
for (const [k, d] of growth.slice(0, 8)) console.log(`    ${k.padEnd(16)} ${d > 0 ? '+' : ''}${d} B`)
