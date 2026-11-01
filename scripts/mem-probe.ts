/**
 * Memory / save-size probe for a long game.
 *
 *   npx tsx scripts/mem-probe.ts [--years 6] [--fleet 20]
 *
 * Grows a real 20-coach fleet on several corridors, then plays year by year and
 * prints the byte size of every top-level game-state slice, so an unbounded
 * array or map shows up immediately.
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { applyDecision } from '../src/engine/sim/events'
import { assignBus, createSchedule, applySeasonalPermit } from '../src/engine/sim/schedules'
import { orderNewBus } from '../src/engine/sim/fleet'
import { recruitVeteran, assignStaff } from '../src/engine/sim/staffing'
import { ROUTES } from '../src/engine/data/routes'
import { encodeSaveString } from '../src/store/saveCodec'
import type { GameState } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const years = Number(arg('years', '6'))
const fleetTarget = Number(arg('fleet', '20'))

const s: GameState = newGame('Mem Probe', 'malik', 'maa-mdu', 4242)
// Money is paise: ₹100 crore, enough to grow a 20-coach fleet without finance noise.
s.company.cash = 100_000_000_000

/** Corridors the probe operates: alternating metro and hometown routes. */
const ROUTE_IDS = ['maa-mdu', 'maa-blr', 'blr-hyd', 'maa-cbe', 'mdu-trv']

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

/** JSON byte size of one slice, tolerant of cycles. */
function sizeOf(value: unknown): number {
  if (value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return -1
  }
}

function growthReport(label: string): number {
  const keys: (keyof GameState)[] = [
    'trips', 'openTripIds', 'txns', 'monthly', 'kpis', 'decisions', 'inbox',
    'routeStats', 'routeHistory', 'seasonalStats', 'receivables', 'insuranceClaims',
    'buses', 'staff', 'schedules', 'permits', 'loans', 'busOrders', 'usedMarket',
    'leaseOffers', 'attachOffers', 'hiringPool', 'world',
  ]
  let total = 0
  console.log(`\n--- ${label} (day ${s.day}) ---`)
  const rows: [string, number, string][] = []
  for (const k of keys) {
    const v = s[k]
    const bytes = sizeOf(v)
    total += bytes
    let count = ''
    if (Array.isArray(v)) count = `${v.length} items`
    else if (v && typeof v === 'object') {
      if ('trips' === k || 'buses' === k || 'staff' === k || 'schedules' === k) count = `${Object.keys(v).length} keys`
      else count = `${Object.keys(v).length} keys`
    }
    rows.push([String(k), bytes, count])
  }
  const companyBytes = sizeOf(s.company)
  total += companyBytes
  rows.push(['company', companyBytes, ''])
  rows.sort((a, b) => b[1] - a[1])
  for (const [k, bytes, count] of rows.slice(0, 14)) {
    console.log(`  ${k.padEnd(16)} ${String(bytes).padStart(10)} B  ${count}`)
  }
  total += 0
  console.log(`  ${'TOTAL'.padEnd(16)} ${String(total).padStart(10)} B  (${(total / 1024).toFixed(0)} KB)`)
  console.log(`  company: grievances ${s.company.grievances?.length ?? 0}, claims ${s.insuranceClaims.length}, contracts ${s.company.cargoContracts?.length ?? 0}, spot ${s.company.spotOffers?.length ?? 0}`)
  const save = encodeSaveString(s).length
  console.log(`  encoded save: ${save} B (${(save / 1024).toFixed(0)} KB)`)
  return total
}

/** Keep the fleet at target and crew every coach. */
function topUpFleet(): void {
  const live = Object.values(s.buses).filter((b) => b.status !== 'sold' && b.status !== 'delivery')
  const pending = s.busOrders.length
  const need = fleetTarget - live.length - pending
  for (let i = 0; i < need; i++) {
    const modelId = i % 3 === 0 ? 'leyacsleep2' : i % 3 === 1 ? 'volvo9400semi' : 'cheetah'
    const err = orderNewBus(s, modelId, {})
    if (err) {
      console.log(`  (order refused: ${err})`)
      break
    }
  }
  // Crew any coach without a full complement.
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

/** Put idle coaches on schedules across the probe corridors. */
function assignSchedules(): void {
  const idle = Object.values(s.buses).filter(
    (b) => b.status === 'active' && !b.scheduleId,
  )
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
          depHour: 20 + (existing.length % 3),
          depMin: 0,
          baseFare: Math.round(route.marketFareAC * 1.1),
          autoPrice: true,
          cancellation: 'standard',
          redDeal: false,
          paired: route.hours > 5,
          returnDepHour: 8 + (existing.length % 3),
          returnDepMin: 0,
        })
        if ('error' in res) continue
        sch = s.schedules[res.id]!
      }
      const err = assignBus(s, sch.id, bus.id)
      if (!err) break
    }
  }
}

console.log(`Simulating ${years} years with a ${fleetTarget}-coach fleet…`)
const sizes: number[] = []
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 365; d++) {
    while (s.decisions.length > 0) {
      const dec = s.decisions[0]!
      const optId = dec.options[0]?.id ?? 'pass'
      const err = applyDecision(s, dec.id, optId)
      if (err) s.decisions.shift()
    }
    topUpFleet()
    assignSchedules()
    advanceDay(s)
    // Re-cover a coach that got retired/sold out from under the probe.
    for (const bus of Object.values(s.buses)) {
      if (bus.status === 'active' && !bus.scheduleId) assignSchedules()
    }
  }
  sizes.push(growthReport(`after year ${y}`))
  // Cap cash injections so P&L stays meaningful.
  if (s.company.cash < 100_000_000_000) s.company.cash = 100_000_000_000
}

console.log('\n=== growth per year (KB) ===')
let prev = 0
for (let i = 0; i < sizes.length; i++) {
  const kb = Math.round(sizes[i]! / 1024)
  console.log(`  year ${i + 1}: ${kb} KB  (+${Math.round((sizes[i]! - prev) / 1024)} KB)`)
  prev = sizes[i]!
}
console.log(`\nFinal fleet: ${Object.values(s.buses).length} coaches, day ${s.day}`)
console.log(`Monthly entries: ${s.monthly.length}, txns: ${s.txns.length}, kpis: ${s.kpis.length}, decisions: ${s.decisions.length}`)
console.log(`Grievances: ${s.company.grievances?.length ?? 0}, contracts: ${s.company.cargoContracts?.length ?? 0}, spotOffers: ${s.company.spotOffers?.length ?? 0}`)
console.log(`Claims: ${s.insuranceClaims.length}, receivables: ${s.receivables.length}, routeHistory routes: ${Object.keys(s.routeHistory).length}`)
console.log(`Seasonal history: ${s.seasonalStats?.history.length ?? 0}`)
