import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { BAL } from '../../engine/data/balance'
import { ROUTES, routeName, cityName, canonicalRouteId, isOvernight, haulTitle, routeViaLabel } from '../../engine/data/routes'
import { BUS_MODELS, coachKind, coachKindClass, isCargoModel, modelTitleById } from '../../engine/data/busModels'
import { enabledChannelLabels } from '../../engine/data/channels'
import { getScheduleDefaults, scheduleIsCargo, scheduleOccLf } from '../../engine/sim/schedules'
import { serviceTierFareMult } from '../../engine/sim/pricing'
import { isNewVehicle } from '../../engine/sim/fleet'
import { fmtTurnaround, runningMinutes, suggestReturnSlot, hasYardOrHome, recommendedFleetSize, turnaroundMinutes } from '../../engine/sim/pairing'
import { clockFromMinutes, clockMinutes, fmtClock, HALF_HOUR_SLOTS } from '../../engine/core/calendar'
import { toRupees, rs } from '../../engine/core/money'
import type { Bus, GameState, ID, RouteDef, Schedule, ServiceTier } from '../../engine/types'
import { activeGroups, resolvedAmenities, sortedGroups } from '../../engine/sim/groups'
import { AMENITY_CATALOG, FITTING_CATALOG } from '../../engine/data/amenitiesCatalog'
import { Modal, Panel, GroupBadge } from '../bits'

const ROUTE_PREF_KEY = 'busraj_schedules_route'

function readSavedRoute(fallback: string): string {
  try {
    return localStorage.getItem(ROUTE_PREF_KEY) || fallback
  } catch {
    return fallback
  }
}

function saveRoute(id: string): void {
  try { localStorage.setItem(ROUTE_PREF_KEY, id) } catch { /* ignore */ }
}

function occTone(lf: number): string {
  return lf < 0.4 ? 'bad' : lf > 0.75 ? 'good' : lf >= 0.55 ? 'warn' : ''
}

/** Option text for a coach. Native selects cannot render a pill, so NEW is a tag in the label. */
function busPickLabel(b: Bus, day: number, extra?: string): string {
  const m = BUS_MODELS[b.modelId]
  const bits = [
    extra,
    isNewVehicle(b, day) ? 'NEW' : '',
    b.status === 'grounded' ? 'grounded' : '',
  ].filter(Boolean)
  const tail = bits.length ? ` · ${bits.join(' · ')}` : ''
  return `${b.reg} — ${modelTitleById(b.modelId)}${m ? ` · ${coachKind(m)}` : ''}${tail}`
}

function fmtReach(depHour: number, depMin: 0 | 30 | undefined, route: RouteDef): string {
  const abs = clockMinutes({ depHour, depMin }) + runningMinutes(route)
  const days = Math.floor(abs / 1440)
  const clock = clockFromMinutes(abs)
  const dayTag = days > 0 ? ` +${days}d` : ''
  return `reaches ${fmtClock(clock)}${dayTag} (${route.hours}h)`
}

/** Actual gap from 1st-trip arrival to 2nd-trip departure (not the formula floor). */
function fmtLayover(
  outHour: number,
  outMin: 0 | 30 | undefined,
  retHour: number,
  retMin: 0 | 30 | undefined,
  route: RouteDef,
): string {
  const arriveAbs = clockMinutes({ depHour: outHour, depMin: outMin }) + runningMinutes(route)
  let retAbs = clockMinutes({ depHour: retHour, depMin: retMin })
  while (retAbs < arriveAbs) retAbs += 1440
  const gap = retAbs - arriveAbs
  const dayOffset = Math.floor(retAbs / 1440) - Math.floor(arriveAbs / 1440)
  const dayTag = dayOffset > 0 ? ` (+${dayOffset}d)` : ''
  if (gap < 60) return `${gap}m layover${dayTag}`
  const h = Math.floor(gap / 60)
  const m = gap % 60
  return (m ? `${h}h ${m}m layover` : `${h}h layover`) + dayTag
}

function suggestedSlots(route: RouteDef): { depHour: number; depMin: 0 | 30; label: string }[] {
  if (isOvernight(route)) {
    return [
      { depHour: 20, depMin: 0, label: '20:00' },
      { depHour: 21, depMin: 0, label: '21:00' },
      { depHour: 21, depMin: 30, label: '21:30' },
      { depHour: 22, depMin: 0, label: '22:00' },
      { depHour: 22, depMin: 30, label: '22:30' },
    ]
  }
  return [
    { depHour: 6, depMin: 0, label: '06:00' },
    { depHour: 7, depMin: 0, label: '07:00' },
    { depHour: 17, depMin: 0, label: '17:00' },
    { depHour: 18, depMin: 0, label: '18:00' },
    { depHour: 19, depMin: 0, label: '19:00' },
  ]
}

function busFitScore(bus: Bus, route: RouteDef): number {
  const m = BUS_MODELS[bus.modelId]
  if (!m) return 99
  const overnight = isOvernight(route)
  let score = 0
  if (overnight) {
    if (m.layout.kind === 'sleeper' || m.sleeper) score -= 3
    else if (m.layout.kind === 'hybrid') score -= 2.5
    else if (m.layout.kind === 'semi') score -= 1
    else score += 2
  } else {
    if (m.layout.kind === 'seater' || m.layout.kind === 'semi') score -= 2
    if (m.layout.kind === 'hybrid') score -= 1
    if (m.layout.kind === 'sleeper') score += 1
  }
  if (bus.odometer <= 0) score -= 1
  return score
}

function sortFreeBuses(buses: Bus[], route: RouteDef | undefined): Bus[] {
  if (!route) return [...buses]
  return [...buses].sort((a, b) => busFitScore(a, route) - busFitScore(b, route) || a.reg.localeCompare(b.reg))
}

type ServiceStatus = 'live' | 'needs_bus' | 'needs_2nd' | 'needs_more' | 'suspended'

function serviceStatus(sch: Schedule, route: RouteDef | undefined, isCargo = false, s?: GameState): ServiceStatus {
  // Cargo runs are one-way, so they never need a second coach for a return leg.
  const paired = Boolean(sch.paired) && !isCargo
  if (!sch.active) return 'suspended'
  if (sch.festivalOnly || (sch.outboundDuty === 'festival' && (!paired || sch.returnDuty === 'festival'))) return 'live' // buses park automatically on festival days
  if (sch.busIds.length === 0) return 'needs_bus'
  if (route) {
    const rec = recommendedFleetSize(route, paired, s)
    if (sch.busIds.length < rec) {
      return rec > 2 ? 'needs_more' : 'needs_2nd'
    }
  }
  return 'live'
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  if (status === 'needs_bus') return <span className="pill bad">Needs bus</span>
  if (status === 'needs_2nd') return <span className="pill warn">Needs 2nd</span>
  if (status === 'needs_more') return <span className="pill warn">Needs more coaches</span>
  if (status === 'suspended') return <span className="pill bad">Off</span>
  return <span className="pill good">Live</span>
}

type GameActions = ReturnType<typeof useGame.getState>

function isRoutePermitActive(permits: GameState['permits'], routeId: string): boolean {
  const canon = canonicalRouteId(routeId)
  return Object.values(permits).some((p) => p.status === 'active' && canonicalRouteId(p.routeId) === canon)
}

function DepartureSelect({ hour, min, onChange }: {
  hour: number
  min?: number
  onChange: (hour: number, min: 0 | 30) => void
}) {
  return (
    <select
      value={clockMinutes({ depHour: hour, depMin: min })}
      onChange={(e) => {
        const c = clockFromMinutes(Number(e.target.value))
        onChange(c.depHour, c.depMin)
      }}
    >
      {HALF_HOUR_SLOTS.map((c) => (
        <option key={clockMinutes(c)} value={clockMinutes(c)}>{fmtClock(c)}</option>
      ))}
    </select>
  )
}

function dayOffsetTag(absMin: number): string {
  const d = Math.floor(absMin / 1440)
  return d > 0 ? ` +${d}d` : ''
}

