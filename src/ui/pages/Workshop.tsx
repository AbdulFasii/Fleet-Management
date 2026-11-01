import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { fmtDate } from '../../engine/core/calendar'
import {
  BAL,
  nextWorkshopBayCost,
  workshopJobDiscount,
  workshopJobSpeedup,
} from '../../engine/data/balance'
import { BUS_MODELS, modelTitleById } from '../../engine/data/busModels'
import { worstSubsystem } from '../../engine/sim/fleet'
import {
  axleTyresDue,
  bServiceDueKm,
  computeBayAllocations,
  determineDueServiceTier,
  freeStaffedBays,
  getWorkshopLocations,
  inOwnWorkshop,
  overhaulDueInfo,
  ownerPaysService,
  quoteReplaceTyres,
  quoteService,
  serviceDueKm,
  serviceDeferredForBus,
  serviceResumeDay,
  sortWorkshopBayJobs,
  tyresDue,
} from '../../engine/sim/maintenance'
import { fmtCompact, rs } from '../../engine/core/money'
import { CITIES, cityName } from '../../engine/data/cities'
import { ROUTES } from '../../engine/data/routes'
import { yardMonthlyRent, busesParkedInCity, outstationNightlyFee } from '../../engine/sim/depot'
import { accountantOnDuty, deskOf, managersOnPayroll, staffedWorkshopBays, workshopMechanicsOnDuty } from '../../engine/sim/staffing'
import { spanMeters } from '../../engine/sim/span'
import type { Bus, MechanicTrade, Ownership, ServiceTierId, Staff, TyreAxle, TyreBrand, WorkshopLocation, ID } from '../../engine/types'
import { Bar, KV, M, Panel, Modal, GroupBadge } from '../bits'

const TRADE_LABEL: Record<MechanicTrade, string> = {
  engine_gearbox: 'Engine/Gearbox',
  electrical_ac: 'Electrical/AC',
  body_suspension: 'Body/Suspension',
  general: 'General',
}

function tradeLabel(trade?: MechanicTrade): string {
  return TRADE_LABEL[trade ?? 'general']
}

function ServiceJobBadge({ jobLabel }: { jobLabel?: string }) {
  if (!jobLabel) return null
  const clean = jobLabel.replace(/^breakdown:\s*/i, '')
  if (clean.includes('Overhaul')) {
    return <span className="pill accent small" style={{ marginLeft: 6 }}>Annual Overhaul</span>
  }
  if (clean.includes('B-Service')) {
    return <span className="pill info small" style={{ marginLeft: 6 }}>B-Service (Major)</span>
  }
  if (clean.includes('A-Service')) {
    return <span className="pill dim small" style={{ marginLeft: 6 }}>A-Service (Minor)</span>
  }
  if (/tyres?:?/i.test(clean)) {
    return <span className="pill warn small" style={{ marginLeft: 6 }}>{clean}</span>
  }
  return <span className="dim"> · {clean}</span>
}

function OwnershipCell({ ownership, attachShare }: { ownership: Ownership; attachShare?: number }) {
  return (
    <span className={`pill small ${ownership === 'owned' ? 'accent' : ownership === 'leased' ? 'info' : 'warn'}`}>
      {ownership}{attachShare !== undefined ? ` ${Math.round(attachShare * 100)}%` : ''}
    </span>
  )
}

