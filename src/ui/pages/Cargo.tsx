import { useMemo, useState } from 'react'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import { ROUTES } from '../../engine/data/routes'
import { CITIES } from '../../engine/data/cities'
import { ymKey } from '../../engine/core/calendar'
import { fmtCompact, rs } from '../../engine/core/money'
import { BAL } from '../../engine/data/balance'
import {
  cargoCorridorLabel,
  cargoFreightRupees,
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
  chargeableKg,
  CARGO_DENSITY,
  cargoPoolsForView,
} from '../../engine/sim/cargo'
import type { CargoContract, CargoHaulLine, CargoLaneDay, RouteDef, CargoPricingType, CargoCargoType } from '../../engine/types'
import { cargoManagerOnDuty, deskOf, managersOnPayroll } from '../../engine/sim/staffing'
import { spanMeters, DESK_UNIT } from '../../engine/sim/span'
import { Bar, Empty, M, Panel, SpanMeter, StatRow, Tabs, PageHeader } from '../bits'
import { num, qty, tonnes } from '../format'

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
  return lane.fuel + lane.toll + lane.bata + (lane.wear ?? 0)
}

function laneLoadingCost(lane: CargoLaneDay): number {
  return lane.loading + lane.unloading
}

function laneContribution(lane: CargoLaneDay): number {
  return lane.revenue - laneLoadingCost(lane) - lane.liability - lane.shortfall - laneVehicleCost(lane)
}

/** Profit as a share of freight revenue (0 when nothing was billed). */
function laneMargin(lane: CargoLaneDay): number {
  return lane.revenue > 0 ? laneContribution(lane) / lane.revenue : 0
}

type CorridorSortKey = 'corridor' | 'trips' | 'cap' | 'hauled' | 'fill' | 'yield' | 'revenue' | 'profit' | 'margin'

type CorridorRow = CargoLaneDay & { label: string; corridorKey: string; route: RouteDef }

function corridorFill(row: CargoLaneDay): number {
  return row.capKg > 0 ? row.kg / row.capKg : 0
}

function corridorYield(row: CargoLaneDay): number {
  return row.kg > 0 ? row.revenue / 100 / row.kg : 0
}

function corridorSortValue(row: CorridorRow, key: CorridorSortKey): number | string {
  switch (key) {
    case 'corridor': return row.label
    case 'trips': return row.trips
    case 'cap': return row.capKg
    case 'hauled': return row.kg
    case 'fill': return corridorFill(row)
    case 'yield': return corridorYield(row)
    case 'revenue': return row.revenue
    case 'profit': return laneContribution(row)
    case 'margin': return laneMargin(row)
  }
}