function RotationTooltip({
  sch,
  route,
  s,
}: {
  sch: Schedule
  route: RouteDef
  s: GameState
}) {
  const isCargoSvc = scheduleIsCargo(s, sch)
  const paired = Boolean(sch.paired) && !isCargoSvc
  const rec = recommendedFleetSize(route, paired, s)
  const busCount = sch.busIds?.length ?? 0
  const shortfall = Math.max(0, rec - busCount)

  const runMin = runningMinutes(route)
  const turnMin = turnaroundMinutes(route, s)
  const layoverH = (turnMin / 60).toFixed(1).replace(/\.0$/, '')
  const oneWayCycleMin = runMin + turnMin
  const oneWayCycleDays = Math.max(1, Math.ceil(oneWayCycleMin / 1440))
  const roundTripCycleMin = 2 * runMin + 2 * turnMin
  const roundTripCycleDays = Math.max(1, Math.ceil(roundTripCycleMin / 1440))
  const cycleDays = paired ? roundTripCycleDays : oneWayCycleDays
  const cycleHours = Math.round((paired ? roundTripCycleMin : oneWayCycleMin) / 60)

  const fromCity = cityName(route.from)
  const toCity = cityName(route.to)
  const hasYardAtTo = hasYardOrHome(s, route.to)
  const hasYardAtFrom = hasYardOrHome(s, route.from)

  const outMin = clockMinutes(sch)
  const arrAbs = outMin + runMin
  const readyAtToAbs = arrAbs + turnMin

  let retDepAbs: number | undefined
  let retArrAbs: number | undefined
  let readyAtHomeAbs: number | undefined
  if (paired && sch.returnDepHour !== undefined) {
    const retClockMin = clockMinutes({ depHour: sch.returnDepHour, depMin: sch.returnDepMin })
    // Return clock is on calendar day of earliest ready (or later if player set a later slot)
    const readyDayStart = Math.floor(readyAtToAbs / 1440) * 1440
    retDepAbs = readyDayStart + retClockMin
    if (retDepAbs < readyAtToAbs) retDepAbs += 1440
    retArrAbs = retDepAbs + runMin
    readyAtHomeAbs = retArrAbs + turnaroundMinutes({ ...route, to: route.from }, s)
  }

  const serviceLine = paired
    ? `Daily both ways (${fromCity} ↔ ${toCity})`
    : `Daily one way (${fromCity} → ${toCity})`

  return (
    <span
      className="panel-info"
      tabIndex={0}
      aria-label="Coach rotation and timing details"
      style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle', cursor: 'help' }}
    >
      <span
        className="panel-info-icon"
        aria-hidden
        style={{
          borderColor: busCount < rec ? 'var(--warn)' : 'var(--good)',
          color: busCount < rec ? 'var(--warn)' : 'var(--good)',
        }}
      >
        i
      </span>
      <div
        className="panel-info-tip"
        role="tooltip"
        style={{
          width: 380,
          padding: '10px 12px',
          background: 'var(--bg3, #151a21)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          zIndex: 100,
          textAlign: 'left',
          lineHeight: 1.45,
          color: 'var(--fg)',
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: '11px',
            marginBottom: 8,
            borderBottom: '1px solid var(--border)',
            paddingBottom: 5,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>Coach Rotation & Timing</span>
          <span className={busCount >= rec ? 'good' : 'warn'}>
            {busCount}/{rec} coaches
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '11px' }}>
          <div className="dim small">
            Goal: keep <b style={{ color: 'var(--fg)' }}>{serviceLine}</b> without sending the same coach out before it has rested.
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>1. One coach’s trip timeline</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 2 }}>
              <div>
                <span className="accent">{fmtClock(sch)}</span> leave {fromCity}
                <span className="dim"> → drive {route.hours}h ({route.km} km)</span>
              </div>
              <div>
                Arrive {toCity}{' '}
                <b>{fmtClock(clockFromMinutes(arrAbs))}{dayOffsetTag(arrAbs)}</b>
              </div>
              <div
                style={{
                  background: 'var(--bg2, rgba(255,255,255,0.05))',
                  padding: '5px 7px',
                  borderRadius: 4,
                }}
              >
                Rest at {toCity}: <b>{layoverH}h</b> vehicle layover
                <div className="dim small" style={{ marginTop: 2 }}>
                  Terminal turnaround{hasYardAtTo ? '' : ' (+30m: no yard here)'} plus haul-scaled rest.
                  Same coach cannot depart again before{' '}
                  <b style={{ color: 'var(--fg)' }}>
                    {fmtClock(clockFromMinutes(readyAtToAbs))}{dayOffsetTag(readyAtToAbs)}
                  </b>
                  .
                </div>
              </div>
              {paired && retDepAbs !== undefined && retArrAbs !== undefined && readyAtHomeAbs !== undefined ? (
                <>
                  <div>
                    <span className="accent">{fmtClock(clockFromMinutes(retDepAbs))}</span>
                    {dayOffsetTag(retDepAbs)} leave {toCity}
                    <span className="dim"> → drive {route.hours}h back</span>
                  </div>
                  <div>
                    Arrive {fromCity}{' '}
                    <b>{fmtClock(clockFromMinutes(retArrAbs))}{dayOffsetTag(retArrAbs)}</b>
                  </div>
                  <div className="dim small">
                    Rest again at {fromCity} (~{(turnaroundMinutes({ ...route, to: route.from }, s) / 60).toFixed(1).replace(/\.0$/, '')}h
                    {hasYardAtFrom ? '' : ', no yard'}) — coach free again{' '}
                    <b style={{ color: 'var(--fg)' }}>
                      {fmtClock(clockFromMinutes(readyAtHomeAbs))}{dayOffsetTag(readyAtHomeAbs)}
                    </b>
                    .
                  </div>
                </>
              ) : (
                <div className="dim small">
                  One-way service: coach lays over at {toCity}, then comes home on a later trip / reverse schedule before the next outbound.
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              2. Why {rec} coaches? ({cycleDays}-day cycle ≈ {cycleHours}h)
            </div>
            <div className="dim small" style={{ marginBottom: 4 }}>
              {paired ? (
                <>
                  Round trip = {route.hours}h out + {layoverH}h rest + {route.hours}h back + rest at home
                  ≈ <b style={{ color: 'var(--fg)' }}>{cycleHours}h</b> before one coach can leave {fromCity} again.
                  To offer a departure <b style={{ color: 'var(--fg)' }}>every day</b>, you need about{' '}
                  <b style={{ color: 'var(--fg)' }}>{rec}</b> coaches in the pool so one is always ready while others are on the road or resting.
                </>
              ) : (
                <>
                  One leg = {route.hours}h drive + {layoverH}h rest ≈ <b style={{ color: 'var(--fg)' }}>{Math.round(oneWayCycleMin / 60)}h</b>.
                  For a daily departure, assign about <b style={{ color: 'var(--fg)' }}>{rec}</b> coaches and rotate which one leaves each night.
                </>
              )}
            </div>
            <div
              style={{
                background: 'var(--bg2, rgba(255,255,255,0.05))',
                padding: '5px 7px',
                borderRadius: 4,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Example with {rec} coaches</div>
              <div className="dim small">
                {Array.from({ length: Math.min(rec, 4) }, (_, i) => (
                  <div key={i}>
                    Coach {i + 1}: takes the Day {i + 1} departure, then is busy ~{cycleDays} day{cycleDays > 1 ? 's' : ''} (drive + rest)
                    {paired ? ' covering out & return' : ''}.
                  </div>
                ))}
                {rec > 4 && <div>…and Coach {rec} covers Day {rec}.</div>}
                <div style={{ marginTop: 3 }}>
                  Day {rec + 1}: Coach 1 is free again → continuous daily service.
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            {busCount >= rec ? (
              <span className="good small">
                ✓ Fleet is sized for daily service — enough coaches for drive + layover without skipping nights.
              </span>
            ) : (
              <span className="warn small">
                ⚠ You have {busCount} of {rec}. Assign {shortfall} more coach{shortfall === 1 ? '' : 'es'} or some nights will have no departure while coaches finish their rest.
              </span>
            )}
          </div>
        </div>
      </div>
    </span>
  )
}

function CreateModal({ onClose, defaultRouteId }: {
  onClose: () => void
  defaultRouteId?: string
}) {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const defaults = getScheduleDefaults(s)
  const rawActive = Object.values(s.permits)
    .filter((p) => p.status === 'active' && ROUTES[p.routeId])
    .map((p) => canonicalRouteId(p.routeId))
  const seenActive = new Set<string>()
  const activeRoutes: string[] = []
  for (const rid of rawActive) {
    const name = routeName(rid)
    if (!seenActive.has(name)) {
      seenActive.add(name)
      activeRoutes.push(rid)
    }
  }
  activeRoutes.sort((a, b) => routeName(a).localeCompare(routeName(b)))
  const initialRoute = defaultRouteId && activeRoutes.includes(canonicalRouteId(defaultRouteId)) ? canonicalRouteId(defaultRouteId) : (activeRoutes[0] ?? '')
  const initialRouteDef = initialRoute ? ROUTES[initialRoute] : undefined
  const initialSlot = initialRouteDef
    ? suggestedSlots(initialRouteDef)[1] ?? suggestedSlots(initialRouteDef)[0]!
    : { depHour: 21, depMin: 0 as 0 | 30 }

  const [routeId, setRouteId] = useState(initialRoute)
  const [depHour, setDepHour] = useState(initialSlot.depHour)
  const [depMin, setDepMin] = useState<0 | 30>(initialSlot.depMin)
  const [paired, setPaired] = useState(false)
  const [outboundDuty, setOutboundDuty] = useState<'daily' | 'festival'>('daily')
  const [returnDuty, setReturnDuty] = useState<'daily' | 'festival'>('daily')
  const [retHour, setRetHour] = useState(14)
  const [retMin, setRetMin] = useState<0 | 30>(0)
  const [busId, setBusId] = useState('')
  const [serviceKind, setServiceKind] = useState<'passenger' | 'cargo'>('passenger')
  const uiPrefs = useGame((g) => g.uiPrefs)
  const activeBrandList = useMemo(() => activeGroups(s), [s.groups])
  const defaultGid = uiPrefs.fleetGroupId !== 'all' && uiPrefs.fleetGroupId !== 'none'
    ? uiPrefs.fleetGroupId
    : (activeBrandList[0]?.id ?? '')
  const [groupId, setGroupId] = useState<string>(defaultGid)
  const [serviceTier, setServiceTier] = useState<ServiceTier>(
    defaultGid && s.groups?.[defaultGid]?.defaultServiceTier
      ? s.groups[defaultGid].defaultServiceTier!
      : (s.company.defaultServiceTier ?? 'standard'),
  )
  const subsidiary = Boolean(s.company.dedicatedCargoSubsidiary)

  const handleGroupChange = (gid: string) => {
    setGroupId(gid)
    setBusId('')
    if (gid && s.groups?.[gid]?.defaultServiceTier) {
      setServiceTier(s.groups[gid].defaultServiceTier!)
    }
  }

  const route = ROUTES[routeId]
  const permit = routeId ? s.permits[routeId] : undefined
  const hasSeasonal = permit?.seasonal?.status === 'active'
  const isAllFest = outboundDuty === 'festival' && (!paired || returnDuty === 'festival')
  const suggestions = route ? suggestedSlots(route) : []
  const freeBuses = useMemo(
    () => sortFreeBuses(
      Object.values(s.buses).filter((b) => {
        if (b.scheduleId || b.coveringBusId) return false
        if (b.status !== 'active' && b.status !== 'grounded') return false
        const cargo = isCargoModel(b.modelId)
        if (serviceKind === 'cargo' ? !cargo : cargo) return false
        if (groupId) return b.groupId === groupId
        return !b.groupId
      }),
      route,
    ),
    [s.buses, route, serviceKind, groupId],
  )

  const syncReturn = (r: RouteDef | undefined, oh: number, om: 0 | 30) => {
    if (!r) return
    const sug = suggestReturnSlot({ depHour: oh, depMin: om }, r)
    setRetHour(sug.depHour)
    setRetMin(sug.depMin)
  }

  useEffect(() => {
    if (paired && route) syncReturn(route, depHour, depMin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, routeId, depHour, depMin])

  const pickRoute = (id: string) => {
    setRouteId(id)
    setBusId('')
    const p = s.permits[id]
    if (!p?.seasonal || p.seasonal.status !== 'active') {
      setOutboundDuty('daily')
      setReturnDuty('daily')
    }
    const r = ROUTES[id]
    if (r) {
      const sug = suggestedSlots(r)
      const pick = sug[1] ?? sug[0]!
      setDepHour(pick.depHour)
      setDepMin(pick.depMin)
      if (paired) syncReturn(r, pick.depHour, pick.depMin)
    }
  }

  const earliest = route ? suggestReturnSlot({ depHour, depMin }, route) : null

  const launch = () => {
    if (!routeId || !route) return
    const tierFare = Math.round(toRupees(route.marketFareAC) * serviceTierFareMult(serviceTier))
    const ok = g.createSchedule({
      routeId,
      groupId: groupId || undefined,
      depHour,
      depMin,
      baseFare: rs(tierFare),
      autoPrice: defaults.autoPrice,
      returnAutoPrice: defaults.autoPrice,
      returnBaseFare: rs(tierFare),
      cancellation: (groupId && s.groups?.[groupId]?.defaultCancellation) ?? defaults.cancellation,
      channels: { ...defaults.channels },
      redDeal: defaults.redDeal,
      paired,
      returnDepHour: paired ? retHour : undefined,
      returnDepMin: paired ? retMin : undefined,
      outboundDuty,
      returnDuty: paired ? returnDuty : 'daily',
      festivalOnly: isAllFest,
      serviceKind,
      serviceTier,
    }, busId || undefined)
    if (ok) onClose()
  }

  return (
    <Modal
      title="New service"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!routeId} onClick={launch}>Launch</button>
        </>
      }
    >
      <div className="form-row">
        <label>Route</label>
        <select value={routeId} onChange={(e) => pickRoute(e.target.value)}>
          {activeRoutes.map((r) => {
            const schs = Object.values(s.schedules).filter((sch) => canonicalRouteId(sch.routeId) === canonicalRouteId(r) && ROUTES[sch.routeId])
            const n = schs.length
            const busCount = schs.reduce((acc, sch) => acc + (sch.busIds?.length ?? 0), 0)
            const targetBuses = schs.reduce((acc, sch) => acc + recommendedFleetSize(ROUTES[sch.routeId] ?? ROUTES[canonicalRouteId(sch.routeId)], Boolean(sch.paired) && !scheduleIsCargo(s, sch), s), 0)
            const isShort = schs.length > 0 && busCount < targetBuses
            const busText = isShort
              ? `⚠️ ${busCount}/${targetBuses} buses`
              : `${busCount} bus${busCount === 1 ? '' : 'es'}`
            const detail = n > 0 ? ` (${n} svc · ${busText})` : ' (new)'
            return (
              <option key={r} value={r}>
                {routeName(r)}{detail}
              </option>
            )
          })}
        </select>
      </div>
      <div className="form-row">
        <label>Subsidiary</label>
        <select value={groupId} onChange={(e) => handleGroupChange(e.target.value)}>
          {activeBrandList.map((grp) => (
            <option key={grp.id} value={grp.id}>
              {grp.code} - {grp.name}
            </option>
          ))}
          <option value="">Unassigned</option>
        </select>
      </div>
      <div className="form-row">
        <label>Service</label>
        <div className="flex" style={{ gap: 12 }}>
          <label className="flex" style={{ alignItems: 'center', gap: 4 }}>
            <input type="radio" name="serviceKind" checked={serviceKind === 'passenger'} onChange={() => { setServiceKind('passenger'); setBusId('') }} />
            Passenger
          </label>
          <label className="flex" style={{ alignItems: 'center', gap: 4, opacity: subsidiary ? 1 : 0.45 }}>
            <input
              type="radio"
              name="serviceKind"
              disabled={!subsidiary}
              checked={serviceKind === 'cargo'}
              onChange={() => { setServiceKind('cargo'); setBusId(''); setPaired(false) }}
            />
            Cargo
          </label>
          {!subsidiary && <span className="dim small">Cargo needs the subsidiary on</span>}
        </div>
      </div>

      {route && (
        <>
          {/* Freight services are one-way only: no paired return leg to offer. */}
          {serviceKind === 'passenger' && (
            <div className="form-row">
              <label>Paired</label>
              <label className="flex">
                <input type="checkbox" checked={paired} onChange={(e) => setPaired(e.target.checked)} />
                Double trip same day — both directions ({fmtTurnaround(route, s)})
              </label>
            </div>
          )}

          <div className="form-row">
            <label>{serviceKind === 'cargo' ? 'Duty' : '1st trip duty'}</label>
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              <label className="flex" style={{ alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="outboundDuty"
                  value="daily"
                  checked={outboundDuty === 'daily'}
                  onChange={() => {
                    setOutboundDuty('daily')
                  }}
                />
                Daily
              </label>
              <label className="flex" style={{ alignItems: 'center', gap: 4, opacity: hasSeasonal ? 1 : 0.4 }}>
                <input
                  type="radio"
                  name="outboundDuty"
                  value="festival"
                  disabled={!hasSeasonal}
                  checked={outboundDuty === 'festival'}
                  onChange={() => {
                    setOutboundDuty('festival')
                    if (returnDuty === 'festival') setBusId('')
                  }}
                />
                Seasonal (festivals)
              </label>
              {!hasSeasonal && (
                <span className="dim small">
                  (<Link to="/routes">Need a seasonal permit</Link>)
                </span>
              )}
            </div>
          </div>

          {paired && (
            <div className="form-row">
              <label>2nd trip duty</label>
              <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 4 }}>
                  <input
                    type="radio"
                    name="returnDuty"
                    value="daily"
                    checked={returnDuty === 'daily'}
                    onChange={() => setReturnDuty('daily')}
                  />
                  Daily
                </label>
                <label
                  className="flex"
                  style={{ alignItems: 'center', gap: 4, opacity: hasSeasonal ? 1 : 0.4 }}
                >
                  <input
                    type="radio"
                    name="returnDuty"
                    value="festival"
                    disabled={!hasSeasonal}
                    checked={returnDuty === 'festival'}
                    onChange={() => {
                      setReturnDuty('festival')
                      if (outboundDuty === 'festival') setBusId('')
                    }}
                  />
                  Seasonal (festivals)
                </label>
              </div>
            </div>
          )}

          <div className="form-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <label>{paired ? '1st trip' : 'Slot'}</label>
            {suggestions.map((sug) => {
              const active = sug.depHour === depHour && sug.depMin === depMin
              return (
                <button
                  key={sug.label}
                  type="button"
                  className={active ? 'primary small' : 'small'}
                  onClick={() => { setDepHour(sug.depHour); setDepMin(sug.depMin) }}
                >
                  {sug.label}
                </button>
              )
            })}
            <DepartureSelect hour={depHour} min={depMin} onChange={(h, m) => { setDepHour(h); setDepMin(m) }} />
            <span className="dim small">{fmtReach(depHour, depMin, route)}</span>
          </div>

          {paired && earliest && (
            <div className="form-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <label>2nd trip</label>
              <DepartureSelect hour={retHour} min={retMin} onChange={(h, m) => { setRetHour(h); setRetMin(m) }} />
              <span className="dim small">
                earliest {fmtClock(earliest)}{earliest.dayOffset ? ' next day' : ''}
              </span>
            </div>
          )}

          {serviceKind === 'passenger' && (
            <div className="form-row">
              <label>Amenities</label>
              <span className="dim small" style={{ alignSelf: 'center' }}>
                {(() => {
                  const grp = groupId && s.groups ? s.groups[groupId] : undefined
                  const am = grp?.defaultAmenities ?? s.company.defaultAmenities ?? {}
                  const items = AMENITY_CATALOG.filter((a) => am[a.id]).map((a) => a.shortLabel)
                  return items.length > 0 ? `Included on board: ${items.join(', ')}` : 'None configured for this brand'
                })()}
              </span>
            </div>
          )}

          <div className="form-row">
            <label>Bus</label>
            <select value={busId} onChange={(e) => setBusId(e.target.value)}>
              <option value="">{isAllFest ? 'Auto-assign 3d before fest (or pick now)' : 'Assign later'}</option>
              {freeBuses.map((b) => {
                const m = BUS_MODELS[b.modelId]
                return (
                  <option key={b.id} value={b.id}>
                    {busPickLabel(b, s.day, m && !isCargoModel(b.modelId) ? m.layout.cols : undefined)}
                  </option>
                )
              })}
            </select>
          </div>

          <p className="dim small" style={{ margin: '8px 0 0' }}>
            Sell-on: <Link to="/settings">Settings → Channels</Link>
            {' · '}{enabledChannelLabels(defaults.channels)}.
            {isAllFest
              ? ' Seasonal festival service — runs the festival window plus one day either side (homebound before, return after) so the coach repositions with a load. Booking opens 3 days out.'
              : (outboundDuty === 'festival' || returnDuty === 'festival')
                ? ' Mixed service — 2 buses run up and down simultaneously.'
                : paired
                  ? ' If the 1st trip runs late, the 2nd trip slips up to 90 min (or leaves empty).'
                  : route.hours > 6
                    ? ' Long haul: 2nd bus for daily both ways.'
                    : ''}
          </p>
        </>
      )}
    </Modal>
  )
}

function EditScheduleModal({ sch, s, g, onClose }: {
  sch: Schedule
  s: GameState
  g: GameActions
  onClose: () => void
}) {
  const route = ROUTES[sch.routeId]
  const isCargoSvc = scheduleIsCargo(s, sch)
  const grp = sch.groupId && s.groups ? s.groups[sch.groupId] : undefined
  const paired = Boolean(sch.paired) && !isCargoSvc
  const permit = s.permits[sch.routeId]
  const hasSeasonal = permit?.seasonal?.status === 'active'
  const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!paired || sch.returnDuty === 'festival'))
  const isMixed = paired && ((sch.outboundDuty === 'festival' && sch.returnDuty === 'daily') || (sch.outboundDuty === 'daily' && sch.returnDuty === 'festival'))

  const isHybrid = sch.busIds.some((id) => {
    const b = s.buses[id]
    if (!b) return false
    const m = BUS_MODELS[b.modelId]
    return m && (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID')
  }) || (sch.baseFareSleeper !== undefined && sch.baseFareSeater !== undefined && sch.busIds.length === 0)

  const defaultSlp = sch.baseFareSleeper ? Math.round(toRupees(sch.baseFareSleeper)) : Math.round(toRupees(sch.baseFare) * 1.15)
  const defaultStr = sch.baseFareSeater ? Math.round(toRupees(sch.baseFareSeater)) : Math.round(toRupees(sch.baseFare) * 0.85)
  const [fare, setFare] = useState(Math.round(toRupees(sch.baseFare)))
  const [fareSlp, setFareSlp] = useState(defaultSlp)
  const [fareStr, setFareStr] = useState(defaultStr)

  const retBase = sch.returnBaseFare ?? sch.baseFare
  const defaultRetSlp = sch.returnBaseFareSleeper
    ? Math.round(toRupees(sch.returnBaseFareSleeper))
    : (sch.baseFareSleeper ? Math.round(toRupees(sch.baseFareSleeper)) : Math.round(toRupees(retBase) * 1.15))
  const defaultRetStr = sch.returnBaseFareSeater
    ? Math.round(toRupees(sch.returnBaseFareSeater))
    : (sch.baseFareSeater ? Math.round(toRupees(sch.baseFareSeater)) : Math.round(toRupees(retBase) * 0.85))
  const [returnFare, setReturnFare] = useState(Math.round(toRupees(retBase)))
  const [returnFareSlp, setReturnFareSlp] = useState(defaultRetSlp)
  const [returnFareStr, setReturnFareStr] = useState(defaultRetStr)

  useEffect(() => {
    setFare(Math.round(toRupees(sch.baseFare)))
    if (sch.baseFareSleeper) setFareSlp(Math.round(toRupees(sch.baseFareSleeper)))
    if (sch.baseFareSeater) setFareStr(Math.round(toRupees(sch.baseFareSeater)))

    const rBase = sch.returnBaseFare ?? sch.baseFare
    setReturnFare(Math.round(toRupees(rBase)))
    if (sch.returnBaseFareSleeper) {
      setReturnFareSlp(Math.round(toRupees(sch.returnBaseFareSleeper)))
    } else if (sch.baseFareSleeper) {
      setReturnFareSlp(Math.round(toRupees(sch.baseFareSleeper)))
    } else {
      setReturnFareSlp(Math.round(toRupees(rBase) * 1.15))
    }
    if (sch.returnBaseFareSeater) {
      setReturnFareStr(Math.round(toRupees(sch.returnBaseFareSeater)))
    } else if (sch.baseFareSeater) {
      setReturnFareStr(Math.round(toRupees(sch.baseFareSeater)))
    } else {
      setReturnFareStr(Math.round(toRupees(rBase) * 0.85))
    }
  }, [sch.baseFare, sch.baseFareSleeper, sch.baseFareSeater, sch.returnBaseFare, sch.returnBaseFareSleeper, sch.returnBaseFareSeater])

  return (
    <Modal wide="xl" title={`Edit Service — ${fmtClock(sch)} ${routeName(sch.routeId)}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Departures and Duty */}
        <div className="panel" style={{ padding: 12 }}>
          <div className="accent small" style={{ fontWeight: 600, marginBottom: 8 }}>Schedule & Duty</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <label className="sched-ctrl">
              <span className="dim">Duty</span>
              <select
                value={isAllFest ? 'all_fest' : isMixed ? (sch.outboundDuty === 'daily' ? 'daily_fest' : 'fest_daily') : 'daily'}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'all_fest') {
                    g.updateSchedule(sch.id, { outboundDuty: 'festival', returnDuty: 'festival', festivalOnly: true })
                  } else if (val === 'fest_daily') {
                    g.updateSchedule(sch.id, { outboundDuty: 'festival', returnDuty: 'daily', festivalOnly: false })
                  } else if (val === 'daily_fest') {
                    g.updateSchedule(sch.id, { outboundDuty: 'daily', returnDuty: 'festival', festivalOnly: false })
                  } else {
                    g.updateSchedule(sch.id, { outboundDuty: 'daily', returnDuty: 'daily', festivalOnly: false })
                  }
                }}
              >
                <option value="daily">Daily</option>
                {hasSeasonal && <option value="all_fest">Seasonal (festivals)</option>}
                {hasSeasonal && paired && <option value="fest_daily">Seasonal 1st + daily 2nd</option>}
                {hasSeasonal && paired && <option value="daily_fest">Daily 1st + seasonal 2nd</option>}
              </select>
            </label>
            <label className="sched-ctrl">
              <span className="dim">{paired ? '1st Departure' : 'Departure'}</span>
              <DepartureSelect
                hour={sch.depHour}
                min={sch.depMin}
                onChange={(depHour, depMin) => g.updateSchedule(sch.id, { depHour, depMin })}
              />
              {route && (
                <span className="dim small" title="Arrival at destination from this departure">
                  {fmtReach(sch.depHour, sch.depMin, route)}
                </span>
              )}
            </label>
            {!isCargoSvc && (
              <label className="sched-ctrl" title="Run 2nd trip (return leg, same day)">
                <span className="flex" style={{ alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={paired}
                    onChange={(e) => g.updateSchedule(sch.id, { paired: e.target.checked })}
                  />
                  <span>2nd trip (return)</span>
                </span>
              </label>
            )}
            {paired && !isCargoSvc && (
              <label className="sched-ctrl">
                <span className="dim">2nd Departure</span>
                <DepartureSelect
                  hour={sch.returnDepHour ?? 20}
                  min={sch.returnDepMin ?? 0}
                  onChange={(returnDepHour, returnDepMin) => g.updateSchedule(sch.id, { returnDepHour, returnDepMin })}
                />
                {route && sch.returnDepHour !== undefined && (
                  <span className="dim small" title="Gap from 1st-trip arrival to 2nd departure">
                    {fmtLayover(sch.depHour, sch.depMin, sch.returnDepHour, sch.returnDepMin, route)}
                  </span>
                )}
              </label>
            )}
          </div>
        </div>

        {/* Pricing */}
        {!isCargoSvc && (
          <div className="panel" style={{ padding: 12 }}>
            <div className="accent small" style={{ fontWeight: 600, marginBottom: 8 }}>Fare Configuration</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {/* 1st Fare */}
              <label className="sched-ctrl">
                <span className="dim">{paired ? '1st Fare' : 'Fare'}</span>
                <select
                  value={sch.autoPrice ? 'auto' : 'manual'}
                  onChange={(e) => {
                    const isAuto = e.target.value === 'auto'
                    if (isAuto) {
                      g.updateSchedule(sch.id, { autoPrice: true })
                    } else {
                      if (isHybrid) {
                        const slp = rs(fareSlp)
                        const str = rs(fareStr)
                        const avg = rs(Math.round((fareSlp + fareStr) / 2))
                        g.updateSchedule(sch.id, { autoPrice: false, baseFareSleeper: slp, baseFareSeater: str, baseFare: avg })
                      } else {
                        g.updateSchedule(sch.id, { autoPrice: false, baseFare: rs(fare) })
                      }
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
                {!sch.autoPrice && (
                  isHybrid ? (
                    <span className="flex" style={{ alignItems: 'center', gap: 4 }}>
                      <span className="faint small" title="Sleeper Berth Flat Ticket Fare">Slp</span>
                      <input
                        type="number"
                        value={fareSlp}
                        style={{ width: 62 }}
                        step={50}
                        onChange={(e) => setFareSlp(Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        onBlur={() => {
                          const slp = rs(fareSlp)
                          const str = rs(fareStr)
                          const avg = rs(Math.round((fareSlp + fareStr) / 2))
                          g.updateSchedule(sch.id, { baseFareSleeper: slp, baseFareSeater: str, baseFare: avg })
                        }}
                      />
                      <span className="faint small" title="Seater / Semi Flat Ticket Fare">Str</span>
                      <input
                        type="number"
                        value={fareStr}
                        style={{ width: 62 }}
                        step={50}
                        onChange={(e) => setFareStr(Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        onBlur={() => {
                          const slp = rs(fareSlp)
                          const str = rs(fareStr)
                          const avg = rs(Math.round((fareSlp + fareStr) / 2))
                          g.updateSchedule(sch.id, { baseFareSleeper: slp, baseFareSeater: str, baseFare: avg })
                        }}
                      />
                    </span>
                  ) : (
                    <input
                      type="number"
                      value={fare}
                      style={{ width: 72 }}
                      step={50}
                      onChange={(e) => setFare(Number(e.target.value))}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      onBlur={() => g.updateSchedule(sch.id, { baseFare: rs(fare) })}
                    />
                  )
                )}
              </label>

              {/* 2nd Fare when paired */}
              {paired && (
                <label className="sched-ctrl">
                  <span className="dim">2nd Fare</span>
                  <select
                    value={(sch.returnAutoPrice ?? sch.autoPrice) ? 'auto' : 'manual'}
                    onChange={(e) => {
                      const isAuto = e.target.value === 'auto'
                      if (isAuto) {
                        g.updateSchedule(sch.id, { returnAutoPrice: true })
                      } else {
                        if (isHybrid) {
                          const slp = rs(returnFareSlp)
                          const str = rs(returnFareStr)
                          const avg = rs(Math.round((returnFareSlp + returnFareStr) / 2))
                          g.updateSchedule(sch.id, { returnAutoPrice: false, returnBaseFareSleeper: slp, returnBaseFareSeater: str, returnBaseFare: avg })
                        } else {
                          g.updateSchedule(sch.id, { returnAutoPrice: false, returnBaseFare: rs(returnFare) })
                        }
                      }
                    }}
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                  {!(sch.returnAutoPrice ?? sch.autoPrice) && (
                    isHybrid ? (
                      <span className="flex" style={{ alignItems: 'center', gap: 4 }}>
                        <span className="faint small">Slp</span>
                        <input
                          type="number"
                          value={returnFareSlp}
                          style={{ width: 62 }}
                          step={50}
                          onChange={(e) => setReturnFareSlp(Number(e.target.value))}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          onBlur={() => {
                            const slp = rs(returnFareSlp)
                            const str = rs(returnFareStr)
                            const avg = rs(Math.round((returnFareSlp + returnFareStr) / 2))
                            g.updateSchedule(sch.id, { returnBaseFareSleeper: slp, returnBaseFareSeater: str, returnBaseFare: avg })
                          }}
                        />
                        <span className="faint small">Str</span>
                        <input
                          type="number"
                          value={returnFareStr}
                          style={{ width: 62 }}
                          step={50}
                          onChange={(e) => setReturnFareStr(Number(e.target.value))}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          onBlur={() => {
                            const slp = rs(returnFareSlp)
                            const str = rs(returnFareStr)
                            const avg = rs(Math.round((returnFareSlp + returnFareStr) / 2))
                            g.updateSchedule(sch.id, { returnBaseFareSleeper: slp, returnBaseFareSeater: str, returnBaseFare: avg })
                          }}
                        />
                      </span>
                    ) : (
                      <input
                        type="number"
                        value={returnFare}
                        style={{ width: 72 }}
                        step={50}
                        onChange={(e) => setReturnFare(Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        onBlur={() => g.updateSchedule(sch.id, { returnBaseFare: rs(returnFare) })}
                      />
                    )
                  )}
                </label>
              )}
            </div>
          </div>
        )}

        {/* Brand & Service Tier */}
        <div className="panel" style={{ padding: 12 }}>
          <div className="accent small" style={{ fontWeight: 600, marginBottom: 8 }}>
            {isCargoSvc || grp?.cargoBrand ? 'Brand' : 'Brand & Service Tier'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <label className="sched-ctrl">
              <span className="dim">Subsidiary Brand</span>
              <select
                value={sch.groupId ?? ''}
                onChange={(e) => {
                  const gid = e.target.value || undefined
                  const brand = gid ? s.groups?.[gid] : undefined
                  const patch: { groupId?: string; serviceTier?: ServiceTier } = { groupId: gid }
                  if (!brand?.cargoBrand) {
                    patch.serviceTier = brand?.defaultServiceTier ?? s.company.defaultServiceTier ?? 'standard'
                  }
                  g.updateSchedule(sch.id, patch)
                }}
              >
                {sortedGroups(Object.values(s.groups ?? {})).map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.code}] {g.name}{g.status === 'retired' ? ' (retired)' : ''}
                  </option>
                ))}
                <option value="">Unassigned</option>
              </select>
            </label>

            {!isCargoSvc && !grp?.cargoBrand && (
              <label className="sched-ctrl">
                <span className="dim">Service Tier</span>
                <select
                  value={sch.serviceTier ?? 'standard'}
                  onChange={(e) => g.setServiceTier(sch.id, e.target.value as ServiceTier)}
                >
                  <option value="economy">Economy</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="gold">Deluxe</option>
                </select>
              </label>
            )}
          </div>
          {!isCargoSvc && !grp?.cargoBrand && (
            <div className="dim small" style={{ marginTop: 8 }}>
              Amenities and fittings inherit from the brand (Settings → Subsidiaries).
              {' '}Ticket pricing: Economy {Math.round(serviceTierFareMult('economy') * 100)}% ·
              Standard {Math.round(serviceTierFareMult('standard') * 100)}% ·
              Premium {Math.round(serviceTierFareMult('premium') * 100)}% ·
              Deluxe {Math.round(serviceTierFareMult('gold') * 100)}% of corridor fare.
            </div>
          )}
        </div>

        {/* Danger Zone */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => g.updateSchedule(sch.id, { active: !sch.active })}
            >
              {sch.active ? 'Suspend Service' : 'Resume Service'}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                g.deleteSchedule(sch.id)
                onClose()
              }}
            >
              Delete
            </button>
          </div>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  )
}

const TIER_LABEL: Record<ServiceTier, string> = {
  economy: 'Economy',
  standard: 'Standard',
  premium: 'Premium',
  gold: 'Deluxe',
}

/** Always-open compact service card (presentational). */
function ServiceCard({ sch, s, g, freeBuses, autoEdit, onAutoEditHandled }: {
  sch: Schedule
  s: GameState
  g: GameActions
  freeBuses: Bus[]
  autoEdit?: boolean
  onAutoEditHandled?: () => void
}) {
  const [editing, setEditing] = useState(Boolean(autoEdit))

  useEffect(() => {
    if (!autoEdit) return
    setEditing(true)
    onAutoEditHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, sch.id])
  const route = ROUTES[sch.routeId]
  const isCargoSvc = scheduleIsCargo(s, sch)
  const status = serviceStatus(sch, route, isCargoSvc, s)
  const paired = Boolean(sch.paired) && !isCargoSvc
  const last30Lf = scheduleOccLf(sch, s.day, 30, 'out')
  const return30Lf = paired && sch.returnDepHour !== undefined ? scheduleOccLf(sch, s.day, 30, 'return') : null

  const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!paired || sch.returnDuty === 'festival'))
  const isMixed = paired && ((sch.outboundDuty === 'festival' && sch.returnDuty === 'daily') || (sch.outboundDuty === 'daily' && sch.returnDuty === 'festival'))
  const ranked = sortFreeBuses(freeBuses, route).filter((b) => {
    const cargo = isCargoModel(b.modelId)
    if (isCargoSvc ? !cargo : cargo) return false
    // Brand-scoped schedules only offer coaches from that brand; unassigned only unassigned.
    if (sch.groupId) return b.groupId === sch.groupId
    return !b.groupId
  })

  const grp = sch.groupId && s.groups ? s.groups[sch.groupId] : undefined
  const tier = sch.serviceTier ?? grp?.defaultServiceTier ?? s.company.defaultServiceTier ?? 'standard'
  const amenities = resolvedAmenities(s, sch)
  const amenityNames = AMENITY_CATALOG.filter((a) => amenities[a.id]).map((a) => a.shortLabel)
  const fittingNames = FITTING_CATALOG.filter((f) => grp?.defaultFittings?.[f.id]).map((f) => f.shortLabel)
  const configBits = [
    grp ? `[${grp.code}]` : null,
    !isCargoSvc && !grp?.cargoBrand ? (TIER_LABEL[tier] ?? tier) : null,
    !isCargoSvc && !grp?.cargoBrand
      ? `${amenityNames.length} amenities · ${fittingNames.length} fittings`
      : null,
  ].filter(Boolean)
  const configDetail = [
    amenityNames.length ? `Amenities: ${amenityNames.join(', ')}` : null,
    fittingNames.length ? `Fittings: ${fittingNames.join(', ')}` : null,
  ].filter(Boolean).join('\n')

  return (
    <article className={`sched-card ${!sch.active ? 'off' : ''} ${paired ? 'paired' : ''}`}>
      <header className="sched-card-head">
        <div className="sched-card-times">
          <div className="sched-leg">
            <span className="sched-time">{fmtClock(sch)}</span>
            {route && <span className="dim small">{fmtReach(sch.depHour, sch.depMin, route)}</span>}
            <span className={`sched-occ ${last30Lf !== null ? occTone(last30Lf) : 'faint'}`}>
              {last30Lf !== null ? `${Math.round(last30Lf * 100)}%` : '—'}
              <span className="faint"> {isCargoSvc ? 'load' : '30d'}</span>
            </span>
          </div>
          {paired && sch.returnDepHour !== undefined && (
            <div className="sched-leg trip2">
              <span className="sched-time">
                {fmtClock({ depHour: sch.returnDepHour, depMin: sch.returnDepMin })}
              </span>
              {route && (
                <span className="dim small">
                  {fmtLayover(sch.depHour, sch.depMin, sch.returnDepHour, sch.returnDepMin, route)}
                </span>
              )}
              <span className={`sched-occ ${return30Lf !== null ? occTone(return30Lf) : 'faint'}`}>
                {return30Lf !== null ? `${Math.round(return30Lf * 100)}%` : '—'}
                <span className="faint"> {isCargoSvc ? 'load' : '30d'}</span>
              </span>
            </div>
          )}
        </div>
        <div className="sched-card-meta">
          <GroupBadge group={grp} />
          {isCargoSvc && <span className="pill warn">Cargo</span>}
          {isMixed && (
            <span className="pill warn">
              {sch.outboundDuty === 'daily' ? 'Daily + seasonal' : 'Seasonal + daily'}
            </span>
          )}
          {isAllFest && <span className="pill warn">Seasonal</span>}
          {!isCargoSvc && (paired ? <span className="pill info">2 trips</span> : <span className="pill faint">1 trip</span>)}
          {paired && route && !hasYardOrHome(s, route.to) && (
            <span className="pill warn" title="No leased yard in return city (+30 min public bay turnaround)">Public bay +30 min</span>
          )}
          {route && !isCargoSvc && (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span
                className={`pill ${sch.busIds.length >= recommendedFleetSize(route, paired, s) ? 'good' : 'warn'}`}
                title={`Recommended fleet for continuous operation: ${recommendedFleetSize(route, paired, s)} coaches`}
              >
                {sch.busIds.length}/{recommendedFleetSize(route, paired, s)} coaches
              </span>
              <RotationTooltip sch={sch} route={route} s={s} />
            </span>
          )}
          <StatusBadge status={status} />
        </div>
      </header>

      <div className="sched-card-body">
        <div className="sched-card-buses">
          {sch.busIds.length === 0 && (
            <span className="faint small">
              {isAllFest ? 'No bus assigned (Schedule mgr puts two coaches on a long festival run, 3d before)' : 'No bus assigned'}
            </span>
          )}
          {sch.busIds.map((bid: ID) => {
            const bus = s.buses[bid]
            if (!bus) return null
            const model = BUS_MODELS[bus.modelId]
            return (
              <div key={bid} className="sched-bus-chip">
                <span className="accent">{bus.reg}</span>
                <span className="dim small">
                  {modelTitleById(bus.modelId)}
                  {model && <> · <span className={coachKindClass(model)}>{coachKind(model)}</span></>}
                  {bus.status === 'grounded' && ' · grounded, sells when cleared'}
                </span>
                {isNewVehicle(bus, s.day) && <span className="pill good">New</span>}
                <button type="button" className="small" onClick={() => g.unassignBus(sch.id, bid)}>×</button>
              </div>
            )
          })}
          {sch.busIds.length < (BAL.scheduleMaxCoaches ?? 4) && ranked.length > 0 && (
            <select
              className="small"
              value=""
              onChange={(e) => { if (e.target.value) g.assignBus(sch.id, e.target.value) }}
            >
              <option value="">+ bus…</option>
              {ranked.map((b) => (
                <option key={b.id} value={b.id}>
                  {busPickLabel(b, s.day)}
                </option>
              ))}
            </select>
          )}
          {isAllFest && (
            <span className="dim small" style={{ marginLeft: 6 }}>
              {s.company.scheduleManagerId
                ? <span className="good">Schedule mgr on</span>
                : <Link to="/staff">appoint Schedule manager</Link>}
            </span>
          )}
        </div>

      </div>

      <footer className="sched-card-foot">
        <span
          className="sched-card-config"
          title={
            isCargoSvc
              ? 'Freight service'
              : (configDetail || 'Brand config — edit amenities & fittings in Settings → Subsidiaries')
          }
        >
          {isCargoSvc
            ? 'Freight service'
            : (configBits.length > 0 ? configBits.join(' · ') : 'Unassigned · 0 amenities · 0 fittings')}
        </span>
        <div className="sched-card-actions">
          <button type="button" className="primary small" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="small" onClick={() => g.duplicateSchedule(sch.id, 'hour')}>+1hr</button>
          <button type="button" className="small" onClick={() => g.updateSchedule(sch.id, { active: !sch.active })}>
            {sch.active ? 'Suspend' : 'Resume'}
          </button>
          <button type="button" className="small danger" onClick={() => g.deleteSchedule(sch.id)}>Delete</button>
        </div>
      </footer>

      {editing && (
        <EditScheduleModal
          sch={sch}
          s={s}
          g={g}
          onClose={() => setEditing(false)}
        />
      )}
    </article>
  )
}

type RouteSummary = {
  rid: string
  services: number
  buses: number
  targetBuses: number
  groups: { id: string; name: string; code: string; color: string; n: number; retired: boolean }[]
  occ30: number | null
  cargoOnly: boolean
  permitActive: boolean
}

export function SchedulesPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const uiPrefs = useGame((g) => g.uiPrefs)
  const setFleetGroupFilter = useGame((g) => g.setFleetGroupFilter)
  const [searchParams, setSearchParams] = useSearchParams()
  const focusSchId = searchParams.get('sch')
  const activeBrandList = useMemo(() => activeGroups(s), [s.groups])
  const [creating, setCreating] = useState(false)
  const [railSearch, setRailSearch] = useState('')
  const [openSchId, setOpenSchId] = useState<string | null>(focusSchId)

  const brandFilter = uiPrefs.fleetGroupId
  const scheduleMatchesBrand = (sch: Schedule): boolean => {
    if (brandFilter === 'all') return true
    if (brandFilter === 'none') return !sch.groupId
    return sch.groupId === brandFilter
  }

  const permitRoutes = Object.values(s.permits)
    .filter((p) => p.status === 'active' && ROUTES[p.routeId])
    .map((p) => canonicalRouteId(p.routeId))

  const scheduledRoutes = Object.values(s.schedules)
    .filter((sch) => ROUTES[sch.routeId])
    .map((sch) => canonicalRouteId(sch.routeId))

  const allRouteIds = [...new Set([...permitRoutes, ...scheduledRoutes])]
  const seenRouteNames = new Set<string>()
  const routeOptions: string[] = []
  for (const rid of allRouteIds) {
    const name = routeName(rid)
    if (!seenRouteNames.has(name)) {
      seenRouteNames.add(name)
      routeOptions.push(rid)
    }
  }
  routeOptions.sort((a, b) => routeName(a).localeCompare(routeName(b)))

  const [routeId, setRouteId] = useState<string>(() => {
    const saved = readSavedRoute('')
    const canonSaved = canonicalRouteId(saved)
    if (canonSaved && routeOptions.includes(canonSaved)) return canonSaved
    return routeOptions[0] ?? ''
  })
  const canonSelected = canonicalRouteId(routeId)
  const selected = routeOptions.includes(canonSelected) ? canonSelected : (routeOptions[0] ?? '')

  const selectRoute = (id: string) => {
    const canon = canonicalRouteId(id)
    setRouteId(canon)
    saveRoute(canon)
  }

  // Deep-link from fleet detail: /schedules?sch=<id>
  useEffect(() => {
    if (!focusSchId) return
    const sch = s.schedules[focusSchId]
    if (!sch || !ROUTES[sch.routeId]) {
      setOpenSchId(null)
      return
    }
    if (sch.groupId) setFleetGroupFilter(sch.groupId)
    else if (brandFilter !== 'all' && brandFilter !== 'none') setFleetGroupFilter('all')
    selectRoute(sch.routeId)
    setOpenSchId(focusSchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSchId])

  // One-pass route summaries
  const summaries = useMemo(() => {
    const map = new Map<string, {
      rid: string
      services: number
      buses: number
      targetBuses: number
      groupCounts: Map<string, number>
      occLfs: number[]
      cargoCount: number
    }>()

    for (const rid of routeOptions) {
      map.set(rid, {
        rid,
        services: 0,
        buses: 0,
        targetBuses: 0,
        groupCounts: new Map<string, number>(),
        occLfs: [],
        cargoCount: 0,
      })
    }

    for (const sch of Object.values(s.schedules)) {
      if (!ROUTES[sch.routeId]) continue
      const canon = canonicalRouteId(sch.routeId)
      const entry = map.get(canon)
      if (!entry) continue

      entry.services += 1
      entry.buses += (sch.busIds?.length ?? 0)

      if (sch.groupId) {
        entry.groupCounts.set(sch.groupId, (entry.groupCounts.get(sch.groupId) ?? 0) + 1)
      }

      const isCargo = scheduleIsCargo(s, sch)
      if (isCargo) entry.cargoCount += 1
      const rDef = ROUTES[sch.routeId] ?? ROUTES[canon]
      entry.targetBuses += recommendedFleetSize(rDef, Boolean(sch.paired) && !isCargo, s)

      const outLf = scheduleOccLf(sch, s.day, 30, 'out')
      if (outLf !== null) entry.occLfs.push(outLf)
      if (sch.paired && !isCargo && sch.returnDepHour !== undefined) {
        const retLf = scheduleOccLf(sch, s.day, 30, 'return')
        if (retLf !== null) entry.occLfs.push(retLf)
      }
    }

    const result: Record<string, RouteSummary> = {}
    for (const [rid, entry] of map.entries()) {
      const groupsList: { id: string; name: string; code: string; color: string; n: number; retired: boolean }[] = []
      for (const [gid, n] of entry.groupCounts.entries()) {
        const grp = s.groups?.[gid]
        if (grp) {
          groupsList.push({
            id: gid,
            name: grp.name,
            code: grp.code,
            color: grp.color,
            n,
            retired: grp.status === 'retired',
          })
        }
      }
      groupsList.sort((a, b) => a.code.localeCompare(b.code))

      const occ30 = entry.occLfs.length > 0
        ? entry.occLfs.reduce((a, b) => a + b, 0) / entry.occLfs.length
        : null

      result[rid] = {
        rid,
        services: entry.services,
        buses: entry.buses,
        targetBuses: entry.targetBuses,
        groups: groupsList,
        occ30,
        cargoOnly: entry.services > 0 && entry.cargoCount === entry.services,
        permitActive: isRoutePermitActive(s.permits, rid),
      }
    }
    return result
  }, [s.schedules, s.permits, s.groups, s.day, routeOptions])

  const filteredRoutes = useMemo(() => {
    let ids = routeOptions
    if (brandFilter !== 'all') {
      ids = ids.filter((rid) => {
        const sm = summaries[rid]
        if (!sm) return false
        if (brandFilter === 'none') {
          // Route has at least one unassigned service, or is permit-only with no services yet
          if (sm.services === 0) return true
          return Object.values(s.schedules).some(
            (sch) => canonicalRouteId(sch.routeId) === rid && ROUTES[sch.routeId] && !sch.groupId,
          )
        }
        return sm.groups.some((grp) => grp.id === brandFilter)
      })
    }
    if (railSearch.trim()) {
      const q = railSearch.toLowerCase()
      ids = ids.filter((rid) => routeName(rid).toLowerCase().includes(q))
    }
    // Always: more services first, then higher 30d occupancy, then name.
    return [...ids].sort((a, b) => {
      const sa = summaries[a]
      const sb = summaries[b]
      const svcDiff = (sb?.services ?? 0) - (sa?.services ?? 0)
      if (svcDiff !== 0) return svcDiff
      const oa = sa?.occ30
      const ob = sb?.occ30
      if (oa === null || oa === undefined) {
        if (ob !== null && ob !== undefined) return 1
      } else if (ob === null || ob === undefined) {
        return -1
      } else if (ob !== oa) {
        return ob - oa
      }
      return routeName(a).localeCompare(routeName(b))
    })
  }, [routeOptions, railSearch, brandFilter, summaries, s.schedules])

  // Keep selection inside the filtered rail when brand/search changes
  const selectedInFilter = filteredRoutes.includes(selected)
  const effectiveSelected = selectedInFilter ? selected : (filteredRoutes[0] ?? '')

  useEffect(() => {
    if (effectiveSelected && effectiveSelected !== selected) {
      selectRoute(effectiveSelected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSelected])

  const schedules = useMemo(() => {
    const rid = effectiveSelected || selected
    return Object.values(s.schedules)
      .filter((sch) =>
        canonicalRouteId(sch.routeId) === canonicalRouteId(rid)
        && ROUTES[sch.routeId]
        && scheduleMatchesBrand(sch),
      )
      .sort((a, b) => clockMinutes(a) - clockMinutes(b))
  }, [s.schedules, selected, effectiveSelected, brandFilter])

  const selectedTargetBuses = schedules.reduce((acc, sch) => {
    const rDef = ROUTES[sch.routeId] ?? ROUTES[canonicalRouteId(sch.routeId)]
    return acc + recommendedFleetSize(rDef, Boolean(sch.paired) && !scheduleIsCargo(s, sch), s)
  }, 0)
  const selectedBusCount = schedules.reduce((acc, sch) => acc + (sch.busIds?.length ?? 0), 0)
  const selectedIsShort = schedules.length > 0 && selectedBusCount < selectedTargetBuses

  const freeBuses = Object.values(s.buses).filter((b) => {
    if (b.scheduleId || b.coveringBusId) return false
    if (b.status !== 'active' && b.status !== 'grounded') return false
    if (brandFilter === 'all') return true
    if (brandFilter === 'none') return !b.groupId
    return b.groupId === brandFilter
  })
  const route = (effectiveSelected || selected) ? ROUTES[effectiveSelected || selected] : undefined
  const summary = (effectiveSelected || selected) ? summaries[effectiveSelected || selected] : undefined

  return (
    <>
      <div className="page-title">
        Schedules
        <span className="sub">
          {selected
            ? `${schedules.length} service${schedules.length === 1 ? '' : 's'} · ${freeBuses.length} free`
            : 'pick a route'}
        </span>
      </div>

      {routeOptions.length === 0 ? (
        <Panel>
          <span className="dim">No active routes. Get a permit on <Link to="/routes">Routes</Link> first.</span>
        </Panel>
      ) : (
        <div className="sched-layout">
          {/* Left Rail */}
          <aside className="sched-rail">
            <select
              className="sched-rail-brand"
              value={brandFilter}
              onChange={(e) => setFleetGroupFilter(e.target.value as 'all' | 'none' | string)}
              aria-label="Filter routes by brand"
            >
              <option value="all">All Brands</option>
              {activeBrandList.map((grp) => (
                <option key={grp.id} value={grp.id}>
                  {grp.code} — {grp.name}
                </option>
              ))}
              <option value="none">Unassigned</option>
            </select>
            <input
              type="text"
              className="sched-rail-search"
              placeholder="Filter routes..."
              value={railSearch}
              onChange={(e) => setRailSearch(e.target.value)}
            />
            {filteredRoutes.length === 0 && (
              <span className="dim small" style={{ padding: '8px 6px' }}>
                No routes match this brand filter.
              </span>
            )}
            {filteredRoutes.map((rid) => {
              const sm = summaries[rid]
              const r = ROUTES[rid]
              const active = rid === (effectiveSelected || selected)
              const isShort = sm ? sm.services > 0 && sm.buses < sm.targetBuses : false
              return (
                <button
                  key={rid}
                  type="button"
                  className={`sched-route ${active ? 'active' : ''}`}
                  onClick={() => selectRoute(rid)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{routeName(rid)}</span>
                    {sm && !sm.permitActive && <span className="pill bad small">expired</span>}
                    {sm && sm.cargoOnly && <span className="pill warn small">Cargo</span>}
                  </div>
                  {r && (
                    <div className="dim small" style={{ fontSize: '11px', marginTop: 2 }}>
                      {r.km} km · {r.hours}h · {haulTitle(r).toLowerCase()}{r.ghat ? ' ⛰️' : ''}
                    </div>
                  )}
                  {sm && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 4 }}>
                      <span className="small">
                        {sm.services} svc · <span className={isShort ? 'warn' : 'good'}>{sm.buses}/{sm.targetBuses}b</span>
                      </span>
                      <span className={`small ${sm.occ30 !== null ? occTone(sm.occ30) : 'dim'}`}>
                        {sm.occ30 !== null ? `${Math.round(sm.occ30 * 100)}%` : '—'}
                      </span>
                    </div>
                  )}
                  {sm && sm.groups.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                      {sm.groups.map((g) => (
                        <span
                          key={g.id}
                          style={{ display: 'inline-flex', alignItems: 'center', opacity: g.retired ? 0.45 : 1 }}
                          title={`${g.code}${g.retired ? ' (retired)' : ''}`}
                        >
                          <GroupBadge group={g} />
                          {g.n > 1 && <span className="dim small" style={{ marginLeft: 2, fontSize: '10px' }}>×{g.n}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </aside>

          {/* Right Detail Pane */}
          <div className="sched-detail">
            {/* Compact Route Header */}
            <div className="sched-toolbar" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>{routeName(effectiveSelected || selected)}</h2>
                {route && (
                  <span className="dim small">
                    {route.km} km · {route.hours}h · {haulTitle(route).toLowerCase()}
                    {routeViaLabel(route.id) ? ` · ${routeViaLabel(route.id)}` : ''}
                    {route.ghat ? ' · ⛰️ ghat' : ''}
                  </span>
                )}
                {!summary?.permitActive ? (
                  <span className="pill bad small">Permit inactive</span>
                ) : (
                  <span className="pill good small">Permit active</span>
                )}
                {schedules.length > 0 && (
                  selectedIsShort ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <span
                        className="pill warn small"
                        title={`Route needs ${selectedTargetBuses} buses for all scheduled trips, but only ${selectedBusCount} assigned.`}
                      >
                        ⚠️ {selectedBusCount}/{selectedTargetBuses} buses
                      </span>
                      {route && schedules[0] && (
                        <RotationTooltip sch={schedules[0]} route={route} s={s} />
                      )}
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <span className="pill good small" title={`All ${selectedTargetBuses} trips have assigned buses.`}>
                        {selectedBusCount} {selectedBusCount === 1 ? 'bus' : 'buses'}
                      </span>
                      {route && schedules[0] && (
                        <RotationTooltip sch={schedules[0]} route={route} s={s} />
                      )}
                    </span>
                  )
                )}
                {summary?.groups.map((g) => (
                  <span key={g.id} style={{ opacity: g.retired ? 0.45 : 1 }}>
                    <GroupBadge group={g} />
                    {g.n > 1 && <span className="dim small" style={{ marginLeft: 2 }}>×{g.n}</span>}
                  </span>
                ))}
                {summary?.occ30 !== null && summary?.occ30 !== undefined && (
                  <span className={`pill small ${occTone(summary.occ30)}`}>
                    {Math.round(summary.occ30 * 100)}% 30d LF
                  </span>
                )}
                {schedules.length > 1 && (
                  <span
                    className="panel-info"
                    tabIndex={0}
                    aria-label="Spacing info"
                    style={{ cursor: 'help' }}
                  >
                    <span className="panel-info-icon" aria-hidden>i</span>
                    <span className="panel-info-tip" role="tooltip">
                      Nearby departures share shoppers: two leaving within half an hour split the pool at 50%, an hour apart 25%, two hours 10%, and past three hours they are independent.
                    </span>
                  </span>
                )}
              </div>
              <button
                className="primary small"
                onClick={() => setCreating(true)}
                disabled={permitRoutes.length === 0}
              >
                + Service
              </button>
            </div>

            {schedules.length === 0 ? (
              <Panel>
                <span className="dim">
                  {!effectiveSelected && !selected
                    ? 'No routes match this filter.'
                    : brandFilter !== 'all' && (summary?.services ?? 0) > 0
                    ? 'No services for this brand on this route — switch brand filter or create one.'
                    : summary?.permitActive
                    ? 'No services yet — pick a departure and assign a bus.'
                    : 'Permit inactive — renew on Routes to add services.'}
                </span>
                {summary?.permitActive && (
                  <div style={{ marginTop: 10 }}>
                    <button className="primary" onClick={() => setCreating(true)}>Create service</button>
                  </div>
                )}
              </Panel>
            ) : (
              <>
                {(['passenger', 'cargo'] as const).map((kind) => {
                  const rows = schedules.filter((sch) => (kind === 'cargo') === scheduleIsCargo(s, sch))
                  if (rows.length === 0) return null
                  return (
                    <div key={kind} style={{ marginBottom: 16 }}>
                      <h3 style={{ margin: '0 0 8px', fontSize: 13, letterSpacing: '0.04em' }} className="dim">
                        {kind === 'cargo' ? 'Cargo services' : 'Passenger services'}
                      </h3>
                      <div className="sched-cards">
                        {rows.map((sch) => (
                          <ServiceCard
                            key={sch.id}
                            sch={sch}
                            s={s}
                            g={g}
                            freeBuses={freeBuses}
                            autoEdit={openSchId === sch.id}
                            onAutoEditHandled={() => {
                              setOpenSchId(null)
                              if (searchParams.has('sch')) {
                                const next = new URLSearchParams(searchParams)
                                next.delete('sch')
                                setSearchParams(next, { replace: true })
                              }
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          defaultRouteId={effectiveSelected || selected}
        />
      )}
    </>
  )
}