export function WorkshopPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [activeTab, setActiveTab] = useState<'bays' | 'service' | 'depot' | 'claims'>('bays')
  const [serviceFilter, setServiceFilter] = useState<'all' | 'overhaul' | 'service_b' | 'service_a' | 'tyres' | 'gps'>('all')

  const buses = Object.values(s.buses)
  const inShop = buses.filter((b) => b.status === 'workshop')
  const manager = s.workshop.managerId ? s.staff[s.workshop.managerId] : undefined
  const managerCandidates = managersOnPayroll(s).filter(
    (st) => st.id === s.workshop.managerId || !deskOf(s, st.id),
  )
  const bayMechs = (s.workshop.mechanicIds ?? []).map((id) => s.staff[id]).filter(Boolean) as Staff[]
  const staffed = staffedWorkshopBays(s)
  const freeMechanics = Object.values(s.staff).filter(
    (st) =>
      st.role === 'mechanic' &&
      s.workshop.managerId !== st.id &&
      !(s.workshop.mechanicIds ?? []).includes(st.id),
  )
  const disc = workshopJobDiscount(s.workshop.bays)
  const speed = workshopJobSpeedup(s.workshop.bays)
  const locations = getWorkshopLocations(s)
  const bays = computeBayAllocations(s)
  const assignedJobIds = new Set(bays.map((b) => b.job?.id).filter(Boolean))
  const overflow = inShop.filter((b) => !assignedJobIds.has(b.id))
  const util = s.workshop.bays > 0 ? staffed / s.workshop.bays : 0
  const freeBays = freeStaffedBays(s)
  const wsSpan = spanMeters(s).workshop

  const [frontBrandSelect, setFrontBrandSelect] = useState<Record<string, 'oem' | 'tier2'>>({})
  const [rearBrandSelect, setRearBrandSelect] = useState<Record<string, 'oem' | 'tier2' | 'retread'>>({})
  const [selectedLeaseCity, setSelectedLeaseCity] = useState<string>('')

  const [showAddSatelliteModal, setShowAddSatelliteModal] = useState(false)
  const [newSiteCity, setNewSiteCity] = useState<string>('')
  const [newSiteBrands, setNewSiteBrands] = useState<ID[]>([])

  const [editingLocation, setEditingLocation] = useState<WorkshopLocation | null>(null)
  const [editLocationBrands, setEditLocationBrands] = useState<ID[]>([])

  const homeParkedCount = Object.values(s.buses).filter(
    (b) =>
      (b.parkedCityId ?? s.company.homeCityId) === s.company.homeCityId &&
      (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded'),
  ).length

  const activePermitRouteIds = Object.values(s.permits)
    .filter((p) => p.status === 'active' && ROUTES[p.routeId])
    .map((p) => p.routeId)
  const permitCities = Array.from(
    new Set(
      activePermitRouteIds.flatMap((rid) => {
        const r = ROUTES[rid]
        return r ? [r.from, r.to] : []
      }),
    ),
  )
  const leasedCitySet = new Set((s.yards ?? []).map((y) => y.cityId))
  const availableCitiesToLease = permitCities
    .filter((c) => c !== s.company.homeCityId && !leasedCitySet.has(c))
    .sort(
      (a, b) =>
        busesParkedInCity(s, b).length - busesParkedInCity(s, a).length ||
        cityName(a).localeCompare(cityName(b)),
    )

  const [outsideModal, setOutsideModal] = useState<{
    busId: string
    reg: string
    action: 'service' | 'tyres'
    tier?: ServiceTierId
    axle?: TyreAxle
    brand?: TyreBrand
    cost: number
    days: number
    title: string
  } | null>(null)

  const handleService = (bus: Bus, tier: ServiceTierId) => {
    if (!inOwnWorkshop(s, bus)) {
      const q = quoteService(s, bus, tier, true)
      setOutsideModal({
        busId: bus.id,
        reg: bus.reg,
        action: 'service',
        tier,
        cost: q.cost,
        days: q.days,
        title: `${q.label} at Outside Garage`,
      })
    } else {
      g.serviceBus(bus.id, tier)
    }
  }

  const handleReplaceTyres = (bus: Bus, axle: TyreAxle, brand: TyreBrand) => {
    if (!inOwnWorkshop(s, bus)) {
      const q = quoteReplaceTyres(s, bus, axle, brand, true)
      if (typeof q === 'string') {
        g.toast(q, 'bad')
        return
      }
      setOutsideModal({
        busId: bus.id,
        reg: bus.reg,
        action: 'tyres',
        axle,
        brand,
        cost: q.cost,
        days: q.days,
        title: `${axle.toUpperCase()} tyres (${brand.toUpperCase()}) at Outside Garage`,
      })
    } else {
      g.replaceTyres(bus.id, axle, brand)
    }
  }

  const needsWork = useMemo(() => {
    return buses
      .filter(
        (b) =>
          b.status === 'active' &&
          !ownerPaysService(b) &&
          (serviceDueKm(b) > 0 ||
            bServiceDueKm(b) > 0 ||
            overhaulDueInfo(s, b).isDue ||
            worstSubsystem(b.condition) < 50 ||
            tyresDue(b) ||
            !b.gpsDeviceFitted),
      )
      .sort((a, b) => worstSubsystem(a.condition) - worstSubsystem(b.condition))
  }, [buses, s])

  const filteredNeedsWork = useMemo(() => {
    if (serviceFilter === 'all') return needsWork
    if (serviceFilter === 'overhaul') return needsWork.filter((b) => overhaulDueInfo(s, b).isDue)
    if (serviceFilter === 'service_b') return needsWork.filter((b) => bServiceDueKm(b) > 0 && !overhaulDueInfo(s, b).isDue)
    if (serviceFilter === 'service_a') return needsWork.filter((b) => serviceDueKm(b) > 0 && bServiceDueKm(b) <= 0 && !overhaulDueInfo(s, b).isDue)
    if (serviceFilter === 'tyres') return needsWork.filter((b) => tyresDue(b))
    if (serviceFilter === 'gps') return needsWork.filter((b) => !b.gpsDeviceFitted)
    return needsWork
  }, [needsWork, serviceFilter, s])

  const refurbBusesInWorks = buses
    .filter(
      (b) =>
        b.status === 'workshop' &&
        b.workshopJob &&
        (b.workshopJob.toLowerCase().includes('re-body') || b.workshopJob.toLowerCase().includes('seat')),
    )
    .sort((a, b) => (a.workshopUntilDay ?? 0) - (b.workshopUntilDay ?? 0))

  const activeClaims = s.insuranceClaims?.filter((c) => c.status !== 'settled' && c.status !== 'rejected') ?? []

  return (
    <>
      {/* Top Header */}
      <div className="page-title">
        <span>Workshop & Fleet Maintenance</span>
        <span className="sub">
          {s.workshop.bays === 0
            ? 'Outside commercial garage rates (0% discount)'
            : `${staffed}/${s.workshop.bays} Bays Staffed · ${Math.round(disc * 100)}% Cost Savings · ${Math.round(speed * 100)}% Faster Turnaround · Foreman Span: ${wsSpan.demand}/${wsSpan.capacity} bays (${Math.round(wsSpan.coverage * 100)}%)`}
        </span>
        <span className="spacer" />
        <span className="flex" style={{ gap: 6 }}>
          {([
            ['bays', `🛠️ Service Bays (${s.workshop.bays})`],
            ['service', `⚠️ Maintenance Due (${needsWork.length})`],
            ['depot', `🅿️ Depot & Yards (${homeParkedCount}/${s.depotSlots ?? 4})`],
            ['claims', `📑 Claims & Refurb (${activeClaims.length + refurbBusesInWorks.length})`],
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

      {/* KPI Status Strip */}
      <div className="grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Workshop Facility</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            {s.workshop.bays === 0 ? (
              <span className="warn">Outside Only</span>
            ) : (
              <span className="good">{s.workshop.bays} Bay{s.workshop.bays === 1 ? '' : 's'} Built</span>
            )}
          </div>
          <div className="small dim">
            {freeBays > 0 ? <span className="good">{freeBays} bay(s) available</span> : <span className="warn">0 bays free</span>} · {staffed}/{s.workshop.bays} staffed
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Turnaround & Efficiency</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className="accent">+{Math.round(speed * 100)}% Speed</span>
          </div>
          <div className="small dim">
            <span className="good">{Math.round(disc * 100)}% job discount</span> vs outside garages
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Fleet Upkeep Queue</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className={needsWork.length > 0 ? 'warn' : 'good'}>{needsWork.length} Bus{needsWork.length === 1 ? '' : 'es'} Due</span>
          </div>
          <div className="small dim">
            {inShop.length} in shop ({inShop.filter((b) => assignedJobIds.has(b.id)).length} on bay, {overflow.length} outside/queue)
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Home Depot Yard</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className={homeParkedCount > (s.depotSlots ?? 4) ? 'bad' : 'good'}>
              {homeParkedCount} / {s.depotSlots ?? 4} Slots
            </span>
          </div>
          <div className="small dim">
            {homeParkedCount > (s.depotSlots ?? 4) ? (
              <span className="bad">⚠️ Street overflow ({homeParkedCount - (s.depotSlots ?? 4)} bus)</span>
            ) : (
              <span className="good">✓ Fully sheltered (-40% decay)</span>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: SERVICE BAYS & ACTIVE JOBS                                         */}
      {/* ========================================================================= */}
      {activeTab === 'bays' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Bay Board */}
          <Panel
            title={`Bay Board (${staffed} Live / ${s.workshop.bays} Built)`}
            right={
              s.workshop.bays > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="dim small">
                    {freeBays} bay(s) ready for service
                  </span>
                  <button
                    className="small primary"
                    onClick={() => {
                      setNewSiteCity('')
                      setNewSiteBrands([])
                      setShowAddSatelliteModal(true)
                    }}
                  >
                    + Open Satellite ({fmtCompact(BAL.workshopSiteFirstBayCost)})
                  </button>
                </div>
              )
            }
          >
            {s.workshop.bays === 0 ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <p className="warn" style={{ marginBottom: 8 }}>
                  No in-house workshop built yet. All fleet maintenance is outsourced to outside commercial garages at full price.
                </p>
                <button className="primary" onClick={() => g.openWorkshopLocation(s.company.homeCityId, [])}>
                  Build HQ Workshop — 1 Bay ({fmtCompact(BAL.workshopSiteFirstBayCost)})
                </button>
              </div>
            ) : (
              <div>
                {locations.map((loc) => {
                  const locBays = bays.filter((b) => b.locationId === loc.id)
                  const isHQ = loc.cityId === s.company.homeCityId
                  return (
                    <div
                      key={loc.id}
                      style={{
                        marginBottom: 16,
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        background: 'var(--bg2)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          background: 'var(--bg3)',
                          borderBottom: '1px solid var(--border)',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>
                            {cityName(loc.cityId)}
                          </span>
                          {isHQ && <span className="pill good small">HQ Depot</span>}
                          <span className="dim small">
                            {loc.bayCount} Bay{loc.bayCount === 1 ? '' : 's'}
                          </span>
                          <span className="dim small">· Allowed:</span>
                          {loc.groupIds.length === 0 ? (
                            <span className="pill faint small">All Brands</span>
                          ) : (
                            loc.groupIds.map((gid) => {
                              const grp = s.groups?.[gid]
                              return grp ? <GroupBadge key={gid} group={grp} /> : null
                            })
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            className="small"
                            onClick={() => {
                              setEditingLocation(loc)
                              setEditLocationBrands([...loc.groupIds])
                            }}
                          >
                            Brands
                          </button>
                          <button
                            className="small primary"
                            onClick={() => g.addWorkshopBayAtLocation(loc.id)}
                            title={`Add 1 bay at ${cityName(loc.cityId)} for ${fmtCompact(BAL.workshopBayCostFlat)}`}
                          >
                            + Bay ({fmtCompact(BAL.workshopBayCostFlat)})
                          </button>
                        </div>
                      </div>

                      <table className="data" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>Bay</th>
                            <th>Assigned Mechanic</th>
                            <th>Active Job</th>
                            <th>Type</th>
                            <th className="num">ETA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {locBays.map((bay) => {
                            const onLeave = bay.mechanic?.onLeaveUntilDay && bay.mechanic.onLeaveUntilDay >= s.day
                            const vacant = !bay.mechanic
                            return (
                              <tr key={bay.index}>
                                <td className="accent">
                                  <b>#{bay.index}</b>
                                  <span className="dim small" style={{ marginLeft: 4 }}>
                                    (Bay {bay.bayIndexInLoc + 1})
                                  </span>
                                </td>
                                <td className="nowrap">
                                  {vacant ? (
                                    freeMechanics.length > 0 ? (
                                      <select
                                        value=""
                                        style={{ maxWidth: 170 }}
                                        onChange={(e) => {
                                          const id = e.target.value
                                          if (id) g.appointBayMechanic(id)
                                        }}
                                      >
                                        <option value="">+ Appoint Mechanic…</option>
                                        {freeMechanics.map((st) => (
                                          <option key={st.id} value={st.id}>
                                            {st.name} ({tradeLabel(st.mechanicTrade)} · sk {st.skill})
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="bad small">⚠️ Unstaffed (Hire on Staff)</span>
                                    )
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div>
                                        <b>{bay.mechanic!.name}</b>
                                        <div className="dim small">
                                          {tradeLabel(bay.mechanic!.mechanicTrade)} · Skill {bay.mechanic!.skill}
                                          {onLeave && <span className="warn"> (on leave)</span>}
                                        </div>
                                      </div>
                                      <button
                                        className="small text"
                                        title="Unappoint mechanic from this bay"
                                        onClick={() => g.unappointBayMechanic(bay.mechanic!.id)}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td>
                                  {vacant || onLeave ? (
                                    <span className="dim small">{vacant ? 'Bay idle (unstaffed)' : 'Mechanic on leave'}</span>
                                  ) : bay.job ? (
                                    <div>
                                      <Link to={`/fleet/${bay.job.id}`}><b>{bay.job.reg}</b></Link>
                                      <div className="small dim">{modelTitleById(bay.job.modelId)}</div>
                                      <ServiceJobBadge jobLabel={bay.job.workshopJob} />
                                    </div>
                                  ) : (
                                    <span className="good small">✓ Bay Ready & Clean</span>
                                  )}
                                </td>
                                <td>
                                  {bay.job ? (
                                    <OwnershipCell ownership={bay.job.ownership} attachShare={bay.job.attach?.ownerShare} />
                                  ) : (
                                    <span className="dim">—</span>
                                  )}
                                </td>
                                <td className="num">
                                  {bay.job ? (
                                    <b className="accent">{Math.max(0, (bay.job.workshopUntilDay ?? s.day) - s.day)}d left</b>
                                  ) : (
                                    <span className="dim">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })}

                {bayMechs.length < s.workshop.bays && (
                  <p className="small warn" style={{ padding: '8px 10px 0' }}>
                    💡 Unstaffed bays remain idle. Hire mechanics in the Staff desk to operate all bays.
                  </p>
                )}
              </div>
            )}
          </Panel>

          {/* Facility Management & Expansion */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Panel title="Workshop Facility & Expansion">
              <KV rows={[
                ['Workshop Capacity', `${s.workshop.bays} Bay(s) Built across ${locations.length} Location(s) · ${staffed} Staffed (${Math.round(util * 100)}% utilization)`],
                ['Foreman Span', <span><b>{wsSpan.demand}</b> / {wsSpan.capacity} bays ({Math.round(wsSpan.coverage * 100)}% coverage){wsSpan.demand > wsSpan.capacity ? <span className="warn" style={{ marginLeft: 6 }}>+{wsSpan.assistantsToCover} assistant(s) needed</span> : null}</span>],
                ['Free Staffed Bays', <span className={freeBays > 0 ? 'good' : 'warn'}>{freeBays} bay(s) available</span>],
                ['Cost Reduction', <span className="good">-{Math.round(disc * 100)}% cheaper vs outside commercial rate</span>],
                ['Turnaround Speedup', <span className="accent">+{Math.round(speed * 100)}% faster overhaul turnaround</span>],
                ['Workshop Manager', manager ? (
                  <span>
                    <b>{manager.name}</b> (Skill {manager.skill})
                    <div className="dim small">Auto-schedules 25k/100k/250k services in-house on owned bays & pulls idle cover coaches</div>
                  </span>
                ) : (
                  <span className="warn">None appointed (Manual service booking only)</span>
                )],
              ]} />

              <div className="form-row mt12">
                <label>Appoint Workshop Manager</label>
                <select
                  value={s.workshop.managerId ?? ''}
                  onChange={(e) => g.appointFleetManager(e.target.value || undefined)}
                >
                  <option value="">— None (Manual Operations) —</option>
                  {managerCandidates.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} · Skill {st.skill} ({st.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row mt12">
                <label>Default Manager Tyre Replacement Brand</label>
                <select
                  value={s.company.workshopTyreBrand ?? 'oem'}
                  onChange={(e) => g.setWorkshopTyreBrand(e.target.value as 'oem' | 'tier2')}
                >
                  <option value="oem">OEM Tier-1 (Apollo / MRF — {fmtCompact(BAL.tyres.oem.price)}/tyre)</option>
                  <option value="tier2">Tier-2 Quality (JK / BKT — {fmtCompact(BAL.tyres.tier2.price)}/tyre)</option>
                </select>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.workshop.bays === 0 ? (
                  <button className="primary" onClick={() => g.openWorkshopLocation(s.company.homeCityId, [])}>
                    Build HQ Workshop — 1 Bay ({fmtCompact(BAL.workshopSiteFirstBayCost)})
                  </button>
                ) : (
                  <button
                    className="primary"
                    onClick={() => {
                      setNewSiteCity('')
                      setNewSiteBrands([])
                      setShowAddSatelliteModal(true)
                    }}
                  >
                    + Open Satellite Workshop ({fmtCompact(BAL.workshopSiteFirstBayCost)})
                  </button>
                )}
              </div>
            </Panel>

            {/* Outside / Waiting Queue */}
            {overflow.length > 0 && (
              <Panel title={`Waiting / Commercial Outside Queue (${overflow.length})`} flat>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Bus</th>
                      <th>Model</th>
                      <th>Ownership</th>
                      <th>Job</th>
                      <th className="num">Days Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overflow.map((b) => (
                      <tr key={b.id}>
                        <td><Link to={`/fleet/${b.id}`}><b>{b.reg}</b></Link></td>
                        <td className="dim">{modelTitleById(b.modelId)}</td>
                        <td><OwnershipCell ownership={b.ownership} attachShare={b.attach?.ownerShare} /></td>
                        <td><ServiceJobBadge jobLabel={b.workshopJob} /></td>
                        <td className="num">{Math.max(0, (b.workshopUntilDay ?? s.day) - s.day)}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small warn" style={{ padding: '6px 10px 0' }}>
                  Owned coaches take priority on staffed bays; overflow jobs run at commercial outside garage rates until a bay frees up.
                </p>
              </Panel>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FLEET MAINTENANCE & DUE SERVICING                                  */}
      {/* ========================================================================= */}
      {activeTab === 'service' && (
        <Panel
          title={`Fleet Maintenance Due (${filteredNeedsWork.length} Coaches)`}
          flat
          right={
            <div className="flex" style={{ gap: 4 }}>
              {([
                ['all', `All Due (${needsWork.length})`],
                ['overhaul', 'Annual Overhauls'],
                ['service_b', 'Major B-Service'],
                ['service_a', 'Minor A-Service'],
                ['tyres', 'Tyres Due'],
                ['gps', 'Missing GPS'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={`small ${serviceFilter === id ? 'primary' : ''}`}
                  onClick={() => setServiceFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="dim small">
              Owned coaches take in-house bays first. Attached / leased coaches use leftover bays or outside garages.
              Tyres wear on steer and drive axles independently.
            </span>
          </div>

          {filteredNeedsWork.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }} className="good">
              ✓ All active coaches in this category are healthy and road-ready.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Bus / Reg</th>
                    <th>Model</th>
                    <th>Own</th>
                    <th>Condition</th>
                    <th className="num">Due Interval</th>
                    <th>Front Steer Tyres</th>
                    <th>Rear Drive Tyres</th>
                    <th className="num">Service Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNeedsWork.map((b) => {
                    const tierDue = determineDueServiceTier(s, b)
                    const due = serviceDueKm(b)
                    const dueB = bServiceDueKm(b)
                    const overhaulInfo = overhaulDueInfo(s, b)
                    const tyreInfo = axleTyresDue(b)
                    const fBrand = frontBrandSelect[b.id] ?? b.frontBrand ?? 'oem'
                    const rBrand = rearBrandSelect[b.id] ?? b.rearBrand ?? 'oem'
                    const fQuote = quoteReplaceTyres(s, b, 'front', fBrand, s.workshop.bays <= 0)
                    const rQuote = quoteReplaceTyres(s, b, 'rear', rBrand, s.workshop.bays <= 0)
                    const fCost = fQuote && typeof fQuote === 'object' ? fQuote.cost : 0
                    const rCost = rQuote && typeof rQuote === 'object' ? rQuote.cost : 0

                    return (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/fleet/${b.id}`}><b>{b.reg}</b></Link>
                          {!b.gpsDeviceFitted && (
                            <span className="pill warn small" style={{ marginLeft: 6 }}>No GPS</span>
                          )}
                        </td>
                        <td className="dim small">{modelTitleById(b.modelId)}</td>
                        <td><OwnershipCell ownership={b.ownership} attachShare={b.attach?.ownerShare} /></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Bar value={worstSubsystem(b.condition) / 100} tone="auto" width={8} />
                            <span className={worstSubsystem(b.condition) < 50 ? 'bad' : 'good'}>
                              {Math.round(worstSubsystem(b.condition))}%
                            </span>
                          </div>
                        </td>
                        <td className="num">
                          {overhaulInfo.isDue ? (
                            <span className="bad" title="Annual Overhaul due (365d or 250k km)">
                              <b>Overhaul</b> ({Math.max(1, Math.round(overhaulInfo.dueKm / 1000))}k over)
                            </span>
                          ) : dueB > 0 ? (
                            <span className="bad" title="Major B-Service due (100k km interval)">
                              <b>B-Service</b> ({Math.round(dueB / 1000)}k over)
                            </span>
                          ) : due > 0 ? (
                            <span className="warn" title="Minor A-Service due (25k km interval)">
                              <b>A-Service</b> ({Math.round(due / 1000)}k over)
                            </span>
                          ) : (
                            <span className="dim">ok ({Math.round(-due / 1000)}k to A)</span>
                          )}
                        </td>
                        <td className="nowrap">
                          <div className={tyreInfo.frontDue ? 'bad' : tyreInfo.frontPct >= 0.75 ? 'warn' : 'dim small'}>
                            Front: {Math.round(tyreInfo.frontPct * 100)}% ({b.frontBrand?.toUpperCase() ?? 'OEM'})
                          </div>
                          <div className="flex gap-4 mt4" style={{ alignItems: 'center' }}>
                            <select
                              className="small"
                              style={{ maxWidth: 80 }}
                              value={fBrand}
                              onChange={(e) =>
                                setFrontBrandSelect((prev) => ({ ...prev, [b.id]: e.target.value as 'oem' | 'tier2' }))
                              }
                            >
                              <option value="oem">OEM</option>
                              <option value="tier2">Tier-2</option>
                            </select>
                            <button
                              className="small"
                              onClick={() => handleReplaceTyres(b, 'front', fBrand)}
                              title={`Replace 2 front steer tyres with ${fBrand.toUpperCase()} (${fmtCompact(fCost)})`}
                            >
                              Fit ({fmtCompact(fCost)})
                            </button>
                          </div>
                        </td>
                        <td className="nowrap">
                          <div className={tyreInfo.rearDue ? 'bad' : tyreInfo.rearPct >= 0.75 ? 'warn' : 'dim small'}>
                            Rear: {Math.round(tyreInfo.rearPct * 100)}% ({b.rearBrand?.toUpperCase() ?? 'OEM'})
                          </div>
                          <div className="flex gap-4 mt4" style={{ alignItems: 'center' }}>
                            <select
                              className="small"
                              style={{ maxWidth: 88 }}
                              value={rBrand}
                              onChange={(e) =>
                                setRearBrandSelect((prev) => ({
                                  ...prev,
                                  [b.id]: e.target.value as 'oem' | 'tier2' | 'retread',
                                }))
                              }
                            >
                              <option value="oem">OEM</option>
                              <option value="tier2">Tier-2</option>
                              <option value="retread">Retread</option>
                            </select>
                            <button
                              className="small"
                              onClick={() => handleReplaceTyres(b, 'rear', rBrand)}
                              title={`Replace rear drive tyres with ${rBrand.toUpperCase()} (${fmtCompact(rCost)})`}
                            >
                              Fit ({fmtCompact(rCost)})
                            </button>
                          </div>
                        </td>
                        <td className="num nowrap">
                          {(() => {
                            const deferred = serviceDeferredForBus(s, b)
                            const resume = serviceResumeDay(s.day)
                            if (deferred) {
                              return (
                                <span
                                  className="dim small"
                                  title="Scheduled coaches are protected from workshop downtime during peak festival windows."
                                >
                                  Festival hold{resume ? ` (d${resume})` : ''}
                                </span>
                              )
                            }
                            return (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                {!b.gpsDeviceFitted && (
                                  <button
                                    className="small warn"
                                    onClick={() => g.fitGps(b.id)}
                                    title={`Fit mandatory AIS-140 GPS telematics (${fmtCompact(BAL.gpsFitCost)})`}
                                  >
                                    Fit GPS
                                  </button>
                                )}
                                <button
                                  className={`small ${tierDue === 'overhaul' ? 'accent' : tierDue === 'b' ? 'primary' : ''}`}
                                  onClick={() => handleService(b, tierDue)}
                                  title={`Book ${BAL.serviceTiers[tierDue].label} (${BAL.serviceTiers[tierDue].costMult}× cost, ${BAL.serviceTiers[tierDue].days}d turnaround)`}
                                >
                                  {tierDue === 'overhaul' ? 'Overhaul' : tierDue === 'b' ? 'B-Service' : 'A-Service'}
                                </button>
                              </div>
                            )
                          })()}
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

      {/* ========================================================================= */}
      {/* TAB 3: DEPOT & OUTSTATION YARDS                                           */}
      {/* ========================================================================= */}
      {activeTab === 'depot' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Home Yard */}
          <Panel
            title={`Home Depot Yard (${cityName(s.company.homeCityId)})`}
            info="Home depot overnight parking is capped. Buses parked on the road at home incur nightly overflow fees and risk RTO fines. Expanding slots covers fleet vehicles safely."
          >
            <KV rows={[
              ['Home City', cityName(s.company.homeCityId)],
              ['Slot Capacity', `${homeParkedCount} / ${s.depotSlots ?? BAL.depot.baseSlots} Slots`],
              ['Parking Status', homeParkedCount > (s.depotSlots ?? BAL.depot.baseSlots) ? (
                <span className="bad">
                  ⚠️ {homeParkedCount - (s.depotSlots ?? BAL.depot.baseSlots)} Bus(es) in street overflow ({fmtCompact(BAL.depot.overflowFeePerBusNight)}/bus nightly fee + RTO impound risk)
                </span>
              ) : (
                <span className="good">✓ Fully sheltered & secure (-40% time decay)</span>
              )],
              ['Monthly Base Rent', `${fmtCompact(BAL.depotRentBase + Math.max(0, Math.max(buses.length, s.depotSlots ?? BAL.depot.baseSlots) - BAL.depot.baseSlots) * BAL.depotRentPerExtraBus)}/month`],
            ]} />

            <div style={{ marginTop: 14 }}>
              <button className="primary" onClick={() => g.expandDepot()}>
                Expand Depot Yard (+1 Slot for {fmtCompact(BAL.depot.expandSlotCost)})
              </button>
              <div className="dim small" style={{ marginTop: 6 }}>
                Current slots: {s.depotSlots ?? BAL.depot.baseSlots} · Expansion permanently expands overnight capacity.
              </div>
            </div>
          </Panel>

          {/* Depot Bulk Fuel Tank */}
          <Panel
            title="Home Depot Bulk Fuel Yard Tank"
            info="Underground bulk diesel storage allows wholesale tanker procurement at ₹4/L discount. Buses departing from home depot fuel directly from the yard tank."
          >
            {s.company.depotFuelTank?.installed ? (
              <div>
                <KV rows={[
                  ['Tank Capacity', '10,000 Litres (Commercial Grade)'],
                  ['Current Fuel Level', (
                    <div>
                      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                        <b>{Math.round(s.company.depotFuelTank.litres).toLocaleString('en-IN')} / 10,000 L</b>
                        <span className={s.company.depotFuelTank.litres > 2500 ? 'good' : 'warn'}>
                          {Math.round((s.company.depotFuelTank.litres / 10000) * 100)}%
                        </span>
                      </div>
                      <Bar value={s.company.depotFuelTank.litres / 10000} tone="auto" />
                    </div>
                  )],
                  ['Wholesale Savings', (
                    <span className="good">
                      -₹4.00 / Litre vs pump price (saving ₹32,000 per 8,000L tanker)
                    </span>
                  )],
                  ['Auto-Refill Status', (
                    <label className="flex" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!s.company.depotFuelTank.autoRefill}
                        onChange={(e) => g.toggleAutoRefillDepotTank(e.target.checked)}
                      />
                      <span className={s.company.depotFuelTank.autoRefill ? 'good small' : 'dim small'}>
                        {s.company.depotFuelTank.autoRefill ? 'Active (auto-orders 8,000L tanker at 2,000L)' : 'Manual ordering'}
                      </span>
                    </label>
                  )],
                ]} />

                <div style={{ marginTop: 14 }}>
                  {(() => {
                    const wholesalePrice = Math.max(rs(70), s.world.dieselPaise - BAL.fuelCommercial.wholesaleDiscountPerLitre)
                    const cost8k = Math.round(8_000 * wholesalePrice)
                    const canFill = s.company.depotFuelTank.capacityLitres - s.company.depotFuelTank.litres >= 1000
                    return (
                      <button
                        className="primary"
                        onClick={() => g.orderDepotFuelRefill(8_000)}
                        disabled={!canFill}
                      >
                        Order 8,000L Bulk Tanker ({fmtCompact(cost8k)})
                      </button>
                    )
                  })()}
                </div>
              </div>
            ) : (
              <div>
                <p className="dim small" style={{ marginBottom: 12 }}>
                  No bulk fuel tank installed at the home depot. Fleet buses currently refuel at highway pumps at retail diesel rates without wholesale discount.
                </p>
                <button
                  className="primary"
                  onClick={() => g.installDepotFuelTank()}
                >
                  Install 10,000L Bulk Fuel Tank ({fmtCompact(BAL.fuelCommercial.depotTankInstallCost)})
                </button>
                <div className="dim small" style={{ marginTop: 6 }}>
                  Capex: ₹4.5 L. Saves ₹4.00 per litre on all home departures!
                </div>
              </div>
            )}
          </Panel>

          {/* Outstation Leased Yards */}
          <Panel
            title="Outstation Leased Yards Network"
            info="Buses parked overnight in destination cities incur public parking fees. Leasing covered yards in turnaround cities eliminates nightly parking fees and prevents wear."
          >
            {(s.yards?.length ?? 0) === 0 ? (
              <div style={{ padding: '10px 0' }}>
                <p className="dim small" style={{ marginBottom: 12 }}>
                  No outstation yards leased yet. Turnaround coaches incur public parking fees of ₹200–₹500/night.
                </p>
              </div>
            ) : (
              <table className="data" style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>Turnaround City</th>
                    <th className="num">Buses Parked</th>
                    <th className="num">Monthly Rent</th>
                    <th>Type</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.yards.map((y) => {
                    const parked = busesParkedInCity(s, y.cityId)
                    return (
                      <tr key={y.cityId}>
                        <td><b>{cityName(y.cityId)}</b></td>
                        <td className="num">
                          {parked.length > 0 ? (
                            <span title={parked.map((b) => b.reg).join(', ')}>
                              <b>{parked.length}</b> bus{parked.length === 1 ? '' : 'es'}
                            </span>
                          ) : (
                            <span className="dim">0 (idle yard)</span>
                          )}
                        </td>
                        <td className="num"><M v={y.monthlyRent} /></td>
                        <td className="dim small">{y.covered ? 'Covered Yard' : 'Open Lot'}</td>
                        <td className="num">
                          <button className="small warn" onClick={() => g.cancelYard(y.cityId)}>
                            Cancel Lease
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="total">
                    <td>Total ({s.yards.length} yard{s.yards.length === 1 ? '' : 's'})</td>
                    <td className="num">{s.yards.reduce((n, y) => n + busesParkedInCity(s, y.cityId).length, 0)}</td>
                    <td className="num"><M v={s.yards.reduce((n, y) => n + y.monthlyRent, 0)} /></td>
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            )}

            {availableCitiesToLease.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <label className="dim small" style={{ display: 'block', marginBottom: 6 }}>
                  Available Turnaround Cities on Permitted Routes:
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={selectedLeaseCity || availableCitiesToLease[0]}
                    onChange={(e) => setSelectedLeaseCity(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {availableCitiesToLease.map((c) => {
                      const parked = busesParkedInCity(s, c).length
                      const nightly = parked * outstationNightlyFee(c)
                      return (
                        <option key={c} value={c}>
                          {cityName(c)} — {fmtCompact(yardMonthlyRent(c))}/mo ({parked} bus{parked === 1 ? '' : 'es'} parked{parked > 0 ? ` · saves ${fmtCompact(nightly * 30)}/mo` : ''})
                        </option>
                      )
                    })}
                  </select>
                  <button
                    type="button"
                    className="small primary"
                    onClick={() => {
                      const target = selectedLeaseCity || availableCitiesToLease[0]
                      if (target) {
                        g.leaseYard(target)
                        setSelectedLeaseCity('')
                      }
                    }}
                  >
                    Lease Yard
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CLAIMS & REFURBISHMENT                                             */}
      {/* ========================================================================= */}
      {activeTab === 'claims' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Insurance Claims Desk */}
          <Panel
            title="Insurance Claims Desk"
            flat
            info={
              accountantOnDuty(s)
                ? `Accounts Manager ${accountantOnDuty(s)!.name} auto-settles surveyed claims and processes garage payouts.`
                : 'Appoint an Accounts Manager on Staff to auto-process insurance claims upon surveyor clearance.'
            }
          >
            {(s.insuranceClaims?.length ?? 0) === 0 ? (
              <div style={{ padding: 20, textAlign: 'center' }} className="dim">
                No insurance claims filed. Accidents and major en-route breakdowns generate claims here.
              </div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Bus</th>
                    <th>Claim Status</th>
                    <th className="num">Repair Estimate</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {s.insuranceClaims
                    .filter(
                      (c) =>
                        (c.status !== 'settled' && c.status !== 'rejected') ||
                        s.day - (c.resolvedDay ?? c.filedDay) <= 14,
                    )
                    .map((c) => {
                      const bus = s.buses[c.busId]
                      const ready = s.day >= c.surveyorUntilDay
                      const acct = accountantOnDuty(s)
                      return (
                        <tr key={c.id}>
                          <td><b>{bus?.reg ?? c.busId}</b></td>
                          <td className="small">
                            {c.status === 'settled' ? (
                              <span className="good">✓ Settled (+<M v={c.payout ?? 0} />)</span>
                            ) : c.status === 'rejected' ? (
                              <span className="bad">✗ Rejected (Co. Expense)</span>
                            ) : c.status === 'garage_paid' ? (
                              <span className="info">Garage Paid</span>
                            ) : ready ? (
                              <span className="accent">{acct ? 'Survey Ready · Accounts Mgr' : 'Survey Complete'}</span>
                            ) : (
                              <span className="dim">Survey in progress (Day {c.surveyorUntilDay})</span>
                            )}
                          </td>
                          <td className="num"><b><M v={c.repairEstimate} /></b></td>
                          <td className="num">
                            {c.status !== 'settled' && c.status !== 'rejected' && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                {c.status !== 'garage_paid' && (
                                  <button className="small" onClick={() => g.payGarageClaim(c.id)}>
                                    Pay Garage
                                  </button>
                                )}
                                <button
                                  className="small primary"
                                  disabled={!ready && c.status === 'survey'}
                                  onClick={() => g.settleInsuranceClaim(c.id)}
                                >
                                  Settle Claim
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
          </Panel>

          {/* Re-body & Seat Refurbishment */}
          <Panel
            title="Re-body & Seat Refurbishment Works"
            flat
            info="Specialist fibreglass body building (+3 years life extension) and luxury upholstery (+2 comfort rating points). In-house workshop accelerates turnaround."
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Bus / Reg</th>
                  <th>Model</th>
                  <th>Work Order</th>
                  <th>Condition</th>
                  <th>Completion Date</th>
                  <th className="num">Status</th>
                </tr>
              </thead>
              <tbody>
                {refurbBusesInWorks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dim" style={{ textAlign: 'center', padding: 20 }}>
                      No coaches currently undergoing re-body or seat refurbishment. Start jobs from any coach's Condition card in Fleet Details.
                    </td>
                  </tr>
                ) : (
                  refurbBusesInWorks.map((b) => {
                    const daysLeft = Math.max(0, (b.workshopUntilDay ?? s.day) - s.day)
                    const isRebody = b.workshopJob?.includes('re-body')
                    const condPct = isRebody
                      ? Math.round((b.condition.body + b.condition.ac + b.condition.electrical) / 3)
                      : Math.round(((BUS_MODELS[b.modelId]?.comfort ?? 7) + (b.comfortBonus ?? 0)) * 10)
                    return (
                      <tr key={b.id}>
                        <td><Link to={`/fleet/${b.id}`}><b>{b.reg}</b></Link></td>
                        <td className="dim small">{modelTitleById(b.modelId)}</td>
                        <td><b>{b.workshopJob}</b></td>
                        <td className="small">
                          <span className={condPct >= 75 ? 'good' : condPct >= 50 ? 'warn' : 'bad'}>
                            {condPct}%
                          </span>
                          <span className="dim"> ({isRebody ? 'Body/AC/Elec' : 'Comfort'})</span>
                        </td>
                        <td className="small">
                          {b.workshopUntilDay ? `${fmtDate(b.workshopUntilDay)} (${daysLeft}d left)` : 'In progress'}
                        </td>
                        <td className="num">
                          <span className="pill info small">In Progress</span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      {/* Outside Commercial Garage Confirmation Modal */}
      {outsideModal && (
        <div className="modal-backdrop" onClick={() => setOutsideModal(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Outside Commercial Garage Dispatch</h3>
            <p>
              Your in-house workshop has <strong>no eligible free staffed bay</strong> for this vehicle (capacity full or brand restricted). Would you like to outsource{' '}
              <strong>{outsideModal.reg}</strong> to an authorized commercial garage?
            </p>
            <div className="panel flat" style={{ margin: '12px 0', padding: '10px 14px' }}>
              <div><strong>Maintenance Job:</strong> {outsideModal.title}</div>
              <div><strong>Commercial Quote:</strong> {fmtCompact(outsideModal.cost)} (undiscounted outside rate)</div>
              <div><strong>Turnaround:</strong> {outsideModal.days} day(s)</div>
            </div>
            <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setOutsideModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  if (outsideModal.action === 'service') {
                    g.serviceBus(outsideModal.busId, outsideModal.tier, { outside: true })
                  } else if (outsideModal.action === 'tyres') {
                    g.replaceTyres(outsideModal.busId, outsideModal.axle, outsideModal.brand, { outside: true })
                  }
                  setOutsideModal(null)
                }}
              >
                Send to Outside Garage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open Satellite Workshop Modal */}
      {showAddSatelliteModal && (
        <Modal
          title="Open Satellite Workshop Depot"
          onClose={() => setShowAddSatelliteModal(false)}
          actions={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="small text" onClick={() => setShowAddSatelliteModal(false)}>
                Cancel
              </button>
              <button
                className="primary small"
                disabled={!newSiteCity}
                onClick={() => {
                  if (!newSiteCity) return
                  g.openWorkshopLocation(newSiteCity, newSiteBrands)
                  setShowAddSatelliteModal(false)
                }}
              >
                Open Satellite Depot ({fmtCompact(BAL.workshopSiteFirstBayCost)})
              </button>
            </div>
          }
        >
          <p className="dim small" style={{ marginBottom: 14 }}>
            Open a regional satellite workshop in another city hub. The first bay at this site costs{' '}
            <strong style={{ color: 'var(--fg)' }}>{fmtCompact(BAL.workshopSiteFirstBayCost)}</strong>{' '}
            (includes opening the depot). Any additional bays built at this location cost flat{' '}
            <strong style={{ color: 'var(--fg)' }}>{fmtCompact(BAL.workshopBayCostFlat)}</strong> each.
          </p>

          <div className="form-row">
            <label>Site City</label>
            <select
              value={newSiteCity}
              onChange={(e) => setNewSiteCity(e.target.value)}
            >
              <option value="">— Select Outstation City —</option>
              {Object.keys(CITIES)
                .filter((cid) => !locations.some((l) => l.cityId === cid))
                .sort((a, b) => cityName(a).localeCompare(cityName(b)))
                .map((cid) => (
                  <option key={cid} value={cid}>
                    {cityName(cid)} ({CITIES[cid].state})
                  </option>
                ))}
            </select>
          </div>

          <div className="form-row mt12">
            <label>Allowed Brands</label>
            <div className="dim small" style={{ marginBottom: 6 }}>
              Bays at this satellite will only service coaches of selected subsidiary brands. Select none to allow all brands across the company.
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 180,
                overflowY: 'auto',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg)',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newSiteBrands.length === 0}
                  onChange={(e) => {
                    if (e.target.checked) setNewSiteBrands([])
                  }}
                />
                <span><strong>All Brands</strong> (Universal access)</span>
              </label>
              {Object.values(s.groups ?? {}).map((grp) => (
                <label key={grp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newSiteBrands.includes(grp.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewSiteBrands([...newSiteBrands, grp.id])
                      } else {
                        setNewSiteBrands(newSiteBrands.filter((id) => id !== grp.id))
                      }
                    }}
                  />
                  <GroupBadge group={grp} />
                  <span>{grp.name} ({grp.code})</span>
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Workshop Location Brands Modal */}
      {editingLocation && (
        <Modal
          title={`Allowed Brands — ${cityName(editingLocation.cityId)}`}
          onClose={() => setEditingLocation(null)}
          actions={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="small text" onClick={() => setEditingLocation(null)}>
                Cancel
              </button>
              <button
                className="primary small"
                onClick={() => {
                  g.updateWorkshopLocationBrands(editingLocation.id, editLocationBrands)
                  setEditingLocation(null)
                }}
              >
                Save Allowed Brands
              </button>
            </div>
          }
        >
          <p className="dim small" style={{ marginBottom: 12 }}>
            Choose which subsidiary brands may occupy bays at <strong>{cityName(editingLocation.cityId)}</strong>.
            Buses not in this list will use other locations or outside commercial garages.
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              margin: '10px 0',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg)',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editLocationBrands.length === 0}
                onChange={(e) => {
                  if (e.target.checked) setEditLocationBrands([])
                }}
              />
              <span><strong>All Brands</strong> (Allow any company fleet vehicle)</span>
            </label>
            {Object.values(s.groups ?? {}).map((grp) => (
              <label key={grp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editLocationBrands.includes(grp.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setEditLocationBrands([...editLocationBrands, grp.id])
                    } else {
                      setEditLocationBrands(editLocationBrands.filter((id) => id !== grp.id))
                    }
                  }}
                />
                <GroupBadge group={grp} />
                <span>{grp.name} ({grp.code})</span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
