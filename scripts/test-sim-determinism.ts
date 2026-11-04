import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { ROUTES } from '../src/engine/data/routes'
import { applySeasonalPermit, createSchedule, assignBus } from '../src/engine/sim/schedules'
import { orderNewBus } from '../src/engine/sim/fleet'
import { recruitVeteran, assignStaff } from '../src/engine/sim/staffing'
import { applyDecision } from '../src/engine/sim/events'
import type { GameState } from '../src/engine/types'

export function buildProbeFixture(fleetTarget = 60, seed = 4242): GameState {
  const s: GameState = newGame('Perf Probe', 'malik', 'maa-mdu', seed)
  s.company.cash = 100_000_000_000
  const ROUTE_IDS = ['maa-mdu', 'maa-blr', 'blr-hyd', 'maa-cbe', 'mdu-trv', 'maa-tir', 'maa-hyd', 'blr-goa']

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
      const err = orderNewBus(s, modelId, {})
      if (err) break
    }
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
            depMin: ((existing.length % 2) * 30) as 0 | 30,
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

  for (let day = 0; day < 60; day++) {
    settleDecisions()
    topUpFleet()
    advanceDay(s)
    crewFleet()
    assignSchedules()
  }
  settleDecisions()
  for (let day = 0; day < 20; day++) {
    settleDecisions()
    advanceDay(s)
  }

  return s
}

export function runDeterminismCheck(days = 5) {
  const s = buildProbeFixture(60, 4242)
  console.log(`Ready fixture at day ${s.day}, starting ${days}-day test run...`)
  const snapshots: { day: number; soldSeats: number; revenue: number; openTrips: number; cash: number }[] = []

  for (let i = 0; i < days; i++) {
    advanceDay(s)
    let sold = 0
    let rev = 0
    for (const t of Object.values(s.trips)) {
      sold += t.sold
      rev += t.revenue
    }
    snapshots.push({
      day: s.day,
      soldSeats: sold,
      revenue: Math.round(rev),
      openTrips: s.openTripIds.length,
      cash: Math.round(s.company.cash),
    })
  }

  return snapshots
}

const snapshots = runDeterminismCheck(5)
console.log('BASELINE SNAPSHOTS:\n', JSON.stringify(snapshots, null, 2))
