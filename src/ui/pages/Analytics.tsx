import { Fragment, useEffect, useMemo, useState } from 'react'
import { fmtDateShort } from '../../engine/core/calendar'
import {
  Area, AreaChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { useDeferredGameState } from '../../store/gameStore'
import { routeName, canonicalRouteId, ROUTES } from '../../engine/data/routes'
import { BAL } from '../../engine/data/balance'
import { routeStatsForPeriod, UNASSIGNED_BRAND_KEY, brandKeyForService } from '../../engine/sim/finance'
import { getSeasonalStatsForPeriod } from '../../engine/sim/festival'
import { toRupees } from '../../engine/core/money'
import type { RouteLayoutStats, RouteStats, BusGroup } from '../../engine/types'
import { KV, M, Panel, ratingTone, GroupBadge, StatRow, PageHeader } from '../bits'
import { activeGroups, brandStars, compareGroupsPassengerFirst, fleetDescendantIds } from '../../engine/sim/groups'
import { BrandOptions } from '../BrandOptions'

type PeriodId = 'lifetime' | '7' | '30' | '90' | '180' | '365'

const PERIODS: { id: PeriodId; label: string; days: number | null }[] = [
  { id: 'lifetime', label: 'Lifetime', days: null },
  { id: '7', label: 'Last 1 week', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 3 months', days: 90 },
  { id: '180', label: 'Last 6 months', days: 180 },
  { id: '365', label: 'Last 1 year', days: 365 },
]

type RouteRow = ReturnType<typeof buildRouteRows>[number]
type RouteSortKey =
  | 'route' | 'trips' | 'revenue' | 'cost' | 'profit'
  | 'occupancy' | 'occ30' | 'profitPerSeatKm' | 'revPerSeatKm' | 'costPerSeatKm' | 'breakeven'

const BASE_ROUTE_SORT_COLS: { key: RouteSortKey; label: string; num?: boolean }[] = [
  { key: 'route', label: 'Route' },
  { key: 'trips', label: 'Trips', num: true },
  { key: 'revenue', label: 'Revenue', num: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'profit', label: 'Profit', num: true },
  { key: 'occupancy', label: 'Occupancy', num: true },
  { key: 'occ30', label: '30d occ', num: true },
]

const UNIT_ROUTE_SORT_COLS: { key: RouteSortKey; label: string; num?: boolean }[] = [
  { key: 'profitPerSeatKm', label: 'Profit/seat-km', num: true },
  { key: 'revPerSeatKm', label: 'Rev/seat-km', num: true },
  { key: 'costPerSeatKm', label: 'Cost/seat-km', num: true },
  { key: 'breakeven', label: 'Breakeven LF', num: true },
]

const ALL_ROUTE_SORT_COLS = [...BASE_ROUTE_SORT_COLS, ...UNIT_ROUTE_SORT_COLS]

function routeSortValue(r: RouteRow, key: RouteSortKey): number | string {
  switch (key) {
    case 'route': return routeName(r.rid)
    case 'trips': return r.st.trips
    case 'revenue': return r.st.revenue
    case 'cost': return r.st.cost
    case 'profit': return r.profit
    case 'occupancy': return r.occupancy
    case 'occ30': return r.occ30 ?? -1
    case 'profitPerSeatKm': return r.profitPerSeatKm
    case 'revPerSeatKm': return r.revPerSeatKm
    case 'costPerSeatKm': return r.costPerSeatKm
    case 'breakeven': return r.breakeven
  }
}

function readSort(persistKey: string, fallbackKey: string): { key: string; desc: boolean } {
  try {
    const raw = localStorage.getItem(`busraj_tablesort_${persistKey}`)
    if (!raw) return { key: fallbackKey, desc: true }
    const parsed = JSON.parse(raw) as { key?: string; desc?: boolean }
    return {
      key: typeof parsed.key === 'string' ? parsed.key : fallbackKey,
      desc: typeof parsed.desc === 'boolean' ? parsed.desc : true,
    }
  } catch {
    return { key: fallbackKey, desc: true }
  }
}

function writeSort(persistKey: string, key: string, desc: boolean): void {
  try {
    localStorage.setItem(`busraj_tablesort_${persistKey}`, JSON.stringify({ key, desc }))
  } catch { /* ignore */ }
}

function layoutMetrics(st: RouteLayoutStats) {
  const profit = st.revenue - st.cost
  const occupancy = st.seatKm > 0 ? st.paxKm / st.seatKm : 0
  const profitPerSeatKm = st.seatKm > 0 ? profit / st.seatKm : 0
  const revPerSeatKm = st.seatKm > 0 ? st.revenue / st.seatKm : 0
  const costPerSeatKm = st.seatKm > 0 ? st.cost / st.seatKm : 0
  const revPerPaxKm = st.paxKm > 0 ? st.revenue / st.paxKm : 0
  const breakeven = revPerPaxKm > 0 ? costPerSeatKm / revPerPaxKm : 0
  return { profit, occupancy, profitPerSeatKm, revPerSeatKm, costPerSeatKm, breakeven }
}

function seatFill(st: { paxKm: number; seatKm: number } | undefined): number | null {
  return st && st.seatKm > 0 ? st.paxKm / st.seatKm : null
}

/** Fill band shared by every occupancy cell. */
function occTone(occ: number | null): string {
  if (occ === null) return 'dim'
  return occ >= 0.55 ? 'good' : occ < 0.4 ? 'bad' : 'warn'
}

function buildRouteRows(stats: Record<string, RouteStats>, recent: Record<string, RouteStats>) {
  return Object.entries(stats)
    .map(([rid, st]) => {
      const rec = recent[rid]
      const occ30 = seatFill(rec)
      const revPerSeatKm = st.seatKm > 0 ? st.revenue / st.seatKm : 0
      const costPerSeatKm = st.seatKm > 0 ? st.cost / st.seatKm : 0
      const profitPerSeatKm = st.seatKm > 0 ? (st.revenue - st.cost) / st.seatKm : 0
      const revPerPaxKm = st.paxKm > 0 ? st.revenue / st.paxKm : 0
      const occupancy = st.seatKm > 0 ? st.paxKm / st.seatKm : 0
      const breakeven = revPerPaxKm > 0 ? costPerSeatKm / revPerPaxKm : 0
      const layouts = Object.entries(st.byLayout ?? {})
        .map(([layout, lay]) => ({
          layout, ...lay, ...layoutMetrics(lay), occ30: seatFill(rec?.byLayout?.[layout]),
        }))
        .sort((a, b) => b.profitPerSeatKm - a.profitPerSeatKm)
      return {
        rid, st, revPerSeatKm, costPerSeatKm, profitPerSeatKm,
        occupancy, occ30, breakeven, profit: st.revenue - st.cost, layouts,
      }
    })
}

export function AnalyticsPage() {
  const s = useDeferredGameState()!
  const [period, setPeriod] = useState<PeriodId>('lifetime')
  const periodDef = PERIODS.find((p) => p.id === period) ?? PERIODS[0]!

  const savedRouteSort = readSort('analytics-routes', 'profit')
  const [routeSortKey, setRouteSortKey] = useState<RouteSortKey>(
    (ALL_ROUTE_SORT_COLS.some((c) => c.key === savedRouteSort.key) ? savedRouteSort.key : 'profit') as RouteSortKey,
  )
  const [routeSortDesc, setRouteSortDesc] = useState(savedRouteSort.desc)

  const routeStats = useMemo(
    () => routeStatsForPeriod(s, periodDef.days),
    [s, periodDef.days],
  )
  const seasonalSummary = useMemo(
    () => getSeasonalStatsForPeriod(s, periodDef.days),
    [s, periodDef.days],
  )
  // Trailing-30d fill is always shown beside the selected period: the number to act on.
  const recentStats = useMemo(() => routeStatsForPeriod(s, 30), [s])
  const routeRows = useMemo(() => buildRouteRows(routeStats, recentStats), [routeStats, recentStats])
  const [showLayouts, setShowLayouts] = useState(false)
  const [showBrands, setShowBrands] = useState(false)
  const [routeBrandFilter, setRouteBrandFilter] = useState<'all' | 'none' | string>('all')

  const sortedRouteRows = useMemo(() => {
    const rows = [...routeRows]
    rows.sort((a, b) => {
      const av = routeSortValue(a, routeSortKey)
      const bv = routeSortValue(b, routeSortKey)
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return routeSortDesc ? -cmp : cmp
    })
    return rows
  }, [routeRows, routeSortKey, routeSortDesc])

  const brandFilterOptions = useMemo(() => {
    return activeGroups(s).filter((grp) => grp.kind !== 'operator')
  }, [s.groups])

  const routeBrandFilterKey = routeBrandFilter === 'all'
    ? null
    : routeBrandFilter === 'none'
      ? '__unassigned__'
      : routeBrandFilter

  const routeTotals = useMemo(() => {
    let trips = 0
    let revenue = 0
    let cost = 0
    let paxKm = 0
    let seatKm = 0
    for (const r of routeRows) {
      trips += r.st.trips
      revenue += r.st.revenue
      cost += r.st.cost
      paxKm += r.st.paxKm
      seatKm += r.st.seatKm
    }
    const profit = revenue - cost
    const occupancy = seatKm > 0 ? paxKm / seatKm : 0
    const profitPerSeatKm = seatKm > 0 ? profit / seatKm : 0
    const revPerSeatKm = seatKm > 0 ? revenue / seatKm : 0
    const costPerSeatKm = seatKm > 0 ? cost / seatKm : 0
    const revPerPaxKm = paxKm > 0 ? revenue / paxKm : 0
    const breakeven = revPerPaxKm > 0 ? costPerSeatKm / revPerPaxKm : 0
    return { trips, revenue, cost, profit, occupancy, profitPerSeatKm, revPerSeatKm, costPerSeatKm, breakeven, seatKm }
  }, [routeRows])

  const totalOcc30 = useMemo(() => {
    let paxKm = 0
    let seatKm = 0
    for (const r of routeRows) {
      const rec = recentStats[r.rid]
      if (!rec) continue
      paxKm += rec.paxKm
      seatKm += rec.seatKm
    }
    return seatKm > 0 ? paxKm / seatKm : null
  }, [routeRows, recentStats])

  const fleetOcc = useMemo(() => {
    let paxKm = 0
    let seatKm = 0
    for (const st of Object.values(routeStats)) {
      paxKm += st.paxKm
      seatKm += st.seatKm
    }
    return seatKm > 0 ? paxKm / seatKm : null
  }, [routeStats])

  const routeBrandStats = useMemo((): Record<string, {
    id: string
    group?: BusGroup
    name: string
    trips: number
    paxKm: number
    seatKm: number
    revenue: number
    cost: number
    profit: number
    occupancy: number
  }[]> => {
    const daysBack = periodDef.days
    const fromDay = daysBack !== null ? s.day - daysBack : null

    type RouteBrandAcc = {
      id: string
      group?: BusGroup
      name: string
      trips: number
      paxKm: number
      seatKm: number
      revenue: number
      cost: number
    }

    const byRoute = new Map<string, Map<string, RouteBrandAcc>>()

    const getAcc = (canonRid: string, brandKey: string): RouteBrandAcc => {
      let rMap = byRoute.get(canonRid)
      if (!rMap) {
        rMap = new Map()
        byRoute.set(canonRid, rMap)
      }
      let acc = rMap.get(brandKey)
      if (!acc) {
        const grp = brandKey !== UNASSIGNED_BRAND_KEY && s.groups ? s.groups[brandKey] : undefined
        acc = {
          id: brandKey,
          group: grp,
          name: grp ? grp.name : 'Unassigned',
          trips: 0,
          paxKm: 0,
          seatKm: 0,
          revenue: 0,
          cost: 0,
        }
        rMap.set(brandKey, acc)
      }
      return acc
    }

    const addBrand = (
      canonRid: string,
      brandKey: string,
      delta: { trips?: number; paxKm?: number; seatKm?: number; revenue?: number; cost?: number },
    ) => {
      const acc = getAcc(canonRid, brandKey)
      acc.trips += delta.trips ?? 0
      acc.paxKm += delta.paxKm ?? 0
      acc.seatKm += delta.seatKm ?? 0
      acc.revenue += delta.revenue ?? 0
      acc.cost += delta.cost ?? 0
    }

    // Primary source: routeHistory / routeStats byBrand. This survives the
    // 3-day completed-trip prune that used to freeze every brand-filtered period.
    if (fromDay === null) {
      for (const [rid, st] of Object.entries(s.routeStats ?? {})) {
        if (!s.permits[rid]) continue
        const canonRid = canonicalRouteId(rid)
        const brands = st.byBrand
        if (brands && Object.keys(brands).length > 0) {
          for (const [brandKey, b] of Object.entries(brands)) {
            addBrand(canonRid, brandKey, b)
          }
        }
      }
    } else if (s.routeHistory) {
      for (const [rid, hist] of Object.entries(s.routeHistory)) {
        if (!s.permits[rid]) continue
        const canonRid = canonicalRouteId(rid)
        for (const d of hist) {
          if (d.day <= fromDay || d.day > s.day) continue
          const brands = d.byBrand
          if (!brands || Object.keys(brands).length === 0) continue
          for (const [brandKey, b] of Object.entries(brands)) {
            addBrand(canonRid, brandKey, b)
          }
        }
      }
    }

    // Backfill recent days that pre-date byBrand (old saves): use still-retained trips.
    const tripKeepFrom = s.day - BAL.completedTripKeepDays
    for (const tr of Object.values(s.trips)) {
      if (tr.status !== 'completed') continue
      if (fromDay !== null && (tr.day <= fromDay || tr.day > s.day)) continue
      if (fromDay === null && tr.day < tripKeepFrom) continue
      const canonRid = canonicalRouteId(tr.routeId)
      const brandKey = brandKeyForService(s, { busId: tr.busId, tripId: tr.id, scheduleId: tr.scheduleId }, tr.day)
      // Skip if history already credited this day for this brand (avoid double-count).
      const dayRow = s.routeHistory?.[tr.routeId]?.find((d) => d.day === tr.day)
        ?? s.routeHistory?.[canonRid]?.find((d) => d.day === tr.day)
      if (dayRow?.byBrand && Object.keys(dayRow.byBrand).length > 0) continue
      const route = ROUTES[tr.routeId]
      const seats = tr.seatCount || tr.seats.length || 0
      const km = route?.km ?? 0
      addBrand(canonRid, brandKey, {
        trips: 1,
        paxKm: (tr.sold || 0) * km,
        seatKm: seats * km,
        revenue: tr.revenue || 0,
      })
    }

    // Cost backfill for days without byBrand: allocate route txns by bus brand.
    if (fromDay !== null) {
      for (const t of s.txns) {
        if (t.day <= fromDay || t.day > s.day || !t.routeId || t.kind !== 'expense') continue
        const dayRow = s.routeHistory?.[t.routeId]?.find((d) => d.day === t.day)
          ?? s.routeHistory?.[canonicalRouteId(t.routeId)]?.find((d) => d.day === t.day)
        if (dayRow?.byBrand && Object.keys(dayRow.byBrand).length > 0) continue
        const brandKey = brandKeyForService(s, { busId: t.busId, tripId: t.tripId }, t.day)
        addBrand(canonicalRouteId(t.routeId), brandKey, { cost: t.amount })
      }
    }

    const out: Record<string, (RouteBrandAcc & { profit: number; occupancy: number })[]> = {}
    for (const [canonRid, rMap] of byRoute.entries()) {
      const list = Array.from(rMap.values())
        .filter((a) => a.trips > 0 || a.revenue > 0 || a.cost > 0)
        .map((a) => ({
          ...a,
          profit: a.revenue - a.cost,
          occupancy: a.seatKm > 0 ? a.paxKm / a.seatKm : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
      out[canonRid] = list
    }
    return out
  }, [s, periodDef.days])

  const displayedRouteRows = useMemo(() => {
    if (!routeBrandFilterKey) return sortedRouteRows
    const rows: RouteRow[] = []
    // Only corridors this brand actually operates (has a schedule), not every
    // corridor a brand coach once covered or visited.
    const brandCorridors = [
      ...new Set(
        Object.values(s.schedules)
          .filter((sch) =>
            routeBrandFilterKey === UNASSIGNED_BRAND_KEY
              ? !sch.groupId
              : sch.groupId === routeBrandFilterKey,
          )
          .map((sch) => canonicalRouteId(sch.routeId)),
      ),
    ]
    for (const canon of brandCorridors) {
      const brands = routeBrandStats[canon] ?? []
      const b = brands.find((x) => x.id === routeBrandFilterKey)
      const seatKm = Math.max(0, b?.seatKm ?? 0)
      const paxKm = Math.max(0, b?.paxKm ?? 0)
      const revenue = b?.revenue ?? 0
      const cost = b?.cost ?? 0
      const trips = b?.trips ?? 0
      const profit = revenue - cost
      const occupancy = seatKm > 0 ? paxKm / seatKm : 0
      const revPerSeatKm = seatKm > 0 ? revenue / seatKm : 0
      const costPerSeatKm = seatKm > 0 ? cost / seatKm : 0
      const profitPerSeatKm = seatKm > 0 ? profit / seatKm : 0
      const revPerPaxKm = paxKm > 0 ? revenue / paxKm : 0
      const breakeven = revPerPaxKm > 0 ? costPerSeatKm / revPerPaxKm : 0
      const base = sortedRouteRows.find((r) => canonicalRouteId(r.rid) === canon)
      rows.push({
        rid: base?.rid ?? canon,
        st: { revenue, cost, trips, paxKm, seatKm, byLayout: {} },
        occupancy,
        occ30: null,
        breakeven,
        profit,
        revPerSeatKm,
        costPerSeatKm,
        profitPerSeatKm,
        layouts: [],
      })
    }
    rows.sort((a, b) => {
      const av = routeSortValue(a, routeSortKey)
      const bv = routeSortValue(b, routeSortKey)
      if (typeof av === 'string' && typeof bv === 'string') {
        const cmp = av.localeCompare(bv)
        return routeSortDesc ? -cmp : cmp
      }
      const cmp = (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0
      return routeSortDesc ? -cmp : cmp
    })
    return rows
  }, [sortedRouteRows, routeBrandStats, routeBrandFilterKey, routeSortKey, routeSortDesc, s.schedules])

  const tableRouteTotals = useMemo(() => {
    let trips = 0
    let revenue = 0
    let cost = 0
    let paxKm = 0
    let seatKm = 0
    for (const r of displayedRouteRows) {
      trips += r.st.trips
      revenue += r.st.revenue
      cost += r.st.cost
      paxKm += r.st.paxKm
      seatKm += r.st.seatKm
    }
    const profit = revenue - cost
    const occupancy = seatKm > 0 ? paxKm / seatKm : 0
    const profitPerSeatKm = seatKm > 0 ? profit / seatKm : 0
    const revPerSeatKm = seatKm > 0 ? revenue / seatKm : 0
    const costPerSeatKm = seatKm > 0 ? cost / seatKm : 0
    const revPerPaxKm = paxKm > 0 ? revenue / paxKm : 0
    const breakeven = revPerPaxKm > 0 ? costPerSeatKm / revPerPaxKm : 0
    return { trips, revenue, cost, profit, occupancy, profitPerSeatKm, revPerSeatKm, costPerSeatKm, breakeven, seatKm }
  }, [displayedRouteRows])

  const tableOcc30 = useMemo(() => {
    if (routeBrandFilterKey) return null
    let paxKm = 0
    let seatKm = 0
    for (const r of displayedRouteRows) {
      const rec = recentStats[r.rid]
      if (!rec) continue
      paxKm += rec.paxKm
      seatKm += rec.seatKm
    }
    return seatKm > 0 ? paxKm / seatKm : null
  }, [displayedRouteRows, recentStats, routeBrandFilterKey])

  const serviceTierStats = useMemo(() => {
    const daysBack = periodDef.days
    const fromDay = daysBack !== null ? s.day - daysBack : 0

    let spendA = 0
    let countA = 0
    let spendB = 0
    let countB = 0
    let spendOverhaul = 0
    let countOverhaul = 0

    for (const t of s.txns) {
      if (t.kind !== 'expense' || t.head !== 'maintenance' || t.day < fromDay) continue
      const note = t.note ?? ''
      if (note.includes('A-Service') || note === 'scheduled service') {
        spendA += t.amount
        countA++
      } else if (note.includes('B-Service')) {
        spendB += t.amount
        countB++
      } else if (note.includes('Overhaul') || note.includes('Annual Overhaul')) {
        spendOverhaul += t.amount
        countOverhaul++
      }
    }

    if (period === 'lifetime' && s.company.serviceSpendByTier) {
      spendA = Math.max(spendA, s.company.serviceSpendByTier.a ?? 0)
      spendB = Math.max(spendB, s.company.serviceSpendByTier.b ?? 0)
      spendOverhaul = Math.max(spendOverhaul, s.company.serviceSpendByTier.overhaul ?? 0)
      countA = Math.max(countA, s.company.serviceCountByTier?.a ?? 0)
      countB = Math.max(countB, s.company.serviceCountByTier?.b ?? 0)
      countOverhaul = Math.max(countOverhaul, s.company.serviceCountByTier?.overhaul ?? 0)
    }

    let totalKm = 0
    if (period === 'lifetime') {
      totalKm = Object.values(s.buses).reduce((a, b) => a + b.odometer, 0)
    } else {
      const tripsInPeriod = Object.values(s.trips).filter((t) => t.status === 'completed' && t.day >= fromDay)
      totalKm = tripsInPeriod.reduce((a, t) => {
        const route = s.routeStats[t.routeId]
        const km = route ? Math.round(route.seatKm / Math.max(1, (route.trips || 1) * 40)) : 350
        return a + km
      }, 0)
      if (totalKm <= 0) {
        const lifetimeKm = Object.values(s.buses).reduce((a, b) => a + b.odometer, 0)
        totalKm = Math.round(lifetimeKm * (daysBack! / Math.max(1, s.day - s.startDay)))
      }
    }

    const safeKm = Math.max(1, totalKm)
    const costPerKmA = (spendA / 100) / safeKm
    const costPerKmB = (spendB / 100) / safeKm
    const costPerKmOverhaul = (spendOverhaul / 100) / safeKm
    const totalMaintSpend = spendA + spendB + spendOverhaul
    const costPerKmTotal = (totalMaintSpend / 100) / safeKm

    return {
      spendA, countA, costPerKmA,
      spendB, countB, costPerKmB,
      spendOverhaul, countOverhaul, costPerKmOverhaul,
      totalMaintSpend, costPerKmTotal,
      totalKm,
    }
  }, [s.txns, s.company.serviceSpendByTier, s.company.serviceCountByTier, s.buses, s.trips, s.routeStats, s.day, s.startDay, period, periodDef.days])

  const applyRouteSort = (key: RouteSortKey) => {
    let nextDesc = true
    if (routeSortKey === key) nextDesc = !routeSortDesc
    setRouteSortKey(key)
    setRouteSortDesc(nextDesc)
    writeSort('analytics-routes', key, nextDesc)
  }

  const [shareRoute, setShareRoute] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('busraj_analytics_route')
      if (saved && (saved in ROUTES || saved in s.permits)) return saved
    } catch {}
    return Object.keys(s.permits)[0] || Object.keys(ROUTES)[0] || 'maa-blr'
  })

  const shareData = useMemo(() => {
    const list = s.world.shareHistory?.[shareRoute] ?? []
    return list.map((h) => ({
      day: fmtDateShort(h.day),
      player: Math.round(h.player),
      rival: Math.max(0, 100 - Math.round(h.player)),
    }))
  }, [s.world.shareHistory, shareRoute])

  const brandEconomicsRows = useMemo(() => {
    type BrandEconRow = {
      id: string
      group?: BusGroup
      name: string
      buses: number
      services: number
      trips: number
      paxKm: number
      seatKm: number
      occupancy: number | null
      revenue: number
      cost: number
      profit: number
      perTrip: number
      rating: number
      ratingCount: number
      primo: boolean
      stars: number | null
      /** Operator rows hold the sum of their fleet brands and are left out of the total. */
      isOperator: boolean
      /** Fleet brands an operator row adds up. */
      fleetCount: number
      depth: number
    }

    const emptyRow = (id: string, name: string, extras: Partial<BrandEconRow> = {}): BrandEconRow => ({
      id,
      name,
      buses: 0,
      services: 0,
      trips: 0,
      paxKm: 0,
      seatKm: 0,
      occupancy: null,
      revenue: 0,
      cost: 0,
      profit: 0,
      perTrip: 0,
      rating: s.company.rating,
      ratingCount: 0,
      primo: false,
      stars: null,
      isOperator: false,
      fleetCount: 0,
      depth: 0,
      ...extras,
    })

    const map = new Map<string, BrandEconRow>()

    map.set(UNASSIGNED_BRAND_KEY, emptyRow(UNASSIGNED_BRAND_KEY, 'Unassigned'))

    for (const grp of Object.values(s.groups ?? {})) {
      map.set(grp.id, emptyRow(grp.id, grp.name, {
        group: grp,
        rating: grp.ratingCount >= BAL.groupRatingMinReviews ? grp.rating : s.company.rating,
        ratingCount: grp.ratingCount,
        primo: Boolean(grp.primo),
        stars: brandStars(s, grp.id),
      }))
    }

    // Keys for brands that no longer exist (deleted brands, old saves) count as Unassigned.
    const rowFor = (key: string | undefined): BrandEconRow =>
      map.get(key ?? UNASSIGNED_BRAND_KEY) ?? map.get(UNASSIGNED_BRAND_KEY)!

    for (const b of Object.values(s.buses)) {
      const row = rowFor(b.groupId)
      row.buses += 1
      row.trips += b.lifeTrips
      row.revenue += b.lifeRevenue
      row.cost += b.lifeCost
      row.profit += (b.lifeRevenue - b.lifeCost)
    }

    for (const sch of Object.values(s.schedules)) {
      rowFor(sch.groupId).services += 1
    }

    // Lifetime load factor from corridor brand splits (pax-km / seat-km).
    for (const st of Object.values(s.routeStats ?? {})) {
      const brands = st.byBrand
      if (!brands) continue
      for (const [brandKey, b] of Object.entries(brands)) {
        const row = rowFor(brandKey)
        row.paxKm += b.paxKm
        row.seatKm += b.seatKm
      }
    }

    // Operators: sum every fleet brand beneath them (sums of pax-km and seat-km, so the
    // occupancy is a true load factor; rating weighted by review count).
    for (const grp of Object.values(s.groups ?? {})) {
      if (grp.kind !== 'operator') continue
      const row = map.get(grp.id)!
      row.isOperator = true
      row.stars = null
      let ratingSum = 0
      let reviews = 0
      for (const fid of fleetDescendantIds(s, grp.id)) {
        const child = map.get(fid)
        if (!child) continue
        row.fleetCount += 1
        row.buses += child.buses
        row.services += child.services
        row.trips += child.trips
        row.revenue += child.revenue
        row.cost += child.cost
        row.profit += child.profit
        row.paxKm += child.paxKm
        row.seatKm += child.seatKm
        ratingSum += child.rating * child.ratingCount
        reviews += child.ratingCount
      }
      row.ratingCount = reviews
      row.rating = reviews > 0 ? ratingSum / reviews : s.company.rating
    }

    for (const row of map.values()) {
      row.perTrip = row.trips > 0 ? row.profit / row.trips : 0
      row.occupancy = row.seatKm > 0 ? row.paxKm / row.seatKm : null
    }

    // Tree order: Unassigned first, then each top-level brand followed by the brands under it.
    const groups = s.groups ?? {}
    const childrenOf = new Map<string, BusGroup[]>()
    for (const grp of Object.values(groups)) {
      const parent = grp.parentGroupId && groups[grp.parentGroupId] ? grp.parentGroupId : ''
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent)!.push(grp)
    }
    const ordered: BrandEconRow[] = [map.get(UNASSIGNED_BRAND_KEY)!]
    const seen = new Set<string>()
    const walk = (parent: string, depth: number) => {
      for (const grp of (childrenOf.get(parent) ?? []).sort(compareGroupsPassengerFirst)) {
        if (seen.has(grp.id)) continue
        seen.add(grp.id)
        const row = map.get(grp.id)!
        row.depth = depth
        ordered.push(row)
        walk(grp.id, depth + 1)
      }
    }
    walk('', 0)
    return ordered
  }, [s.buses, s.schedules, s.groups, s.company.rating, s.routeStats, s])

  const brandTotals = useMemo(() => {
    let buses = 0
    let services = 0
    let trips = 0
    let paxKm = 0
    let seatKm = 0
    let revenue = 0
    let cost = 0
    let profit = 0
    for (const r of brandEconomicsRows) {
      if (r.isOperator) continue
      buses += r.buses
      services += r.services
      trips += r.trips
      paxKm += r.paxKm
      seatKm += r.seatKm
      revenue += r.revenue
      cost += r.cost
      profit += r.profit
    }
    const perTrip = trips > 0 ? profit / trips : 0
    const occupancy = seatKm > 0 ? paxKm / seatKm : null
    return { buses, services, trips, occupancy, revenue, cost, profit, perTrip }
  }, [brandEconomicsRows])

  const [showUnit, setShowUnit] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')

  const SECTIONS = useMemo(() => [
    { id: 'overview', label: 'Overview' },
    { id: 'brands', label: 'Brands' },
    { id: 'routes', label: 'Routes' },
    { id: 'seasonal', label: 'Seasonal' },
    { id: 'fleet', label: 'Maintenance' },
    { id: 'market', label: 'Market Share' },
  ], [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { threshold: 0.15, rootMargin: '-40px 0px -40% 0px' },
    )

    for (const sec of SECTIONS) {
      const el = document.getElementById(sec.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [SECTIONS])

  const routeSortCols = useMemo(
    () => (showUnit ? [...BASE_ROUTE_SORT_COLS, ...UNIT_ROUTE_SORT_COLS] : BASE_ROUTE_SORT_COLS),
    [showUnit],
  )

  const periodTitle = periodDef.id === 'lifetime'
    ? 'Route economics (lifetime)'
    : `Route economics (${periodDef.label.toLowerCase()})`

  return (
    <>
      <PageHeader title="Analytics" facts={<>{fleetOcc !== null ? <>occupancy {Math.round(fleetOcc * 100)}%</> : null}</>} />

      <nav className="analytics-subnav">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={`small ${activeSection === sec.id ? 'primary' : ''}`}
            onClick={() => {
              document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {sec.label}
          </button>
        ))}
      </nav>

      {/* 1. Overview Section */}
      <section id="overview" className="analytics-section">
        <h2 className="section-title">Overview</h2>
        {(() => {
          const totalSaveDays = Math.max(0, s.day - s.startDay)
          const historyDepthLimit = 400
          const availableDays = Math.min(totalSaveDays, historyDepthLimit)
          if (periodDef.days !== null && periodDef.days > availableDays) {
            return (
              <div
                style={{
                  padding: '8px 14px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                className="warn"
              >
                <span>ℹ️</span>
                <span>
                  <b>Only {availableDays} days of data available.</b> Showing all available history. (Period options that exceed available data are disabled until data accrues).
                </span>
              </div>
            )
          }
          return null
        })()}

        <StatRow
          items={[
            { label: `Revenue ${periodDef.label}`, value: <M v={routeTotals.revenue} /> },
            { label: 'Cost', value: <M v={routeTotals.cost} />, tone: 'bad' },
            { label: 'Profit', value: <M v={routeTotals.profit} colored />, title: routeTotals.revenue > 0 ? `${((routeTotals.profit / routeTotals.revenue) * 100).toFixed(1)}% margin` : undefined },
            { label: 'Trips', value: routeTotals.trips.toLocaleString('en-IN') },
            { label: 'Occupancy', value: fleetOcc !== null ? `${Math.round(fleetOcc * 100)}%` : '—', tone: fleetOcc !== null ? (occTone(fleetOcc) as 'good' | 'warn' | 'bad') : undefined },
            { label: '30-day LF', value: totalOcc30 !== null ? `${Math.round(totalOcc30 * 100)}%` : '—', tone: totalOcc30 !== null ? (occTone(totalOcc30) as 'good' | 'warn' | 'bad') : undefined },
          ]}
        />
      </section>

      {/* 2. Brands Section */}
      <section id="brands" className="analytics-section">
        <h2 className="section-title">Brands</h2>
        <Panel
          title="Subsidiary Brand Economics (Lifetime)"
          flat
          info="Lifetime asset view: aggregates coach life revenue and costs by subsidiary brand, joined with active schedule counts and brand ratings. For period windows use the Route economics brand filter below (fed by routeHistory.byBrand)."
        >
          <table className="data">
            <thead>
              <tr>
                <th>Brand</th>
                <th className="num">Buses</th>
                <th className="num">Services</th>
                <th className="num">Trips</th>
                <th className="num">Occupancy</th>
                <th className="num">Revenue</th>
                <th className="num">Cost</th>
                <th className="num">Life profit</th>
                <th className="num">Margin %</th>
                <th className="num">₹/trip</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {brandEconomicsRows.map((row) => {
                const margin = row.revenue > 0 ? (row.profit / row.revenue) * 100 : null
                return (
                <tr key={row.id} style={row.isOperator ? { background: 'var(--bg3)', fontStyle: 'italic' } : undefined}>
                  <td>
                    {row.group ? (
                      <div className="flex" style={{ alignItems: 'center', gap: 6, paddingLeft: row.depth * 16 }}>
                        {row.depth > 0 && <span className="dim">↳</span>}
                        <GroupBadge group={row.group} />
                        <b>{row.name}</b>
                        {row.isOperator && (
                          <span
                            className="pill info small"
                            title={`Operator: owns no coaches. Its numbers are the sum of its ${row.fleetCount} fleet brands and are not added again to the total.`}
                          >
                            Operator · {row.fleetCount}
                          </span>
                        )}
                        {row.group.status === 'retired' && <span className="pill dim small">Retired</span>}
                        {row.primo && <span className="pill good small">PRIMO</span>}
                      </div>
                    ) : (
                      <span className="dim">Unassigned</span>
                    )}
                  </td>
                  <td className="num">{row.buses}</td>
                  <td className="num">{row.services}</td>
                  <td className="num">{row.trips.toLocaleString()}</td>
                  <td className={`num ${occTone(row.occupancy)}`}>
                    {row.occupancy !== null ? `${Math.round(row.occupancy * 100)}%` : '—'}
                  </td>
                  <td className="num"><M v={row.revenue} /></td>
                  <td className="num"><M v={row.cost} /></td>
                  <td className="num"><M v={row.profit} colored /></td>
                  <td className={`num ${margin === null ? 'dim' : margin >= 0 ? 'good' : 'bad'}`}>
                    {margin === null ? '—' : `${margin.toFixed(1)}%`}
                  </td>
                  <td className="num"><M v={Math.round(row.perTrip)} colored /></td>
                  <td>
                    <span className={ratingTone(row.rating)}>★ {row.rating.toFixed(2)}</span>
                    {row.stars !== null && <span className="dim small"> (fleet ★ {row.stars.toFixed(1)})</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
            {brandEconomicsRows.length > 0 && (
              <tfoot>
                <tr className="total">
                  <td>
                    <b>Total</b>{' '}
                    <span className="dim">
                      ({brandEconomicsRows.filter((r) => r.group && !r.isOperator).length} brands
                      {brandEconomicsRows.some((r) => r.isOperator) ? ', operators not double-counted' : ''})
                    </span>
                  </td>
                  <td className="num"><b>{brandTotals.buses}</b></td>
                  <td className="num"><b>{brandTotals.services}</b></td>
                  <td className="num"><b>{brandTotals.trips.toLocaleString()}</b></td>
                  <td className={`num ${occTone(brandTotals.occupancy)}`}>
                    <b>{brandTotals.occupancy !== null ? `${Math.round(brandTotals.occupancy * 100)}%` : '—'}</b>
                  </td>
                  <td className="num"><b><M v={brandTotals.revenue} /></b></td>
                  <td className="num"><b><M v={brandTotals.cost} /></b></td>
                  <td className="num"><b><M v={brandTotals.profit} colored /></b></td>
                  <td className={`num ${brandTotals.revenue > 0 && brandTotals.profit >= 0 ? 'good' : brandTotals.revenue > 0 ? 'bad' : 'dim'}`}>
                    <b>{brandTotals.revenue > 0 ? `${((brandTotals.profit / brandTotals.revenue) * 100).toFixed(1)}%` : '—'}</b>
                  </td>
                  <td className="num"><b><M v={Math.round(brandTotals.perTrip)} colored /></b></td>
                  <td>—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </Panel>
      </section>

      {/* 3. Routes Section */}
      <section id="routes" className="analytics-section">
        <div className="flex" style={{ alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Routes</h2>
          <span className="spacer" />
          <label className="dim small">
            <input
              type="checkbox"
              checked={showLayouts}
              onChange={(e) => setShowLayouts(e.target.checked)}
              disabled={Boolean(routeBrandFilterKey)}
            /> layouts
          </label>
          <label className="dim small">
            <input
              type="checkbox"
              checked={showUnit}
              onChange={(e) => setShowUnit(e.target.checked)}
            /> unit econ
          </label>
          <label className="dim small">
            <input
              type="checkbox"
              checked={showBrands}
              onChange={(e) => setShowBrands(e.target.checked)}
              disabled={Boolean(routeBrandFilterKey)}
            /> subsidiaries
          </label>
          <select
            value={routeBrandFilter}
            onChange={(e) => setRouteBrandFilter(e.target.value)}
            aria-label="Filter routes by brand"
            style={{ minWidth: 160 }}
          >
            <option value="all">All Brands</option>
            <BrandOptions s={s} brands={brandFilterOptions} />
            <option value="none">Unassigned</option>
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodId)}
            aria-label="Report period"
          >
            {PERIODS.map((p) => {
              const availableDays = Math.min(Math.max(0, s.day - s.startDay), 400)
              const disabled = p.days !== null && p.days > availableDays
              return (
                <option key={p.id} value={p.id} disabled={disabled}>
                  {p.label}{disabled ? ` (need ${p.days}d · ${availableDays}d accrued)` : ''}
                </option>
              )
            })}
          </select>
        </div>

      <Panel
        title={periodTitle}
        flat
        info="Click a column to sort. 30d occ is always the trailing 30 days, whichever period is selected. Route row = corridor total (or the selected brand when filtered); tick “layouts” for the indented layout split; tick “unit econ” for per-seat-km metrics."
      >
        <table className="data">
          <thead>
            <tr>
              {routeSortCols.map((c) => (
                <th
                  key={c.key}
                  className={`${c.num ? 'num' : ''} ${routeSortKey === c.key ? 'sorted' : ''}`}
                  onClick={() => applyRouteSort(c.key)}
                >
                  {c.label}{routeSortKey === c.key ? (routeSortDesc ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRouteRows.length === 0 && (
              <tr>
                <td colSpan={showUnit ? 11 : 7} className="dim">
                  {routeBrandFilterKey
                    ? 'No routes match this brand filter for the selected period.'
                    : periodDef.days === null
                      ? 'Run some trips first.'
                      : 'No data in this window yet — period reports fill as days advance.'}
                </td>
              </tr>
            )}
            {displayedRouteRows.map((r) => (
              <Fragment key={r.rid}>
                <tr>
                  <td>{routeName(r.rid)}</td>
                  <td className="num">{r.st.trips}</td>
                  <td className="num"><M v={r.st.revenue} /></td>
                  <td className="num"><M v={r.st.cost} /></td>
                  <td className="num"><M v={r.profit} colored /></td>
                  <td className={`num ${r.occupancy >= 0.55 ? 'good' : r.occupancy < 0.4 ? 'bad' : 'warn'}`}>
                    {r.st.seatKm > 0 ? `${Math.round(r.occupancy * 100)}%` : '—'}
                  </td>
                  <td className={`num ${occTone(r.occ30)}`}>
                    {r.occ30 !== null ? <b>{Math.round(r.occ30 * 100)}%</b> : '—'}
                  </td>
                  {showUnit && (
                    <>
                      <td className={`num ${r.profitPerSeatKm >= 0 ? 'good' : 'bad'}`}>
                        {r.st.seatKm > 0 ? toRupees(r.profitPerSeatKm).toFixed(2) : '—'}
                      </td>
                      <td className="num">{r.st.seatKm > 0 ? toRupees(r.revPerSeatKm).toFixed(2) : '—'}</td>
                      <td className="num">{r.st.seatKm > 0 ? toRupees(r.costPerSeatKm).toFixed(2) : '—'}</td>
                      <td className={`num ${r.occupancy > r.breakeven ? 'good' : 'bad'}`}>
                        {r.st.seatKm > 0 ? `${Math.round(r.breakeven * 100)}%` : '—'}
                      </td>
                    </>
                  )}
                </tr>
                {showLayouts && !routeBrandFilterKey && r.layouts.map((l) => (
                  <tr key={`${r.rid}:${l.layout}`} className="layout-row">
                    <td className="dim" style={{ paddingLeft: 18 }}>↳ {l.layout}</td>
                    <td className="num dim">{l.trips || '—'}</td>
                    <td className="num dim"><M v={l.revenue} /></td>
                    <td className="num dim"><M v={l.cost} /></td>
                    <td className="num"><M v={l.profit} colored /></td>
                    <td className={`num ${l.seatKm <= 0 ? 'dim' : l.occupancy >= 0.55 ? 'good' : l.occupancy < 0.4 ? 'bad' : 'warn'}`}>
                      {l.seatKm > 0 ? `${Math.round(l.occupancy * 100)}%` : '—'}
                    </td>
                    <td className={`num ${occTone(l.occ30)}`}>
                      {l.occ30 !== null ? `${Math.round(l.occ30 * 100)}%` : '—'}
                    </td>
                    {showUnit && (
                      <>
                        <td className={`num ${l.seatKm <= 0 ? 'dim' : l.profitPerSeatKm >= 0 ? 'good' : 'bad'}`}>
                          {l.seatKm > 0 ? toRupees(l.profitPerSeatKm).toFixed(2) : '—'}
                        </td>
                        <td className="num dim">{l.seatKm > 0 ? toRupees(l.revPerSeatKm).toFixed(2) : '—'}</td>
                        <td className="num dim">{l.seatKm > 0 ? toRupees(l.costPerSeatKm).toFixed(2) : '—'}</td>
                        <td className={`num ${l.seatKm <= 0 ? 'dim' : l.occupancy > l.breakeven ? 'good' : 'bad'}`}>
                          {l.seatKm > 0 ? `${Math.round(l.breakeven * 100)}%` : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {showBrands && !routeBrandFilterKey && (routeBrandStats[canonicalRouteId(r.rid)] ?? routeBrandStats[r.rid] ?? []).map((b) => (
                  <tr key={`${r.rid}:${b.id}`} className="layout-row">
                    <td className="dim" style={{ paddingLeft: 18 }}>
                      ↳ {b.group ? <GroupBadge group={b.group} /> : <span className="pill dim small">Unassigned</span>} {b.name}
                    </td>
                    <td className="num dim">{b.trips || '—'}</td>
                    <td className="num dim"><M v={b.revenue} /></td>
                    <td className="num dim"><M v={b.cost} /></td>
                    <td className="num"><M v={b.profit} colored /></td>
                    <td className={`num ${b.seatKm <= 0 ? 'dim' : b.occupancy >= 0.55 ? 'good' : b.occupancy < 0.4 ? 'bad' : 'warn'}`}>
                      {b.seatKm > 0 ? `${Math.round(b.occupancy * 100)}%` : '—'}
                    </td>
                    <td className="num dim">—</td>
                    {showUnit && (
                      <>
                        <td className={`num ${b.seatKm <= 0 ? 'dim' : b.profit >= 0 ? 'good' : 'bad'}`}>
                          {b.seatKm > 0 ? toRupees(b.profit / b.seatKm).toFixed(2) : '—'}
                        </td>
                        <td className="num dim">{b.seatKm > 0 ? toRupees(b.revenue / b.seatKm).toFixed(2) : '—'}</td>
                        <td className="num dim">{b.seatKm > 0 ? toRupees(b.cost / b.seatKm).toFixed(2) : '—'}</td>
                        <td className="num dim">—</td>
                      </>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          {displayedRouteRows.length > 0 && (
            <tfoot>
              <tr className="total">
                <td><b>Total</b> <span className="dim">({displayedRouteRows.length} routes)</span></td>
                <td className="num"><b>{tableRouteTotals.trips}</b></td>
                <td className="num"><b><M v={tableRouteTotals.revenue} /></b></td>
                <td className="num"><b><M v={tableRouteTotals.cost} /></b></td>
                <td className="num"><b><M v={tableRouteTotals.profit} colored /></b></td>
                <td className={`num ${tableRouteTotals.occupancy >= 0.55 ? 'good' : tableRouteTotals.occupancy < 0.4 ? 'bad' : 'warn'}`}>
                  <b>{tableRouteTotals.seatKm > 0 ? `${Math.round(tableRouteTotals.occupancy * 100)}%` : '—'}</b>
                </td>
                <td className={`num ${occTone(tableOcc30)}`}>
                  <b>{tableOcc30 !== null ? `${Math.round(tableOcc30 * 100)}%` : '—'}</b>
                </td>
                {showUnit && (
                  <>
                    <td className={`num ${tableRouteTotals.profitPerSeatKm >= 0 ? 'good' : 'bad'}`}>
                      <b>{tableRouteTotals.seatKm > 0 ? toRupees(tableRouteTotals.profitPerSeatKm).toFixed(2) : '—'}</b>
                    </td>
                    <td className="num"><b>{tableRouteTotals.seatKm > 0 ? toRupees(tableRouteTotals.revPerSeatKm).toFixed(2) : '—'}</b></td>
                    <td className="num"><b>{tableRouteTotals.seatKm > 0 ? toRupees(tableRouteTotals.costPerSeatKm).toFixed(2) : '—'}</b></td>
                    <td className={`num ${tableRouteTotals.occupancy > tableRouteTotals.breakeven ? 'good' : 'bad'}`}>
                      <b>{tableRouteTotals.seatKm > 0 ? `${Math.round(tableRouteTotals.breakeven * 100)}%` : '—'}</b>
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </Panel>
      </section>

      {/* 4. Seasonal Section */}
      <section id="seasonal" className="analytics-section">
        <h2 className="section-title">Seasonal & Festival Services</h2>
        <Panel
          title={`Seasonal Festival Services — ${periodDef.label}`}
          flat
          info="Dedicated revenue, direct trip expenses, and net profit tracked specifically for seasonal festival passenger service runs and private group charters."
        >
          {seasonalSummary.trips === 0 ? (
            <div className="empty" title="Set a schedule's duty to Seasonal (needs a seasonal permit). Idle coaches also get group charter offers in festival seasons.">
              No seasonal runs or charters for {periodDef.label.toLowerCase()}.
              {seasonalSummary.lifetimeTotals.trips > 0 && (
                <> Lifetime: {seasonalSummary.lifetimeTotals.trips} runs · <M v={seasonalSummary.lifetimeTotals.profit} colored /></>
              )}
            </div>
          ) : (
            <>
              {/* Split Breakdown: Scheduled Festival Runs vs Private Charters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Scheduled Festival Departures</span>
                    <span className="badge dim" style={{ fontSize: '0.72rem' }}>{seasonalSummary.scheduledTrips} service runs</span>
                  </div>
                  <div className="small dim" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                    <span>Revenue: <b className="good"><M v={seasonalSummary.scheduledRevenue} /></b></span>
                    <span>Expenses: <b className="bad"><M v={seasonalSummary.scheduledExpenses} /></b></span>
                    <span>Net Profit: <b className={seasonalSummary.scheduledProfit >= 0 ? 'good' : 'bad'}><M v={seasonalSummary.scheduledProfit} colored /></b></span>
                    <span>Margin: <b>{seasonalSummary.scheduledRevenue > 0 ? `${((seasonalSummary.scheduledProfit / seasonalSummary.scheduledRevenue) * 100).toFixed(1)}%` : '0%'}</b></span>
                  </div>
                  <div className="small faint mt4">
                    {seasonalSummary.scheduledTrips > 0 ? 'Peak holiday services deployed on seasonal route permits' : 'No scheduled festival departures active in this window'}
                  </div>
                </div>

                <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Private & Pilgrim Group Charters</span>
                    {s.company.scheduleManagerId ? (
                      <span className="pill good small" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>Auto-accepted by Schedule Mgr</span>
                    ) : (
                      <span className="badge dim" style={{ fontSize: '0.72rem' }}>{seasonalSummary.charterTrips} contracts</span>
                    )}
                  </div>
                  <div className="small dim" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                    <span>Revenue: <b className="good"><M v={seasonalSummary.charterRevenue} /></b></span>
                    <span>Expenses: <b className="bad"><M v={seasonalSummary.charterExpenses} /></b></span>
                    <span>
                      {seasonalSummary.charterProfit >= 0 ? 'Net Profit: ' : 'Net Loss: '}
                      <b className={seasonalSummary.charterProfit >= 0 ? 'good' : 'bad'}>
                        <M v={seasonalSummary.charterProfit} colored />
                      </b>
                    </span>
                    <span>
                      Margin: <b className={seasonalSummary.charterProfit >= 0 ? 'good' : 'bad'}>
                        {seasonalSummary.charterRevenue > 0 ? `${((seasonalSummary.charterProfit / seasonalSummary.charterRevenue) * 100).toFixed(1)}%` : '0%'}
                      </b>
                    </span>
                  </div>
                  {seasonalSummary.charterTrips > 0 && (
                    <div className="small faint mt4" style={{ fontSize: '0.73rem' }}>
                      Direct Costs: Fuel <M v={seasonalSummary.charterFuelCost} /> · Tolls <M v={seasonalSummary.charterTollCost} /> · Bata <M v={seasonalSummary.charterBataCost} /> · AdBlue/Clean <M v={seasonalSummary.charterOtherCosts} />
                    </div>
                  )}
                  <div className="small mt4" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.74rem' }}>
                    <span style={{ color: 'var(--accent, #38bdf8)' }} title="Customer preferred coach layout for group charters">
                      ★ Semi-sleeper (preferred): {seasonalSummary.charterBreakdown.semiTrips} (<M v={seasonalSummary.charterBreakdown.semiRevenue} />)
                    </span>
                    <span className="dim">Hybrid: {seasonalSummary.charterBreakdown.hybridTrips} (<M v={seasonalSummary.charterBreakdown.hybridRevenue} />)</span>
                    <span className="dim">Sleeper: {seasonalSummary.charterBreakdown.sleeperTrips} (<M v={seasonalSummary.charterBreakdown.sleeperRevenue} />)</span>
                  </div>
                </div>
              </div>

              {/* Corridor Breakdown & Recent Festival Trips (Flat & Open) */}
              <div className="mb14">
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--fg-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Corridor Performance Breakdown (Festival Scheduled Runs)</span>
                  <span className="dim small" style={{ fontWeight: 400 }}>Excludes private group charters</span>
                </div>
                {Object.keys(seasonalSummary.byRoute).length === 0 ? (
                  <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 6, border: '1px solid var(--border)', textAlign: 'center' }} className="dim small">
                    No scheduled festival runs operated in this reporting period.
                  </div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th className="num">Festival Runs</th>
                        <th className="num">Pax</th>
                        <th className="num">Occupancy</th>
                        <th className="num">Revenue</th>
                        <th className="num">Expenses</th>
                        <th className="num">Net Profit</th>
                        <th className="num">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(seasonalSummary.byRoute).map((br) => {
                        const margin = br.revenue > 0 ? (br.profit / br.revenue) * 100 : 0
                        return (
                          <tr key={br.routeId}>
                            <td>{routeName(br.routeId)}</td>
                            <td className="num">{br.trips}</td>
                            <td className="num">{br.pax.toLocaleString('en-IN')}</td>
                            <td className={`num ${br.occupancy >= 0.6 ? 'good' : br.occupancy >= 0.4 ? 'warn' : 'bad'}`}>
                              {Math.round(br.occupancy * 100)}%
                            </td>
                            <td className="num"><M v={br.revenue} /></td>
                            <td className="num"><M v={br.expenses} /></td>
                            <td className="num"><M v={br.profit} colored /></td>
                            <td className={`num ${margin >= 0 ? 'good' : 'bad'}`}>
                              {margin.toFixed(1)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="total">
                        <td><b>Total Scheduled Festival Runs</b></td>
                        <td className="num"><b>{seasonalSummary.scheduledTrips}</b></td>
                        <td className="num"><b>{seasonalSummary.scheduledPax.toLocaleString('en-IN')}</b></td>
                        <td className={`num ${seasonalSummary.scheduledOccupancy >= 0.6 ? 'good' : 'warn'}`}>
                          <b>{Math.round(seasonalSummary.scheduledOccupancy * 100)}%</b>
                        </td>
                        <td className="num"><b><M v={seasonalSummary.scheduledRevenue} /></b></td>
                        <td className="num"><b><M v={seasonalSummary.scheduledExpenses} /></b></td>
                        <td className="num"><b><M v={seasonalSummary.scheduledProfit} colored /></b></td>
                        <td className={`num ${seasonalSummary.scheduledProfit >= 0 ? 'good' : 'bad'}`}>
                          <b>
                            {seasonalSummary.scheduledRevenue > 0
                              ? `${((seasonalSummary.scheduledProfit / seasonalSummary.scheduledRevenue) * 100).toFixed(1)}%`
                              : '0%'}
                          </b>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {seasonalSummary.recentRuns.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--fg-dim)' }}>
                    Recent Seasonal & Charter Runs (Last {seasonalSummary.recentRuns.length})
                  </div>
                  <table className="data small">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Type</th>
                        <th>Route</th>
                        <th>Direction</th>
                        <th>Coach / Bus</th>
                        <th className="num">Pax / Seats</th>
                        <th className="num">Revenue</th>
                        <th className="num">Expenses</th>
                        <th className="num">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonalSummary.recentRuns.map((run) => (
                        <tr key={run.tripId}>
                          <td>{fmtDateShort(run.day)}</td>
                          <td>
                            {run.kind === 'charter' ? (
                              <span className="pill warn small" style={{ fontSize: '0.68rem', padding: '1px 5px' }}>
                                Charter
                              </span>
                            ) : (
                              <span className="pill small" style={{ fontSize: '0.68rem', padding: '1px 5px' }}>
                                Scheduled
                              </span>
                            )}
                          </td>
                          <td>{routeName(run.routeId)}</td>
                          <td>{run.kind === 'charter' ? 'Return Charter' : run.direction === 'AB' ? 'Outbound' : 'Return'}</td>
                          <td>
                            {s.buses[run.busId]?.reg ?? run.busId}
                            {run.coachType ? <span className="dim small"> ({run.coachType})</span> : ''}
                          </td>
                          <td className="num">{run.pax} / {run.seats}</td>
                          <td className="num"><M v={run.revenue} /></td>
                          <td className="num"><M v={run.expenses} /></td>
                          <td className="num"><M v={run.profit} colored /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
      </section>

      {/* 5. Maintenance Section */}
      <section id="fleet" className="analytics-section">
        <h2 className="section-title">Maintenance & Service Tiers</h2>
        <Panel
          title={`Maintenance & Service Tier Cost per Km (${periodDef.label})`}
          flat
          info="Tiered preventive maintenance intervals (EI-01): A-Service minor (every 25,000 km), B-Service major (every 100,000 km), and Annual Overhaul (every 365 days or 250,000 km). Tracks actual rupee cost per fleet km by service tier."
        >
          <div className="grid-3" style={{ gap: 16 }}>
            <div className="panel" style={{ padding: '10px 14px', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="bold">A-Service (Minor)</span>
                <span className="pill dim small">25k km · 1×</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                ₹{serviceTierStats.costPerKmA.toFixed(2)} <span className="dim small" style={{ fontSize: '0.85rem', fontWeight: 400 }}>/ km</span>
              </div>
              <KV rows={[
                ['Total Spend', <M v={serviceTierStats.spendA} />],
                ['Jobs Completed', `${serviceTierStats.countA} service(s)`],
                ['Turnaround', '1 day'],
                ['Scope', 'Oil, filters, brake lube'],
              ]} />
            </div>

            <div className="panel" style={{ padding: '10px 14px', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="info bold">B-Service (Major)</span>
                <span className="pill info small">100k km · 3.5×</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--info)', marginBottom: 4 }}>
                ₹{serviceTierStats.costPerKmB.toFixed(2)} <span className="dim small" style={{ fontSize: '0.85rem', fontWeight: 400 }}>/ km</span>
              </div>
              <KV rows={[
                ['Total Spend', <M v={serviceTierStats.spendB} />],
                ['Jobs Completed', `${serviceTierStats.countB} service(s)`],
                ['Turnaround', '2–3 days'],
                ['Scope', 'Transmission, injectors, AC flush'],
              ]} />
            </div>

            <div className="panel" style={{ padding: '10px 14px', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="accent bold">Annual Overhaul</span>
                <span className="pill accent small">365d / 250k · 7×</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
                ₹{serviceTierStats.costPerKmOverhaul.toFixed(2)} <span className="dim small" style={{ fontSize: '0.85rem', fontWeight: 400 }}>/ km</span>
              </div>
              <KV rows={[
                ['Total Spend', <M v={serviceTierStats.spendOverhaul} />],
                ['Jobs Completed', `${serviceTierStats.countOverhaul} overhaul(s)`],
                ['Turnaround', '5–7 days'],
                ['Scope', 'Complete teardown to 98%'],
              ]} />
            </div>
          </div>

          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="dim small">Combined Fleet Scheduled Maintenance: </span>
              <b className="accent" style={{ fontSize: '1.05rem', marginLeft: 6 }}>
                ₹{serviceTierStats.costPerKmTotal.toFixed(2)} / km
              </b>
              <span className="dim small ml8">
                (Total <M v={serviceTierStats.totalMaintSpend} /> across {Math.round(serviceTierStats.totalKm).toLocaleString('en-IN')} km)
              </span>
            </div>
            <div style={{ width: '35%', display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-page)' }}>
              {serviceTierStats.totalMaintSpend > 0 ? (
                <>
                  <div style={{ width: `${(serviceTierStats.spendA / serviceTierStats.totalMaintSpend) * 100}%`, background: 'var(--dim)' }} title="A-Service" />
                  <div style={{ width: `${(serviceTierStats.spendB / serviceTierStats.totalMaintSpend) * 100}%`, background: 'var(--info)' }} title="B-Service" />
                  <div style={{ width: `${(serviceTierStats.spendOverhaul / serviceTierStats.totalMaintSpend) * 100}%`, background: 'var(--accent)' }} title="Annual Overhaul" />
                </>
              ) : null}
            </div>
          </div>
        </Panel>
      </section>

      {/* 6. Market Section */}
      <section id="market" className="analytics-section">
        <h2 className="section-title">Market Share</h2>
        <Panel
          title={`Corridor Market Share Trend — ${routeName(shareRoute)}`}
          flat
          info="Daily market share drift based on ticket pricing, coach comfort, punctuality and brand awareness (Sprint 9). Max 180 days history."
          right={
            <select
              value={shareRoute}
              onChange={(e) => {
                e.stopPropagation()
                setShareRoute(e.target.value)
                try {
                  localStorage.setItem('busraj_analytics_route', e.target.value)
                } catch {}
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const raw = Object.keys(s.permits).map(canonicalRouteId)
                const seen = new Set<string>()
                const routes: string[] = []
                for (const rid of raw) {
                  const name = routeName(rid)
                  if (!seen.has(name)) {
                    seen.add(name)
                    routes.push(rid)
                  }
                }
                return routes.sort((a, b) => routeName(a).localeCompare(routeName(b)))
              })().map((r) => (
                <option key={r} value={r}>
                  {routeName(r)}
                </option>
              ))}
            </select>
          }
        >
          {shareData.length === 0 ? (
            <span className="empty" title="No market share history recorded for this corridor yet.">No market share history yet.</span>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={shareData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: '#64748b' }} width={42} />
                <Tooltip
                  content={({ payload, label }) => (
                    <div className="chart-tooltip">
                      {label}: {payload?.map((p) => `${p.name}: ${p.value}%`).join(' · ')}
                    </div>
                  )}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="player"
                  stackId="1"
                  stroke="#38bdf8"
                  fill="#38bdf8"
                  name="Your Share"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="rival"
                  stackId="1"
                  stroke="#64748b"
                  fill="#334155"
                  name="Rival Share"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </section>
    </>
  )
}
