import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import {
  ROUTE_LIST,
  RIVALS,
  routeName,
  displayRouteHours,
  haulTitle,
  haulBriefFor,
  routeViaLabel,
  routeViaNames,
  routeMatchesCategory,
  routeMatchesHours,
  canonicalRouteId,
  type RouteCategory,
} from '../../engine/data/routes'
import { RIVALS_DATA, seedRouteShare } from '../../engine/data/rivals'
import { calculateRoutePlayerShare } from '../../engine/sim/rivals'
import { getCorridorStance, isTripFrontRun, personalityOf, rivalMemory } from '../../engine/sim/rivalIntelligence'
import { BAL } from '../../engine/data/balance'
import { fmtCompact } from '../../engine/core/money'
import { statesOnRoute } from '../../engine/sim/schedules'
import { cargoPermitActive } from '../../engine/sim/cargo'
import { cityName } from '../../engine/data/cities'
import type { GameState, Permit, CorridorStance, RouteDef } from '../../engine/types'
import { Empty, M, Modal, Panel, PageHeader, GroupBadge } from '../bits'
import { BrandOptions } from '../BrandOptions'

function getPermitForRoute(s: GameState, routeId: string): Permit | undefined {
  return (
    s.permits[routeId] ??
    s.permits[canonicalRouteId(routeId)] ??
    Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canonicalRouteId(routeId))
  )
}

type SortCol = 'name' | 'states' | 'km' | 'hours' | 'fare' | 'demand' | 'permit'

