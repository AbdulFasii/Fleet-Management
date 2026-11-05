import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import {
  ROUTE_LIST,
  RIVALS,
  routeName,
  displayRouteHours,
  getRouteCategory,
  haulTitle,
  haulBrief,
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
import { fmtDateShort } from '../../engine/core/calendar'
import { statesOnRoute } from '../../engine/sim/schedules'
import { cargoContractsOnCorridor, cargoLicence, cargoPermitActive, cargoPermitFee } from '../../engine/sim/cargo'
import { getLoungeDemandBoost } from '../../engine/sim/lounge'
import { cityName } from '../../engine/data/cities'
import type { GameState, Permit, CorridorStance, RouteDef } from '../../engine/types'
import { Empty, M, Modal, Panel, PageHeader } from '../bits'

function getPermitForRoute(s: GameState, routeId: string): Permit | undefined {
  return (
    s.permits[routeId] ??
    s.permits[canonicalRouteId(routeId)] ??
    Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canonicalRouteId(routeId))
  )
}

type SortCol = 'name' | 'states' | 'km' | 'hours' | 'fare' | 'demand' | 'permit'

export function RoutesPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmCargoId, setConfirmCargoId] = useState<string | null>(null)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<RouteCategory>('all')
  const [hoursFilter, setHoursFilter] = useState<string>('all')
  const [scheduleFilter, setScheduleFilter] = useState<'all' | 'scheduled' | 'unscheduled'>('all')
  const [permitFilter, setPermitFilter] = useState<'all' | 'active_applied' | 'active' | 'applied' | 'available' | 'cargo' | 'threats'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
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
  const countUnscheduled = ROUTE_LIST.length - countScheduled

  // 1. Filter routes
  const filteredRoutes = ROUTE_LIST.filter((r) => {
    if (!routeMatchesCategory(r, categoryFilter)) return false
    if (!routeMatchesHours(r, hoursFilter)) return false

    const hasSchedule = scheduledRouteIds.has(canonicalRouteId(r.id))
    if (scheduleFilter === 'scheduled' && !hasSchedule) return false
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
            >
              <option value="all">All Durations</option>
              <option value="<6">Day hop (&lt; 6 hrs)</option>
              <option value="6-8">Mid-haul (6 – 8 hrs)</option>
              <option value="8-10">Night haul (8 – 10 hrs)</option>
              <option value="10-16">Marathon night haul (10 – 16 hrs)</option>
              <option value=">16">Ultra marathon (&gt; 16 hrs)</option>
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
            {(categoryFilter !== 'all' || hoursFilter !== 'all' || scheduleFilter !== 'all' || permitFilter !== 'all' || searchQuery || sortCol !== 'name') && (
              <button
                className="small"
                onClick={() => {
                  setCategoryFilter('all')
                  setHoursFilter('all')
                  setScheduleFilter('all')
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
        <table className="data">
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>
                Corridor {renderSortArrow('name')}
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('states')}>
                States {renderSortArrow('states')}
              </th>
              <th>Papers</th>
              <th>Seasonal</th>
              <th>Cargo licence</th>
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('km')}>
                Km {renderSortArrow('km')}
              </th>
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('hours')}>
                Hours {renderSortArrow('hours')}
              </th>
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('fare')}>
                Mkt fare (AC slpr) {renderSortArrow('fare')}
              </th>
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('demand')}>
                Corridor pax/day {renderSortArrow('demand')}
              </th>
              <th>Competitors & Share</th>
              <th>Live effects</th>
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
              const closure = s.world.closures[r.id]
              const shock = s.world.demandShock[r.id]
              const war = s.world.priceWars[r.id]
              const rivalAction = s.world.rivalActions?.[r.id] ?? s.world.rivalActions?.[canonicalRouteId(r.id)]
              const idx = s.world.fareIndex[r.id] ?? 1
              const schCount = Object.values(s.schedules).filter((sch) => canonicalRouteId(sch.routeId) === canonicalRouteId(r.id)).length
              const cat = getRouteCategory(r)
              const cargoLicenceRow = cargoLicence(s, r.id)
              const cargoLicensed = cargoPermitActive(s, r.id)
              const cargoFee = cargoPermitFee(r)
              const cargoRenewalFee = cargoPermitFee(r, { renewal: true })
              const cargoLeft = cargoLicenceRow ? cargoLicenceRow.expiryDay - s.day : 0
              const liveCargoContracts = cargoContractsOnCorridor(s, r.id).length

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
                      <span className="accent bold">{routeName(r.id)}</span>
                      <span
                        className="pill small"
                        style={{ fontSize: 10, padding: '0 4px' }}
                        title={haulBrief(r)}
                      >
                        {haulTitle(r)}
                      </span>
                      {r.ghat && <span className="warn" title="Ghat sections: hairpin curves, monsoon risk"> ⛰</span>}
                      {cat === 'interstate' ? (
                        <span className="pill small" style={{ fontSize: 10, padding: '0 4px' }} title="Inter-state corridor (requires AITP)">⇄ Inter-State</span>
                      ) : cat === 'south_state' ? (
                        <span className="pill small" style={{ fontSize: 10, padding: '0 4px' }} title="South State internal corridor (State carriage)">South State</span>
                      ) : (
                        <span className="pill small" style={{ fontSize: 10, padding: '0 4px' }} title="Northern & Western corridor">▲ North</span>
                      )}
                      {(() => {
                        const fromLounge = (s.company.lounges ?? []).find((l) => l.cityId === r.from)
                        const toLounge = (s.company.lounges ?? []).find((l) => l.cityId === r.to)
                        if (!fromLounge && !toLounge) return null
                        return (
                          <>
                            {fromLounge && (
                              <Link
                                to="/lounges"
                                className="pill small"
                                style={{ fontSize: 10, padding: '0 4px', textDecoration: 'none' }}
                                title={`Boarding Lounge in ${cityName(r.from)} (Tier ${fromLounge.tier}) — passenger waiting & snacks boost booking conversion`}
                              >
                                {cityName(r.from)} Lounge (T{fromLounge.tier})
                              </Link>
                            )}
                            {toLounge && (
                              <Link
                                to="/lounges"
                                className="pill small"
                                style={{ fontSize: 10, padding: '0 4px', textDecoration: 'none' }}
                                title={`Boarding Lounge in ${cityName(r.to)} (Tier ${toLounge.tier}) — return booking boost`}
                              >
                                {cityName(r.to)} Lounge (T{toLounge.tier})
                              </Link>
                            )}
                          </>
                        )
                      })()}
                    </div>
                    <div className="small faint">{r.notes}</div>
                    {routeViaLabel(r.id) && (
                      <div className="small" style={{ color: 'var(--gray)' }} title="Cities this run passes through — all of them are already on our network">
                        {routeViaLabel(r.id)}
                      </div>
                    )}
                  </td>
                  <td className="small">{statesOnRoute(r).join(', ')}</td>
                  <td className="small">{r.interstate ? 'AITP' : 'State carriage'}</td>
                  <td className="small">
                    {permit?.seasonal?.status === 'active' && (
                      <span className="good">
                        Active until {fmtDateShort(permit.seasonal.expiryDay!)}
                      </span>
                    )}
                    {permit?.seasonal?.status === 'applied' && (
                      <span className="warn">applied ({s.day - permit.seasonal.appliedDay}d ago)</span>
                    )}
                    {permit?.seasonal?.status === 'expired' && (
                      <span className="bad">expired</span>
                    )}
                    {!permit?.seasonal && <span className="dim">none</span>}
                  </td>
                  <td className="small">
                    {cargoLicensed ? (
                      <span className="good">
                        licensed
                        {cargoLeft <= 45 && <span className="warn"> · renews in {cargoLeft}d</span>}
                      </span>
                    ) : cargoLicenceRow ? (
                      <span className="bad">lapsed</span>
                    ) : permit?.status === 'active' ? (
                      <span className="dim">none · {fmtCompact(cargoFee)}/yr</span>
                    ) : (
                      <span className="faint">needs corridor permit</span>
                    )}
                    {liveCargoContracts > 0 && (
                      <div className="dim" style={{ fontSize: '0.75rem' }}>
                        {liveCargoContracts} contract{liveCargoContracts === 1 ? '' : 's'}
                      </div>
                    )}
                  </td>
                  <td className="num">{r.km}</td>
                  <td className="num font-bold">
                    {displayRouteHours(r.hours)}h
                  </td>
                  <td className="num">
                    <M v={Math.round(r.marketFareAC * idx)} />
                    <span className={idx > 1.05 ? 'good small' : idx < 0.95 ? 'bad small' : 'dim small'}> {idx > 1 ? '+' : ''}{Math.round((idx - 1) * 100)}%</span>
                  </td>
                  <td className="num">{r.baseDemand.toLocaleString()}</td>
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

                      // When player is 0%, competitors are 100%
                      const competitorShare = Math.max(0, 100 - pShare)

                      let rivalEntries = share?.byRival ? Object.entries(share.byRival) : []
                      if (rivalEntries.length === 0) {
                        const fallbackSeed = seedRouteShare(r.id, r.competition, RIVALS[r.id], pShare)
                        rivalEntries = Object.entries(fallbackSeed.byRival)
                      }

                      // Compute average fare index & comfort for competitors
                      let totalFareWeight = 0
                      let totalComfortWeight = 0
                      let totalWeight = 0
                      for (const [id, val] of rivalEntries) {
                        const rival = s.world.rivals?.[id] ?? RIVALS_DATA[id]
                        if (rival) {
                          totalFareWeight += rival.fareIndex * val
                          totalComfortWeight += rival.comfort * val
                          totalWeight += val
                        }
                      }
                      const avgFare = totalWeight > 0 ? (totalFareWeight / totalWeight).toFixed(2) : '1.00'
                      const avgComfort = totalWeight > 0 ? (totalComfortWeight / totalWeight).toFixed(1) : '7.0'

                      return (
                        <div>
                          <div>
                            <b>Competitors</b> <span className="dim small">({competitorShare}%)</span>
                            <div className="dim small">
                              Fare: {avgFare}× · Comfort: {avgComfort}
                            </div>
                          </div>
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
                            You: {pShare}%{capInfo.dailySeats > 0 ? ` (${capInfo.dailySeats} seats/day)` : ''}
                          </div>
                          <div className="dim small" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                            <span className={r.competition > 0.8 ? 'bad' : r.competition > 0.65 ? 'warn' : 'good'}>
                              {r.competition > 0.8 ? 'brutal' : r.competition > 0.65 ? 'heavy' : 'moderate'}
                            </span>
                            {r.railCompetition > 0.55 && <span> +rail</span>}
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
                  <td className="small">
                    {rivalAction && rivalAction.untilDay >= s.day && (
                      <div className="warn font-semibold" style={{ marginBottom: 2 }}>
                        ⚔️ {rivalAction.headline} ({rivalAction.untilDay - s.day}d)
                      </div>
                    )}
                    {closure && closure.untilDay >= s.day && <div className="bad">CLOSED: {closure.reason} ({closure.untilDay - s.day}d)</div>}
                    {war && !rivalAction && war.untilDay >= s.day && <div className="warn">price war −{Math.round(war.depth * 100)}% ({war.untilDay - s.day}d)</div>}
                    {shock && shock.untilDay >= s.day && shock.untilDay - s.day < 400 && (
                      <div className={shock.mult > 1 ? 'good' : 'bad'}>{shock.reason}: ×{shock.mult.toFixed(2)} ({shock.untilDay - s.day}d)</div>
                    )}
                    {s.world.expressways.includes(r.id) && <div className="info">expressway </div>}
                    {(() => {
                      const boost = getLoungeDemandBoost(s, r.id)
                      if (boost > 1.0) {
                        const pct = ((boost - 1.0) * 100).toFixed(1).replace(/\.0$/, '')
                        return (
                          <div className="good small" style={{ marginTop: 2 }}>
                            Lounge lift: +{pct}% conversion
                          </div>
                        )
                      }
                      return null
                    })()}
                  </td>
                  <td>
                    {permit?.status === 'active' && (
                      <span className="good">
                        active
                        {permit.expiryDay !== undefined && permit.expiryDay - s.day < 40 ? ` (renews ${permit.expiryDay - s.day}d)` : ''}
                        {schCount > 0 && <span className="dim"> · {schCount} sched</span>}
                      </span>
                    )}
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

                          {cargoLicensed ? (
                            <span className="flex" style={{ gap: 4 }}>
                              {cargoLeft <= 45 && (
                                <button
                                  className="small"
                                  title={`Renew cargo licence (${fmtCompact(cargoRenewalFee)} a year)`}
                                  onClick={() => g.renewCargoPermit(r.id)}
                                >
                                  renew cargo
                                </button>
                              )}
                              {confirmCargoId === r.id ? (
                                <>
                                  <button
                                    className="small danger"
                                    title={
                                      liveCargoContracts > 0
                                        ? `Surrender licence — closes ${liveCargoContracts} live contract(s) on this corridor`
                                        : 'Surrender the cargo licence'
                                    }
                                    onClick={() => {
                                      g.closeCargoPermit(r.id)
                                      setConfirmCargoId(null)
                                    }}
                                  >
                                    confirm close
                                  </button>
                                  <button className="small" onClick={() => setConfirmCargoId(null)}>
                                    cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="small danger"
                                  title={
                                    liveCargoContracts > 0
                                      ? `Surrender licence — closes ${liveCargoContracts} live contract(s) on this corridor`
                                      : 'Surrender the cargo licence'
                                  }
                                  onClick={() => setConfirmCargoId(r.id)}
                                >
                                  close cargo
                                </button>
                              )}
                            </span>
                          ) : cargoLicenceRow ? (
                            <button
                              className="small"
                              title={`Cargo licence lapsed — renew for ${fmtCompact(cargoRenewalFee)} a year`}
                              onClick={() => g.renewCargoPermit(r.id)}
                            >
                              renew cargo
                            </button>
                          ) : (
                            <button
                              className="small primary"
                              title={`Cargo licence · ${fmtCompact(cargoFee)} a year — unlocks freight contract invites in both directions`}
                              onClick={() => g.openCargoPermit(r.id)}
                            >
                              + cargo
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

        const STANCES: { id: CorridorStance; title: string; effect: string; detail: string }[] = [
          { id: 'neutral', title: 'Neutral', effect: 'no counter-measures', detail: 'Standard timetable and pricing. A rival front-running your departure takes the shoppers.' },
          { id: 'undercut', title: 'Undercut', effect: 'match rival fares · +15% booking defense', detail: 'Neutralises the rival front-runner at the cost of lower yield.' },
          { id: 'premium_hold', title: 'Premium hold', effect: 'keep fares · needs 4.0★ coach or Primo', detail: 'Loyal high-yield passengers stay. Without a 4.0+ coach or Primo the rival gains +20% appeal; a rival wave also ends 2 days sooner each week.' },
          { id: 'cargo_bundle', title: 'Cargo bundle', effect: '+30% parcel revenue on this route', detail: 'Freight earnings subsidise passenger seats. The rival still front-runs (+10% appeal).' },
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
