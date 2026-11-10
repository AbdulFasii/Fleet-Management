import { useState, useMemo } from 'react'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import { fmtDate, fmtDateShort } from '../../engine/core/calendar'
import {
  BAL,
  workshopJobDiscount,
  workshopJobSpeedup,
} from '../../engine/data/balance'
import { BUS_MODELS, modelTitleById } from '../../engine/data/busModels'
import {
  coachTitle,
  type CoachLayoutKind,
  DEFAULT_BODY_BUILDERS,
  busComfort,
} from '../../engine/data/bodyBuilders'
import { worstSubsystem, busAgeYears } from '../../engine/sim/fleet'
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
  tyresDue,
  rebodyBlocker,
  canChassisBeRebodied,
  quoteRebody,
  quotePowertrainOverhaul,
} from '../../engine/sim/maintenance'
import { fmtCompact, rs } from '../../engine/core/money'
import { CITIES, cityName } from '../../engine/data/cities'
import { ROUTES } from '../../engine/data/routes'
import { yardMonthlyRent, busesParkedInCity, outstationNightlyFee, nextDepotTankUpgrade, autoRefillThreshold } from '../../engine/sim/depot'
import { accountantOnDuty, deskOf, managersOnPayroll, staffedWorkshopBays } from '../../engine/sim/staffing'
import { spanMeters } from '../../engine/sim/span'
import type { Bus, MechanicTrade, Ownership, ServiceTierId, Staff, TyreAxle, TyreBrand, WorkshopLocation, ID } from '../../engine/types'
import { Bar, BusLink, CoachCell, Empty, GroupBadge, KV, M, Modal, PageHeader, Panel, StatRow, Tabs } from '../bits'
import { qty } from '../format'

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
    return <span className="pill accent small ml6">Annual Overhaul</span>
  }
  if (clean.includes('B-Service')) {
    return <span className="pill info small ml6">B-Service (Major)</span>
  }
  if (clean.includes('A-Service')) {
    return <span className="pill dim small ml6">A-Service (Minor)</span>
  }
  if (/tyres?:?/i.test(clean)) {
    return <span className="pill warn small ml6">{clean}</span>
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

/** Two side-by-side halves so a long list of bays does not run a single tall column. */
function splitColumns<T>(items: T[]): T[][] {
  if (items.length < 2) return [items]
  const half = Math.ceil(items.length / 2)
  return [items.slice(0, half), items.slice(half)]
}

export function WorkshopPage() {
  const s = useDeferredGameState()!
  const g = useGameActions()
  const [activeTab, setActiveTab] = useState<'jobs' | 'due' | 'upgrades' | 'depot' | 'claims'>('jobs')
  const [serviceFilter, setServiceFilter] = useState<'all' | 'overhaul' | 'service_b' | 'service_a' | 'tyres' | 'gps'>('all')
  const [overhaulFilter, setOverhaulFilter] = useState<'candidates' | 'all' | 'semi_sleeper' | 'low_condition' | 'in_progress'>('candidates')
  const [overhaulStudioBus, setOverhaulStudioBus] = useState<Bus | null>(null)
  const [overhaulTab, setOverhaulTab] = useState<'rebody' | 'powertrain'>('rebody')
  const [selectedBuilderId, setSelectedBuilderId] = useState<string>('')
  const [selectedDesignId, setSelectedDesignId] = useState<string>('')
  const [selectedLayoutKind, setSelectedLayoutKind] = useState<CoachLayoutKind>('sleeper')

  const openOverhaulStudio = (bus: Bus, tab?: 'rebody' | 'powertrain') => {
    setOverhaulStudioBus(bus)
    const model = BUS_MODELS[bus.modelId]
    const canRebody = model ? canChassisBeRebodied(model) : false
    const initialTab = tab ?? (canRebody ? 'rebody' : 'powertrain')
    setOverhaulTab(initialTab)
    const builders = s.bodyBuilders ?? DEFAULT_BODY_BUILDERS
    const compatible = Object.values(builders).filter((b) =>
      !model || b.makers.includes(model.maker as any),
    )
    const firstB = compatible[0] ?? Object.values(builders)[0]
    const bId = bus.bodyBuilderId && builders[bus.bodyBuilderId] ? bus.bodyBuilderId : (firstB?.id ?? 'prakesh')
    setSelectedBuilderId(bId)
    const firstD = builders[bId]?.designs[0]
    setSelectedDesignId(bus.bodyDesignId ?? firstD?.id ?? '')
    setSelectedLayoutKind('sleeper')
  }

  const buses = Object.values(s.buses)
  const inShop = buses.filter((b) => b.status === 'workshop')
  const managerCandidates = managersOnPayroll(s).filter(
    (st) => st.id === s.workshop.managerId || !deskOf(s, st.id),
  )
  const bayMechs = (s.workshop.mechanicIds ?? [])
    .filter((id): id is string => Boolean(id))
    .map((id) => s.staff[id])
    .filter(Boolean) as Staff[]
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
        (b.workshopJob.toLowerCase().includes('re-body') ||
         b.workshopJob.toLowerCase().includes('seat') ||
         b.workshopJob.toLowerCase().includes('powertrain') ||
         b.workshopJob.toLowerCase().includes('luxury')),
    )
    .sort((a, b) => (a.workshopUntilDay ?? 0) - (b.workshopUntilDay ?? 0))

  const midLifeCandidates = useMemo(() => {
    return buses.filter((b) => {
      if (b.ownership !== 'owned') return false
      const age = busAgeYears(s, b)
      const canRebody = canChassisBeRebodied(BUS_MODELS[b.modelId])
      const lowPowertrain = b.condition.engine < 75 || b.condition.gearbox < 75
      const lowBody = canRebody && (b.condition.body ?? 100) < 75
      return age >= 2.5 || b.odometer >= 200_000 || lowPowertrain || lowBody
    })
  }, [buses, s.day])

  const filteredOverhaulBuses = useMemo(() => {
    const owned = buses.filter((b) => b.ownership === 'owned')
    if (overhaulFilter === 'candidates') {
      return owned.filter((b) => {
        const age = busAgeYears(s, b)
        const canRebody = canChassisBeRebodied(BUS_MODELS[b.modelId])
        const lowPowertrain = b.condition.engine < 75 || b.condition.gearbox < 75
        const lowBody = canRebody && (b.condition.body ?? 100) < 75
        return age >= 2.5 || b.odometer >= 200_000 || lowPowertrain || lowBody
      })
    }
    if (overhaulFilter === 'semi_sleeper') {
      return owned.filter((b) => {
        const m = BUS_MODELS[b.modelId]
        return m && !m.sleeper && m.layout?.kind !== 'sleeper' && canChassisBeRebodied(m)
      })
    }
    if (overhaulFilter === 'low_condition') {
      return owned.filter((b) => {
        const canRebody = canChassisBeRebodied(BUS_MODELS[b.modelId])
        const lowPowertrain = b.condition.engine < 25 || b.condition.gearbox < 25
        const lowBody = canRebody && (b.condition.body ?? 100) < 25
        return lowPowertrain || lowBody
      })
    }
    if (overhaulFilter === 'in_progress') {
      return owned.filter((b) => b.status === 'workshop' && b.workshopJob && (
        b.workshopJob.toLowerCase().includes('re-body') ||
        b.workshopJob.toLowerCase().includes('powertrain') ||
        b.workshopJob.toLowerCase().includes('luxury') ||
        b.workshopJob.toLowerCase().includes('seat')
      ))
    }
    return owned
  }, [buses, overhaulFilter, s.day])

  const activeClaims = s.insuranceClaims?.filter((c) => c.status !== 'settled' && c.status !== 'rejected') ?? []

  const unstaffedWarning = bayMechs.length < s.workshop.bays

  const openSatellite = () => {
    setNewSiteCity('')
    setNewSiteBrands([])
    setShowAddSatelliteModal(true)
  }

  const yardRows = s.yards ?? []
  const depotCap = s.depotSlots ?? BAL.depot.baseSlots

  return (
    <>
      <PageHeader
        title="Workshop"
        facts={<>{s.workshop.bays === 0 ? 'no bays' : `${staffed}/${s.workshop.bays} bays staffed · -${Math.round(disc * 100)}% cost · ${Math.round(speed * 100)}% faster`}</>}
        factsTip={s.workshop.bays === 0 ? 'No own bays: outside garage rates apply' : `Foreman span ${qty(wsSpan.demand)}/${qty(wsSpan.capacity)} bays (${Math.round(wsSpan.coverage * 100)}%)`}
      >
        <Tabs
          inline
          tabs={[
            ['jobs', `Jobs (${inShop.length})`],
            ['due', `Due (${needsWork.length})`],
            ['upgrades', `Upgrades (${refurbBusesInWorks.length > 0 ? `${refurbBusesInWorks.length} in shop` : midLifeCandidates.length})`],
            ['depot', 'Depot'],
            ['claims', `Claims (${activeClaims.length})`],
          ] as const}
          value={activeTab}
          onChange={setActiveTab}
        />
      </PageHeader>

      <StatRow
        items={[
          { label: 'Bays', value: s.workshop.bays === 0 ? 'outside only' : `${freeBays} free / ${s.workshop.bays}`, tone: s.workshop.bays === 0 ? 'warn' : freeBays > 0 ? 'good' : 'warn', title: `${staffed} staffed (${Math.round(util * 100)}% used)` },
          { label: 'Speed', value: `+${Math.round(speed * 100)}%`, tone: 'accent', title: `${Math.round(disc * 100)}% cheaper than outside garages` },
          { label: 'Due', value: needsWork.length, tone: needsWork.length > 0 ? 'warn' : 'good' },
          { label: 'In shop', value: inShop.length, title: `${inShop.filter((b) => assignedJobIds.has(b.id)).length} on a bay, ${overflow.length} outside or queued` },
          { label: 'Depot', value: `${homeParkedCount}/${depotCap}`, tone: homeParkedCount > depotCap ? 'bad' : 'good', title: homeParkedCount > depotCap ? 'Street overflow: nightly fee and RTO risk' : 'Sheltered: -40% decay' },
        ]}
      />

      {/* ---------------- JOBS ---------------- */}
      {activeTab === 'jobs' && (
        <>
          <div className="row gap wrap mb12">
            <label className="row gap6" title="Books A and B services in-house on its own and pulls idle cover coaches">
              <span className="muted">Manager</span>
              <select value={s.workshop.managerId ?? ''} onChange={(e) => g.appointFleetManager(e.target.value || undefined)}>
                <option value="">none</option>
                {managerCandidates.map((st) => (
                  <option key={st.id} value={st.id}>{st.name} · skill {st.skill}</option>
                ))}
              </select>
            </label>
            <label className="row gap6" title="Tyre brand the manager fits when tyres wear out">
              <span className="muted">Tyres</span>
              <select value={s.company.workshopTyreBrand ?? 'oem'} onChange={(e) => g.setWorkshopTyreBrand(e.target.value as 'oem' | 'tier2')}>
                <option value="oem">OEM · {fmtCompact(BAL.tyres.oem.price)}</option>
                <option value="tier2">Tier-2 · {fmtCompact(BAL.tyres.tier2.price)}</option>
              </select>
            </label>
            <span className="grow" />
            {s.workshop.bays === 0 ? (
              <button className="primary small" onClick={() => g.openWorkshopLocation(s.company.homeCityId, [])}>
                Build HQ workshop · {fmtCompact(BAL.workshopSiteFirstBayCost)}
              </button>
            ) : (
              <button className="primary small" onClick={openSatellite} title="A workshop in another city: first bay includes opening the depot">
                + Satellite · {fmtCompact(BAL.workshopSiteFirstBayCost)}
              </button>
            )}
          </div>

          {s.workshop.bays === 0 ? (
            <Panel flat><Empty text="No workshop built. Maintenance is outsourced at full price." /></Panel>
          ) : (
            locations.map((loc) => {
              const locBays = bays.filter((b) => b.locationId === loc.id)
              const isHQ = loc.cityId === s.company.homeCityId
              return (
                <Panel
                  key={loc.id}
                  flat
                  title={
                    <>
                      {cityName(loc.cityId)}
                      {isHQ && <span className="pill good small ml8">HQ</span>}
                      <span className="muted ml8">{loc.bayCount} bay{loc.bayCount === 1 ? '' : 's'}</span>
                    </>
                  }
                  right={
                    <span className="row gap6">
                      {loc.groupIds.length === 0
                        ? <span className="muted">all brands</span>
                        : loc.groupIds.map((gid) => (s.groups?.[gid] ? <GroupBadge key={gid} group={s.groups[gid]} /> : null))}
                      <button className="small" onClick={() => { setEditingLocation(loc); setEditLocationBrands([...loc.groupIds]) }}>Brands</button>
                      <button className="small primary" onClick={() => g.addWorkshopBayAtLocation(loc.id)} title={`Add a bay at ${cityName(loc.cityId)}`}>
                        + Bay · {fmtCompact(BAL.workshopBayCostFlat)}
                      </button>
                    </span>
                  }
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(540px, 1fr))', gap: 16, alignItems: 'start' }}>
                  {splitColumns(locBays).map((list, col) => (
                  <table key={col} className="data" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 50 }} />
                      <col style={{ width: 235 }} />
                      <col />
                      <col style={{ width: 95 }} />
                      <col style={{ width: 55 }} />
                    </colgroup>
                    <thead>
                      <tr><th>Bay</th><th>Mechanic</th><th>Job</th><th>Owner</th><th className="num">Left</th></tr>
                    </thead>
                    <tbody>
                      {list.map((bay) => {
                        const onLeave = Boolean(bay.mechanic?.onLeaveUntilDay && bay.mechanic.onLeaveUntilDay >= s.day)
                        const vacant = !bay.mechanic
                        return (
                          <tr key={bay.index}>
                            <td className="accent"><b>#{bay.index}</b></td>
                            <td className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {vacant ? (
                                freeMechanics.length > 0 ? (
                                  <select
                                    value=""
                                    style={{ maxWidth: '100%' }}
                                    onChange={(e) => { if (e.target.value) g.appointBayMechanic(e.target.value, bay.globalBayIndex) }}
                                  >
                                    <option value="">+ appoint mechanic</option>
                                    {freeMechanics.map((st) => (
                                      <option key={st.id} value={st.id}>{st.name} · {tradeLabel(st.mechanicTrade)} · sk {st.skill}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="bad" title="Hire mechanics on the Staff page">unstaffed</span>
                                )
                              ) : (
                                <>
                                  <b>{bay.mechanic!.name}</b>
                                  <span className="muted"> {tradeLabel(bay.mechanic!.mechanicTrade)} · sk {bay.mechanic!.skill}{onLeave ? ' · on leave' : ''}</span>{' '}
                                  <button className="small dim" title="Remove from this bay" onClick={() => g.unappointBayMechanic(bay.mechanic!.id)}>×</button>
                                </>
                              )}
                            </td>
                            <td style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {vacant || onLeave ? (
                                <span className="dim">{vacant ? 'idle' : 'mechanic on leave'}</span>
                              ) : bay.job ? (
                                <>
                                  <BusLink id={bay.job.id} reg={bay.job.reg} />
                                  <span className="muted"> {modelTitleById(bay.job.modelId)}</span>
                                  <ServiceJobBadge jobLabel={bay.job.workshopJob} />
                                </>
                              ) : (
                                <span className="good">ready</span>
                              )}
                            </td>
                            <td style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {bay.job ? <OwnershipCell ownership={bay.job.ownership} attachShare={bay.job.attach?.ownerShare} /> : <span className="dim">—</span>}
                            </td>
                            <td className="num">{bay.job ? <b className="accent">{Math.max(0, (bay.job.workshopUntilDay ?? s.day) - s.day)}d</b> : <span className="dim">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  ))}
                  </div>
                </Panel>
              )
            })
          )}

          {unstaffedWarning && s.workshop.bays > 0 && (
            <div className="warn muted mb12">Unstaffed bays stay idle. Hire mechanics on the Staff page.</div>
          )}

          {overflow.length > 0 && (
            <Panel
              flat
              title={`Outside or waiting (${overflow.length})`}
              right={<span className="muted" title="Owned coaches get staffed bays first. Overflow runs at outside garage rates until a bay frees up.">why?</span>}
            >
              <table className="data">
                <thead>
                  <tr><th>Bus</th><th>Model</th><th>Owner</th><th>Job</th><th className="num">Left</th></tr>
                </thead>
                <tbody>
                  {overflow.map((b) => (
                    <tr key={b.id}>
                      <td><BusLink id={b.id} reg={b.reg} /></td>
                      <td className="muted">{modelTitleById(b.modelId)}</td>
                      <td><OwnershipCell ownership={b.ownership} attachShare={b.attach?.ownerShare} /></td>
                      <td><ServiceJobBadge jobLabel={b.workshopJob} /></td>
                      <td className="num">{Math.max(0, (b.workshopUntilDay ?? s.day) - s.day)}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}

      {/* ---------------- DUE ---------------- */}
      {activeTab === 'due' && (
        <Panel
          flat
          title={`Due (${filteredNeedsWork.length})`}
          right={
            <Tabs
              inline
              tabs={[
                ['all', `All (${needsWork.length})`],
                ['overhaul', 'Overhaul'],
                ['service_b', 'B-service'],
                ['service_a', 'A-service'],
                ['tyres', 'Tyres'],
                ['gps', 'GPS'],
              ] as const}
              value={serviceFilter}
              onChange={setServiceFilter}
            />
          }
        >
          {filteredNeedsWork.length === 0 ? (
            <Empty text="Nothing due here. Active coaches are road-ready." />
          ) : (
            <div className="xscroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bus</th>
                    <th>Own</th>
                    <th>Condition</th>
                    <th>Due</th>
                    <th>Front tyres</th>
                    <th>Rear tyres</th>
                    <th className="num">Action</th>
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
                    const worst = worstSubsystem(b.condition)
                    const deferred = serviceDeferredForBus(s, b)
                    const resume = serviceResumeDay(s.day)
                    return (
                      <tr key={b.id}>
                        <td>
                          <BusLink id={b.id} reg={b.reg} />
                          {!b.gpsDeviceFitted && <span className="pill warn small ml6">no GPS</span>}
                          <div className="muted">{modelTitleById(b.modelId)}</div>
                        </td>
                        <td><OwnershipCell ownership={b.ownership} attachShare={b.attach?.ownerShare} /></td>
                        <td className="nowrap">
                          <Bar value={worst / 100} tone="auto" width={8} /> <span className={worst < 50 ? 'bad' : 'good'}>{Math.round(worst)}%</span>
                        </td>
                        <td className="nowrap">
                          {overhaulInfo.isDue ? (
                            <span className="bad" title="Annual overhaul due (365 days or 250k km)"><b>Overhaul</b> {Math.max(1, Math.round(overhaulInfo.dueKm / 1000))}k over</span>
                          ) : dueB > 0 ? (
                            <span className="bad" title="B-service due every 100k km"><b>B-service</b> {Math.round(dueB / 1000)}k over</span>
                          ) : due > 0 ? (
                            <span className="warn" title="A-service due every 25k km"><b>A-service</b> {Math.round(due / 1000)}k over</span>
                          ) : (
                            <span className="dim">{Math.round(-due / 1000)}k to A</span>
                          )}
                        </td>
                        <td className="nowrap">
                          <span className={tyreInfo.frontDue ? 'bad' : tyreInfo.frontPct >= 0.75 ? 'warn' : 'dim'}>{Math.round(tyreInfo.frontPct * 100)}%</span>{' '}
                          <select value={fBrand} onChange={(e) => setFrontBrandSelect((p) => ({ ...p, [b.id]: e.target.value as 'oem' | 'tier2' }))}>
                            <option value="oem">OEM</option>
                            <option value="tier2">Tier-2</option>
                          </select>{' '}
                          <button className="small" onClick={() => handleReplaceTyres(b, 'front', fBrand)} title={`Fit 2 front tyres (${fBrand.toUpperCase()})`}>
                            Fit {fmtCompact(fCost)}
                          </button>
                        </td>
                        <td className="nowrap">
                          <span className={tyreInfo.rearDue ? 'bad' : tyreInfo.rearPct >= 0.75 ? 'warn' : 'dim'}>{Math.round(tyreInfo.rearPct * 100)}%</span>{' '}
                          <select value={rBrand} onChange={(e) => setRearBrandSelect((p) => ({ ...p, [b.id]: e.target.value as 'oem' | 'tier2' | 'retread' }))}>
                            <option value="oem">OEM</option>
                            <option value="tier2">Tier-2</option>
                            <option value="retread">Retread</option>
                          </select>{' '}
                          <button className="small" onClick={() => handleReplaceTyres(b, 'rear', rBrand)} title={`Fit rear drive tyres (${rBrand.toUpperCase()})`}>
                            Fit {fmtCompact(rCost)}
                          </button>
                        </td>
                        <td className="num nowrap">
                          {deferred ? (
                            <span className="dim" title="Scheduled coaches are kept on the road through peak festival windows">festival hold{resume ? ` · ${fmtDateShort(resume)}` : ''}</span>
                          ) : (
                            <>
                              {!b.gpsDeviceFitted && (
                                <button className="small warn" onClick={() => g.fitGps(b.id)} title={`Fit AIS-140 GPS (${fmtCompact(BAL.gpsFitCost)})`}>GPS</button>
                              )}{' '}
                              <button
                                className={`small ${tierDue === 'overhaul' ? 'accent' : tierDue === 'b' ? 'primary' : ''}`}
                                onClick={() => handleService(b, tierDue)}
                                title={`${BAL.serviceTiers[tierDue].label}: ${BAL.serviceTiers[tierDue].costMult}× cost, ${BAL.serviceTiers[tierDue].days} days`}
                              >
                                {tierDue === 'overhaul' ? 'Overhaul' : tierDue === 'b' ? 'B-service' : 'A-service'}
                              </button>
                            </>
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

      {/* ---------------- UPGRADES ---------------- */}
      {activeTab === 'upgrades' && (
        <>
          {refurbBusesInWorks.length > 0 && (
            <Panel flat title={`In the workshop (${refurbBusesInWorks.length})`}>
              <table className="data">
                <thead>
                  <tr><th>Coach</th><th>Job</th><th>Progress</th><th className="num">Ready</th></tr>
                </thead>
                <tbody>
                  {refurbBusesInWorks.map((b) => {
                    const daysLeft = Math.max(0, (b.workshopUntilDay ?? s.day) - s.day)
                    const done = Math.max(0.05, Math.min(1, (14 - daysLeft) / 14))
                    return (
                      <tr key={b.id}>
                        <td><CoachCell bus={b} /></td>
                        <td>{b.workshopJob}</td>
                        <td className="nowrap"><Bar value={done} tone="good" width={10} /> <span className="muted">{Math.round(done * 100)}%</span></td>
                        <td className="num">{daysLeft}d{b.workshopUntilDay ? <span className="muted"> · {fmtDate(b.workshopUntilDay)}</span> : null}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel
            flat
            title={`Fleet (${filteredOverhaulBuses.length})`}
            right={
              <Tabs
                inline
                tabs={[
                  ['candidates', `Mid-life (${midLifeCandidates.length})`],
                  ['semi_sleeper', 'Semi-sleepers'],
                  ['low_condition', 'Low health'],
                  ['in_progress', 'In shop'],
                  ['all', 'All owned'],
                ] as const}
                value={overhaulFilter}
                onChange={setOverhaulFilter}
              />
            }
          >
            {filteredOverhaulBuses.length === 0 ? (
              <Empty text="No coaches match." />
            ) : (
              <div className="xscroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Coach</th>
                      <th>Layout</th>
                      <th className="num" title="Engine / gearbox condition, plus coach body condition">Health</th>
                      <th>Spec</th>
                      <th className="num">Upgrade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOverhaulBuses.map((bus) => {
                      const m = BUS_MODELS[bus.modelId]
                      const canRebody = canChassisBeRebodied(m)
                      const isSleeper = Boolean(m?.sleeper || m?.layout?.kind === 'sleeper')
                      const isLuxury = bus.luxuryRetrofitDay !== undefined || bus.airSuspensionFitted
                      const inShopNow = bus.status === 'workshop'
                      const tone = (v: number) => (v >= 75 ? 'good' : v >= 50 ? 'warn' : 'bad')
                      return (
                        <tr key={bus.id}>
                          <td>
                            <BusLink id={bus.id} reg={bus.reg} />
                            <div className="muted">{coachTitle(m, bus.bodyDesignName)} · {busAgeYears(s, bus).toFixed(1)}y · {(bus.odometer / 1000).toFixed(0)}k km</div>
                          </td>
                          <td className="nowrap">
                            {isSleeper ? 'Sleeper' : m?.layout?.kind === 'hybrid' ? 'Hybrid' : 'Semi-sleeper'}
                            <span className="muted"> {m?.seats} {isSleeper ? 'berths' : 'seats'}</span>
                          </td>
                          <td className="num nowrap">
                            <span className={tone(bus.condition.engine)} title={`Engine: ${Math.round(bus.condition.engine)}%`}>{Math.round(bus.condition.engine)}%</span>
                            {' / '}
                            <span className={tone(bus.condition.gearbox)} title={`Gearbox: ${Math.round(bus.condition.gearbox)}%`}>{Math.round(bus.condition.gearbox)}%</span>
                            {canRebody && (bus.condition.body ?? 100) < 25 && (
                              <span className={`pill small ml6 ${tone(bus.condition.body ?? 100)}`} title={`Coach body condition: ${Math.round(bus.condition.body ?? 100)}% (eligible for Re-body)`}>
                                Body {Math.round(bus.condition.body ?? 100)}%
                              </span>
                            )}
                          </td>
                          <td className="nowrap">
                            <b>{busComfort(s, bus).toFixed(1)}★</b>
                            {bus.powertrainOverhaulDay !== undefined && <span className="pill good small ml6" title="+10% fuel economy">rebuilt</span>}
                            {isLuxury && <span className="pill accent small ml6">air susp.</span>}
                            {bus.refurbishedDay !== undefined && <span className="pill good small ml6">re-bodied</span>}
                          </td>
                          <td className="num nowrap">
                            {inShopNow ? (
                              <span className="pill info small">in shop · {Math.max(0, (bus.workshopUntilDay ?? s.day) - s.day)}d</span>
                            ) : (
                              <>
                                {canRebody ? (
                                  <button className="small primary" onClick={() => openOverhaulStudio(bus, 'rebody')} title="New body and layout. Resets body, AC and electrical, +5 years of life">Re-body</button>
                                ) : (
                                  <span className="pill dim small" title="Factory monocoque van: cannot be re-bodied">monocoque</span>
                                )}{' '}
                                <button className={`small ${!canRebody ? 'primary' : ''}`} onClick={() => openOverhaulStudio(bus, 'powertrain')} title="Engine and gearbox rebuild: +10% fuel economy, half the breakdown risk">Powertrain</button>
                              </>
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
        </>
      )}

      {/* ---------------- DEPOT ---------------- */}
      {activeTab === 'depot' && (
        <>
          <div className="grid-2">
            <Panel title={`Home depot · ${cityName(s.company.homeCityId)}`}>
              <KV rows={[
                ['Slots', <span className={homeParkedCount > depotCap ? 'bad' : ''}>{homeParkedCount} / {depotCap}</span>],
                ['Parking', homeParkedCount > depotCap
                  ? <span className="bad" title={`${fmtCompact(BAL.depot.overflowFeePerBusNight)} per bus per night, plus RTO impound risk`}>{homeParkedCount - depotCap} on the street</span>
                  : <span className="good" title="Sheltered coaches decay 40% slower">sheltered</span>],
                ['Rent', `${fmtCompact(BAL.depotRentBase + Math.max(0, Math.max(buses.length, depotCap) - BAL.depot.baseSlots) * BAL.depotRentPerExtraBus)}/mo`],
              ]} />
              <button className="primary small mt12" onClick={() => g.expandDepot()}>+1 slot · {fmtCompact(BAL.depot.expandSlotCost)}</button>
            </Panel>

            <Panel title="Fuel tank">
              {s.company.depotFuelTank?.installed ? (
                (() => {
                  const tank = s.company.depotFuelTank
                  const wholesale = Math.max(rs(70), s.world.dieselPaise - BAL.fuelCommercial.wholesaleDiscountPerLitre)
                  const cost8k = Math.round(8_000 * wholesale)
                  const free = tank.capacityLitres - tank.litres
                  const canFill = free >= 1000
                  const fillLitres = Math.floor(free / 1000) * 1000
                  const next = nextDepotTankUpgrade(s)
                  const threshold = autoRefillThreshold(tank.capacityLitres)
                  return (
                    <>
                      <KV rows={[
                        ['Level', <span><Bar value={tank.litres / tank.capacityLitres} tone="auto" /> <b>{Math.round(tank.litres).toLocaleString('en-IN')} L</b> <span className="muted">of {tank.capacityLitres.toLocaleString('en-IN')}</span></span>],
                        ['Saving', <span className="good" title="₹4.00 a litre below pump price">₹4/L</span>],
                        ['Auto-refill', (
                          <label className="row gap6" title={`Orders full 8,000 L tanker loads when the level drops to ${threshold.toLocaleString('en-IN')} L`}>
                            <input type="checkbox" checked={!!tank.autoRefill} onChange={(e) => g.toggleAutoRefillDepotTank(e.target.checked)} />
                            <span>{tank.autoRefill ? 'on' : 'off'}</span>
                          </label>
                        )],
                      ]} />
                      <div className="row gap6 wrap mt12">
                        <button className="primary small" disabled={!canFill} onClick={() => g.orderDepotFuelRefill(8_000)}>
                          Order 8,000 L · {fmtCompact(cost8k)}
                        </button>
                        {fillLitres > 8_000 && (
                          <button className="small" onClick={() => g.orderDepotFuelRefill(fillLitres)}>
                            Fill up {fillLitres.toLocaleString('en-IN')} L · {fmtCompact(Math.round(fillLitres * wholesale))}
                          </button>
                        )}
                        {next ? (
                          <button
                            className="small"
                            title="A bigger tank holds more cheap wholesale diesel between tankers. Fuel already in the tank stays."
                            onClick={() => g.upgradeDepotFuelTank()}
                          >
                            Upgrade to {next.capacityLitres.toLocaleString('en-IN')} L · {fmtCompact(next.cost)}
                          </button>
                        ) : (
                          <span className="muted small">Largest tank size</span>
                        )}
                      </div>
                    </>
                  )
                })()
              ) : (
                <>
                  <Empty text="No bulk tank. Coaches fuel at pumps at retail price." />
                  <button className="primary small" title="Saves ₹4 a litre on all home departures" onClick={() => g.installDepotFuelTank()}>
                    Install 10,000 L tank · {fmtCompact(BAL.fuelCommercial.depotTankInstallCost)}
                  </button>
                </>
              )}
            </Panel>
          </div>

          <Panel
            flat
            title="Outstation yards"
            right={
              availableCitiesToLease.length > 0 && (
                <span className="row gap6">
                  <select value={selectedLeaseCity || availableCitiesToLease[0]} onChange={(e) => setSelectedLeaseCity(e.target.value)}>
                    {availableCitiesToLease.map((c) => {
                      const parked = busesParkedInCity(s, c).length
                      return (
                        <option key={c} value={c}>
                          {cityName(c)} · {fmtCompact(yardMonthlyRent(c))}/mo · {parked} parked{parked > 0 ? ` · saves ${fmtCompact(parked * outstationNightlyFee(c) * 30)}/mo` : ''}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    className="small primary"
                    onClick={() => {
                      const target = selectedLeaseCity || availableCitiesToLease[0]
                      if (target) {
                        g.leaseYard(target)
                        setSelectedLeaseCity('')
                      }
                    }}
                  >
                    Lease
                  </button>
                </span>
              )
            }
          >
            {yardRows.length === 0 ? (
              <Empty text="No yards leased. Turnaround coaches pay public parking of ₹200 to ₹500 a night." />
            ) : (
              <table className="data">
                <thead>
                  <tr><th>City</th><th className="num">Parked</th><th className="num">Rent/mo</th><th>Type</th><th /></tr>
                </thead>
                <tbody>
                  {yardRows.map((y) => {
                    const parked = busesParkedInCity(s, y.cityId)
                    return (
                      <tr key={y.cityId}>
                        <td><b>{cityName(y.cityId)}</b></td>
                        <td className="num" title={parked.map((b) => b.reg).join(', ')}>{parked.length}</td>
                        <td className="num"><M v={y.monthlyRent} /></td>
                        <td className="muted">{y.covered ? 'covered' : 'open lot'}</td>
                        <td className="num"><button className="small warn" onClick={() => g.cancelYard(y.cityId)}>Cancel</button></td>
                      </tr>
                    )
                  })}
                  <tr className="total">
                    <td><b>{yardRows.length} yard{yardRows.length === 1 ? '' : 's'}</b></td>
                    <td className="num">{yardRows.reduce((n, y) => n + busesParkedInCity(s, y.cityId).length, 0)}</td>
                    <td className="num"><M v={yardRows.reduce((n, y) => n + y.monthlyRent, 0)} /></td>
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* ---------------- CLAIMS ---------------- */}
      {activeTab === 'claims' && (
        <Panel
          flat
          title="Insurance claims"
          right={
            <span className="muted" title={accountantOnDuty(s) ? `${accountantOnDuty(s)!.name} settles surveyed claims automatically` : 'Appoint an accounts manager to settle claims automatically'}>
              {accountantOnDuty(s) ? 'auto-settle on' : 'manual'}
            </span>
          }
        >
          {(s.insuranceClaims?.length ?? 0) === 0 ? (
            <Empty text="No claims. Accidents and major breakdowns file them here." />
          ) : (
            <table className="data">
              <thead>
                <tr><th>Bus</th><th>Status</th><th className="num">Repair estimate</th><th className="num">Action</th></tr>
              </thead>
              <tbody>
                {s.insuranceClaims
                  .filter((c) => (c.status !== 'settled' && c.status !== 'rejected') || s.day - (c.resolvedDay ?? c.filedDay) <= 14)
                  .map((c) => {
                    const bus = s.buses[c.busId]
                    const ready = s.day >= c.surveyorUntilDay
                    return (
                      <tr key={c.id}>
                        <td><CoachCell bus={bus} /></td>
                        <td>
                          {c.status === 'settled' ? (
                            <span className="good">settled +<M v={c.payout ?? 0} /></span>
                          ) : c.status === 'rejected' ? (
                            <span className="bad" title="Rejected: the cost stays with the company">rejected</span>
                          ) : c.status === 'garage_paid' ? (
                            <span className="info">garage paid</span>
                          ) : ready ? (
                            <span className="accent">survey done</span>
                          ) : (
                            <span className="dim">survey until {fmtDateShort(c.surveyorUntilDay)}</span>
                          )}
                        </td>
                        <td className="num"><b><M v={c.repairEstimate} /></b></td>
                        <td className="num nowrap">
                          {c.status !== 'settled' && c.status !== 'rejected' && (
                            <>
                              {c.status !== 'garage_paid' && <button className="small" onClick={() => g.payGarageClaim(c.id)}>Pay garage</button>}{' '}
                              <button className="small primary" disabled={!ready && c.status === 'survey'} onClick={() => g.settleInsuranceClaim(c.id)}>Settle</button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {/* ---------------- MODALS ---------------- */}
      {outsideModal && (
        <Modal
          title="Send to an outside garage?"
          onClose={() => setOutsideModal(null)}
          actions={
            <>
              <button onClick={() => setOutsideModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  if (outsideModal.action === 'service') g.serviceBus(outsideModal.busId, outsideModal.tier, { outside: true })
                  else if (outsideModal.action === 'tyres') g.replaceTyres(outsideModal.busId, outsideModal.axle, outsideModal.brand, { outside: true })
                  setOutsideModal(null)
                }}
              >
                Send for {fmtCompact(outsideModal.cost)}
              </button>
            </>
          }
        >
          <KV rows={[
            ['Coach', outsideModal.reg],
            ['Job', outsideModal.title],
            ['Outside quote', fmtCompact(outsideModal.cost)],
            ['Turnaround', `${outsideModal.days} day${outsideModal.days === 1 ? '' : 's'}`],
          ]} />
          <div className="muted mt12">No free staffed bay here (full, or the bay is restricted to other brands).</div>
        </Modal>
      )}

      {showAddSatelliteModal && (
        <Modal
          title="Open satellite workshop"
          onClose={() => setShowAddSatelliteModal(false)}
          actions={
            <>
              <button onClick={() => setShowAddSatelliteModal(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!newSiteCity}
                onClick={() => {
                  if (!newSiteCity) return
                  g.openWorkshopLocation(newSiteCity, newSiteBrands)
                  setShowAddSatelliteModal(false)
                }}
              >
                Open for {fmtCompact(BAL.workshopSiteFirstBayCost)}
              </button>
            </>
          }
        >
          <div className="stack14">
            <label className="stack10" title={`First bay ${fmtCompact(BAL.workshopSiteFirstBayCost)} includes opening the depot. Each extra bay ${fmtCompact(BAL.workshopBayCostFlat)}.`}>
              <span className="muted">City</span>
              <select value={newSiteCity} onChange={(e) => setNewSiteCity(e.target.value)}>
                <option value="">choose a city</option>
                {Object.keys(CITIES)
                  .filter((cid) => !locations.some((l) => l.cityId === cid))
                  .sort((a, b) => cityName(a).localeCompare(cityName(b)))
                  .map((cid) => <option key={cid} value={cid}>{cityName(cid)} ({CITIES[cid].state})</option>)}
              </select>
            </label>
            <div>
              <div className="muted mb8" title="Bays here only serve the selected brands. Leave on all brands to serve the whole company.">Allowed brands</div>
              <BrandChecks groups={Object.values(s.groups ?? {})} value={newSiteBrands} onChange={setNewSiteBrands} />
            </div>
          </div>
        </Modal>
      )}

      {editingLocation && (
        <Modal
          title={`Allowed brands · ${cityName(editingLocation.cityId)}`}
          onClose={() => setEditingLocation(null)}
          actions={
            <>
              <button onClick={() => setEditingLocation(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  g.updateWorkshopLocationBrands(editingLocation.id, editLocationBrands)
                  setEditingLocation(null)
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="muted mb8" title="Coaches of other brands use other locations or outside garages">Brands served at this workshop</div>
          <BrandChecks groups={Object.values(s.groups ?? {})} value={editLocationBrands} onChange={setEditLocationBrands} />
        </Modal>
      )}

      {overhaulStudioBus && (() => {
        const bus = overhaulStudioBus
        const m = BUS_MODELS[bus.modelId]
        const age = busAgeYears(s, bus)
        const canRebody = canChassisBeRebodied(m)
        const blocker = rebodyBlocker(bus)
        const builders = s.bodyBuilders ?? DEFAULT_BODY_BUILDERS
        const compatibleBuilders = Object.values(builders).filter((b) => !m || b.makers.includes(m.maker as never))
        const currentBuilder = builders[selectedBuilderId] ?? compatibleBuilders[0] ?? Object.values(builders)[0]
        const currentDesign = currentBuilder?.designs.find((d) => d.id === selectedDesignId) ?? currentBuilder?.designs[0]

        const quote =
          overhaulTab === 'rebody' ? quoteRebody(s, bus, currentDesign?.id)
          : quotePowertrainOverhaul(s, bus)
        const affordable = s.company.cash >= quote.cost
        const idle = bus.status === 'active'
        const blocked =
          !affordable || !idle || (overhaulTab === 'rebody' && (!canRebody || Boolean(blocker)))
        const confirmLabel =
          overhaulTab === 'rebody' && !canRebody ? 'Cannot re-body a monocoque van'
          : !affordable ? 'Not enough cash'
          : !idle ? 'Coach not active'
          : overhaulTab === 'rebody' && blocker ? 'Requirements not met'
          : overhaulTab === 'rebody' ? 'Start re-body'
          : 'Start rebuild'
        const pct = (v: number) => `${Math.round(v)}%`

        const confirm = () => {
          if (overhaulTab === 'rebody') g.rebodyBus(bus.id, selectedDesignId, selectedLayoutKind)
          else g.overhaulPowertrain(bus.id)
          setOverhaulStudioBus(null)
        }

        const LAYOUTS: [CoachLayoutKind, string, string][] = [
          ['sleeper', 'Executive sleeper 2+1', 'All berths. Highest weekend fares, suits overnight routes.'],
          ['hybrid', 'Hybrid sleeper 2+1', 'Lower deck seats, upper deck berths.'],
          ['semi', 'Semi-sleeper 2+2', 'Most seats. Suits dense daytime corridors.'],
        ]
        const layoutLabel = LAYOUTS.find(([k]) => k === selectedLayoutKind)?.[1] ?? ''

        return (
          <Modal
            title={`Upgrade ${bus.reg}`}
            wide
            onClose={() => setOverhaulStudioBus(null)}
            actions={
              <>
                <div className="grow">
                  <b className="accent">{fmtCompact(quote.cost)}</b>
                  <span className="muted"> · {quote.days} days in the workshop</span>
                </div>
                <button onClick={() => setOverhaulStudioBus(null)}>Close</button>
                <button className="primary" disabled={blocked} onClick={confirm}>{confirmLabel}</button>
              </>
            }
          >
            <div className="stack14">
              <div className="muted">
                {coachTitle(m, bus.bodyDesignName)} · {age.toFixed(1)} years · {(bus.odometer / 1000).toFixed(0)}k km
              </div>

              <Tabs
                tabs={[
                  ['rebody', 'Re-body'],
                  ['powertrain', 'Powertrain'],
                ] as const}
                value={overhaulTab}
                onChange={setOverhaulTab}
              />

              {overhaulTab === 'rebody' && (
                <>
                  {blocker && <div className="bad">{blocker}</div>}
                  <div className="grid-2">
                    <label className="stack10">
                      <span className="muted">Body builder</span>
                      <select
                        value={selectedBuilderId}
                        onChange={(e) => {
                          const bId = e.target.value
                          setSelectedBuilderId(bId)
                          const d = builders[bId]?.designs[0]
                          if (d) setSelectedDesignId(d.id)
                        }}
                      >
                        {compatibleBuilders.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.makers.join(', ')})</option>)}
                      </select>
                    </label>
                    <label className="stack10">
                      <span className="muted">Design</span>
                      <select value={selectedDesignId} onChange={(e) => setSelectedDesignId(e.target.value)}>
                        {(currentBuilder?.designs ?? []).map((d) => (
                          <option key={d.id} value={d.id}>{d.name} {d.layoutKinds ? `(${d.layoutKinds.join(', ')})` : ''}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="stack10">
                    {LAYOUTS.map(([k, title, desc]) => (
                      <label key={k} className="row gap" style={{ cursor: 'pointer' }} title={desc}>
                        <input type="radio" name="layout" checked={selectedLayoutKind === k} onChange={() => setSelectedLayoutKind(k)} />
                        <b className="bold">{title}</b>
                        <span className="muted">{desc}</span>
                      </label>
                    ))}
                  </div>
                  <table className="data">
                    <thead><tr><th /><th>Now</th><th>After</th></tr></thead>
                    <tbody>
                      <tr><td>Coach</td><td>{coachTitle(m, bus.bodyDesignName)}</td><td className="accent">{currentDesign?.name ?? 'Custom shell'} · {layoutLabel}</td></tr>
                      <tr><td>Useful life</td><td>~{Math.max(0, 15 - Math.round(age))} years left</td><td className="good">+5 years</td></tr>
                      <tr><td>Body / AC / electrical</td><td>{pct(bus.condition.body)} / {pct(bus.condition.ac)} / {pct(bus.condition.electrical)}</td><td className="good">reset to 90%</td></tr>
                    </tbody>
                  </table>
                </>
              )}

              {overhaulTab === 'powertrain' && (
                <table className="data" title="Full strip-down: liners, pistons, crankshaft, turbo, injectors and synchro rings">
                  <thead><tr><th /><th>Now</th><th>After</th></tr></thead>
                  <tbody>
                    <tr><td>Engine</td><td className={bus.condition.engine >= 75 ? 'good' : 'warn'}>{pct(bus.condition.engine)}</td><td className="good">98%</td></tr>
                    <tr><td>Gearbox</td><td className={bus.condition.gearbox >= 75 ? 'good' : 'warn'}>{pct(bus.condition.gearbox)}</td><td className="good">98%</td></tr>
                    <tr><td>Breakdown risk</td><td>normal wear</td><td className="good">halved</td></tr>
                    <tr><td>Fuel economy</td><td>{bus.powertrainOverhaulDay ? '+10% (rebuilt)' : 'stock'}</td><td className="good">+10%</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </Modal>
        )
      })()}
    </>
  )
}

/** Brand access list shared by the satellite and brand-edit screens. Empty selection means all brands. */
function BrandChecks({ groups, value, onChange }: {
  groups: { id: ID; name: string; code: string; color: string }[]
  value: ID[]
  onChange: (v: ID[]) => void
}) {
  // An empty selection means "all brands". Ticking every brand is the same thing, shown as "All" ticked.
  const ids = groups.map((g) => g.id)
  const selected = value.length === 0 ? ids : value
  const allOn = ids.length > 0 && ids.every((id) => selected.includes(id))
  return (
    <div className="stack10">
      <label className="row gap6" style={{ cursor: allOn ? 'default' : 'pointer' }} title={allOn ? 'Untick a brand below to narrow the list' : undefined}>
        <input type="checkbox" checked={allOn} disabled={allOn} onChange={(e) => { if (e.target.checked) onChange(ids) }} />
        <b className="bold">All brands</b>
      </label>
      {groups.map((grp) => (
        <label key={grp.id} className="row gap6" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={selected.includes(grp.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, grp.id] : selected.filter((id) => id !== grp.id))}
          />
          <GroupBadge group={grp} />
          <span>{grp.name}</span>
        </label>
      ))}
    </div>
  )
}