export function RoutesPage() {
  const s = useDeferredGameState()!
  const g = useGameActions()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<RouteCategory>('all')
  const [hoursFilter, setHoursFilter] = useState<string>('all')
  const [scheduleFilter, setScheduleFilter] = useState<'all' | 'scheduled' | 'unscheduled'>('all')
  const [permitFilter, setPermitFilter] = useState<'all' | 'active_applied' | 'active' | 'applied' | 'available' | 'cargo' | 'threats'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  /** 'all', 'none' (unassigned services) or a brand id. */
  const [brandFilter, setBrandFilter] = useState<string>('all')
  /** 'all' or a state name: corridors starting or ending in it. */
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [selectedIntelRoute, setSelectedIntelRoute] = useState<RouteDef | null>(null)

  // Sorting: defaults to alphabetical (A-Z) by corridor name
  const [sortCol, setSortCol] = useState<SortCol | null>('name')
  const [sortAsc, setSortAsc] = useState<boolean>(true)

  const requestDiscontinue = (routeId: string, status: 'active' | 'applied') => {
    if (status === 'applied') {
      g.discontinueRoute(routeId)
      setConfirmId(null)
      return
    }
    if (confirmId === routeId) {
      g.discontinueRoute(routeId)
      setConfirmId(null)
      return
    }
    setConfirmId(routeId)
  }

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      if (sortAsc) {
        setSortAsc(false)
      } else {
        // Reset to default sort (active permits first)
        setSortCol(null)
        setSortAsc(true)
      }
    } else {
      setSortCol(col)
      const isNum = col === 'km' || col === 'hours' || col === 'fare' || col === 'demand'
      setSortAsc(!isNum)
    }
  }

  const renderSortArrow = (col: SortCol) => {
    if (sortCol !== col) return <span className="dim faint" style={{ fontSize: 10, marginLeft: 3 }}>↕</span>
    return <span className="accent" style={{ fontSize: 10, marginLeft: 3 }}>{sortAsc ? '▲' : '▼'}</span>
  }

  // Category & Permit counts
  const countAll = ROUTE_LIST.length
  const countInterstate = ROUTE_LIST.filter((r) => routeMatchesCategory(r, 'interstate')).length
  const countSouthState = ROUTE_LIST.filter((r) => routeMatchesCategory(r, 'south_state')).length
  const countNorth = ROUTE_LIST.filter((r) => routeMatchesCategory(r, 'north')).length
  const countActivePermits = ROUTE_LIST.filter((r) => getPermitForRoute(s, r.id)?.status === 'active').length
  const countAppliedPermits = ROUTE_LIST.filter((r) => getPermitForRoute(s, r.id)?.status === 'applied').length
  const countActiveOrApplied = ROUTE_LIST.filter((r) => {
    const p = getPermitForRoute(s, r.id)
    return p?.status === 'active' || p?.status === 'applied'
  }).length
  const countThreats = ROUTE_LIST.filter((r) => {
    const canon = canonicalRouteId(r.id)
    return Boolean(s.world.rivalActions?.[r.id] || s.world.rivalActions?.[canon])
  }).length

  const scheduledRouteIds = new Set(
    Object.values(s.schedules).map((sch) => canonicalRouteId(sch.routeId)),
  )
  const countScheduled = ROUTE_LIST.filter((r) => scheduledRouteIds.has(canonicalRouteId(r.id))).length

  // Services per brand on each corridor ('' = unassigned).
  const brandsByRoute = new Map<string, Map<string, number>>()
  for (const sch of Object.values(s.schedules)) {
    const key = canonicalRouteId(sch.routeId)
    let m = brandsByRoute.get(key)
    if (!m) {
      m = new Map()
      brandsByRoute.set(key, m)
    }
    const gid = sch.groupId ?? ''
    m.set(gid, (m.get(gid) ?? 0) + 1)
  }
  const countUnscheduled = ROUTE_LIST.length - countScheduled

  // Every state a corridor starts or ends in, with how many corridors touch it.
  const stateCounts = new Map<string, number>()
  for (const r of ROUTE_LIST) {
    for (const st of statesOnRoute(r)) stateCounts.set(st, (stateCounts.get(st) ?? 0) + 1)
  }
  const allStates = [...stateCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  // 1. Filter routes
  const filteredRoutes = ROUTE_LIST.filter((r) => {
    if (!routeMatchesCategory(r, categoryFilter)) return false
    if (!routeMatchesHours(r, hoursFilter)) return false

    const hasSchedule = scheduledRouteIds.has(canonicalRouteId(r.id))
    if (scheduleFilter === 'scheduled' && !hasSchedule) return false
    if (stateFilter !== 'all' && !statesOnRoute(r).includes(stateFilter)) return false
    if (brandFilter !== 'all') {
      const brands = brandsByRoute.get(canonicalRouteId(r.id))
      if (!brands?.has(brandFilter === 'none' ? '' : brandFilter)) return false
    }
    if (scheduleFilter === 'unscheduled' && hasSchedule) return false

    const permit = getPermitForRoute(s, r.id)
    const locked = s.company.reputation < r.unlockRep
    if (permitFilter === 'active_applied' && permit?.status !== 'active' && permit?.status !== 'applied') return false
    if (permitFilter === 'active' && permit?.status !== 'active') return false
    if (permitFilter === 'applied' && permit?.status !== 'applied') return false
    if (permitFilter === 'available' && (permit || locked)) return false
    if (permitFilter === 'cargo' && !cargoPermitActive(s, r.id)) return false
    if (permitFilter === 'threats') {
      const canon = canonicalRouteId(r.id)
      if (!s.world.rivalActions?.[r.id] && !s.world.rivalActions?.[canon]) return false
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const name = routeName(r.id).toLowerCase()
      const notes = (r.notes ?? '').toLowerCase()
      const rivals = (RIVALS[r.id] ?? []).join(' ').toLowerCase()
      const states = statesOnRoute(r).join(' ').toLowerCase()
      const via = routeViaNames(r.id).join(' ').toLowerCase()
      if (
        !name.includes(q) &&
        !notes.includes(q) &&
        !rivals.includes(q) &&
        !states.includes(q) &&
        !via.includes(q) &&
        !haulTitle(r).toLowerCase().includes(q) &&
        !r.id.toLowerCase().includes(q)
      ) {
        return false
      }
    }

    return true
  })

  // 2. Sort routes: default sorts active permits to top
  const sortedRoutes = [...filteredRoutes].sort((a, b) => {
    if (sortCol === null) {
      // Default: Active permits on top!
      const aPermit = getPermitForRoute(s, a.id)
      const bPermit = getPermitForRoute(s, b.id)
      const aActive = aPermit?.status === 'active' ? 1 : 0
      const bActive = bPermit?.status === 'active' ? 1 : 0
      if (aActive !== bActive) return bActive - aActive

      // Then applied permits
      const aApplied = aPermit?.status === 'applied' ? 1 : 0
      const bApplied = bPermit?.status === 'applied' ? 1 : 0
      if (aApplied !== bApplied) return bApplied - aApplied

      // For active permits, schedule count descending
      if (aActive && bActive) {
        const aSch = Object.values(s.schedules).filter((sc) => canonicalRouteId(sc.routeId) === canonicalRouteId(a.id)).length
        const bSch = Object.values(s.schedules).filter((sc) => canonicalRouteId(sc.routeId) === canonicalRouteId(b.id)).length
        if (aSch !== bSch) return bSch - aSch
      }

      // Then corridors player has reputation unlocked
      const aCan = s.company.reputation >= a.unlockRep ? 1 : 0
      const bCan = s.company.reputation >= b.unlockRep ? 1 : 0
      if (aCan !== bCan) return bCan - aCan

      if (a.unlockRep !== b.unlockRep) return a.unlockRep - b.unlockRep
      return b.baseDemand - a.baseDemand
    }

    // Custom column sort
    let cmp = 0
    if (sortCol === 'name') {
      cmp = routeName(a.id).localeCompare(routeName(b.id))
    } else if (sortCol === 'states') {
      cmp = statesOnRoute(a).join(', ').localeCompare(statesOnRoute(b).join(', '))
    } else if (sortCol === 'km') {
      cmp = a.km - b.km
    } else if (sortCol === 'hours') {
      cmp = displayRouteHours(a.hours) - displayRouteHours(b.hours)
    } else if (sortCol === 'fare') {
      const idxA = s.world.fareIndex[a.id] ?? 1
      const idxB = s.world.fareIndex[b.id] ?? 1
      cmp = a.marketFareAC * idxA - b.marketFareAC * idxB
    } else if (sortCol === 'demand') {
      cmp = a.baseDemand - b.baseDemand
    } else if (sortCol === 'permit') {
      const aPermit = getPermitForRoute(s, a.id)
      const bPermit = getPermitForRoute(s, b.id)
      const pA = aPermit?.status === 'active' ? 2 : aPermit?.status === 'applied' ? 1 : 0
      const pB = bPermit?.status === 'active' ? 2 : bPermit?.status === 'applied' ? 1 : 0
      cmp = pA - pB
    }

    return sortAsc ? cmp : -cmp
  })

  return (
    <>
      <PageHeader title="Routes" facts={<>reputation {Math.round(s.company.reputation)}/100</>} factsTip={`Permit fee ${fmtCompact(BAL.routePermitFee)}, approval 2-4 weeks. Cargo licence from ${fmtCompact(BAL.cargoPermitBaseFee)}/yr + ${fmtCompact(BAL.cargoPermitPerKmFee)}/km.`} />

      <Panel
        flat
        title="Corridors"
        info="Discontinue surrenders the permit and closes every schedule on that corridor (buses freed, open tickets refunded). Re-apply later at the full permit fee. Withdraw cancels a pending application (fee kept by the RTO). The cargo licence is a separate one-year goods permit on a corridor: freight contracts are invited only on licensed corridors, and closing it ends those contracts."
      >
        {/* Filter Bar Row 1: Category / Region Buttons + Search */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={`small ${categoryFilter === 'all' && permitFilter === 'all' ? 'primary' : ''}`}
              onClick={() => { setCategoryFilter('all'); setPermitFilter('all') }}
            >
              All Corridors ({countAll})
            </button>
            <button
              className={`small ${categoryFilter === 'interstate' ? 'primary' : ''}`}
              onClick={() => setCategoryFilter('interstate')}
              title="Corridors crossing state boundaries (AITP required)"
            >
              ⇄ Inter-State ({countInterstate})
            </button>
            <button
              className={`small ${categoryFilter === 'south_state' ? 'primary' : ''}`}
              onClick={() => setCategoryFilter('south_state')}
              title="Intra-state corridors within South India (Tamil Nadu, Karnataka, Kerala, AP)"
            >
              South State ({countSouthState})
            </button>
            <button
              className={`small ${categoryFilter === 'north' ? 'primary' : ''}`}
              onClick={() => setCategoryFilter('north')}
              title="Northern & Western corridors (Delhi NCR, Punjab, UP, Rajasthan, Gujarat, Maharashtra)"
            >
              ▲ North & West ({countNorth})
            </button>

            <span style={{ display: 'inline-block', width: 1, height: 16, background: 'var(--border)', margin: '0 4px', alignSelf: 'center' }} />

            <button
              className={`small ${permitFilter === 'active_applied' ? 'primary' : ''}`}
              onClick={() => setPermitFilter(permitFilter === 'active_applied' ? 'all' : 'active_applied')}
              title="Show corridors with either active or applied permits"
            >
              Active & Applied ({countActiveOrApplied})
            </button>
            <button
              className={`small ${permitFilter === 'active' ? 'primary' : ''}`}
              onClick={() => setPermitFilter(permitFilter === 'active' ? 'all' : 'active')}
              title="Show corridors with active operational permits"
            >
              Active ({countActivePermits})
            </button>
            <button
              className={`small ${permitFilter === 'applied' ? 'primary' : ''}`}
              onClick={() => setPermitFilter(permitFilter === 'applied' ? 'all' : 'applied')}
              title="Show corridors with pending permit applications"
            >
              ⏳ Applied ({countAppliedPermits})
            </button>
            <button
              className={`small ${permitFilter === 'threats' ? 'primary' : ''}`}
              onClick={() => setPermitFilter(permitFilter === 'threats' ? 'all' : 'threats')}
              title="Corridors facing active rival predatory timing or price wars"
              style={{
                color: countThreats > 0 && permitFilter !== 'threats' ? '#fbbf24' : undefined,
                fontWeight: countThreats > 0 ? 600 : undefined,
              }}
            >
              ⚔️ Rival Moves ({countThreats})
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search corridor, city, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 220, fontSize: 11, padding: '3px 8px' }}
            />
            {searchQuery && (
              <button className="small" onClick={() => setSearchQuery('')} title="Clear search">✕</button>
            )}
          </div>
        </div>

        {/* Filter Bar Row 2: Travel Hours + Permit Filter + Summary */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            marginBottom: 14,
            fontSize: 12,
            background: 'var(--bg2)',
            padding: '6px 10px',
            borderRadius: 2,
            border: '1px solid var(--border)',
          }}
        >
          <div className="row gap6">
            <span className="dim">Travel hours:</span>
            <select
              value={hoursFilter}
              onChange={(e) => setHoursFilter(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px' }}
              title={[
                haulBriefFor('mid'),
                haulBriefFor('overnight'),
                haulBriefFor('marathon'),
                haulBriefFor('ultra'),
              ].join('\n\n')}
            >
              <option value="all">All Durations</option>
              <option value="6-8" title={haulBriefFor('mid')}>Mid-haul (6 – 8 hrs)</option>
              <option value="8-10" title={haulBriefFor('overnight')}>Night haul (8 – 10 hrs)</option>
              <option value="10-16" title={haulBriefFor('marathon')}>Marathon night haul (10 – 16 hrs)</option>
              <option value=">16" title={haulBriefFor('ultra')}>Ultra marathon (&gt; 16 hrs)</option>
            </select>
          </div>

          <div className="row gap6">
            <span className="dim">Schedule:</span>
            <select
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value as 'all' | 'scheduled' | 'unscheduled')}
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              <option value="all">All Routes</option>
              <option value="scheduled">Scheduled ({countScheduled})</option>
              <option value="unscheduled">Not scheduled ({countUnscheduled})</option>
            </select>
          </div>

          <div className="row gap6">
            <span className="dim">State:</span>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px' }}
              title="Corridors that start or end in this state"
            >
              <option value="all">All States</option>
              {allStates.map(([state, n]) => (
                <option key={state} value={state}>{state} ({n})</option>
              ))}
            </select>
          </div>

          <div className="row gap6">
            <span className="dim">Brand:</span>
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px' }}
              title="Corridors where this brand runs at least one service"
            >
              <option value="all">All Brands</option>
              <BrandOptions s={s} />
              <option value="none">Unassigned</option>
            </select>
          </div>

          <div className="row gap6">
            <span className="dim">Permit status:</span>
            <select
              value={permitFilter}
              onChange={(e) => setPermitFilter(e.target.value as any)}
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              <option value="all">All Statuses</option>
              <option value="active_applied">Active & Applied ({countActiveOrApplied})</option>
              <option value="active">Active Permits Only ({countActivePermits})</option>
              <option value="applied">Applied (Pending) Only ({countAppliedPermits})</option>
              <option value="available">Available to Apply</option>
              <option value="cargo">Cargo licensed only</option>
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="dim small">
              Showing <b>{sortedRoutes.length}</b> of {ROUTE_LIST.length} corridors
              {sortCol ? ` · Sorted by ${sortCol} (${sortAsc ? 'asc' : 'desc'})` : ' · Active permits defaulted to top'}
            </span>
            {(categoryFilter !== 'all' || hoursFilter !== 'all' || scheduleFilter !== 'all' || stateFilter !== 'all' || brandFilter !== 'all' || permitFilter !== 'all' || searchQuery || sortCol !== 'name') && (
              <button
                className="small"
                onClick={() => {
                  setCategoryFilter('all')
                  setHoursFilter('all')
                  setScheduleFilter('all')
                  setBrandFilter('all')
                  setStateFilter('all')
                  setPermitFilter('all')
                  setSearchQuery('')
                  setSortCol('name')
                  setSortAsc(true)
                }}
                title="Reset all filters and sort to default"
              >
                Reset filters & sort
              </button>
            )}
          </div>
        </div>

        <div className="xscroll">
        <table className="data" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>
                Corridor {renderSortArrow('name')}
              </th>
              <th title="Brands running services on this corridor (× number of services)">Brands</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('states')}>
                States · papers {renderSortArrow('states')}
              </th>
              <th className="num nowrap">
                <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('km')}>Km {renderSortArrow('km')}</span>
                {' · '}
                <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('hours')}>h {renderSortArrow('hours')}</span>
              </th>
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('demand')}>
                Pax/day {renderSortArrow('demand')}
              </th>
              <th>Competitors & Share</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('permit')}>
                Permit {renderSortArrow('permit')}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedRoutes.map((r) => {
              const permit = getPermitForRoute(s, r.id)
              const locked = s.company.reputation < r.unlockRep
              const rivalAction = s.world.rivalActions?.[r.id] ?? s.world.rivalActions?.[canonicalRouteId(r.id)]
              const schCount = Object.values(s.schedules).filter((sch) => canonicalRouteId(sch.routeId) === canonicalRouteId(r.id)).length

              return (
                <tr
                  key={r.id}
                  style={{
                    background: permit?.status === 'active'
                      ? 'rgba(76, 195, 138, 0.04)'
                      : permit?.status === 'applied'
                      ? 'rgba(217, 177, 59, 0.04)'
                      : undefined,
                  }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span
                        className="accent bold"
                        title={routeViaLabel(r.id) || undefined}
                      >
                        {routeName(r.id)}
                      </span>
                      {r.ghat && <span className="warn" title="Ghat sections: hairpin curves, monsoon risk"> ⛰</span>}
                      {(() => {
                        const fromLounge = (s.company.lounges ?? []).find((l) => l.cityId === r.from)
                        const toLounge = (s.company.lounges ?? []).find((l) => l.cityId === r.to)
                        if (!fromLounge && !toLounge) return null
                        const title = [
                          fromLounge && `Lounge in ${cityName(r.from)} (Tier ${fromLounge.tier})`,
                          toLounge && `Lounge in ${cityName(r.to)} (Tier ${toLounge.tier})`,
                        ].filter(Boolean).join(' · ')
                        return (
                          <Link to="/lounges" title={title} aria-label={title} style={{ textDecoration: 'none' }}>
                            🛋
                          </Link>
                        )
                      })()}
                    </div>
                    {r.notes && <div className="small faint">{r.notes}</div>}
                    {routeViaNames(r.id).length > 0 && (
                      <div className="small">
                        <span className="dim">via </span>
                        <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>{routeViaNames(r.id).join(', ')}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const brands = brandsByRoute.get(canonicalRouteId(r.id))
                      if (!brands || brands.size === 0) return <span className="faint">—</span>
                      return (
                        <span className="flex" style={{ gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                          {[...brands.entries()]
                            .sort((a, b) => b[1] - a[1])
                            .map(([gid, n]) => {
                              const grp = gid ? s.groups?.[gid] : undefined
                              return (
                                <span key={gid || 'none'} className="nowrap" title={`${grp?.name ?? 'Unassigned'}: ${n} service${n === 1 ? '' : 's'}`}>
                                  {grp ? <GroupBadge group={grp} /> : <span className="pill small dim">none</span>}
                                  {n > 1 && <span className="dim small">×{n}</span>}
                                </span>
                              )
                            })}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="small">
                    {statesOnRoute(r).join(', ')}
                    <div className="dim">{r.interstate ? 'AITP' : 'State carriage'}</div>
                  </td>
                  <td className="num nowrap" style={{ verticalAlign: 'middle' }}>
                    <div>
                      {r.km} <span className="dim">·</span> <b>{displayRouteHours(r.hours)}h</b>
                    </div>
                  </td>
                  <td className="num" style={{ verticalAlign: 'middle' }}>
                    <div className="dim small">{r.baseDemand.toLocaleString()} pax</div>
                    <div className="small">
                      <span className={r.competition > 0.8 ? 'bad' : r.competition > 0.65 ? 'warn' : 'good'}>
                        {r.competition > 0.8 ? 'brutal' : r.competition > 0.65 ? 'heavy' : 'moderate'}
                      </span>
                      {r.railCompetition > 0.55 && <span className="dim"> +rail</span>}
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const permit = getPermitForRoute(s, r.id)
                      const hasActivePermit = permit?.status === 'active'
                      const capInfo = calculateRoutePlayerShare(s, r.id)
                      const share = s.world.share?.[r.id] ?? (permit?.routeId ? s.world.share?.[permit.routeId] : undefined)

                      // Player market share is 0 if no active permit!
                      const pShare = hasActivePermit
                        ? (capInfo.dailySeats > 0 ? Math.max(capInfo.playerShare, share?.player ?? 0) : (share?.player ?? 0))
                        : 0

                      return (
                        <div>
                          <div
                            className={`small ${pShare > 0 ? 'good' : 'dim'}`}
                            style={{ fontWeight: 600 }}
                            title={
                              pShare > 0
                                ? `${pShare}% corridor market share (${capInfo.dailySeats > 0 ? `${capInfo.dailySeats} seats/day assigned` : 'takeover rights acquired'})`
                                : hasActivePermit
                                ? '0% market share (no buses assigned to schedule yet)'
                                : '0% market share (no route permit)'
                            }
                          >
                            You {pShare}%{capInfo.dailySeats > 0 ? ` · ${capInfo.dailySeats} seats/day` : ''}
                          </div>
                          {rivalAction && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                className="small warn"
                                style={{
                                  fontSize: '0.70rem',
                                  padding: '1px 6px',
                                  fontWeight: 600,
                                  background: 'rgba(245, 158, 11, 0.15)',
                                  border: '1px solid rgba(245, 158, 11, 0.4)',
                                  color: '#fbbf24',
                                  cursor: 'pointer',
                                }}
                                onClick={() => setSelectedIntelRoute(r)}
                                title="Click to view predatory timing, rival counter-clocks & choose counter-strategy"
                              >
                                ⚔️ {rivalAction.rivalName}: {rivalAction.tactic === 'predatory_timing' ? 'Front-Run' : 'Price War'} ({rivalAction.untilDay - s.day}d)
                              </button>
                            </div>
                          )}
                          {hasActivePermit && (
                            <div style={{ marginTop: 3 }}>
                              <button
                                className="small"
                                style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 5px',
                                  background: 'var(--bg3)',
                                  border: '1px solid var(--border)',
                                  cursor: 'pointer',
                                }}
                                onClick={() => setSelectedIntelRoute(r)}
                                title="Configure strategic corridor counter-posture"
                              >
                                Stance: {getCorridorStance(s, r.id)} 
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td style={{ verticalAlign: 'middle' }}>
                    {permit?.status === 'active' && (
                      <div className="good">
                        active
                        {permit.expiryDay !== undefined && permit.expiryDay - s.day < 40 ? ` (renews ${permit.expiryDay - s.day}d)` : ''}
                      </div>
                    )}
                    {permit?.status === 'active' && schCount > 0 && <div className="dim">{schCount} sched</div>}
                    {permit?.status === 'applied' && <span className="warn">applied ({s.day - permit.appliedDay}d ago)</span>}
                    {!permit && (locked ? <span className="dim">rep {r.unlockRep}+ needed</span> : <span className="dim">none</span>)}
                  </td>
                  <td className="num nowrap">
                    <div className="flex" style={{ justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                      {!permit && !locked && (
                        <button className="small" onClick={() => g.applyForPermit(r.id)}>apply annual</button>
                      )}
                      {permit?.status === 'applied' && (
                        <button
                          className="small"
                          title="Withdraw the pending application (fee not refunded)"
                          onClick={() => requestDiscontinue(permit.routeId || r.id, 'applied')}
                        >
                          withdraw annual
                        </button>
                      )}
                      {permit?.status === 'active' && (
                        <>
                          {permit.seasonal?.status === 'applied' && (
                            <button
                              className="small"
                              title="Withdraw seasonal permit application"
                              onClick={() => g.withdrawSeasonalPermit(permit.routeId || r.id)}
                            >
                              withdraw seasonal
                            </button>
                          )}
                          {(permit.seasonal?.status === 'expired' || (permit.seasonal?.status === 'active' && permit.seasonal.expiryDay !== undefined && permit.seasonal.expiryDay - s.day <= 14)) && (
                            <button
                              className="small"
                              title={`Renew seasonal permit (${fmtCompact(BAL.seasonalPermitRenewal)})`}
                              onClick={() => g.renewSeasonalPermit(permit.routeId || r.id)}
                            >
                              renew seasonal
                            </button>
                          )}
                          {!permit.seasonal && (
                            <button
                              className="small"
                              title={`Apply seasonal permit (${fmtCompact(BAL.seasonalPermitFee)})`}
                              onClick={() => g.applySeasonalPermit(permit.routeId || r.id)}
                            >
                              + seasonal
                            </button>
                          )}

                          {confirmId === r.id ? (
                            <span className="flex" style={{ gap: 4 }}>
                              <button
                                className="small danger"
                                title={schCount > 0 ? `Closes ${schCount} schedule(s), refunds open tickets, frees buses` : 'Surrender permit'}
                                onClick={() => requestDiscontinue(permit.routeId || r.id, 'active')}
                              >
                                confirm stop
                              </button>
                              <button className="small" onClick={() => setConfirmId(null)}>cancel</button>
                            </span>
                          ) : (
                            <button
                              className="small danger"
                              title="Surrender permit — closes schedules on this corridor"
                              onClick={() => requestDiscontinue(permit.routeId || r.id, 'active')}
                            >
                              discontinue
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </Panel>

      {selectedIntelRoute && (() => {
        const r = selectedIntelRoute
        const canon = canonicalRouteId(r.id)
        const action = s.world.rivalActions?.[r.id] ?? s.world.rivalActions?.[canon]
        const currentStance = getCorridorStance(s, r.id)
        const activeSchs = Object.values(s.schedules).filter(
          (sc) => sc.active && (sc.routeId === r.id || canonicalRouteId(sc.routeId) === canon),
        )
        const rawRivals = RIVALS[r.id] ?? ['SRS Travels', 'KPN Travels', 'VRL Travels']

        const fr = BAL.market.frontRun
        const pct = (x: number) => Math.round((x - 1) * 100)
        const STANCES: { id: CorridorStance; title: string; effect: string; detail: string }[] = [
          { id: 'neutral', title: 'Neutral', effect: 'no counter-measures', detail: `Standard timetable and pricing. A rival front-running your departure gains +${pct(fr.uncounteredRival)}% appeal and takes shoppers.` },
          { id: 'undercut', title: 'Undercut', effect: `match rival fares · +${pct(fr.undercutLift)}% booking defense`, detail: 'Neutralises the rival front-runner at the cost of lower yield.' },
          { id: 'premium_hold', title: 'Premium hold', effect: 'keep fares · needs 4.0★ coach or Primo', detail: `Loyal high-yield passengers stay (+${pct(fr.premiumHoldLift)}%). Without a 4.0+ coach or Primo the rival gains +${pct(fr.premiumHoldWeakRival)}% appeal; a rival wave also ends 2 days sooner each week.` },
          { id: 'cargo_bundle', title: 'Cargo bundle', effect: '+30% parcel revenue on this route', detail: `Freight earnings subsidise passenger seats. The rival still front-runs (+${pct(fr.cargoBundleRival)}% appeal).` },
        ]
        const threat = action && action.untilDay >= s.day ? action : undefined

        return (
          <Modal title={`Rivals — ${routeName(r.id)}`} onClose={() => setSelectedIntelRoute(null)} wide>
            <div className="stack14">
              <div className="row gap wrap">
                <span className={`pill ${threat ? 'warn' : 'good'}`}>{threat ? 'Rival wave' : 'Stable'}</span>
                <span className="muted">{rawRivals.join(', ')}</span>
              </div>

              {threat && (
                <div className="panel">
                  <div className="panel-body" title={threat.details}>
                    <div className="row between mb8">
                      <b>{threat.headline}</b>
                      <span className="muted">{threat.intensity} · {threat.untilDay - s.day}d left</span>
                    </div>
                    <div className="row gap wrap muted">
                      <span>Rival <b>{threat.rivalName}</b></span>
                      <span>Fare cut <b className="warn">-{threat.fareDiscountPct}%</b></span>
                      {threat.addedDailySeats > 0 && <span>Extra seats <b className="warn">+{threat.addedDailySeats}/day</b></span>}
                      {threat.targetDepartureClocks.length > 0 && <span>Counter-departures <b>{threat.targetDepartureClocks.join(', ')}</b></span>}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="muted mb8" title="Fixed by market position, then shaped by what each rival has learned from fighting you. State operators do not attack.">Rivals</div>
                <table className="data">
                  <thead>
                    <tr><th>Operator</th><th>Style</th><th>Temper</th><th className="num">Grudge</th><th className="num">Attacks</th></tr>
                  </thead>
                  <tbody>
                    {rawRivals
                      .filter((n) => !n.includes('KSRTC') && !n.includes('TNSTC') && !n.includes('SETC'))
                      .map((n) => {
                        const p = personalityOf(s, n)
                        const m = rivalMemory(s, p.id)
                        return (
                          <tr key={n}>
                            <td><b>{n}</b></td>
                            <td>{p.style === 'price' ? 'price wars' : p.style === 'timing' ? 'front-running' : 'capacity floods'}</td>
                            <td className={p.aggression >= 0.65 ? 'bad' : p.aggression >= 0.4 ? 'warn' : 'good'}>{p.aggression >= 0.65 ? 'aggressive' : p.aggression >= 0.4 ? 'steady' : 'calm'}</td>
                            <td className="num">{Math.round(m.grudge * 100)}%</td>
                            <td className="num" title={`${m.defeats} failed, ${m.victories} worked`}>{m.actions}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="muted mb8" title="If you hold 35%+ share or run 4+ daily departures, top rivals launch front-running and price-war waves">Your stance</div>
                <div className="stack10">
                  {STANCES.map((st) => (
                    <label key={st.id} className="row gap" style={{ cursor: 'pointer' }} title={st.detail}>
                      <input
                        type="radio"
                        name="stance"
                        checked={currentStance === st.id}
                        onChange={() => g.setCorridorStance(r.id, st.id)}
                      />
                      <b className="bold">{st.title}</b>
                      <span className="muted">{st.effect}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="row between mb8">
                  <span className="muted">Departures ({activeSchs.length})</span>
                  <Link to="/schedules" className="small">Schedules ›</Link>
                </div>
                {activeSchs.length === 0 ? (
                  <Empty text="No schedules on this corridor." />
                ) : (
                  <table className="data">
                    <thead>
                      <tr><th>Departs</th><th>Type</th><th>Rival</th></tr>
                    </thead>
                    <tbody>
                      {activeSchs.map((sc) => {
                        const clock = `${String(sc.depHour).padStart(2, '0')}:${String(sc.depMin ?? 0).padStart(2, '0')}`
                        const fr = isTripFrontRun(s, r.id, sc.depHour, sc.depMin ?? 0)
                        return (
                          <tr key={sc.id}>
                            <td><b>{clock}</b></td>
                            <td className="muted">{sc.paired ? 'daily both ways' : 'one way'}</td>
                            <td>
                              {fr.frontRun
                                ? <span className="warn" title="Rival departs 15 minutes before you">front-run by {fr.rivalName} at {fr.rivalClock}</span>
                                : <span className="good" title="No rival departure within 20 minutes">clear</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </Modal>
        )
      })()}
    </>
  )
}
