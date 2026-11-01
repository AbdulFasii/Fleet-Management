import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { BUS_MODELS, coachKind, coachKindClass, modelTitleById, isCargoModel } from '../../engine/data/busModels'
import { ROUTES, routeName } from '../../engine/data/routes'
import { cityName } from '../../engine/data/cities'
import { fmtClock, festivalEffect } from '../../engine/core/calendar'
import { worstSubsystem, busAgeYears, busStatusDetail } from '../../engine/sim/fleet'
import { ownerPaysService, serviceDueKm, axleTyresDue } from '../../engine/sim/maintenance'
import { activeGroups } from '../../engine/sim/groups'
import { BAL } from '../../engine/data/balance'
import type { Bus } from '../../engine/types'
import { canCrewBus, crewLimit, crewOnBus, crewShort } from '../crew'
import { Bar, DataTable, M, Panel, ratingTone, GroupBadge, type Col } from '../bits'

export { ratingTone } from '../bits'

export function FleetPage() {
  const s = useGame((g) => g.state)!
  const uiPrefs = useGame((g) => g.uiPrefs)
  const setFleetGroupFilter = useGame((g) => g.setFleetGroupFilter)
  const nav = useNavigate()
  const [busFilter, setBusFilter] = useState('')
  const allBuses = Object.values(s.buses)
  const activeBrandList = useMemo(() => activeGroups(s), [s.groups])

  const buses = useMemo(() => {
    let list = allBuses
    if (uiPrefs.fleetGroupId === 'none') {
      list = list.filter((b) => !b.groupId)
    } else if (uiPrefs.fleetGroupId !== 'all') {
      list = list.filter((b) => b.groupId === uiPrefs.fleetGroupId)
    }

    const q = busFilter.trim().toLowerCase().replace(/\s+/g, '')
    if (!q) return list
    return list.filter((b) => {
      const reg = b.reg.toLowerCase().replace(/\s+/g, '')
      const nick = b.nickname.toLowerCase().replace(/\s+/g, '')
      return reg.includes(q) || nick.includes(q)
    })
  }, [allBuses, busFilter, uiPrefs.fleetGroupId])

  const tableStats = useMemo(() => {
    let owned = 0
    let leased = 0
    let attached = 0
    let active = 0
    let workshop = 0
    let idle = 0
    let docsAttention = 0
    let tyresAttention = 0
    let odoAttention = 0
    const modelMap: Record<string, number> = {}

    for (const b of buses) {
      if (b.ownership === 'leased') leased++
      else if (b.ownership === 'attached') attached++
      else owned++

      modelMap[b.modelId] = (modelMap[b.modelId] ?? 0) + 1

      if (b.status === 'workshop') workshop++
      else if (b.status === 'active') active++

      if (!b.scheduleId) idle++

      const puc = b.pucExpiryDay ?? (s.day + 180)
      const roadDue = (b.roadTaxPayableDay ?? (s.day + 365)) + 30
      const isFitnessFailed = !!b.fitnessFailed
      const isImpounded = b.impoundUntilDay !== undefined && b.impoundUntilDay > s.day
      const worst = Math.min(b.insuranceExpiryDay, b.fitnessExpiryDay, puc, roadDue) - s.day
      if (isImpounded || isFitnessFailed || worst < 15) {
        docsAttention++
      }

      const tInfo = axleTyresDue(b)
      if (tInfo.frontDue || tInfo.rearDue || b.tyrePressure === 'low' || tInfo.frontPct >= 0.85 || tInfo.rearPct >= 0.85) {
        tyresAttention++
      }

      const odoMark = s.config?.odoHighlightKm ?? BAL.odoHighlightDefaultKm
      if (b.odometer >= odoMark) {
        odoAttention++
      }
    }

    const modelCounts = Object.entries(modelMap).sort((a, b) => b[1] - a[1])

    return {
      total: buses.length,
      owned,
      leased,
      attached,
      active,
      workshop,
      idle,
      docsAttention,
      tyresAttention,
      odoAttention,
      modelCounts,
    }
  }, [buses, s.day, s.config?.odoHighlightKm])

  const cols: Col<Bus>[] = [
    {
      key: 'reg', label: 'Bus', sort: (b) => b.reg,
      render: (b) => <span className="accent">{b.reg}</span>,
    },
    {
      key: 'sub',
      label: 'Sub',
      sort: (b) => (b.groupId && s.groups ? s.groups[b.groupId]?.code : '—'),
      render: (b) => {
        const grp = b.groupId && s.groups ? s.groups[b.groupId] : undefined
        return <GroupBadge group={grp} />
      },
    },
    { key: 'model', label: 'Model', sort: (b) => b.modelId, render: (b) => modelTitleById(b.modelId) },
    {
      key: 'halt', label: 'Current Halt',
      sort: (b) => cityName(b.parkedCityId ?? s.company.homeCityId),
      render: (b) => {
        const city = b.parkedCityId ?? s.company.homeCityId
        const isHome = city === s.company.homeCityId
        const hasYard = s.yards.some((y) => y.cityId === city)
        return (
          <span
            className={isHome ? 'good' : hasYard ? 'info' : 'warn'}
            style={{ fontWeight: 500 }}
            title={isHome ? `Halted at Home Depot (${cityName(city)})` : hasYard ? `Halted at Leased Yard (${cityName(city)})` : `Halted at Outstation / Public Bay (${cityName(city)})`}
          >
            📍 {cityName(city)} <span className="small dim">{isHome ? '(Home)' : hasYard ? '(Yard)' : '(Outstation)'}</span>
          </span>
        )
      },
    },
    {
      key: 'layout', label: 'Layout', sort: (b) => coachKind(BUS_MODELS[b.modelId]),
      render: (b) => {
        const m = BUS_MODELS[b.modelId]
        return <span className={coachKindClass(m)}>{coachKind(m)}</span>
      },
    },
    {
      key: 'own', label: 'Ownership', sort: (b) => b.ownership,
      render: (b) => (
        <span className={`pill ${b.ownership === 'owned' ? 'accent' : b.ownership === 'leased' ? 'info' : 'warn'}`}>
          {b.ownership}{b.attach ? ` ${Math.round(b.attach.ownerShare * 100)}%` : ''}
        </span>
      ),
    },
    {
      key: 'rating', label: 'Rating', num: true, sort: (b) => b.qualityScore,
      render: (b) => {
        if (isCargoModel(b.modelId)) {
          return <span className="dim" title="Dedicated cargo carrier — no passenger reviews">—</span>
        }
        const q = b.qualityScore
        const tone = ratingTone(q)
        return (
          <span className={tone} style={{ fontWeight: 600, whiteSpace: 'nowrap' }} title={`Overall Rating (Passenger Reviews): ${q.toFixed(2)} / 5.0`}>
            {q.toFixed(1)} <span style={{ color: '#f59e0b' }}>★</span>
          </span>
        )
      },
    },
    {
      key: 'age', label: 'Age', num: true, sort: (b) => busAgeYears(s, b),
      render: (b) => {
        const y = busAgeYears(s, b)
        return <span className="dim">{y} yr{y === 1 ? '' : 's'}</span>
      },
    },
    {
      key: 'odo', label: 'Odometer', num: true, sort: (b) => b.odometer,
      render: (b) => {
        const km = Math.round(b.odometer)
        const odoMark = s.config?.odoHighlightKm ?? BAL.odoHighlightDefaultKm
        const odoFar = km >= odoMark * 1.25
        const odoOver = km >= odoMark
        const cls = odoFar ? 'bad' : odoOver ? 'warn' : 'dim'
        return (
          <span
            className={cls}
            style={{ fontWeight: odoOver ? 600 : undefined, whiteSpace: 'nowrap' }}
            title={
              odoFar
                ? `Odometer: ${km.toLocaleString('en-IN')} km (Critical: ≥25% over ${odoMark.toLocaleString('en-IN')} km config milestone)`
                : odoOver
                ? `Odometer: ${km.toLocaleString('en-IN')} km (Attention: exceeded ${odoMark.toLocaleString('en-IN')} km config milestone)`
                : `Odometer: ${km.toLocaleString('en-IN')} km (Config highlight mark: ${odoMark.toLocaleString('en-IN')} km)`
            }
          >
            {km.toLocaleString('en-IN')} km
          </span>
        )
      },
    },
    {
      key: 'cond', label: 'Condition', num: true, sort: (b) => worstSubsystem(b.condition),
      render: (b) => <Bar value={worstSubsystem(b.condition) / 100} tone="auto" width={8} />,
    },
    {
      key: 'svc', label: 'Service', num: true, sort: (b) => serviceDueKm(b),
      render: (b) => {
        if (ownerPaysService(b)) return <span className="dim">owner</span>
        const due = serviceDueKm(b)
        return due > 0 ? <span className="bad">{Math.round(due / 1000)}k over</span> : <span className="dim">{Math.round(-due / 1000)}k left</span>
      },
    },
    {
      key: 'tyres', label: 'Tyres (F/R)', num: true,
      sort: (b) => {
        const info = axleTyresDue(b)
        return Math.max(info.frontPct, info.rearPct)
      },
      render: (b) => {
        const info = axleTyresDue(b)
        const fPct = Math.round(info.frontPct * 100)
        const rPct = Math.round(info.rearPct * 100)
        const lowP = b.tyrePressure === 'low'
        const alert = info.frontDue || info.rearDue || lowP || fPct >= 90 || rPct >= 90
        const warn = fPct >= 75 || rPct >= 75
        return (
          <span
            className={alert ? 'bad' : warn ? 'warn' : 'dim'}
            title={`Front: ${Math.round(info.frontKm / 1000)}k / ${Math.round(info.frontLife / 1000)}k (${b.frontBrand ?? 'oem'}) · Rear: ${Math.round(info.rearKm / 1000)}k / ${Math.round(info.rearLife / 1000)}k (${b.rearBrand ?? 'oem'})${lowP ? ' · LOW PRESSURE' : ''}`}
          >
            {fPct}% / {rPct}%{lowP ? ' (low)' : ''}
          </span>
        )
      },
    },
    {
      key: 'docs', label: 'Docs', sort: (b) => {
        const puc = b.pucExpiryDay ?? (s.day + 180)
        const roadDue = (b.roadTaxPayableDay ?? (s.day + 365)) + 30
        return Math.min(b.insuranceExpiryDay, b.fitnessExpiryDay, puc, roadDue)
      },
      render: (b) => {
        const puc = b.pucExpiryDay ?? (s.day + 180)
        const roadDue = (b.roadTaxPayableDay ?? (s.day + 365)) + 30
        const isFitnessFailed = !!b.fitnessFailed
        const isImpounded = b.impoundUntilDay !== undefined && b.impoundUntilDay > s.day
        const worst = Math.min(b.insuranceExpiryDay, b.fitnessExpiryDay, puc, roadDue) - s.day
        if (isImpounded) return <span className="bad" title={`Impounded until day ${b.impoundUntilDay}`}>IMPOUNDED</span>
        if (isFitnessFailed) return <span className="bad" title="Failed RTO fitness inspection">FIT FAILED</span>
        if (worst < 0) return <span className="bad" title="Expired papers">EXPIRED</span>
        if (worst <= 7) return <span className="bad" title="Expiring soon - immediate renewal required">{worst}d left</span>
        if (worst < 15) return <span className="warn" title="Expiring soon">{worst}d left</span>
        return <span className="dim">ok</span>
      },
    },
    {
      key: 'sched', label: 'Schedule', sort: (b) => (b.scheduleId ? 1 : 0),
      render: (b) => {
        if (b.coveringBusId) {
          const line = s.buses[b.coveringBusId]
          const sch = b.scheduleId ? s.schedules[b.scheduleId] : undefined
          const isFest = sch && (sch.festivalOnly || sch.outboundDuty === 'festival' || sch.returnDuty === 'festival')
          return (
            <span className="info" title={line ? `Standing in for ${line.reg}` : 'Spare cover'}>
              spared{line ? ` · ${line.reg}` : ''}
              {sch ? (
                <span className="dim">
                  {' · '}
                  {isFest && <span title="Festival schedule" style={{ marginRight: 3 }}>🎉</span>}
                  {fmtClock(sch)} · {routeName(sch.routeId)}
                </span>
              ) : null}
            </span>
          )
        }
        if (!b.scheduleId) return <span className="warn">idle</span>
        const sch = s.schedules[b.scheduleId]
        if (!sch) return '—'
        const route = ROUTES[sch.routeId]
        const busIdx = sch.busIds.indexOf(b.id)
        const isMirror = busIdx === 1 && sch.paired && route
        const displayName = isMirror
          ? `${cityName(route.to)} — ${cityName(route.from)}`
          : routeName(sch.routeId)
        const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
        const isMixedFest = sch.paired && (sch.outboundDuty === 'festival' || sch.returnDuty === 'festival')
        const isFest = sch.festivalOnly || sch.outboundDuty === 'festival' || sch.returnDuty === 'festival'
        const fest = festivalEffect(s.day)
        const festTitle = isAllFest
          ? (fest.name ? `Festival schedule (${fest.name} active today)` : 'Seasonal festival schedule (runs on festival dates)')
          : isMixedFest
          ? (sch.outboundDuty === 'festival' ? 'Seasonal 1st + daily 2nd' : 'Daily 1st + seasonal 2nd')
          : 'Festival schedule'
        return (
          <span title={isFest ? festTitle : undefined}>
            {isFest && <span style={{ marginRight: 4 }} title={festTitle}>🎉</span>}
            {fmtClock(sch)} · {displayName}
          </span>
        )
      },
    },
    {
      key: 'crew', label: 'Crew', sort: (b) => crewOnBus(s, b.id, 'driver').length,
      render: (b) => {
        if (b.ownership === 'attached') return <span className="dim">owner</span>
        if (!canCrewBus(b)) return <span className="warn">—</span>
        const need = crewLimit(s, b, 'driver')
        const needCond = crewLimit(s, b, 'conductor')
        const drv = crewOnBus(s, b.id, 'driver').length
        const cond = crewOnBus(s, b.id, 'conductor').length
        const short = crewShort(s, b)
        const drvMismatch = drv !== need
        const condMismatch = cond !== needCond
        const mismatch = drvMismatch || condMismatch
        return (
          <span className={short || drvMismatch ? 'bad' : mismatch ? 'warn' : 'good'}>
            {drv}/{need} drv · {cond}/{needCond} cond
            {mismatch && (
              <span
                className={drvMismatch ? 'bad' : 'warn'}
                title={drvMismatch ? 'Driver assignment differs from required' : 'Conductor assignment differs from required'}
                aria-label="crew mismatch"
              > ⚠</span>
            )}
          </span>
        )
      },
    },
    {
      key: 'clean', label: 'Clean', num: true, sort: (b) => b.busCleanliness ?? 85,
      render: (b) => {
        const c = Math.round(b.busCleanliness ?? 85)
        return <span className={c >= 70 ? 'good' : c >= 40 ? 'warn' : 'bad'}>{c}/100</span>
      },
    },
    {
      key: 'status', label: 'Status', sort: (b) => b.status,
      render: (b) => {
        const detail = busStatusDetail(b, s.day)
        const label = detail ? `${b.status} (${detail})` : b.status
        return b.status === 'active'
          ? <span className="good">active</span>
          : b.status === 'workshop'
            ? <span className="warn">{label}</span>
            : <span className="info">{label}</span>
      },
    },
    { key: 'pl', label: 'Life P&L', num: true, sort: (b) => b.lifeRevenue - b.lifeCost, render: (b) => <M v={b.lifeRevenue - b.lifeCost} colored /> },
  ]

  return (
    <>
      <div className="page-title">
        Fleet
        <span className="sub">
          click a row to inspect, repair, and assign crew
        </span>
        <span className="spacer" />

        {/* Bus Count & Detailed Summary Tooltip on the right */}
        <span
          className="fleet-count-tip"
          tabIndex={0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 12,
            marginRight: 8,
            cursor: 'help',
          }}
          aria-label={`Fleet stats: ${tableStats.total} buses. Owned ${tableStats.owned}, leased ${tableStats.leased}, attached ${tableStats.attached}`}
        >
          <span style={{ fontWeight: 600 }}>{tableStats.total}</span>
          <span className="dim">
            {busFilter.trim()
              ? `of ${allBuses.length} buses`
              : uiPrefs.fleetGroupId !== 'all'
              ? 'buses (filtered)'
              : 'buses'}
          </span>
          <span className="dim small" style={{ fontSize: 10 }}>ⓘ</span>

          <span
            className="fleet-count-tip__pop"
            role="tooltip"
            style={{
              right: 0,
              left: 'auto',
              minWidth: 220,
              padding: '10px 12px',
              borderRadius: 6,
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Fleet Summary</span>
              <span className="dim small">
                {uiPrefs.fleetGroupId === 'all'
                  ? 'All Brands'
                  : uiPrefs.fleetGroupId === 'none'
                  ? 'Unassigned'
                  : s.groups?.[uiPrefs.fleetGroupId]?.code ?? 'Brand'}
              </span>
            </div>

            {/* Ownership based on current table filter */}
            <div style={{ marginBottom: 6 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', fontSize: 10, marginBottom: 2 }}>Ownership</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Owned:</span>
                <b>{tableStats.owned}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Leased:</span>
                <b>{tableStats.leased}</b>
              </div>
              {tableStats.attached > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">Attached:</span>
                  <b>{tableStats.attached}</b>
                </div>
              )}
            </div>

            {/* Breakdown by Model */}
            <div style={{ marginBottom: 6, borderTop: '1px solid var(--border)', paddingTop: 5 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', fontSize: 10, marginBottom: 2 }}>By Model</div>
              {tableStats.modelCounts.length === 0 ? (
                <div className="dim small">No buses</div>
              ) : (
                tableStats.modelCounts.map(([mid, count]) => (
                  <div key={mid} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span className="dim">{modelTitleById(mid)}</span>
                    <b>{count}</b>
                  </div>
                ))
              )}
            </div>

            {/* Operational Health & Activity */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 5, fontSize: 11 }}>
              <div className="dim small" style={{ textTransform: 'uppercase', fontSize: 10, marginBottom: 2 }}>Operations</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Active:</span>
                <b className="good">{tableStats.active}</b>
              </div>
              {tableStats.workshop > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">In Workshop:</span>
                  <b className="warn">{tableStats.workshop}</b>
                </div>
              )}
              {tableStats.idle > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">Idle (No Sched):</span>
                  <b className="warn">{tableStats.idle}</b>
                </div>
              )}
              {tableStats.docsAttention > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">Docs Attention:</span>
                  <b className="bad">{tableStats.docsAttention}</b>
                </div>
              )}
              {tableStats.tyresAttention > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">Tyres Attention:</span>
                  <b className="bad">{tableStats.tyresAttention}</b>
                </div>
              )}
              {tableStats.odoAttention > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="dim">High Odometer:</span>
                  <b className="warn">{tableStats.odoAttention}</b>
                </div>
              )}
            </div>
          </span>
        </span>

        <select
          value={uiPrefs.fleetGroupId}
          onChange={(e) => setFleetGroupFilter(e.target.value as any)}
          style={{ width: 220, minWidth: 200, marginRight: 8 }}
          aria-label="Filter by brand"
        >
          <option value="all">All Brands</option>
          {activeBrandList.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code} - {g.name}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </select>
        <input
          type="search"
          placeholder="Filter by bus no…"
          value={busFilter}
          onChange={(e) => setBusFilter(e.target.value)}
          style={{ width: 160 }}
          aria-label="Filter by bus number"
        />
        {busFilter.trim() && (
          <button className="small" onClick={() => setBusFilter('')}>clear</button>
        )}
      </div>
      <Panel flat>
        <DataTable
          cols={cols}
          rows={buses}
          rowKey={(b) => b.id}
          onRowClick={(b) => nav(`/fleet/${b.id}`)}
          initialSort="pl"
          persistKey="fleet"
          empty={busFilter.trim() ? 'No bus matches that number.' : 'No buses yet - go to Market (3).'}
        />
      </Panel>
      {s.busOrders.length > 0 && (
        <Panel title="On order">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th>Brand</th>
                <th className="num">Price</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {s.busOrders.map((o) => {
                const grp = o.groupId && s.groups ? s.groups[o.groupId] : undefined
                return (
                  <tr key={o.id}>
                    <td>{modelTitleById(o.modelId)}</td>
                    <td>
                      {grp ? (
                        <span className="flex" style={{ alignItems: 'center', gap: 6 }}>
                          <GroupBadge group={grp} />
                          <span className="dim small">{grp.name}</span>
                        </span>
                      ) : (
                        <span className="dim">Unassigned</span>
                      )}
                    </td>
                    <td className="num"><M v={o.price} /></td>
                    <td className="dim">delivery in {o.deliveryDay - s.day} days</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  )
}