function sortCorridorRows(rows: CorridorRow[], key: CorridorSortKey, desc: boolean): CorridorRow[] {
  return [...rows].sort((a, b) => {
    const av = corridorSortValue(a, key)
    const bv = corridorSortValue(b, key)
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return desc ? -cmp : cmp
  })
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


type Tab = 'today' | 'corridors' | 'contracts' | 'spot' | 'desk'

export function CargoPage() {
  const s = useDeferredGameState()!
  const g = useGameActions()
  const [tab, setTab] = useState<Tab>('today')
  const [laneDays, setLaneDays] = useState<7 | 30 | 90>(30)
  const [sortKey, setSortKey] = useState<CorridorSortKey>('revenue')
  const [sortDesc, setSortDesc] = useState(true)

  const applySort = (key: CorridorSortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const appointedMgr = s.company.cargoManagerId ? s.staff[s.company.cargoManagerId] : undefined
  const onDutyMgr = cargoManagerOnDuty(s)
  const cargoMeter = spanMeters(s).cargo
  const hasMgr = Boolean(onDutyMgr || appointedMgr)
  const subsidiary = Boolean(s.company.dedicatedCargoSubsidiary)
  const cargoType = s.company.cargoCargoType ?? 'mixed'
  const acceptFragile = s.company.cargoAcceptFragile ?? false
  const autoSign = s.company.cargoAutoSignContracts !== false
  const cargoStaff = managersOnPayroll(s).filter((st) => st.id === s.company.cargoManagerId || !deskOf(s, st.id))
  const monthKey = ymKey(s.day)
  const corporateYear = useMemo(() => corporateYearInfo(s), [s.day, s.startDay])

  const inMonth = s.curMonth.ym === monthKey
  const mtdCargo = inMonth ? (s.curMonth.income.cargo ?? 0) + (s.curMonth.income.cargo_spot ?? 0) : 0

  const activeContracts = (s.company.cargoContracts ?? []).filter((c) => c.active)
  const spotOffers = (s.company.spotOffers ?? []).filter((o) => (o.status ?? 'offered') !== 'expired' || (o.shippedKg ?? 0) > 0)
  const pendingSpots = spotOffers.filter((o) => (o.status ?? 'offered') === 'offered' && o.expiresDay >= s.day)
  const availableContracts = useMemo(() => (tab === 'contracts' ? getAvailableContracts(s) : []), [s, tab])

  /** One pass over route history: this month's totals, plus per-corridor totals for the chosen window. */
  const history = useMemo(() => {
    const mtd = emptyCargoLaneDay()
    const from = s.day - (laneDays - 1)
    const byCorridor = new Map<string, CorridorRow>()
    for (const [routeId, days] of Object.entries(s.routeHistory ?? {})) {
      const route = ROUTES[routeId]
      if (!route) continue
      const key = [route.from, route.to].sort().join('-')
      for (const day of days ?? []) {
        if (!day.cargo) continue
        const monthly = ymKey(day.day) === monthKey
        for (const dir of ['AB', 'BA'] as const) {
          const lane = day.cargo[dir]
          if (!lane) continue
          if (monthly) addLane(mtd, lane)
          if (day.day < from) continue
          if (lane.trips <= 0 && lane.kg <= 0 && lane.revenue <= 0 && lane.shortfall <= 0) continue
          let row = byCorridor.get(key)
          if (!row) {
            row = { ...emptyCargoLaneDay(), label: cargoCorridorLabel(route), corridorKey: key, route }
            byCorridor.set(key, row)
          }
          addLane(row, lane)
        }
      }
    }
    const corridors = [...byCorridor.values()]
    const total = emptyCargoLaneDay()
    for (const row of corridors) addLane(total, row)
    return { mtd, corridors, total }
  }, [s, monthKey, laneDays])

  const sortedCorridors = useMemo(
    () => sortCorridorRows(history.corridors, sortKey, sortDesc),
    [history.corridors, sortKey, sortDesc],
  )

  const contractRows = useMemo(() => {
    const led = s.company.cargoHaulDay
    const lines = new Map<string, CargoHaulLine>()
    if (led?.day === s.day) for (const line of led.lines) lines.set(line.contractId, line)
    return activeContracts.map((c): ContractRow => {
      const route = ROUTES[c.routeId]
      const line = lines.get(c.id)
      const due = line?.promisedKg ?? 0
      const hauledToday = line?.hauledKg ?? 0
      return {
        c,
        live: c.mtdYm === monthKey,
        route,
        line,
        due,
        hauledToday,
        shortToday: Math.max(0, due - hauledToday),
        cargoBuses: route && c.direction ? cargoVehicleDeparturesOnLane(s, route, c.direction) : null,
        monthFull: route ? rs(cargoFreightRupees(c.guaranteedKgPerDay, route.km, c.ratePerKg100Km, cargoRouteMult(route.km)) * 30) : 0,
      }
    })
  }, [activeContracts, monthKey, s])
  const contractTotals = useMemo(() => sumContractRows(contractRows), [contractRows])
  const contractGroups = useMemo(() => groupContracts(contractRows), [contractRows])

  const licensedLanes = useMemo(() => {
    const seen = new Set<string>()
    let active = 0
    for (const p of Object.values(s.permits)) {
      if (p.status !== 'active') continue
      const r = ROUTES[p.routeId]
      if (!r) continue
      const key = [r.from, r.to].sort().join('-')
      if (seen.has(key)) continue
      seen.add(key)
      if (cargoPermitActive(s, p.routeId)) active++
    }
    return active
  }, [s])

  const baseRate = s.config?.cargoBaseRateRs ?? BAL.cargoBaseRateDefaultRs
  const pricingType: CargoPricingType = s.config?.cargoPricingType ?? 'normal'
  const mtd = history.mtd
  const handling = laneLoadingCost(mtd)
  const mtdProfit = laneContribution(mtd)
  const fillAll = mtd.capKg > 0 ? mtd.kg / mtd.capKg : 0
  const coachKg = Math.max(0, mtd.kg - mtd.cargoOnlyKg)

  return (
    <>
      <PageHeader
        title="Cargo"
        facts={<>{subsidiary ? 'subsidiary' : 'belly parcels'} · desk {qty(cargoMeter.demand)}/{qty(cargoMeter.capacity)}</>}
        factsTip={subsidiary ? 'Freight subsidiary: trucks, B2B contracts and coach parcels' : 'Coach belly parcels only'}
      >
        <Tabs
          inline
          tabs={[
            ['today', 'Today'],
            ['corridors', `Corridors (${history.corridors.length})`],
            ['contracts', `Contracts (${activeContracts.length})`],
            ['spot', `Spot (${pendingSpots.length})`],
            ['desk', 'Desk'],
          ] as const}
          value={tab}
          onChange={setTab}
        />
      </PageHeader>

      <StatRow
        items={[
          { label: 'Revenue MTD', value: <M v={mtdCargo} />, tone: 'good', title: `Coach belly ${fmtCompact(inMonth ? (s.curMonth.cargoCoachRevenue ?? 0) : 0)} · trucks ${fmtCompact(inMonth ? (s.curMonth.cargoTruckRevenue ?? 0) : 0)}` },
          { label: 'Hauled MTD', value: `${tonnes(mtd.kg)} T`, title: `${tonnes(coachKg)} T in coaches · ${tonnes(mtd.cargoOnlyKg)} T in trucks` },
          { label: 'Fill', value: pct(fillAll), tone: fillTone(fillAll), title: `${tonnes(mtd.kg)} T of ${tonnes(mtd.capKg)} T space` },
          { label: 'Profit MTD', value: <M v={mtdProfit} />, tone: mtdProfit >= 0 ? 'good' : 'bad', title: mtdCargo > 0 ? `${pct(mtdProfit / mtdCargo)} margin` : undefined },
          { label: 'Desk capture', value: `${Math.round(companyCargoFillRate(s) * 100)}%`, tone: onDutyMgr ? 'good' : 'warn', title: onDutyMgr ? `${onDutyMgr.name} (skill ${onDutyMgr.skill}) captures ${Math.round(companyCargoFillRate(s) * 100)}% of the parcels on offer` : 'No manager on duty: booking capture sits at the floor' },
        ]}
      />

      {/* ---------------- TODAY ---------------- */}
      {tab === 'today' && (
        <>
          {(() => {
            const pools = cargoPoolsForView(s)
            if (pools.length === 0) return <Panel flat><Empty text="No cargo lanes running today." /></Panel>
            const market = pools.reduce((a, p) => a + p.parcelMarketKg + p.bulkMarketKg, 0)
            const book = pools.reduce((a, p) => a + p.parcelBookKg + p.bulkBookKg, 0)
            const loaded = pools.reduce((a, p) => a + p.parcelLoadedKg + p.bulkLoadedKg, 0)
            return (
              <Panel
                title="Today's lanes"
                flat
                right={<span className="muted">market {tonnes(market)} T · booked {tonnes(book)} T ({pct(market > 0 ? book / market : 0)}) · loaded {tonnes(loaded)} T</span>}
              >
                <div className="xscroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Lane</th>
                        <th className="num">Market</th>
                        <th className="num">Booked</th>
                        <th className="num">Contract due</th>
                        <th className="num">Loaded</th>
                        <th className="num">Runs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pools.map((p) => {
                        const route = ROUTES[p.routeId]
                        return (
                          <tr key={p.laneKey}>
                            <td><b>{route ? cargoLegLabel(route, p.direction) : p.laneKey}</b></td>
                            <td className="num">{tonnes(p.parcelMarketKg + p.bulkMarketKg)} T</td>
                            <td className="num">{tonnes(p.parcelBookKg + p.bulkBookKg)} T</td>
                            <td className="num">{p.contractDueKg > 0 ? fmtWeightShort(p.contractDueKg) : '—'}</td>
                            <td className="num good"><b>{fmtWeightShort(p.parcelLoadedKg + p.bulkLoadedKg)}</b></td>
                            <td className="num muted">{p.departuresServed}/{p.departuresPlanned || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )
          })()}

          <Panel title="This month" flat>
            <table className="data">
              <thead>
                <tr><th /><th className="num">Hauled</th><th className="num">Amount</th><th className="num">Share</th></tr>
              </thead>
              <tbody>
                {(() => {
                  const share = (v: number) => (mtd.revenue > 0 ? pct(v / mtd.revenue) : '—')
                  return (
                    <>
                      <tr><td>Corporate contracts</td><td className="num">{tonnes(mtd.contractKg)} T</td><td className="num"><M v={mtd.contractRevenue} /></td><td className="num muted">{share(mtd.contractRevenue)}</td></tr>
                      <tr><td>Spot parcels</td><td className="num">{tonnes(mtd.spotKg)} T</td><td className="num"><M v={mtd.spotRevenue} /></td><td className="num muted">{share(mtd.spotRevenue)}</td></tr>
                      <tr><td>Counter walk-ins</td><td className="num">{tonnes(mtd.walkupKg)} T</td><td className="num"><M v={mtd.walkupRevenue} /></td><td className="num muted">{share(mtd.walkupRevenue)}</td></tr>
                      <tr className="total"><td><b>Revenue</b></td><td className="num"><b>{tonnes(mtd.kg)} T</b></td><td className="num good"><b><M v={mtd.revenue} /></b></td><td className="num" /></tr>
                      <tr><td title={`₹${(BAL.cargoLoadingPaisePerKg / 100).toFixed(2)}/kg loading · ₹${(BAL.cargoUnloadingPaisePerKg / 100).toFixed(2)}/kg unloading`}>Loading and unloading</td><td /><td className="num warn">-<M v={handling} /></td><td className="num muted">{share(handling)}</td></tr>
                      <tr><td title="Claims for damaged goods and fees for promised kilograms not moved">Claims and shortfall</td><td /><td className={`num ${mtd.liability + mtd.shortfall > 0 ? 'bad' : ''}`}>-<M v={mtd.liability + mtd.shortfall} /></td><td className="num muted">{share(mtd.liability + mtd.shortfall)}</td></tr>
                      <tr><td title="Tyre and service wear, plus fuel, tolls and driver bata on truck runs. Coach belly parcels ride free.">Truck running costs</td><td /><td className="num warn">-<M v={laneVehicleCost(mtd)} /></td><td className="num muted">{share(laneVehicleCost(mtd))}</td></tr>
                      <tr className="total"><td><b>Profit</b></td><td /><td className={`num ${mtdProfit >= 0 ? 'good' : 'bad'}`}><b><M v={mtdProfit} /></b></td><td className={`num ${mtdProfit >= 0 ? 'good' : 'bad'}`}><b>{mtd.revenue > 0 ? pct(mtdProfit / mtd.revenue) : '—'}</b></td></tr>
                    </>
                  )
                })()}
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {/* ---------------- CORRIDORS ---------------- */}
      {tab === 'corridors' && (
        <Panel
          flat
          title={`Corridors · last ${laneDays} days`}
          right={
            <Tabs
              inline
              tabs={[['7', '7d'], ['30', '30d'], ['90', '90d']] as const}
              value={String(laneDays) as '7' | '30' | '90'}
              onChange={(v) => setLaneDays(Number(v) as 7 | 30 | 90)}
            />
          }
        >
          {history.corridors.length === 0 ? (
            <Empty text="No cargo hauled in this window." />
          ) : (
            <div className="xscroll">
              <table className="data">
                <thead>
                  <tr>
                    {([
                      ['corridor', 'Corridor'],
                      ['trips', 'Runs'],
                      ['cap', 'Space'],
                      ['hauled', 'Hauled'],
                      ['fill', 'Fill'],
                      ['yield', '₹/kg'],
                      ['revenue', 'Revenue'],
                      ['profit', 'Profit'],
                      ['margin', 'Margin'],
                    ] as const).map(([key, label]) => (
                      <th key={key} className={`${key === 'corridor' ? '' : 'num'} ${sortKey === key ? 'sorted' : ''}`} onClick={() => applySort(key)} title="Sort">
                        {label}{sortKey === key ? (sortDesc ? ' ▾' : ' ▴') : ''}
                      </th>
                    ))}
                    <th className="num">Licence</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCorridors.map((c) => {
                    const profit = laneContribution(c)
                    const fill = corridorFill(c)
                    const rate = corridorYield(c)
                    const licence = cargoLicence(s, c.route.id)
                    const licensed = cargoPermitActive(s, c.route.id)
                    const daysLeft = licence ? Math.max(0, licence.expiryDay - s.day) : 0
                    return (
                      <tr key={c.corridorKey}>
                        <td>
                          <b>{c.label}</b>
                          {c.cargoOnlyTrips > 0 && <span className="muted ml8">{c.cargoOnlyTrips} truck run{c.cargoOnlyTrips === 1 ? '' : 's'}</span>}
                        </td>
                        <td className="num">{c.trips}</td>
                        <td className="num">{tonnes(c.capKg)} T</td>
                        <td className="num" title={`${tonnes(c.kg - c.cargoOnlyKg)} T in coaches · ${tonnes(c.cargoOnlyKg)} T in trucks`}>
                          <b>{tonnes(c.kg)} T</b>
                          <div className="muted small">{tonnes(c.kg - c.cargoOnlyKg)} coach · {tonnes(c.cargoOnlyKg)} truck</div>
                        </td>
                        <td className="num nowrap"><Bar value={fill} width={6} tone="auto" /> <span className={fillTone(fill)}>{pct(fill)}</span></td>
                        <td className="num">{rate > 0 ? rate.toFixed(2) : '—'}</td>
                        <td className="num"><M v={c.revenue} /></td>
                        <td className={`num ${profit >= 0 ? 'good' : 'bad'}`}><b><M v={profit} /></b></td>
                        <td className={`num ${laneMargin(c) >= 0 ? '' : 'bad'}`} title="Profit as a share of freight revenue">{c.revenue > 0 ? pct(laneMargin(c)) : '—'}</td>
                        <td className="num">
                          {licensed ? (
                            daysLeft <= 45 ? (
                              <button className="small warn" title={`Renew for ${fmtCompact(cargoPermitFee(c.route, { renewal: true }))}`} onClick={() => g.renewCargoPermit(c.route.id)}>
                                renew {daysLeft}d
                              </button>
                            ) : (
                              <span className="pill good small" title="Covers both directions">{daysLeft}d</span>
                            )
                          ) : (
                            <button className="small primary" title={`Annual goods licence ${fmtCompact(cargoPermitFee(c.route))}, both directions`} onClick={() => g.openCargoPermit(c.route.id)}>
                              buy
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="total">
                    <td><b>Network</b></td>
                    <td className="num">{history.total.trips}</td>
                    <td className="num">{tonnes(history.total.capKg)} T</td>
                    <td className="num">{tonnes(history.total.kg)} T</td>
                    <td className="num">{pct(corridorFill(history.total))}</td>
                    <td className="num">{corridorYield(history.total) > 0 ? corridorYield(history.total).toFixed(2) : '—'}</td>
                    <td className="num"><M v={history.total.revenue} /></td>
                    <td className={`num ${laneContribution(history.total) >= 0 ? 'good' : 'bad'}`}><M v={laneContribution(history.total)} /></td>
                    <td className="num">{history.total.revenue > 0 ? pct(laneMargin(history.total)) : '—'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ---------------- CONTRACTS ---------------- */}
      {tab === 'contracts' && (
        !subsidiary ? (
          <Panel flat>
            <Empty text="B2B contracts need the freight subsidiary." />
            <button className="primary small" onClick={() => setTab('desk')}>Set up on Desk ›</button>
          </Panel>
        ) : (
          <>
            <Panel title={`Signed (${activeContracts.length})`} flat>
              {activeContracts.length === 0 ? (
                <Empty text="No contracts signed." />
              ) : (
                <div className="xscroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Lane</th>
                        <th className="num" title="Promised per operating day">Quota/day</th>
                        <th className="num" title="Moved today vs promised">Today</th>
                        <th className="num">Month</th>
                        <th className="num" title="Promised kilograms not moved this month">Short</th>
                        <th className="num" title="About 30 days of freight revenue">Run-rate</th>
                        <th className="num">Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractGroups.map((group) => {
                        const noTruck = group.rows[0]?.cargoBuses === 0
                        const fillToday = group.totals.promised > 0 ? group.totals.hauledToday / group.totals.promised : 0
                        const daysLeft = Math.min(...group.rows.map((r) => Math.max(0, r.c.expiresDay - s.day)))
                        return (
                          <tr key={group.laneKey}>
                            <td>
                              <b>{group.label}</b>
                              {noTruck && <span className="bad ml8">no truck today</span>}
                              <div className="muted">{group.rows.map((r) => r.c.partner).join(' · ')}</div>
                            </td>
                            <td className="num" title={fmtWeight(group.totals.promised)}>{fmtWeightShort(group.totals.promised)}</td>
                            <td className={`num ${group.totals.shortToday > 0 ? 'warn' : 'good'}`} title={`${fmtWeight(group.totals.hauledToday)} of ${fmtWeight(group.totals.promised)}`}>
                              {fmtWeightShort(group.totals.hauledToday)} <span className="muted">{Math.round(fillToday * 100)}%</span>
                            </td>
                            <td className="num">{fmtWeightShort(group.totals.hauledMtd)}</td>
                            <td className={`num ${group.totals.shortfallMtd > 0 ? 'bad' : 'dim'}`}>{group.totals.shortfallMtd > 0 ? fmtWeightShort(group.totals.shortfallMtd) : '—'}</td>
                            <td className="num"><M v={group.totals.monthFull} /></td>
                            <td className={`num ${daysLeft <= 14 ? 'warn' : ''}`}>{daysLeft}d</td>
                          </tr>
                        )
                      })}
                      <tr className="total">
                        <td><b>All</b> <span className="muted">{activeContracts.length} deals · {contractGroups.length} lanes</span></td>
                        <td className="num">{fmtWeightShort(contractTotals.promised)}</td>
                        <td className={`num ${contractTotals.shortToday > 0 ? 'warn' : 'good'}`}>{fmtWeightShort(contractTotals.hauledToday)}</td>
                        <td className="num">{fmtWeightShort(contractTotals.hauledMtd)}</td>
                        <td className={`num ${contractTotals.shortfallMtd > 0 ? 'bad' : 'dim'}`}>{contractTotals.shortfallMtd > 0 ? fmtWeightShort(contractTotals.shortfallMtd) : '—'}</td>
                        <td className="num"><M v={contractTotals.monthFull} /></td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel
              title="Proposals"
              flat
              right={
                <span
                  className={`muted ${corporateYear.pctBonus >= 0 ? 'good' : 'bad'}`}
                  title={`Tender capacity moves between -10% and +20% each year with company profit. Daily caps ${fmtWeight(contractDailyCapKg(s, 'parcel'))} parcel · ${fmtWeight(contractDailyCapKg(s, 'bulk'))} bulk.`}
                >
                  year {corporateYear.yearIndex} {corporateYear.pctBonus !== 0 ? `${corporateYear.pctBonus > 0 ? '+' : ''}${corporateYear.pctBonus}%` : 'base'}
                </span>
              }
            >
              {licensedLanes === 0 ? (
                <Empty text="No corridor holds a goods licence. Buy one under Corridors to receive proposals." />
              ) : availableContracts.length === 0 ? (
                <Empty text="No open proposals." />
              ) : (
                <div className="xscroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Shipper</th>
                        <th>Lane</th>
                        <th className="num">Volume/day</th>
                        <th className="num">Rate</th>
                        <th className="num">Term</th>
                        <th className="num">Per month</th>
                        <th>Trucks</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {availableContracts.map((p) => {
                        const route = ROUTES[p.routeId]
                        const bucket = contractBucket(p.partner)
                        const tier = p.tier ?? getContractTier(bucket, p.guaranteedKgPerDay)
                        const trucks = route ? cargoVehicleDeparturesOnLane(s, route, p.direction) : 0
                        const perMonth = route ? rs(cargoFreightRupees(p.guaranteedKgPerDay, route.km, p.ratePerKg100Km, cargoRouteMult(route.km)) * 30) : 0
                        return (
                          <tr key={p.offerKey}>
                            <td>
                              <b>{p.partner}</b>
                              <div className="muted">{bucket === 'bulk' ? 'industrial' : 'e-commerce'} · {tier === 'enterprise' ? 'enterprise' : tier === 'mid' ? 'national' : 'local'}</div>
                            </td>
                            <td>{route ? cargoLegLabel(route, p.direction) : p.routeId}</td>
                            <td className="num">{fmtWeightShort(p.guaranteedKgPerDay)}</td>
                            <td className="num" title={route ? `₹${((p.ratePerKg100Km / 100) * route.km * cargoRouteMult(route.km)).toFixed(2)}/kg on this lane` : undefined}>₹{p.ratePerKg100Km.toFixed(2)}/100km</td>
                            <td className="num">{p.durationDays}d</td>
                            <td className="num good"><b><M v={perMonth} /></b></td>
                            <td>{trucks > 0 ? <span className="pill good small">{trucks} ready</span> : <span className="pill warn small">none</span>}</td>
                            <td className="num"><button className="small primary" onClick={() => g.signCargoContract(p)}>Sign</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )
      )}

      {/* ---------------- SPOT ---------------- */}
      {tab === 'spot' && (
        <Panel
          title="Spot parcels"
          flat
          right={pendingSpots.length > 0 && <button className="small primary" onClick={() => g.acceptAllSpotOffers()}>Queue all ({pendingSpots.length})</button>}
        >
          {spotOffers.length === 0 ? (
            <Empty text="No spot parcels waiting." />
          ) : (
            <div className="xscroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th>Cargo</th>
                    <th className="num">Weight</th>
                    <th>Status</th>
                    <th className="num">Payout</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {spotOffers.map((o) => {
                    const st = o.status ?? 'offered'
                    const kg = st === 'shipped' ? (o.shippedKg || o.weightKg) : (o.remainingKg ?? o.weightKg)
                    const billable = o.chargeableKg ?? chargeableKg(o.weightKg, o.volumeCbm, o.cargoType)
                    const unit = o.weightKg > 0 ? (o.totalPayment / 100) / billable : 0
                    return (
                      <tr key={o.id}>
                        <td><b>{CITIES[o.originCity]?.name ?? o.originCity} → {CITIES[o.destCity]?.name ?? o.destCity}</b></td>
                        <td className="nowrap">
                          <span style={{ textTransform: 'capitalize' }}>{o.cargoType}</span>
                          {o.fragile && <span className="pill warn small ml6">fragile</span>}
                        </td>
                        <td className="num" title={`${o.volumeCbm.toFixed(1)} CBM at ${CARGO_DENSITY[o.cargoType ?? 'mixed'] ?? 167} kg/m³`}>
                          {fmtWeightShort(kg)}
                          {billable > (o.weightKg ?? 0) && <span className="muted" title="Volumetric weight applies"> · bills {fmtWeightShort(billable)}</span>}
                        </td>
                        <td><span className={`pill small ${st === 'shipped' ? 'good' : st === 'queued' ? 'info' : ''}`}>{st === 'shipped' ? 'delivered' : st === 'queued' ? 'queued' : 'at counter'}</span></td>
                        <td className="num good" title={`₹${unit.toFixed(2)}/kg`}><b><M v={o.totalPayment} /></b></td>
                        <td className="num">{st === 'offered' && <button className="small primary" onClick={() => g.acceptSpotCargoOffer(o.id)}>Queue</button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ---------------- DESK ---------------- */}
      {tab === 'desk' && (
        <div className="grid-2">
          <Panel title="Pricing">
            <div className="form-row">
              <label>Base tariff ₹/kg/100km</label>
              <Tabs
                inline
                tabs={[['1', '1.0'], ['1.5', '1.5'], ['2', '2.0'], ['2.5', '2.5'], ['3', '3.0']] as const}
                value={([1, 1.5, 2, 2.5, 3].find((r) => Math.abs(baseRate - r) < 0.1)?.toString() ?? '') as '1'}
                onChange={(v) => g.setCargoBaseRate(Number(v))}
              />
            </div>
            <div className="form-row">
              <label>Strategy</label>
              <Tabs
                inline
                tabs={[['normal', 'Standard'], ['aggressive', 'Premium +15%'], ['discount', 'Volume -10%']] as const}
                value={pricingType}
                onChange={(v) => g.setCargoPricingType(v)}
              />
            </div>
            <div className="form-row">
              <label>Commodity</label>
              <select value={cargoType} onChange={(e) => g.setCargoCargoType(e.target.value as CargoCargoType)}>
                <option value="mixed">General parcels (167 kg/m³)</option>
                <option value="hardware">Hardware and spares (250)</option>
                <option value="textiles">Textiles (120)</option>
                <option value="agri">Agri produce (140)</option>
                <option value="fmcg">FMCG (120)</option>
              </select>
            </div>
            <label className="row gap" title="Fragile and electronics pay a 25% freight surcharge">
              <input type="checkbox" checked={acceptFragile} onChange={(e) => g.setCargoAcceptFragile(e.target.checked)} />
              <span>Accept fragile (+25%)</span>
            </label>
            <div className="muted mt8">
              Coach parcels ~₹{parcelRatePerKg100Km(s).toFixed(2)} · trucks ~₹{truckRatePerKg100Km(s).toFixed(2)} per kg per 100 km
            </div>
          </Panel>

          <Panel title="Desk">
            <div className="form-row">
              <label>Manager</label>
              <select value={s.company.cargoManagerId ?? ''} onChange={(e) => g.appointCargoManager(e.target.value || undefined)}>
                <option value="">none</option>
                {cargoStaff.map((st) => (
                  <option key={st.id} value={st.id}>{st.name} · skill {st.skill} · {fmtCompact(st.salary)}/mo</option>
                ))}
              </select>
            </div>
            <SpanMeter meter={cargoMeter} unit={DESK_UNIT.cargo} />
            <div className="row gap mt12">
              <span className={`pill ${subsidiary ? 'good' : 'info'}`}>{subsidiary ? 'Freight subsidiary on' : 'Belly parcels only'}</span>
              <button
                className={`small ${subsidiary ? 'warn' : 'primary'}`}
                disabled={!hasMgr}
                title={!hasMgr ? 'Appoint a cargo manager first' : 'Trucks and B2B contracts, plus coach parcels'}
                onClick={() => g.setDedicatedCargoSubsidiary(!subsidiary)}
              >
                {subsidiary ? 'Turn off' : 'Launch'}
              </button>
            </div>
            {subsidiary && (
              <label className="row gap mt8" title="The manager signs deals on corridors that already have scheduled trucks">
                <input type="checkbox" checked={autoSign} onChange={(e) => g.setCargoAutoSignContracts(e.target.checked)} />
                <span>Auto-sign contracts</span>
              </label>
            )}
            <div className="muted mt12" title="Corporate freight deals are only offered on corridors with an active goods licence">
              Goods licences: {licensedLanes} active
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}
