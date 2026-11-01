import { useMemo, useState } from 'react'
import { useGame } from '../../store/gameStore'
import { ROUTES, routeName } from '../../engine/data/routes'
import { CITIES, cityFreightProfile } from '../../engine/data/cities'
import { ymKey } from '../../engine/core/calendar'
import { fmtCompact, rs } from '../../engine/core/money'
import { BAL } from '../../engine/data/balance'
import {
  cargoCorridorLabel,
  cargoFreightRupees,
  cargoLaneKey,
  cargoLegLabel,
  cargoLicence,
  cargoPermitActive,
  cargoPermitFee,
  cargoRouteMult,
  cargoVehicleDeparturesOnLane,
  companyCargoFillRate,
  contractBucket,
  contractDailyCapKg,
  corporateYearInfo,
  emptyCargoLaneDay,
  getAvailableContracts,
  getContractTier,
  parcelRatePerKg100Km,
  truckRatePerKg100Km,
  cargoLaneImbalance,
  chargeableKg,
  CARGO_DENSITY,
  cargoPoolsForView,
  corridorCargoMarketKg,
  cargoBookKg,
} from '../../engine/sim/cargo'
import type { CargoContract, CargoHaulLine, CargoLaneDay, RouteDef, CargoPricingType, CargoCargoType } from '../../engine/types'
import { cargoManagerOnDuty, deskOf, managersOnPayroll } from '../../engine/sim/staffing'
import { spanMeters, DESK_UNIT } from '../../engine/sim/span'
import { Bar, M, Panel, SpanMeter } from '../bits'
import { num, tonnes } from '../format'

function fillTone(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= 0.7) return 'good'
  if (pct >= 0.4) return 'warn'
  return 'bad'
}

function pct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${Math.round(n * 100)}%`
}

function fmtWeight(kg: number): string {
  if (kg <= 0) return '0 kg'
  if (kg < 1000) return `${num(kg)} kg`
  return `${tonnes(kg)} T (${num(kg)} kg)`
}

/** Compact weight for dense tables (full amount in title). */
function fmtWeightShort(kg: number): string {
  if (kg <= 0) return '0 kg'
  if (kg < 1000) return `${num(kg)} kg`
  return `${tonnes(kg)} T`
}

function addLane(into: CargoLaneDay, lane: CargoLaneDay): void {
  into.trips += lane.trips
  into.cargoOnlyTrips += lane.cargoOnlyTrips
  into.kg += lane.kg
  into.cargoOnlyKg += lane.cargoOnlyKg
  into.capKg += lane.capKg
  into.marketKg += lane.marketKg
  into.bookKg += lane.bookKg
  into.revenue += lane.revenue
  into.contractKg += lane.contractKg
  into.spotKg += lane.spotKg
  into.walkupKg += lane.walkupKg
  into.contractRevenue += lane.contractRevenue
  into.spotRevenue += lane.spotRevenue
  into.walkupRevenue += lane.walkupRevenue
  into.loading += lane.loading
  into.unloading += lane.unloading
  into.liability += lane.liability
  into.shortfall += lane.shortfall
  into.fuel += lane.fuel
  into.toll += lane.toll
  into.bata += lane.bata
}

function laneVehicleCost(lane: CargoLaneDay): number {
  return lane.fuel + lane.toll + lane.bata
}

function laneLoadingCost(lane: CargoLaneDay): number {
  return lane.loading + lane.unloading
}

function laneContribution(lane: CargoLaneDay): number {
  return lane.revenue - laneLoadingCost(lane) - lane.liability - lane.shortfall - laneVehicleCost(lane)
}

type CorridorSortKey =
  | 'corridor' | 'trips' | 'market' | 'book' | 'cap' | 'hauled'
  | 'fill' | 'yield' | 'imbalance' | 'revenue' | 'profit'

type CorridorLegRow = CargoLaneDay & {
  label: string
  routeId: string
  dir: 'AB' | 'BA'
}

type CorridorSortRow = CargoLaneDay & {
  label: string
  routeId: string
  dir?: 'AB' | 'BA'
  corridorKey?: string
  route?: RouteDef
  legs?: CorridorLegRow[]
}

function corridorFill(row: CargoLaneDay): number {
  return row.capKg > 0 ? row.kg / row.capKg : 0
}

function corridorYield(row: CargoLaneDay): number {
  return row.kg > 0 ? (row.revenue / 100) / row.kg : 0
}

function corridorMarketKg(s: Parameters<typeof corridorCargoMarketKg>[0], row: CorridorSortRow): number {
  const route = row.route ?? ROUTES[row.routeId]
  if (!route) return row.marketKg
  if (row.dir) {
    const mkt = corridorCargoMarketKg(s, route, row.dir, s.day)
    return mkt.parcelMarketKg + mkt.bulkMarketKg
  }
  // Both-ways combined: sum live market on AB + BA
  const ab = corridorCargoMarketKg(s, route, 'AB', s.day)
  const ba = corridorCargoMarketKg(s, route, 'BA', s.day)
  return ab.parcelMarketKg + ab.bulkMarketKg + ba.parcelMarketKg + ba.bulkMarketKg
}

function corridorBookKg(s: Parameters<typeof cargoBookKg>[0], row: CorridorSortRow): number {
  const route = row.route ?? ROUTES[row.routeId]
  if (!route || !row.dir) return row.bookKg
  const bk = cargoBookKg(s, route, row.dir, s.day)
  return bk.parcelBookKg + bk.bulkBookKg
}

function corridorImbalance(s: Parameters<typeof cargoLaneImbalance>[0], row: CorridorSortRow): number {
  const route = row.route ?? ROUTES[row.routeId]
  if (!route || !row.dir) return 1
  return cargoLaneImbalance(s, route, row.dir, s.day)
}

function corridorSortValue(
  s: Parameters<typeof corridorCargoMarketKg>[0],
  row: CorridorSortRow,
  key: CorridorSortKey,
): number | string {
  switch (key) {
    case 'corridor': return row.label
    case 'trips': return row.trips
    case 'market': return corridorMarketKg(s, row)
    case 'book': return corridorBookKg(s, row)
    case 'cap': return row.capKg
    case 'hauled': return row.kg
    case 'fill': return corridorFill(row)
    case 'yield': return corridorYield(row)
    case 'imbalance': return corridorImbalance(s, row)
    case 'revenue': return row.revenue
    case 'profit': return laneContribution(row)
  }
}

function sortCorridorRows<T extends CorridorSortRow>(
  rows: T[],
  s: Parameters<typeof corridorCargoMarketKg>[0],
  key: CorridorSortKey,
  desc: boolean,
): T[] {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const av = corridorSortValue(s, a, key)
    const bv = corridorSortValue(s, b, key)
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return desc ? -cmp : cmp
  })
  return sorted
}

/* ---------------------- contracts: rows, lane groups ---------------------- */

interface ContractRow {
  c: CargoContract
  live: boolean
  route?: RouteDef
  line?: CargoHaulLine
  due: number
  hauledToday: number
  shortToday: number
  cargoBuses: number | null
  monthFull: number
}

interface ContractTotals {
  promised: number
  due: number
  hauledToday: number
  shortToday: number
  hauledMtd: number
  earned: number
  shortfallMtd: number
  monthFull: number
  blendedRate: number
}

function sumContractRows(rows: ContractRow[]): ContractTotals {
  const t: ContractTotals = {
    promised: 0, due: 0, hauledToday: 0, shortToday: 0,
    hauledMtd: 0, earned: 0, shortfallMtd: 0, monthFull: 0, blendedRate: 0,
  }
  let weighted = 0
  for (const r of rows) {
    t.promised += r.c.guaranteedKgPerDay
    weighted += r.c.guaranteedKgPerDay * r.c.ratePerKg100Km
    if (r.line) {
      t.due += r.due
      t.hauledToday += r.hauledToday
      t.shortToday += r.shortToday
    }
    if (r.live) {
      t.hauledMtd += r.c.hauledKgMtd ?? 0
      t.earned += r.c.earnedPaiseMtd ?? 0
      t.shortfallMtd += r.c.shortfallKgMtd ?? 0
    }
    t.monthFull += r.monthFull
  }
  t.blendedRate = t.promised > 0 ? weighted / t.promised : 0
  return t
}

function corridorSortKey(routeId: string): string {
  const r = ROUTES[routeId]
  return r ? [r.from, r.to].sort().join('-') : routeId
}

interface ContractGroup {
  laneKey: string
  label: string
  direction: 'AB' | 'BA'
  rows: ContractRow[]
  totals: ContractTotals
}

function groupContracts(rows: ContractRow[]): ContractGroup[] {
  const map = new Map<string, ContractRow[]>()
  for (const r of rows) {
    const dir = r.c.direction ?? 'AB'
    const key = r.c.laneKey ?? `${r.c.routeId}-${dir}`
    const list = map.get(key)
    if (list) list.push(r)
    else map.set(key, [r])
  }
  return [...map.entries()]
    .map(([laneKey, laneRows]) => {
      const first = laneRows[0]
      const dir = first.c.direction ?? 'AB'
      return {
        laneKey,
        label: first.route ? cargoLegLabel(first.route, dir) : first.c.routeId,
        direction: dir,
        rows: laneRows,
        totals: sumContractRows(laneRows),
      }
    })
    .sort((a, b) => {
      const ca = corridorSortKey(a.rows[0].c.routeId)
      const cb = corridorSortKey(b.rows[0].c.routeId)
      if (ca !== cb) return ca.localeCompare(cb)
      return a.direction === b.direction ? 0 : a.direction === 'AB' ? -1 : 1
    })
}

export function CargoPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [activeTab, setActiveTab] = useState<'overview' | 'lanes' | 'contracts' | 'spots'>('overview')
  const [laneDays, setLaneDays] = useState<7 | 30 | 90>(30)
  const [corridorSortKey, setCorridorSortKey] = useState<CorridorSortKey>('revenue')
  const [corridorSortDesc, setCorridorSortDesc] = useState(true)

  const applyCorridorSort = (key: CorridorSortKey) => {
    if (corridorSortKey === key) setCorridorSortDesc(!corridorSortDesc)
    else {
      setCorridorSortKey(key)
      setCorridorSortDesc(true)
    }
  }

  const appointedMgr = s.company.cargoManagerId ? s.staff[s.company.cargoManagerId] : undefined
  const onDutyMgr = cargoManagerOnDuty(s)
  const cargoMeter = spanMeters(s).cargo
  const hasMgr = Boolean(onDutyMgr || appointedMgr)
  const dedicatedSubsidiary = Boolean(s.company.dedicatedCargoSubsidiary)
  const cargoType = s.company.cargoCargoType ?? 'mixed'
  const acceptFragile = s.company.cargoAcceptFragile ?? false
  const autoSignContracts = s.company.cargoAutoSignContracts !== false
  const cargoStaff = managersOnPayroll(s).filter(
    (st) => st.id === s.company.cargoManagerId || !deskOf(s, st.id),
  )
  const monthKey = ymKey(s.day)
  const corporateYear = useMemo(() => corporateYearInfo(s), [s.day, s.startDay])

  const mtdCargo = s.curMonth.ym === monthKey ? (s.curMonth.income.cargo ?? 0) + (s.curMonth.income.cargo_spot ?? 0) : 0
  const mtdCoachRevenue = s.curMonth.ym === monthKey ? (s.curMonth.cargoCoachRevenue ?? 0) : 0
  const mtdTruckRevenue = s.curMonth.ym === monthKey ? (s.curMonth.cargoTruckRevenue ?? 0) : 0

  const contracts = s.company.cargoContracts ?? []
  const activeContracts = contracts.filter((c) => c.active)
  const spotOffers = s.company.spotOffers ?? []
  const availableContracts = useMemo(() => getAvailableContracts(s), [s])

  const history = useMemo(() => {
    const mtd = emptyCargoLaneDay()
    const from = s.day - (laneDays - 1)
    const byLane = new Map<string, CargoLaneDay & { label: string; routeId: string; dir: 'AB' | 'BA' }>()
    const byCorridor = new Map<string, CargoLaneDay & {
      label: string
      corridorKey: string
      routeId: string
      route: RouteDef
      legs: (CargoLaneDay & { label: string; routeId: string; dir: 'AB' | 'BA' })[]
    }>()

    for (const [routeId, days] of Object.entries(s.routeHistory ?? {})) {
      const route = ROUTES[routeId]
      if (!route) continue
      const corrKey = [route.from, route.to].sort().join('-')
      for (const day of days ?? []) {
        if (!day.cargo) continue
        const inMonth = ymKey(day.day) === monthKey
        for (const dir of ['AB', 'BA'] as const) {
          const lane = day.cargo[dir]
          if (!lane) continue
          if (inMonth) addLane(mtd, lane)
          if (day.day < from) continue
          if (lane.trips <= 0 && lane.kg <= 0 && lane.revenue <= 0 && lane.shortfall <= 0) continue

          const key = cargoLaneKey(route, dir)
          const row = byLane.get(key) ?? {
            ...emptyCargoLaneDay(),
            label: cargoLegLabel(route, dir),
            routeId: route.id,
            dir,
          }
          addLane(row, lane)
          byLane.set(key, row)

          let corr = byCorridor.get(corrKey)
          if (!corr) {
            corr = {
              ...emptyCargoLaneDay(),
              label: cargoCorridorLabel(route),
              corridorKey: corrKey,
              routeId: route.id,
              route,
              legs: [],
            }
            byCorridor.set(corrKey, corr)
          }
          addLane(corr, lane)
        }
      }
    }

    // Attach sorted directional legs to each combined corridor
    for (const corr of byCorridor.values()) {
      corr.legs = [...byLane.values()].filter((l) => {
        const r = ROUTES[l.routeId]
        return r && [r.from, r.to].sort().join('-') === corr.corridorKey
      }).sort((a, b) => a.dir.localeCompare(b.dir))
    }

    const corridors = [...byCorridor.values()]
    const lanes = [...byLane.values()]
    const total = emptyCargoLaneDay()
    for (const row of lanes) addLane(total, row)
    return { mtd, corridors, lanes, total }
  }, [s, monthKey, laneDays])

  const sortedCorridors = useMemo(
    () => sortCorridorRows(history.corridors, s, corridorSortKey, corridorSortDesc),
    [history.corridors, s, corridorSortKey, corridorSortDesc],
  )

  const haulByContract = useMemo(() => {
    const map = new Map<string, CargoHaulLine>()
    const led = s.company.cargoHaulDay
    if (led?.day !== s.day) return map
    for (const line of led.lines) map.set(line.contractId, line)
    return map
  }, [s])

  const contractRows = useMemo(() => activeContracts.map((c) => {
    const live = c.mtdYm === monthKey
    const route = ROUTES[c.routeId]
    const line = haulByContract.get(c.id)
    const due = line?.promisedKg ?? 0
    const hauledToday = line?.hauledKg ?? 0
    return {
      c,
      live,
      route,
      line,
      due,
      hauledToday,
      shortToday: Math.max(0, due - hauledToday),
      cargoBuses: route && c.direction ? cargoVehicleDeparturesOnLane(s, route, c.direction) : null,
      monthFull: route
        ? rs(cargoFreightRupees(c.guaranteedKgPerDay, route.km, c.ratePerKg100Km, cargoRouteMult(route.km)) * 30)
        : 0,
    }
  }), [activeContracts, haulByContract, monthKey, s])

  const contractTotals = useMemo(() => sumContractRows(contractRows), [contractRows])
  const contractGroups = useMemo(() => groupContracts(contractRows), [contractRows])

  const licensedLanes = useMemo(() => {
    const seen = new Set<string>()
    const out: { routeId: string; name: string; daysLeft: number; fee: number; renewFee: number }[] = []
    for (const p of Object.values(s.permits)) {
      if (p.status !== 'active') continue
      const r = ROUTES[p.routeId]
      if (!r) continue
      const key = [r.from, r.to].sort().join('-')
      if (seen.has(key)) continue
      seen.add(key)
      const licence = cargoLicence(s, p.routeId)
      const active = cargoPermitActive(s, p.routeId)
      const daysLeft = licence ? Math.max(0, licence.expiryDay - s.day) : 0
      out.push({
        routeId: p.routeId,
        name: routeName(p.routeId),
        daysLeft: active ? daysLeft : 0,
        fee: cargoPermitFee(r),
        renewFee: cargoPermitFee(r, { renewal: true }),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [s])

  const activeLicensedCount = licensedLanes.filter((l) => l.daysLeft > 0).length
  const currentBaseRate = s.config?.cargoBaseRateRs ?? BAL.cargoBaseRateDefaultRs
  const currentPricingType: CargoPricingType = s.config?.cargoPricingType ?? 'normal'
  const rupeesPerKg = history.mtd.kg > 0 ? (history.mtd.revenue / 100) / history.mtd.kg : 0
  const truckRate = truckRatePerKg100Km(s)
  const spotRate = parcelRatePerKg100Km(s)
  const mtdDirectHandling = laneLoadingCost(history.mtd)
  const mtdNetProfit = history.mtd.revenue - mtdDirectHandling - history.mtd.liability - history.mtd.shortfall - laneVehicleCost(history.mtd)
  const coachKg = Math.max(0, history.mtd.kg - history.mtd.cargoOnlyKg)
  const fillRateOverall = history.mtd.capKg > 0 ? history.mtd.kg / history.mtd.capKg : 0

  const pendingSpots = spotOffers.filter((o) => (o.status ?? 'offered') === 'offered' && o.expiresDay >= s.day)

  return (
    <>
      {/* Page Title & Navigation */}
      <div className="page-title">
        <span>Cargo & Intercity Logistics</span>
        <span className="sub">
          {dedicatedSubsidiary ? '★ Full Logistics Subsidiary & Coach Belly Parcels' : 'Intercity Bus Belly Parcel Service'}
          {` · Lanes: ${cargoMeter.demand} Licensed / ${cargoMeter.capacity} Supervised (${Math.round(cargoMeter.coverage * 100)}%)`}
        </span>
        <span className="spacer" />
        <span className="flex" style={{ gap: 6 }}>
          {([
            ['overview', '📊 Overview & Desk'],
            ['lanes', `🛣️ Corridors (${history.corridors.length})`],
            ['contracts', dedicatedSubsidiary ? `📋 Corporate Contracts (${activeContracts.length})` : '📋 Corporate Contracts (Off)'],
            ['spots', `📦 Spot Parcels (${spotOffers.filter((o) => (o.status ?? 'offered') !== 'expired').length})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={`small ${activeTab === id ? 'primary' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW & OPERATIONS DESK                                         */}
      {/* ========================================================================= */}
      {activeTab === 'overview' && (
        <>
          {/* Top Operational Mode Strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              marginBottom: 12,
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`pill ${dedicatedSubsidiary ? 'good' : 'info'}`}>
                {dedicatedSubsidiary ? 'Dedicated Freight Subsidiary: ACTIVE' : 'Luggage Parcel Desk: ACTIVE'}
              </span>
              <span className="dim small">
                {dedicatedSubsidiary
                  ? 'Authorized for heavy trucking (Bolero to 26T), B2B logistics contracts & coach belly parcels.'
                  : 'Zero vehicle overhead. Passenger coaches haul parcels in underbelly luggage boots at 100% incremental profit.'}
              </span>
            </div>
            <button
              className={`small ${dedicatedSubsidiary ? 'warn' : 'primary'}`}
              disabled={!hasMgr}
              title={!hasMgr ? 'A Cargo Manager must be appointed on duty to toggle subsidiary' : ''}
              onClick={() => g.setDedicatedCargoSubsidiary(!dedicatedSubsidiary)}
            >
              {dedicatedSubsidiary ? 'Turn Off Freight Subsidiary' : '🚀 Launch Freight Subsidiary'}
            </button>
          </div>

          {/* Key Metric Cards (Clean & Human Understandable) */}
          <div className="grid-4" style={{ gap: 12, marginBottom: 12 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Monthly Freight Revenue</div>
              <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }} className="good">
                <M v={mtdCargo} full />
              </div>
              <div className="dim small">
                Coach belly: <M v={mtdCoachRevenue} /> · Trucks: <M v={mtdTruckRevenue} />
              </div>
              {rupeesPerKg > 0 && (
                <div className="dim small" style={{ marginTop: 2 }}>
                  Realized rate: <b>₹{rupeesPerKg.toFixed(2)} / kg</b>
                </div>
              )}
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Tonnage Hauled (MTD)</div>
              <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>
                {history.mtd.kg > 0 ? `${tonnes(history.mtd.kg)} T` : '0 T'}
              </div>
              <div className="dim small">
                {num(history.mtd.kg)} kg total freight moved
              </div>
              {history.mtd.kg > 0 && (
                <div className="dim small" style={{ marginTop: 2 }}>
                  {tonnes(coachKg)} T in coach bellies · {tonnes(history.mtd.cargoOnlyKg)} T in trucks
                </div>
              )}
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Capacity Fill Rate</div>
              <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }} className={fillTone(fillRateOverall)}>
                {pct(fillRateOverall)}
              </div>
              <div style={{ margin: '4px 0' }}>
                <Bar value={fillRateOverall} width={12} tone="auto" />
              </div>
              <div className="dim small">
                {tonnes(history.mtd.kg)} T hauled / {tonnes(history.mtd.capKg)} T available space
              </div>
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Net Freight Profit</div>
              <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }} className={mtdNetProfit >= 0 ? 'good' : 'bad'}>
                <M v={mtdNetProfit} full />
              </div>
              <div className="dim small">
                Margin: <b>{mtdCargo > 0 ? pct(mtdNetProfit / mtdCargo) : '—'}</b>
              </div>
              <div className="dim small" style={{ marginTop: 2 }}>
                Hamali loading: <M v={mtdDirectHandling} />
              </div>
            </div>
          </div>

          {/* Today's Operational Book & Bay Dispatch Strip */}
          {(() => {
            const todayPools = cargoPoolsForView(s)
            if (todayPools.length === 0) return null
            const totalMarket = todayPools.reduce((a, p) => a + p.parcelMarketKg + p.bulkMarketKg, 0)
            const totalBook = todayPools.reduce((a, p) => a + p.parcelBookKg + p.bulkBookKg, 0)
            const totalLoaded = todayPools.reduce((a, p) => a + p.parcelLoadedKg + p.bulkLoadedKg, 0)
            const totalContractDue = todayPools.reduce((a, p) => a + p.contractDueKg, 0)
            const captureRate = totalMarket > 0 ? totalBook / totalMarket : 0

            return (
              <Panel
                title="Today's Book & Live Bay Dispatch"
                flat
                right={
                  <div className="dim small">
                    Daily Market: <b>{tonnes(totalMarket)} T</b> · Book: <b>{tonnes(totalBook)} T</b> ({pct(captureRate)} capture) · Loaded: <b>{tonnes(totalLoaded)} T</b>
                  </div>
                }
                style={{ marginBottom: 12 }}
              >
                <div style={{ overflowX: 'auto' }}>
                  <table className="data" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Corridor Lane</th>
                        <th className="num">Daily Market</th>
                        <th className="num">Desk Book</th>
                        <th className="num">Capture %</th>
                        <th className="num">Contracts Due</th>
                        <th className="num">Bay Loaded</th>
                        <th className="num">Departures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayPools.slice(0, 8).map((pool) => {
                        const route = ROUTES[pool.routeId]
                        const laneLabel = route ? cargoLegLabel(route, pool.direction) : pool.laneKey
                        const marketKg = pool.parcelMarketKg + pool.bulkMarketKg
                        const bookKg = pool.parcelBookKg + pool.bulkBookKg
                        const loadedKg = pool.parcelLoadedKg + pool.bulkLoadedKg
                        const capPct = marketKg > 0 ? bookKg / marketKg : 0
                        return (
                          <tr key={pool.laneKey}>
                            <td><b>{laneLabel}</b></td>
                            <td className="num">{tonnes(marketKg)} T</td>
                            <td className="num">{tonnes(bookKg)} T</td>
                            <td className="num info">{pct(capPct)}</td>
                            <td className="num">{pool.contractDueKg > 0 ? `${fmtWeight(pool.contractDueKg)}` : '—'}</td>
                            <td className="num good"><b>{fmtWeight(loadedKg)}</b></td>
                            <td className="num dim small">
                              {pool.departuresServed} / {pool.departuresPlanned || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )
          })()}

          {/* Interactive Playability Desk (Pricing, Mix & Manager Controls) */}
          <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
            <Panel title="Commercial Tariff & Pricing Strategy" info="Adjust your per-kg freight tariff and strategy across your network.">
              <div className="form-row" style={{ marginBottom: 10 }}>
                <label>Base Tariff (₹/kg per 100 km)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {[1.0, 1.5, 2.0, 2.5, 3.0].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`small ${Math.abs(currentBaseRate - rate) < 0.1 ? 'primary' : ''}`}
                      onClick={() => g.setCargoBaseRate(rate)}
                    >
                      ₹{rate.toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 10 }}>
                <label>Market Strategy</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([
                    ['normal', 'Standard Balanced (1.0×)', 'Regular pricing matching market demand.'],
                    ['aggressive', 'Express Premium (+15%)', 'Higher tariff for urgent parcels, slight drop in volume.'],
                    ['discount', 'Volume Grab (-10%)', 'Lower tariff to capture market share and fill bays.'],
                  ] as const).map(([val, label, tip]) => (
                    <button
                      key={val}
                      className={`small ${currentPricingType === val ? 'primary' : ''}`}
                      title={tip}
                      onClick={() => g.setCargoPricingType(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 8 }}>
                <label>Commodity Focus</label>
                <select
                  value={cargoType}
                  onChange={(e) => g.setCargoCargoType(e.target.value as CargoCargoType)}
                >
                  <option value="mixed">📦 General Parcels & E-Commerce (167 kg/m³ density)</option>
                  <option value="hardware">⚙️ Auto Spare Parts & Hardware (250 kg/m³ heavy density)</option>
                  <option value="textiles">🧵 Textiles & Garments (120 kg/m³ high cube volume)</option>
                  <option value="agri">🌾 Agri Produce & Spices (140 kg/m³ seasonal)</option>
                  <option value="fmcg">🥫 FMCG & Packaged Goods (120 kg/m³ commercial)</option>
                </select>
              </div>

              <label className="flex" style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={acceptFragile}
                  onChange={(e) => g.setCargoAcceptFragile(e.target.checked)}
                />
                <span>Accept Fragile & Electronics (+25% freight rate surcharge)</span>
              </label>

              <div className="dim small" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <b>Live corridor preview:</b> Coach parcel rate ~₹{spotRate.toFixed(2)}/100km · Dedicated truck rate ~₹{truckRate.toFixed(2)}/100km.
                E.g. on Chennai ↔ Madurai (460 km): ~₹{((spotRate / 100) * 460).toFixed(2)}/kg for parcels.
              </div>
            </Panel>

            <Panel title="Cargo Manager Desk & Automation" info="Manage assigned staff and operational preferences.">
              <div className="form-row" style={{ marginBottom: 10 }}>
                <label>Cargo Desk Manager</label>
                <select
                  value={s.company.cargoManagerId ?? ''}
                  onChange={(e) => g.appointCargoManager(e.target.value || undefined)}
                >
                  <option value="">— None (Unmanaged desk) —</option>
                  {cargoStaff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} · Skill {st.skill}/10 · {fmtCompact(st.salary)}/mo
                    </option>
                  ))}
                </select>
              </div>

              <SpanMeter meter={cargoMeter} unit={DESK_UNIT.cargo} />

              <div style={{ marginBottom: 12 }}>
                {onDutyMgr ? (
                  <div className="small good" style={{ lineHeight: 1.5 }}>
                    ✓ <b>{onDutyMgr.name}</b> is on duty (Skill {onDutyMgr.skill}/10).
                    <div>Desk booking efficiency: <b>+{Math.round(companyCargoFillRate(s) * 100)}%</b> capture rate.</div>
                  </div>
                ) : (
                  <div className="small warn" style={{ lineHeight: 1.5 }}>
                    ⚠️ No Cargo Manager on duty. Booking capture rate sits at floor minimum.
                  </div>
                )}
              </div>

              {dedicatedSubsidiary && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <label className="flex" style={{ alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={autoSignContracts}
                      onChange={(e) => g.setCargoAutoSignContracts(e.target.checked)}
                    />
                    <span><b>Manager Auto-Sign Contracts</b> (Active truck routes)</span>
                  </label>
                  <div className="dim small" style={{ marginTop: 4 }}>
                    {autoSignContracts
                      ? 'Manager automatically reviews and accepts deals on corridors with scheduled trucks.'
                      : 'Manual Mode: You review and sign deals yourself in the Contracts tab.'}
                  </div>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
                <div className="dim small">
                  <b>RTO Goods Licences:</b> {activeLicensedCount} active corridor licence{activeLicensedCount === 1 ? '' : 's'}.
                  Corporate freight deals can only be solicited on corridors with an active licence.
                </div>
              </div>
            </Panel>
          </div>

          {/* Monthly P&L Ledger Breakdown */}
          <Panel title="Monthly Freight P&L Breakdown" flat>
            <div style={{ padding: '10px 14px' }}>
              <div className="grid-4" style={{ gap: 12 }}>
                <div>
                  <div className="dim small">Corporate Contracts</div>
                  <b><M v={history.mtd.contractRevenue} /></b>
                  <div className="dim small">{tonnes(history.mtd.contractKg)} T hauled</div>
                </div>
                <div>
                  <div className="dim small">On-Demand Spot Parcels</div>
                  <b><M v={history.mtd.spotRevenue} /></b>
                  <div className="dim small">{tonnes(history.mtd.spotKg)} T hauled</div>
                </div>
                <div>
                  <div className="dim small">Counter Walk-In Freight</div>
                  <b><M v={history.mtd.walkupRevenue} /></b>
                  <div className="dim small">{tonnes(history.mtd.walkupKg)} T hauled</div>
                </div>
                <div>
                  <div className="dim small">Total Gross Revenue</div>
                  <b className="good"><M v={history.mtd.revenue} /></b>
                  <div className="dim small">{tonnes(history.mtd.kg)} T all-in</div>
                </div>
              </div>

              <div className="grid-4" style={{ gap: 12, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div>
                  <div className="dim small">Origin Hamali (Loading)</div>
                  <b><M v={history.mtd.loading} /></b>
                  <div className="dim small">₹{(BAL.cargoLoadingPaisePerKg / 100).toFixed(2)}/kg handled</div>
                </div>
                <div>
                  <div className="dim small">Destination Hamali (Unloading)</div>
                  <b><M v={history.mtd.unloading} /></b>
                  <div className="dim small">₹{(BAL.cargoUnloadingPaisePerKg / 100).toFixed(2)}/kg handled</div>
                </div>
                <div>
                  <div className="dim small">Damage Claims & Shortfall</div>
                  <b className={history.mtd.liability + history.mtd.shortfall > 0 ? 'bad' : ''}>
                    <M v={history.mtd.liability + history.mtd.shortfall} />
                  </b>
                  <div className="dim small">
                    claims <M v={history.mtd.liability} /> · missed <M v={history.mtd.shortfall} />
                  </div>
                </div>
                <div>
                  <div className="dim small">Truck Fuel, Toll & Bata</div>
                  <b><M v={laneVehicleCost(history.mtd)} /></b>
                  <div className="dim small">Coach belly rides free</div>
                </div>
              </div>
            </div>
          </Panel>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CORRIDORS & PERFORMANCE                                            */}
      {/* ========================================================================= */}
      {activeTab === 'lanes' && (
        <Panel
          title={`Corridor Freight Performance · Last ${laneDays} Days`}
          flat
          right={
            <div className="flex" style={{ gap: 2 }}>
              {([7, 30, 90] as const).map((n) => (
                <button
                  key={n}
                  className={`small ${laneDays === n ? 'primary' : ''}`}
                  onClick={() => setLaneDays(n)}
                >
                  {n} Days
                </button>
              ))}
            </div>
          }
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span className="dim small">
              Both directions rolled into one corridor row. Weights in tonnes (1 T = 1,000 kg). RTO goods licence unlocks B2B contracts.
            </span>
            <span className="pill info small">
              {history.corridors.length} corridor{history.corridors.length === 1 ? '' : 's'}
            </span>
          </div>

          {history.corridors.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }} className="dim">
              No cargo hauled in this window. As your scheduled buses and trucks depart, cargo movements will appear here.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    {([
                      { key: 'corridor' as const, label: 'Corridor' },
                      { key: 'trips' as const, label: 'Departures', num: true },
                      { key: 'market' as const, label: 'Market', num: true },
                      { key: 'cap' as const, label: 'Capacity', num: true },
                      { key: 'hauled' as const, label: 'Hauled', num: true },
                      { key: 'fill' as const, label: 'Fill %', num: true },
                      { key: 'yield' as const, label: 'Yield ₹/kg', num: true },
                      { key: 'revenue' as const, label: 'Gross Revenue', num: true },
                      { key: 'profit' as const, label: 'Net Profit', num: true },
                    ]).map((col) => (
                      <th
                        key={col.key}
                        className={`${col.num ? 'num' : ''} ${corridorSortKey === col.key ? 'sorted' : ''}`}
                        onClick={() => applyCorridorSort(col.key)}
                        title="Click to sort"
                      >
                        {col.label}{corridorSortKey === col.key ? (corridorSortDesc ? ' ▾' : ' ▴') : ''}
                      </th>
                    ))}
                    <th className="num">Licence</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCorridors.map((c) => {
                    const contrib = laneContribution(c)
                    const fill = c.capKg > 0 ? c.kg / c.capKg : 0
                    const rate = c.kg > 0 ? (c.revenue / 100) / c.kg : 0
                    const route = c.route
                    const licence = cargoLicence(s, route.id)
                    const activeLicence = cargoPermitActive(s, route.id)
                    const daysLeft = licence ? Math.max(0, licence.expiryDay - s.day) : 0
                    const licenceFee = cargoPermitFee(route)
                    const renewFee = cargoPermitFee(route, { renewal: true })
                    const mktKg = corridorMarketKg(s, c)
                    const legDesc = (c.legs ?? [])
                      .map((leg) => `${leg.label}${leg.kg > 0 ? ` ${tonnes(leg.kg)} T` : ''}`)
                      .join(' · ')

                    return (
                      <tr key={c.corridorKey}>
                        <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                          <b>{c.label}</b>
                          {c.cargoOnlyTrips > 0 && (
                            <span className="dim small" style={{ marginLeft: 8 }}>
                              {c.cargoOnlyTrips} truck run{c.cargoOnlyTrips === 1 ? '' : 's'}
                            </span>
                          )}
                          {legDesc && (
                            <div className="dim small" style={{ marginTop: 2, lineHeight: 1.35 }}>
                              {legDesc}
                            </div>
                          )}
                        </td>
                        <td className="num">{c.trips}</td>
                        <td className="num">{tonnes(mktKg)} T</td>
                        <td className="num">{tonnes(c.capKg)} T</td>
                        <td className="num"><b>{tonnes(c.kg)} T</b></td>
                        <td className={`num ${fillTone(fill)}`}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            <Bar value={fill} width={6} tone="auto" />
                            <span>{pct(fill)}</span>
                          </div>
                        </td>
                        <td className="num">{rate > 0 ? `₹${rate.toFixed(2)}/kg` : '—'}</td>
                        <td className="num"><b><M v={c.revenue} /></b></td>
                        <td className={`num ${contrib >= 0 ? 'good' : 'bad'}`}>
                          <b><M v={contrib} /></b>
                        </td>
                        <td className="num">
                          {activeLicence ? (
                            daysLeft <= 45 ? (
                              <button
                                className="small warn"
                                title={`Renews corridor licence for ${fmtCompact(renewFee)}`}
                                onClick={() => g.renewCargoPermit(route.id)}
                              >
                                Renew ({daysLeft}d)
                              </button>
                            ) : (
                              <span className="pill good small" title="Covers both directions">
                                Active ({daysLeft}d)
                              </span>
                            )
                          ) : (
                            <button
                              className="small primary"
                              title={`Buy annual RTO Goods Licence for ${fmtCompact(licenceFee)} (covers both directions)`}
                              onClick={() => g.openCargoPermit(route.id)}
                            >
                              + Buy
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="total" style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>
                      Network
                      <span className="dim small" style={{ marginLeft: 8 }}>
                        {history.corridors.length} corridors
                      </span>
                    </td>
                    <td className="num">{history.total.trips}</td>
                    <td className="num">
                      {tonnes(sortedCorridors.reduce((n, row) => n + corridorMarketKg(s, row), 0))} T
                    </td>
                    <td className="num">{tonnes(history.total.capKg)} T</td>
                    <td className="num">{tonnes(history.total.kg)} T</td>
                    <td className={`num ${fillTone(history.total.capKg > 0 ? history.total.kg / history.total.capKg : 0)}`}>
                      {history.total.capKg > 0 ? pct(history.total.kg / history.total.capKg) : '—'}
                    </td>
                    <td className="num">
                      {history.total.kg > 0 ? `₹${((history.total.revenue / 100) / history.total.kg).toFixed(2)}/kg` : '—'}
                    </td>
                    <td className="num"><M v={history.total.revenue} full /></td>
                    <td className={`num ${laneContribution(history.total) >= 0 ? 'good' : 'bad'}`}>
                      <M v={laneContribution(history.total)} full />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CORPORATE CONTRACTS (B2B LOGISTICS)                                 */}
      {/* ========================================================================= */}
      {activeTab === 'contracts' && (
        <>
          {!dedicatedSubsidiary ? (
            <Panel title="Corporate Freight Contracts" flat>
              <div style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                  Corporate Freight Logistics Subsidiary Inactive
                </div>
                <p className="dim" style={{ maxWidth: 640, margin: '0 auto 16px', lineHeight: 1.5 }}>
                  B2B corporate logistics contracts with courier giants (<b>Delhivery, Blue Dart, DTDC</b>)
                  and industrial supply chains (<b>TVS Supply Chain, Amazon Freight</b>) require the Dedicated Freight Subsidiary.
                  While inactive, your fleet operates the Travels Luggage Parcel Desk, carrying spot parcels in coach bellies.
                </p>
                <button
                  className="primary"
                  disabled={!hasMgr}
                  onClick={() => g.setDedicatedCargoSubsidiary(true)}
                >
                  🚀 Launch Freight Subsidiary from Overview
                </button>
              </div>
            </Panel>
          ) : (
            <>
              {/* Active Signed Contracts */}
              <Panel
                title={`Active Signed Contracts (${activeContracts.length})`}
                flat
                right={
                  <span className="dim small">
                    Promised contract freight moves on scheduled cargo trucks.
                  </span>
                }
              >
                {activeContracts.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center' }} className="dim">
                    No active corporate contracts currently signed. Review available proposals below to partner with shippers.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Corridor</th>
                          <th className="num" title="Promised kg per operating day">Daily quota</th>
                          <th className="num" title="Moved today vs today’s promise">Today</th>
                          <th className="num" title="Moved this calendar month">Month</th>
                          <th className="num" title="Missed promise this month">Shortfall</th>
                          <th className="num" title="Blended contract tariff">Avg rate</th>
                          <th className="num" title="~30× daily freight revenue">Mo. run-rate</th>
                          <th className="num" title="Soonest expiry on this lane">Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractGroups.map((group) => {
                          const trucks = group.rows[0]?.cargoBuses
                          const noTruck = trucks === 0
                          const fillToday = group.totals.promised > 0
                            ? group.totals.hauledToday / group.totals.promised
                            : 0
                          const shippers = group.rows.map((r) => r.c.partner)
                          const daysLeft = Math.min(...group.rows.map((r) => Math.max(0, r.c.expiresDay - s.day)))
                          return (
                            <tr key={group.laneKey}>
                              <td style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                                <b>{group.label}</b>
                                <span className="dim small" style={{ marginLeft: 8 }}>
                                  {group.rows.length} deal{group.rows.length === 1 ? '' : 's'}
                                </span>
                                {noTruck && (
                                  <span className="bad small" style={{ marginLeft: 8 }}>
                                    No truck today
                                  </span>
                                )}
                                <div className="dim small" style={{ marginTop: 2, lineHeight: 1.35 }}>
                                  {shippers.join(' · ')}
                                </div>
                              </td>
                              <td className="num" title={fmtWeight(group.totals.promised)}>
                                <b>{fmtWeightShort(group.totals.promised)}</b>/d
                              </td>
                              <td
                                className={`num ${group.totals.shortToday > 0 ? 'warn' : 'good'}`}
                                title={`${fmtWeight(group.totals.hauledToday)} of ${fmtWeight(group.totals.promised)}`}
                              >
                                {fmtWeightShort(group.totals.hauledToday)}
                                <span className="dim small"> · {Math.round(fillToday * 100)}%</span>
                              </td>
                              <td className="num" title={fmtWeight(group.totals.hauledMtd)}>
                                {fmtWeightShort(group.totals.hauledMtd)}
                              </td>
                              <td className={`num ${group.totals.shortfallMtd > 0 ? 'bad' : 'dim'}`} title={fmtWeight(group.totals.shortfallMtd)}>
                                {group.totals.shortfallMtd > 0 ? fmtWeightShort(group.totals.shortfallMtd) : '—'}
                              </td>
                              <td className="num dim">
                                {group.totals.blendedRate > 0 ? `₹${group.totals.blendedRate.toFixed(2)}/100km` : '—'}
                              </td>
                              <td className="num"><b><M v={group.totals.monthFull} /></b></td>
                              <td className={`num ${daysLeft <= 14 ? 'warn' : ''}`}>{daysLeft}d</td>
                            </tr>
                          )
                        })}
                        <tr className="total" style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                          <td>
                            Portfolio
                            <span className="dim small" style={{ marginLeft: 8 }}>
                              {activeContracts.length} deals · {contractGroups.length} lanes
                            </span>
                          </td>
                          <td className="num" title={fmtWeight(contractTotals.promised)}>
                            {fmtWeightShort(contractTotals.promised)}/d
                          </td>
                          <td
                            className={`num ${contractTotals.shortToday > 0 ? 'warn' : 'good'}`}
                            title={fmtWeight(contractTotals.hauledToday)}
                          >
                            {fmtWeightShort(contractTotals.hauledToday)}
                          </td>
                          <td className="num" title={fmtWeight(contractTotals.hauledMtd)}>
                            {fmtWeightShort(contractTotals.hauledMtd)}
                          </td>
                          <td className={`num ${contractTotals.shortfallMtd > 0 ? 'bad' : 'dim'}`} title={fmtWeight(contractTotals.shortfallMtd)}>
                            {contractTotals.shortfallMtd > 0 ? fmtWeightShort(contractTotals.shortfallMtd) : '—'}
                          </td>
                          <td className="num dim">
                            {contractTotals.blendedRate > 0 ? `₹${contractTotals.blendedRate.toFixed(2)} avg` : '—'}
                          </td>
                          <td className="num"><M v={contractTotals.monthFull} full /></td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {/* Available Contract Proposals */}
              <Panel
                title="Available Corporate Proposals & Bids"
                flat
                right={
                  <span className="dim small">
                    Invited only on corridors holding an active RTO Cargo Licence (covers both directions).
                  </span>
                }
              >
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span className="dim small">
                    Shippers tender freight contracts on licensed corridors. Both directions eligible.
                  </span>
                  <span
                    className={`pill small ${corporateYear.pctBonus >= 0 ? 'good' : 'bad'}`}
                    title={`Corporate tender capacity fluctuates between -10% and +20% each operational year based on annual company profitability or losses. Base: ${fmtWeight(BAL.cargoContractDailyCapParcelKg)} parcel / ${fmtWeight(BAL.cargoContractDailyCapBulkKg)} bulk.`}
                  >
                    🏢 Corporate Offer Capacity: Year {corporateYear.yearIndex} · {corporateYear.pctBonus !== 0 ? `${corporateYear.pctBonus > 0 ? '+' : ''}${corporateYear.pctBonus}% ${corporateYear.pctBonus >= 0 ? 'Growth' : 'Contraction'}` : 'Base Capacity'} ({fmtWeight(contractDailyCapKg(s, 'parcel'))}/d parcel · {fmtWeight(contractDailyCapKg(s, 'bulk'))}/d bulk cap)
                  </span>
                </div>
                {licensedLanes.filter((l) => l.daysLeft > 0).length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center' }}>
                    <div className="warn" style={{ marginBottom: 6 }}>
                      ⚠️ No corridors hold an active RTO Cargo Goods Licence.
                    </div>
                    <p className="dim small" style={{ marginBottom: 10 }}>
                      Shippers require compliant RTO Goods transport licences before tendering corporate cargo contracts.
                      Purchase licences from the Corridors tab to unlock partner proposals.
                    </p>
                  </div>
                ) : availableContracts.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center' }} className="dim">
                    No open proposals currently waiting. New courier and logistics tenders refresh periodically.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Partner Shipper</th>
                          <th>Corridor (Lane)</th>
                          <th className="num">Daily Volume</th>
                          <th className="num">Agreed Rate</th>
                          <th className="num">Contract Term</th>
                          <th className="num">Est. Monthly Revenue</th>
                          <th className="num">Fleet Readiness</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {availableContracts.map((p) => {
                          const route = ROUTES[p.routeId]
                          const bucket = contractBucket(p.partner)
                          const tier = p.tier ?? getContractTier(bucket, p.guaranteedKgPerDay)
                          const cargoBuses = route ? cargoVehicleDeparturesOnLane(s, route, p.direction) : 0
                          const estMonthly = route
                            ? rs(cargoFreightRupees(p.guaranteedKgPerDay, route.km, p.ratePerKg100Km, cargoRouteMult(route.km)) * 30)
                            : 0

                          return (
                            <tr key={p.offerKey}>
                              <td>
                                <b>{p.partner}</b>
                                <span className={`pill small ${bucket === 'bulk' ? 'warn' : 'info'}`} style={{ marginLeft: 6 }}>
                                  {bucket === 'bulk' ? 'Industrial Freight' : 'E-Commerce Parcel'}
                                </span>
                                <span
                                  className={`pill small ${tier === 'enterprise' ? 'purple' : tier === 'mid' ? 'accent' : 'dim'}`}
                                  style={{ marginLeft: 6 }}
                                >
                                  {tier === 'enterprise' ? 'Enterprise Tier' : tier === 'mid' ? 'National Tier' : 'Local Player'}
                                </span>
                              </td>
                              <td>{route ? cargoLegLabel(route, p.direction) : p.routeId}</td>
                              <td className="num"><b>{fmtWeight(p.guaranteedKgPerDay)}</b> / day</td>
                              <td className="num">
                                ₹{p.ratePerKg100Km.toFixed(2)}/100km
                                {route && (
                                  <div className="dim small">
                                    ₹{((p.ratePerKg100Km / 100) * route.km * cargoRouteMult(route.km)).toFixed(2)}/kg
                                  </div>
                                )}
                              </td>
                              <td className="num">{p.durationDays} days</td>
                              <td className="num good"><b><M v={estMonthly} /></b></td>
                              <td className="num">
                                {cargoBuses > 0 ? (
                                  <span className="pill good small">✓ {cargoBuses} Truck(s) Ready</span>
                                ) : (
                                  <span className="pill warn small">⚠️ No Truck on Lane</span>
                                )}
                              </td>
                              <td className="num">
                                <button
                                  className="small primary"
                                  onClick={() => g.signCargoContract(p)}
                                >
                                  Sign Deal
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SPOT PARCELS (COUNTER BOOKINGS)                                     */}
      {/* ========================================================================= */}
      {activeTab === 'spots' && (
        <Panel
          title="Spot Consignments & Booking Counter Queue"
          flat
          right={
            pendingSpots.length > 0 && (
              <button
                className="small primary"
                onClick={() => g.acceptAllSpotOffers()}
              >
                Queue All Pending ({pendingSpots.length})
              </button>
            )
          }
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="dim small">
              Customer consignments waiting at booking counters (Koyambedu, Gandhipuram, Kalasipalyam, Mattuthavani).
              {onDutyMgr ? ' Assigned manager automatically queues spot loads.' : ' Accept loads to queue them on upcoming departures.'}
            </span>
          </div>

          {spotOffers.filter((o) => (o.status ?? 'offered') !== 'expired' || (o.shippedKg ?? 0) > 0).length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }} className="dim">
              No spot consignments currently waiting at counters. New bookings arrive throughout the week.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Consignment Corridor</th>
                    <th>Commodity Type</th>
                    <th className="num">Weight / Volume</th>
                    <th>Status</th>
                    <th className="num">Offered Payout</th>
                    <th className="num">Unit Tariff</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {spotOffers
                    .filter((o) => (o.status ?? 'offered') !== 'expired' || (o.shippedKg ?? 0) > 0)
                    .map((o) => {
                      const st = o.status ?? 'offered'
                      const origin = CITIES[o.originCity]?.name ?? o.originCity
                      const dest = CITIES[o.destCity]?.name ?? o.destCity
                      const originProf = cityFreightProfile(o.originCity)
                      const displayKg = st === 'shipped' ? (o.shippedKg || o.weightKg) : (o.remainingKg ?? o.weightKg)
                      const density = CARGO_DENSITY[o.cargoType ?? 'mixed'] ?? 167
                      const chargeKg = o.chargeableKg ?? chargeableKg(o.weightKg, o.volumeCbm, o.cargoType)
                      const isVolumetric = chargeKg > (o.weightKg ?? 0)
                      const unitRate = o.weightKg > 0 ? (o.totalPayment / 100) / (o.chargeableKg ?? o.weightKg) : 0

                      return (
                        <tr key={o.id}>
                          <td>
                            <b>{origin} → {dest}</b>
                            <span className="pill small dim" style={{ marginLeft: 6, fontSize: 10, textTransform: 'capitalize' }} title={`Origin Freight Tier: ${originProf.tier}`}>
                              {originProf.tier}
                            </span>
                          </td>
                          <td>
                            <span style={{ textTransform: 'capitalize' }}>{o.cargoType}</span>
                            {o.fragile && <span className="pill warn small" style={{ marginLeft: 6 }}>Fragile</span>}
                          </td>
                          <td className="num">
                            <b>{fmtWeight(displayKg)}</b>
                            <div className="dim small">
                              {o.volumeCbm.toFixed(1)} CBM ({density} kg/m³)
                              {isVolumetric && (
                                <span className="pill info small" style={{ marginLeft: 4, fontSize: 9 }} title={`Volumetric chargeable weight applies (${num(chargeKg)} kg billable)`}>
                                  ⚡ {tonnes(chargeKg)} T billable
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            {st === 'shipped' ? (
                              <span className="pill good small">✓ Shipped & Delivered</span>
                            ) : st === 'queued' ? (
                              <span className="pill info small">⏳ Queued for Loading</span>
                            ) : (
                              <span className="pill small">Counter Request</span>
                            )}
                          </td>
                          <td className="num good">
                            <b><M v={o.totalPayment} /></b>
                            {st === 'shipped' && <div className="dim small" style={{ fontSize: 10 }}>Earned</div>}
                          </td>
                          <td className="num">
                            ₹{unitRate.toFixed(2)}/kg
                          </td>
                          <td className="num">
                            {st === 'offered' && (
                              <button
                                className="small primary"
                                onClick={() => g.acceptSpotCargoOffer(o.id)}
                              >
                                Queue Load
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}
