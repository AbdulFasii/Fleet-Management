import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { ROUTES, routeName, canonicalRouteId } from '../../engine/data/routes'
import { cityName } from '../../engine/data/cities'
import {
  BUS_MODELS,
  CLASS_LABEL,
  coachKind,
  coachKindClass,
  modelTitle,
  modelNeedsHp,
  isCargoModel,
} from '../../engine/data/busModels'
import { scheduleIsCargo } from '../../engine/sim/schedules'
import { BAL } from '../../engine/data/balance'
import {
  clockMinutes,
  festivalRunEffect,
  festivalRunSlot,
  fmtClock,
  fmtDateShort,
} from '../../engine/core/calendar'
import { rs, toRupees, fmtCompact } from '../../engine/core/money'
import type { Bus, GameState, Schedule, Trip } from '../../engine/types'
import { activeGroups, groupForTrip } from '../../engine/sim/groups'
import { Bar, M, Panel, KV, ratingTone, GroupBadge } from '../bits'
import { tonnes } from '../format'
import { hybridClassStats } from '../../engine/sim/seatmap'
import { spareDriverBench, isDriverEligibleForTrip } from '../../engine/sim/staffing'

function seatCap(t: Trip): number {
  return t.seatCount || t.seats.length
}

function occPct(t: Trip): number {
  const cap = seatCap(t)
  return cap > 0 ? t.sold / cap : 0
}

function occTone(lf: number): string {
  return lf < 0.4 ? 'bad' : lf > 0.75 ? 'good' : lf >= 0.55 ? 'warn' : ''
}

function isCargoSchedule(s: GameState, sch: Schedule): boolean {
  return scheduleIsCargo(s, sch)
}

function tripBrandId(s: GameState, t: Trip): string | undefined {
  const bus = s.buses[t.busId]
  if (bus) return bus.groupId
  const sch = s.schedules[t.scheduleId]
  return sch?.groupId
}

function matchesBrand(s: GameState, t: Trip, fleetGroupId: 'all' | 'none' | string): boolean {
  if (fleetGroupId === 'all') return true
  const gid = tripBrandId(s, t)
  if (fleetGroupId === 'none') return !gid
  return gid === fleetGroupId
}

/** Freight-only departure (a cargo truck, not a passenger coach). */
export function isCargoTrip(s: GameState, t: Trip): boolean {
  const bus = s.buses[t.busId]
  if (bus && isCargoModel(bus.modelId)) return true
  const sch = s.schedules[t.scheduleId]
  return sch ? scheduleIsCargo(s, sch) : false
}

/**
 * Order the "recently run" table: newest day first, then route and clock, with
 * every freight-only run pushed below the passenger departures regardless of
 * the day it last ran.
 */
export function sortRecentTrips(s: GameState, trips: Trip[]): Trip[] {
  return [...trips].sort(
    (a, b) =>
      Number(isCargoTrip(s, a)) - Number(isCargoTrip(s, b)) ||
      b.day - a.day ||
      routeName(a.routeId).localeCompare(routeName(b.routeId)) ||
      clockMinutes(a) - clockMinutes(b) ||
      (a.direction === 'AB' ? -1 : 1),
  )
}

function DirOccFare({
  trip,
  editing,
  onEdit,
  onSave,
  onCancel,
  onRunAnyway,
  isBlocked,
  needsHp,
  bus,
  onNudgeFare,
}: {
  trip?: Trip
  editing: boolean
  onEdit: () => void
  onSave: (fare: number) => void
  onCancel: () => void
  onRunAnyway?: () => void
  isBlocked?: boolean
  needsHp?: boolean
  bus?: Bus
  onNudgeFare?: (delta: number) => void
}) {
  if (!trip) return <span className="dim">—</span>
  const model = bus ? BUS_MODELS[bus.modelId] : undefined
  const isCargo = isCargoModel(model)
  const showCmvr = bus?.ownership !== 'attached' && (isBlocked || trip.cmvrBlocked) && !trip.cmvrRunAnyway

  if (isCargo) {
    const cargoCapKg = model?.cargoCapKg ?? 0
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span
          className="pill small"
          style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--accent)', fontWeight: 600 }}
        >
          📦 {tonnes(cargoCapKg)} t Freight
        </span>
        {showCmvr && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="bad small" title="Blocked by CMVR driving hours / crew rest">CMVR Block</span>
            {onRunAnyway && (
              <button className="small warn" title="Dispatch anyway despite CMVR block" onClick={onRunAnyway}>
                Run Anyway
              </button>
            )}
          </span>
        )}
      </span>
    )
  }

  const hybrid = hybridClassStats(trip, model)
  const lf = occPct(trip)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      {hybrid ? (
        <span className="small">
          <Bar value={hybrid.sleeper.cap ? hybrid.sleeper.sold / hybrid.sleeper.cap : 0} tone="auto" width={8} />
          {' '}
          {hybrid.sleeper.sold}/{hybrid.sleeper.cap}
          <span className="dim"> slp</span>
          <span className="dim"> · </span>
          <Bar value={hybrid.seater.cap ? hybrid.seater.sold / hybrid.seater.cap : 0} tone="auto" width={8} />
          {' '}
          {hybrid.seater.sold}/{hybrid.seater.cap}
          <span className="dim"> str</span>
        </span>
      ) : (
        <>
          <Bar value={lf} tone="auto" width={9} />
          <span className={occTone(lf)} style={{ fontWeight: 600 }}>{Math.round(lf * 100)}%</span>
          <span className="dim small">({trip.sold}/{seatCap(trip)})</span>
        </>
      )}

      {editing && trip.status !== 'completed' ? (
        <input
          autoFocus
          type="number"
          defaultValue={Math.round(toRupees(trip.fare))}
          step={50}
          title="Base fare (before seat multipliers)"
          style={{ width: 68 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(rs(Number((e.target as HTMLInputElement).value)))
            if (e.key === 'Escape') onCancel()
          }}
          onBlur={(e) => {
            const v = rs(Number(e.target.value))
            if (v !== trip.fare) onSave(v)
            else onCancel()
          }}
        />
      ) : (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {trip.status === 'completed' ? (
            <span
              className="dim"
              title={
                hybrid
                  ? `Sleeper and seater fares · base ₹${Math.round(toRupees(trip.fare))} (Departed)`
                  : 'Departed trip fare (read-only)'
              }
            >
              {hybrid ? (
                <span className="small">
                  <M v={hybrid.sleeper.listed} /><span className="dim"> slp</span>
                  <span className="dim"> · </span>
                  <M v={hybrid.seater.listed} /><span className="dim"> str</span>
                </span>
              ) : (
                <b><M v={trip.fare} /></b>
              )}
            </span>
          ) : (
            <>
              <button
                className="linkish"
                onClick={onEdit}
                title={
                  hybrid
                    ? `Sleeper and seater fares · base ₹${Math.round(toRupees(trip.fare))} — click to reprice`
                    : 'Click to reprice departure fare'
                }
              >
                {hybrid ? (
                  <span className="small">
                    <M v={hybrid.sleeper.listed} /><span className="dim"> slp</span>
                    <span className="dim"> · </span>
                    <M v={hybrid.seater.listed} /><span className="dim"> str</span>
                  </span>
                ) : (
                  <b><M v={trip.fare} /></b>
                )}
              </button>
              {onNudgeFare && (
                <span style={{ display: 'inline-flex', gap: 1 }}>
                  <button
                    className="small text"
                    style={{ padding: '0 3px', fontSize: 10, lineHeight: 1 }}
                    onClick={() => onNudgeFare(-50)}
                    title="Decrease fare by ₹50"
                  >
                    -
                  </button>
                  <button
                    className="small text"
                    style={{ padding: '0 3px', fontSize: 10, lineHeight: 1 }}
                    onClick={() => onNudgeFare(50)}
                    title="Increase fare by ₹50"
                  >
                    +
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}

      {bus?.ownership !== 'attached' && needsHp && trip.status !== 'completed' && (
        <span className="warn small" title="Coach needs driver with HMV_HP endorsement. Checkpost fine ₹10k.">
          [HP req]
        </span>
      )}

      {showCmvr && trip.status !== 'completed' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="bad small" title="Blocked by CMVR driving hours / crew rules">CMVR</span>
          {onRunAnyway && (
            <button className="small warn" title="Dispatch anyway despite CMVR block" onClick={onRunAnyway}>
              Force
            </button>
          )}
        </span>
      )}

      {bus?.ownership !== 'attached' && trip.cmvrRunAnyway && trip.status !== 'completed' && (
        <span className="warn small" title="Forced dispatch confirmed">Forced</span>
      )}
    </span>
  )
}

function checkTripCmvrStatus(s: GameState, trip?: Trip): { isBlocked: boolean; needsHp: boolean } {
  if (!trip) return { isBlocked: false, needsHp: false }
  const bus = s.buses[trip.busId]
  const route = ROUTES[trip.routeId]
  if (!bus || !route) return { isBlocked: false, needsHp: false }

  if (bus.ownership === 'attached') return { isBlocked: false, needsHp: false }

  const assignedDrivers = Object.values(s.staff).filter(
    (st) => st.busId === bus.id && (st.role === 'driver' || st.role === 'co_driver'),
  )
  const conductor = Object.values(s.staff).find((st) => st.busId === bus.id && st.role === 'conductor')

  const needsSecond = route.hours > BAL.maxDrivingHoursSingleDriver
  const hasSecondQualified = assignedDrivers.length >= 2 || (conductor && conductor.skill >= 5)
  const driversNeeded = needsSecond && !hasSecondQualified ? 2 : 1
  const isHpBus = modelNeedsHp(bus.modelId)

  const eligibleAssigned = assignedDrivers.filter((d) =>
    isDriverEligibleForTrip(s, d, trip.day, trip.depHour, route.hours, driversNeeded),
  )

  const eligibleSpares = spareDriverBench(s).filter((d) =>
    isDriverEligibleForTrip(s, d, trip.day, trip.depHour, route.hours, driversNeeded),
  )

  const totalEligible = eligibleAssigned.length + eligibleSpares.length
  const isBlocked = totalEligible < driversNeeded

  const hasHpDriver =
    isHpBus &&
    (eligibleAssigned.some((d) => d.licenceClass === 'HMV_HP') ||
      eligibleSpares.some((d) => d.licenceClass === 'HMV_HP'))
  const needsHp = isHpBus && !hasHpDriver

  return { isBlocked: isBlocked || Boolean(trip.cmvrBlocked), needsHp }
}

interface DayPair {
  day: number
  depHour?: number
  depMin?: number
  up?: Trip
  down?: Trip
}

interface ScheduleGroup {
  sch: Schedule
  trips: Trip[]
  days: DayPair[]
  avgLf: number
  openCount: number
}

const SHOW_DAYS = 7

export function TripBoardPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [activeTab, setActiveTab] = useState<'timetable' | 'daily' | 'timeline' | 'history'>('timetable')
  const [routeFilter, setRouteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'high' | 'cmvr' | 'festival' | 'cargo'>('all')
  const [repricing, setRepricing] = useState<string | null>(null)
  const [timelineDay, setTimelineDay] = useState<number>(s.day)
  const [showCargoBookingWindow, setShowCargoBookingWindow] = useState(false)
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null)
  const uiPrefs = useGame((g) => g.uiPrefs)
  const setFleetGroupFilter = useGame((g) => g.setFleetGroupFilter)
  const activeBrandList = useMemo(() => activeGroups(s), [s.groups])

  const activeTimelineDay = Math.min(Math.max(s.day, timelineDay), s.day + SHOW_DAYS - 1)

  const cargoScheduleCount = useMemo(() => {
    let count = 0
    for (const sch of Object.values(s.schedules)) {
      if (isCargoSchedule(s, sch)) count++
    }
    return count
  }, [s.schedules, s.buses])

  const groups = useMemo(() => {
    const bySch = new Map<string, Trip[]>()
    const seenTripIds = new Set<string>()
    const candidateTrips: Trip[] = []

    for (const id of s.openTripIds) {
      const t = s.trips[id]
      if (!t || t.day < s.day || t.day >= s.day + SHOW_DAYS) continue
      if (t.day === s.day ? (t.status !== 'open' && t.status !== 'completed') : t.status !== 'open') continue
      seenTripIds.add(t.id)
      candidateTrips.push(t)
    }

    for (const t of Object.values(s.trips)) {
      if (t.day === s.day && t.status === 'completed' && !seenTripIds.has(t.id)) {
        seenTripIds.add(t.id)
        candidateTrips.push(t)
      }
    }

    for (const t of candidateTrips) {
      if (!matchesBrand(s, t, uiPrefs.fleetGroupId)) continue
      if (routeFilter !== 'all' && canonicalRouteId(t.routeId) !== canonicalRouteId(routeFilter)) continue
      const sch = s.schedules[t.scheduleId]
      if (sch && isCargoSchedule(s, sch) && !showCargoBookingWindow) continue
      const list = bySch.get(t.scheduleId) ?? []
      list.push(t)
      bySch.set(t.scheduleId, list)
    }

    const out: ScheduleGroup[] = []
    for (const [schId, trips] of bySch) {
      const sch = s.schedules[schId]
      if (!sch || !ROUTES[sch.routeId]) continue

      const bySlot = new Map<string, DayPair>()
      for (const t of trips) {
        const slotKey = `${t.day}_${t.depHour}_${t.depMin ?? 0}`
        let row = bySlot.get(slotKey)
        if (!row) {
          row = { day: t.day, depHour: t.depHour, depMin: t.depMin ?? 0 }
          bySlot.set(slotKey, row)
        }
        if (t.direction === 'AB') row.up = t
        else row.down = t
      }
      const days = [...bySlot.values()]
        .sort((a, b) =>
          a.day !== b.day ? a.day - b.day : a.depHour! * 60 + a.depMin! - (b.depHour! * 60 + b.depMin!),
        )
        .slice(0, SHOW_DAYS * 2)

      let sold = 0
      let seats = 0
      for (const t of trips) {
        sold += t.sold
        seats += seatCap(t)
      }
      out.push({
        sch,
        trips,
        days,
        avgLf: seats > 0 ? sold / seats : 0,
        openCount: trips.filter((t) => t.status === 'open').length,
      })
    }

    return out.sort(
      (a, b) =>
        routeName(a.sch.routeId).localeCompare(routeName(b.sch.routeId)) ||
        clockMinutes(a.sch) - clockMinutes(b.sch),
    )
  }, [s, routeFilter, showCargoBookingWindow, uiPrefs.fleetGroupId])

  const filteredGroups = useMemo(() => {
    if (statusFilter === 'all') return groups

    const result: (ScheduleGroup & { visibleDays: DayPair[] })[] = []
    for (const grp of groups) {
      const isCargo = isCargoSchedule(s, grp.sch)
      const isFestSch = Boolean(grp.sch.festivalOnly)

      let visibleDays: DayPair[] = []
      if (statusFilter === 'cargo') {
        if (isCargo) visibleDays = grp.days
      } else if (statusFilter === 'festival') {
        visibleDays = grp.days.filter((row) => isFestSch || Boolean(festivalRunEffect(row.day).name) || Boolean(row.up?.festivalOnly) || Boolean(row.down?.festivalOnly))
      } else if (statusFilter === 'cmvr') {
        visibleDays = grp.days.filter((row) => {
          const upCmvr = row.up ? checkTripCmvrStatus(s, row.up) : null
          const downCmvr = row.down ? checkTripCmvrStatus(s, row.down) : null
          return Boolean((upCmvr && (upCmvr.isBlocked || upCmvr.needsHp)) || (downCmvr && (downCmvr.isBlocked || downCmvr.needsHp)))
        })
      } else if (statusFilter === 'low') {
        visibleDays = grp.days.filter((row) => {
          const upLow = Boolean(row.up && !isCargoTrip(s, row.up) && occPct(row.up) < 0.4)
          const downLow = Boolean(row.down && !isCargoTrip(s, row.down) && occPct(row.down) < 0.4)
          return upLow || downLow
        })
      } else if (statusFilter === 'high') {
        visibleDays = grp.days.filter((row) => {
          const upHigh = Boolean(row.up && !isCargoTrip(s, row.up) && occPct(row.up) >= 0.75)
          const downHigh = Boolean(row.down && !isCargoTrip(s, row.down) && occPct(row.down) >= 0.75)
          return upHigh || downHigh
        })
      }

      if (visibleDays.length > 0) {
        result.push({
          ...grp,
          visibleDays,
        })
      }
    }
    return result
  }, [groups, statusFilter, s])

  const myRoutes = useMemo(() => {
    const brand = uiPrefs.fleetGroupId
    const raw = Object.values(s.schedules)
      .filter((sch) => {
        if (brand === 'all') return true
        const gid = sch.groupId
        if (brand === 'none') return !gid
        return gid === brand
      })
      .map((x) => canonicalRouteId(x.routeId))
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
  }, [s.schedules, uiPrefs.fleetGroupId])

  // Drop a route filter that doesn't belong to the selected brand.
  useEffect(() => {
    if (routeFilter === 'all') return
    const stillValid = myRoutes.some((r) => canonicalRouteId(r) === canonicalRouteId(routeFilter))
    if (!stillValid) setRouteFilter('all')
  }, [myRoutes, routeFilter])

  const totalOpen = groups.reduce((n, grp) => n + grp.openCount, 0)

  const dayTrips = useMemo(() => {
    const list: Trip[] = []
    const seen = new Set<string>()
    for (const id of s.openTripIds) {
      const t = s.trips[id]
      if (!t || t.day !== activeTimelineDay) continue
      if (activeTimelineDay === s.day ? (t.status !== 'open' && t.status !== 'completed') : t.status !== 'open') continue
      if (!matchesBrand(s, t, uiPrefs.fleetGroupId)) continue
      if (routeFilter === 'all' || canonicalRouteId(t.routeId) === canonicalRouteId(routeFilter)) {
        seen.add(t.id)
        list.push(t)
      }
    }
    if (activeTimelineDay === s.day) {
      for (const t of Object.values(s.trips)) {
        if (t.day === s.day && t.status === 'completed' && !seen.has(t.id)) {
          if (!matchesBrand(s, t, uiPrefs.fleetGroupId)) continue
          if (routeFilter === 'all' || canonicalRouteId(t.routeId) === canonicalRouteId(routeFilter)) {
            seen.add(t.id)
            list.push(t)
          }
        }
      }
    }
    return list.sort((a, b) => clockMinutes(a) - clockMinutes(b))
  }, [s.openTripIds, s.trips, activeTimelineDay, routeFilter, uiPrefs.fleetGroupId, s.buses, s.schedules, s.day])

  const filteredDayTrips = useMemo(() => {
    if (statusFilter === 'all') return dayTrips
    return dayTrips.filter((t) => {
      const lf = occPct(t)
      const isCargo = isCargoTrip(s, t)
      const cmvr = checkTripCmvrStatus(s, t)
      const isFest = Boolean(t.festivalOnly || s.schedules[t.scheduleId]?.festivalOnly || festivalRunEffect(t.day).name)
      if (statusFilter === 'low') return !isCargo && lf < 0.4
      if (statusFilter === 'high') return !isCargo && lf >= 0.75
      if (statusFilter === 'cmvr') return cmvr.isBlocked || cmvr.needsHp
      if (statusFilter === 'festival') return isFest
      if (statusFilter === 'cargo') return isCargo
      return true
    })
  }, [dayTrips, statusFilter, s])

  const cmvrBlockedCount = useMemo(() => {
    let count = 0
    for (const id of s.openTripIds) {
      const t = s.trips[id]
      if (t && t.status === 'open' && t.day >= s.day && t.day < s.day + SHOW_DAYS) {
        if (checkTripCmvrStatus(s, t).isBlocked && !t.cmvrRunAnyway) count++
      }
    }
    return count
  }, [s.openTripIds, s.trips, s.buses, s.staff, s.day])

  const conflictTripIds = useMemo(() => {
    const conflicts = new Set<string>()
    const byBus = new Map<string, { trip: Trip; start: number; end: number }[]>()
    for (const t of dayTrips) {
      if (!t.busId) continue
      const route = ROUTES[t.routeId]
      const duration = route ? route.hours : 4
      const start = t.depHour + (t.depMin ?? 0) / 60
      const end = start + duration
      const list = byBus.get(t.busId) ?? []
      list.push({ trip: t, start, end })
      byBus.set(t.busId, list)
    }
    for (const [, entries] of byBus) {
      if (entries.length < 2) continue
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[i].start < entries[j].end && entries[j].start < entries[i].end) {
            conflicts.add(entries[i].trip.id)
            conflicts.add(entries[j].trip.id)
          }
        }
      }
    }
    return conflicts
  }, [dayTrips])

  const timelineSchedules = useMemo(() => {
    const schIds = new Set<string>()
    for (const t of dayTrips) schIds.add(t.scheduleId)
    for (const sch of Object.values(s.schedules)) {
      if (routeFilter === 'all' || canonicalRouteId(sch.routeId) === canonicalRouteId(routeFilter)) {
        if (sch.busIds.length > 0) schIds.add(sch.id)
      }
    }
    return Array.from(schIds)
      .map((id) => s.schedules[id])
      .filter(Boolean)
      .sort((a, b) => routeName(a.routeId).localeCompare(routeName(b.routeId)) || clockMinutes(a) - clockMinutes(b))
  }, [dayTrips, s.schedules, routeFilter])

  const recent = useMemo(() => {
    const completed = Object.values(s.trips).filter((t) => t.status === 'completed' && t.day <= s.day)
    if (completed.length === 0) return []

    const byRoute = new Map<string, Trip[]>()
    for (const t of completed) {
      if (!matchesBrand(s, t, uiPrefs.fleetGroupId)) continue
      if (routeFilter !== 'all' && canonicalRouteId(t.routeId) !== canonicalRouteId(routeFilter)) continue
      const list = byRoute.get(t.routeId) ?? []
      list.push(t)
      byRoute.set(t.routeId, list)
    }

    const out: Trip[] = []
    for (const [, trips] of byRoute) {
      const maxDay = Math.max(...trips.map((t) => t.day))
      const lastDayTrips = trips.filter((t) => t.day === maxDay)
      out.push(...lastDayTrips)
    }

    return sortRecentTrips(s, out)
  }, [s, s.trips, s.day, routeFilter, uiPrefs.fleetGroupId, s.buses, s.schedules])

  const overallAvgLf = useMemo(() => {
    let sold = 0
    let seats = 0
    for (const grp of groups) {
      for (const t of grp.trips) {
        sold += t.sold
        seats += seatCap(t)
      }
    }
    return seats > 0 ? sold / seats : 0
  }, [groups])

  const handleNudgeFare = (tripId: string, deltaRs: number) => {
    const trip = s.trips[tripId]
    if (!trip) return
    const curFareRs = Math.round(toRupees(trip.fare))
    const newFareRs = Math.max(50, curFareRs + deltaRs)
    g.repriceTrip(tripId, rs(newFareRs))
  }

  return (
    <>
      {/* Page Title & Navigation Bar */}
      <div className="page-title">
        <span>Trip Board & Dispatch Control</span>
        <span className="sub">
          {groups.length} Active Services · {totalOpen} Trips on Sale (Next {SHOW_DAYS} Days)
        </span>
        <span className="spacer" />
        <span className="flex" style={{ gap: 6 }}>
          {([
            ['timetable', `📅 Timetable Grid (${groups.length})`],
            ['daily', `📋 Daily Departures (${dayTrips.length})`],
            ['timeline', '⏱️ 24h Timeline'],
            ['history', `📜 Run History (${recent.length})`],
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

      {/* Dispatch Health Strip */}
      <div className="grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Network Passenger Occupancy</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className={occTone(overallAvgLf)}>{Math.round(overallAvgLf * 100)}% Average LF</span>
          </div>
          <div className="small dim">
            {totalOpen} active trips in booking window
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Today's Scheduled Departures</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className="good">{dayTrips.length} Runs Today</span>
          </div>
          <div className="small dim">
            {conflictTripIds.size > 0 ? (
              <span className="bad">⚠️ {conflictTripIds.size} overlap conflict(s)</span>
            ) : (
              <span className="good">✓ Zero platform conflicts</span>
            )}
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">CMVR & Regulatory Compliance</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            {cmvrBlockedCount > 0 ? (
              <span className="bad">⚠️ {cmvrBlockedCount} CMVR Blocked</span>
            ) : (
              <span className="good">✓ 100% CMVR Compliant</span>
            )}
          </div>
          <div className="small dim">
            {cmvrBlockedCount > 0 ? 'Relief crew or force dispatch required' : 'All duty hours within limits'}
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px' }}>
          <div className="dim small">Dedicated Freight Runs</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0' }}>
            <span className="accent">{cargoScheduleCount} Freight Schedules</span>
          </div>
          <div className="small dim">
            <button
              className="linkish small"
              onClick={() => setShowCargoBookingWindow(!showCargoBookingWindow)}
            >
              {showCargoBookingWindow ? 'Hide Cargo in PSS' : 'Show Cargo in PSS'}
            </button>
          </div>
        </div>
      </div>

      {/* Global Filter Bar */}
      <div
        className="flex"
        style={{
          background: 'var(--bg-card)',
          padding: '8px 12px',
          borderRadius: 4,
          marginBottom: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        {/* Status Filters: Timetable Grid & Daily Departures */}
        {(activeTab === 'timetable' || activeTab === 'daily') && (
          <div className="flex flex-wrap" style={{ gap: 4, alignItems: 'center' }}>
            <span className="dim small">Status:</span>
            {([
              ['all', 'All'],
              ['low', 'Low Load (<40%)'],
              ['high', 'Selling Fast (>75%)'],
              ['cmvr', 'CMVR Alert'],
              ['festival', 'Festival Run'],
              ['cargo', 'Cargo'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                className={`small ${statusFilter === id ? 'primary' : ''}`}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Day Navigation Controls: Daily Departures & Timeline */}
        {(activeTab === 'daily' || activeTab === 'timeline') && (
          <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
            <button
              className="small"
              disabled={activeTimelineDay <= s.day}
              onClick={() => setTimelineDay(activeTimelineDay - 1)}
            >
              ◀ Prev Day
            </button>
            <b className="accent small" style={{ minWidth: 120, textAlign: 'center' }}>
              {activeTimelineDay === s.day ? `Today (${fmtDateShort(activeTimelineDay)})` : fmtDateShort(activeTimelineDay)}
            </b>
            <button
              className="small"
              disabled={activeTimelineDay >= s.day + SHOW_DAYS - 1}
              onClick={() => setTimelineDay(activeTimelineDay + 1)}
            >
              Next Day ▶
            </button>
            {activeTimelineDay !== s.day && (
              <button className="small primary" onClick={() => setTimelineDay(s.day)}>
                Today
              </button>
            )}
          </div>
        )}

        {/* Right Side: Route Filter (Docked to Right Across All Views) */}
        <div className="flex" style={{ gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <span className="dim small">Brand:</span>
          <select
            value={uiPrefs.fleetGroupId}
            onChange={(e) => setFleetGroupFilter(e.target.value as any)}
            style={{ width: 220, minWidth: 200 }}
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
          <span className="dim small">Filter Route:</span>
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
            <option value="all">All Routes ({myRoutes.length})</option>
            {myRoutes.map((r) => (
              <option key={r} value={r}>
                {routeName(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: MASTER TIMETABLE GRID (BY SCHEDULE)                                */}
      {/* ========================================================================= */}
      {activeTab === 'timetable' && (
        <>
          {filteredGroups.length === 0 ? (
            <Panel>
              <div style={{ padding: 24, textAlign: 'center' }} className="dim">
                {statusFilter !== 'all'
                  ? `No departures match the "${statusFilter === 'festival' ? 'Festival Run' : statusFilter === 'low' ? 'Low Load (<40%)' : statusFilter === 'high' ? 'Selling Fast (>75%)' : statusFilter === 'cmvr' ? 'CMVR Alert' : 'Cargo'}" filter. Try selecting "All".`
                  : 'No departures currently scheduled. Assign coaches to schedules to open booking windows.'}
              </div>
            </Panel>
          ) : (
            filteredGroups.map((grp) => {
              const route = ROUTES[grp.sch.routeId]
              const buses = grp.sch.busIds.map((id) => s.buses[id]).filter(Boolean)
              const upCity = route ? cityName(route.from) : 'Origin'
              const downCity = route ? cityName(route.to) : 'Destination'
              const isCargo = isCargoSchedule(s, grp.sch)
              const displayDays = grp.visibleDays ?? grp.days
              return (
                <Panel
                  key={grp.sch.id}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <GroupBadge group={grp.sch.groupId && s.groups ? s.groups[grp.sch.groupId] : undefined} />
                      <span><b>{routeName(grp.sch.routeId)}</b> · {fmtClock(grp.sch)}</span>
                      {isCargo ? (
                        <span className="pill small" style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--accent)', fontWeight: 600 }}>
                          📦 Dedicated Freight
                        </span>
                      ) : (
                        <span className={`pill small ${occTone(grp.avgLf)}`}>
                          {Math.round(grp.avgLf * 100)}% {SHOW_DAYS}-day LF
                        </span>
                      )}
                      {!grp.sch.active && <span className="pill bad small">Suspended</span>}
                    </div>
                  }
                  right={
                    <div className="dim small" style={{ textAlign: 'right' }}>
                      {buses.length === 0 ? (
                        <span className="bad small">⚠️ No coach assigned</span>
                      ) : (
                        buses.map((b) => {
                          const m = BUS_MODELS[b.modelId]
                          return (
                            <span key={b.id} style={{ display: 'block' }}>
                              <Link to={`/fleet/${b.id}`}><b>{b.reg}</b></Link>
                              {m && (
                                <>
                                  {' · '}{modelTitle(m)}
                                  {' · '}<span className={coachKindClass(m)}>{coachKind(m)}</span>
                                  {' · '}{CLASS_LABEL[m.cls] ?? m.cls}
                                </>
                              )}
                            </span>
                          )
                        })
                      )}
                    </div>
                  }
                >
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Date / Slot</th>
                        <th>↑ Outbound to {downCity}</th>
                        <th>↓ Return to {upCity}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDays.map((row) => {
                        const fest = festivalRunEffect(row.day)
                        const festName = fest.name
                        const runSlot = festivalRunSlot(row.day)
                        const isToday = row.day === s.day
                        return (
                          <tr key={`${row.day}_${row.depHour}_${row.depMin}`} className={festName ? 'fest' : undefined}>
                            <td>
                              <div>
                                <b className={isToday ? 'accent' : festName ? 'warn' : undefined}>
                                  {fmtDateShort(row.day)}
                                </b>
                                {row.depHour !== undefined && (
                                  <span className="dim"> {fmtClock({ depHour: row.depHour, depMin: row.depMin as 0 | 30 })}</span>
                                )}
                              </div>
                              <div className="dim small">
                                {isToday ? <span className="good">Today</span> : `T-${row.day - s.day}d`}
                                {festName && (
                                  <span className="pill warn small" style={{ marginLeft: 6 }}>
                                    {festName.split(' / ')[0]}
                                    {runSlot === 'pre_pad' ? ' · pre' : runSlot === 'post_pad' ? ' · ret' : ''}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              {(() => {
                                const st = checkTripCmvrStatus(s, row.up)
                                return (
                                  <DirOccFare
                                    trip={row.up}
                                    editing={repricing === row.up?.id}
                                    onEdit={() => row.up && setRepricing(row.up.id)}
                                    onSave={(fare) => {
                                      if (row.up) {
                                        g.repriceTrip(row.up.id, fare)
                                        setRepricing(null)
                                      }
                                    }}
                                    onCancel={() => setRepricing(null)}
                                    isBlocked={st.isBlocked}
                                    needsHp={st.needsHp}
                                    onRunAnyway={() => row.up && g.runTripAnyway(row.up.id)}
                                    bus={row.up?.busId ? s.buses[row.up.busId] : undefined}
                                    onNudgeFare={row.up ? (delta) => handleNudgeFare(row.up!.id, delta) : undefined}
                                  />
                                )
                              })()}
                            </td>
                            <td>
                              {(() => {
                                const st = checkTripCmvrStatus(s, row.down)
                                return (
                                  <DirOccFare
                                    trip={row.down}
                                    editing={repricing === row.down?.id}
                                    onEdit={() => row.down && setRepricing(row.down.id)}
                                    onSave={(fare) => {
                                      if (row.down) {
                                        g.repriceTrip(row.down.id, fare)
                                        setRepricing(null)
                                      }
                                    }}
                                    onCancel={() => setRepricing(null)}
                                    isBlocked={st.isBlocked}
                                    needsHp={st.needsHp}
                                    onRunAnyway={() => row.down && g.runTripAnyway(row.down.id)}
                                    bus={row.down?.busId ? s.buses[row.down.busId] : undefined}
                                    onNudgeFare={row.down ? (delta) => handleNudgeFare(row.down!.id, delta) : undefined}
                                  />
                                )
                              })()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </Panel>
              )
            })
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: DAILY DEPARTURES LIST (CHRONOLOGICAL)                              */}
      {/* ========================================================================= */}
      {activeTab === 'daily' && (
        <Panel
          title={`Daily Departures: ${fmtDateShort(activeTimelineDay)} (${filteredDayTrips.length} Runs)`}
          flat
          right={
            <span className="dim small">
              Click fare to reprice in-line · Use ± buttons to nudge fare by ₹50
            </span>
          }
        >
          {filteredDayTrips.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }} className="dim">
              No matching departures on this date for the active filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Time / Slot</th>
                    <th>Corridor / Route</th>
                    <th>Vehicle</th>
                    <th>Crew / Drivers</th>
                    <th className="num">Load Factor / Pax</th>
                    <th className="num">Ticket Fare</th>
                    <th>CMVR / Compliance</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDayTrips.map((t) => {
                    const route = ROUTES[t.routeId]
                    const bus = s.buses[t.busId]
                    const model = bus ? BUS_MODELS[bus.modelId] : undefined
                    const isCargo = isCargoTrip(s, t)
                    const lf = occPct(t)
                    const cap = seatCap(t)
                    const cmvr = checkTripCmvrStatus(s, t)
                    const hasConflict = conflictTripIds.has(t.id)

                    const assignedDrivers = Object.values(s.staff).filter(
                      (st) => st.busId === t.busId && (st.role === 'driver' || st.role === 'co_driver'),
                    )
                    const conductor = Object.values(s.staff).find(
                      (st) => st.busId === t.busId && st.role === 'conductor',
                    )

                    return (
                      <tr key={t.id} style={hasConflict ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                        <td>
                          <b>{fmtClock(t)}</b>
                          <div className="dim small">
                            {t.direction === 'AB' ? 'Outbound' : 'Return'}
                            {hasConflict && <span className="bad small" style={{ marginLeft: 4 }}>[Conflict]</span>}
                          </div>
                        </td>
                        <td>
                          <b>{routeName(t.routeId)}</b>
                          <div className="dim small">
                            {route ? `${route.km} km · ~${route.hours}h run` : ''}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <GroupBadge group={groupForTrip(s, t)} />
                            {bus ? (
                              <div>
                                <Link to={`/fleet/${bus.id}`}><b>{bus.reg}</b></Link>
                                <div className="dim small">{model ? modelTitle(model) : ''}</div>
                              </div>
                            ) : (
                              <span className="bad small">⚠️ No Bus Assigned</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {assignedDrivers.length > 0 ? (
                            <div>
                              <span>{assignedDrivers.map((d) => d.name).join(', ')}</span>
                              {conductor && <div className="dim small">Cond: {conductor.name}</div>}
                            </div>
                          ) : (
                            <span className="warn small">Depot Standby</span>
                          )}
                        </td>
                        <td className="num">
                          {isCargo ? (
                            <span className="pill info small">
                              📦 {tonnes(model?.cargoCapKg ?? 0)} t Freight
                            </span>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                <Bar value={lf} tone="auto" width={8} />
                                <span className={occTone(lf)} style={{ fontWeight: 600 }}>{Math.round(lf * 100)}%</span>
                              </div>
                              <div className="dim small">{t.sold} / {cap} seats</div>
                            </div>
                          )}
                        </td>
                        <td className="num">
                          {isCargo ? (
                            <span className="dim">Freight rate</span>
                          ) : t.status === 'completed' ? (
                            <span className="dim" title="Departed trip fare (read-only)">
                              <b><M v={t.fare} /></b>
                            </span>
                          ) : repricing === t.id ? (
                            <input
                              autoFocus
                              type="number"
                              defaultValue={Math.round(toRupees(t.fare))}
                              step={50}
                              style={{ width: 68 }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  g.repriceTrip(t.id, rs(Number((e.target as HTMLInputElement).value)))
                                  setRepricing(null)
                                }
                                if (e.key === 'Escape') setRepricing(null)
                              }}
                              onBlur={(e) => {
                                g.repriceTrip(t.id, rs(Number(e.target.value)))
                                setRepricing(null)
                              }}
                            />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                              <button className="linkish" onClick={() => setRepricing(t.id)}>
                                <b><M v={t.fare} /></b>
                              </button>
                              <button
                                className="small text"
                                style={{ padding: '0 4px', fontSize: 10 }}
                                onClick={() => handleNudgeFare(t.id, -50)}
                                title="Lower fare -₹50"
                              >
                                -
                              </button>
                              <button
                                className="small text"
                                style={{ padding: '0 4px', fontSize: 10 }}
                                onClick={() => handleNudgeFare(t.id, 50)}
                                title="Raise fare +₹50"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          {cmvr.isBlocked ? (
                            <span className="bad small">
                              ⚠️ CMVR Blocked {cmvr.needsHp ? '(HP req)' : '(Crew rest/hours)'}
                            </span>
                          ) : cmvr.needsHp ? (
                            <span className="warn small">⚠️ Needs HMV_HP Licence</span>
                          ) : t.cmvrRunAnyway ? (
                            <span className="warn small">Forced Dispatch</span>
                          ) : (
                            <span className="good small">✓ Clean</span>
                          )}
                        </td>
                        <td className="num">
                          {t.status === 'completed' ? (
                            <span className="dim small">Departed</span>
                          ) : cmvr.isBlocked && !t.cmvrRunAnyway ? (
                            <button
                              className="small warn"
                              title="Force dispatch despite crew limits (risks fines)"
                              onClick={() => g.runTripAnyway(t.id)}
                            >
                              Run Anyway
                            </button>
                          ) : (
                            <span className="dim small">Ready</span>
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

      {/* ========================================================================= */}
      {/* TAB 3: 24-HOUR INTERACTIVE TIMELINE                                       */}
      {/* ========================================================================= */}
      {activeTab === 'timeline' && (
        <Panel
          title={
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <span>24h Operational Gantt Timeline: {fmtDateShort(activeTimelineDay)}</span>
            </div>
          }
          info="Horizontal 24h operational schedule. Colored by occupancy: Green >75%, Amber 40-75%, Red <40%. Red border indicates overlapping bus conflict."
        >
          <div style={{ marginBottom: 14, display: 'flex', gap: 16, fontSize: '0.8rem', color: 'var(--dim)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: '#22c55e', borderRadius: 2 }} /> High LF (&gt;75%)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: '#eab308', borderRadius: 2 }} /> Mid LF (40–75%)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: '#ef4444', borderRadius: 2 }} /> Low LF (&lt;40%)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, border: '2px solid #ef4444', borderRadius: 2 }} /> Vehicle Overlap Conflict
            </span>
          </div>

          {timelineSchedules.length === 0 ? (
            <div className="dim" style={{ padding: '24px', textAlign: 'center' }}>
              No active schedules or departures on this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Hour scale ruler */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingBottom: 6,
                }}
              >
                <div style={{ width: 230, flexShrink: 0, fontSize: '0.75rem', fontWeight: 600 }} className="dim">
                  SCHEDULE / BUS
                </div>
                <div style={{ flex: 1, position: 'relative', height: 18 }}>
                  {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
                    <div
                      key={h}
                      style={{
                        position: 'absolute',
                        left: `${(h / 24) * 100}%`,
                        transform: h === 24 ? 'translateX(-100%)' : h === 0 ? 'none' : 'translateX(-50%)',
                        fontSize: '0.72rem',
                        color: 'var(--dim)',
                      }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
              </div>

              {/* Rows */}
              {timelineSchedules.map((sch) => {
                const route = ROUTES[sch.routeId]
                const tripsForSch = dayTrips.filter((t) => t.scheduleId === sch.id)
                const buses = sch.busIds.map((id) => s.buses[id]).filter(Boolean)

                return (
                  <div
                    key={sch.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <div style={{ width: 230, flexShrink: 0, paddingRight: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)' }}>
                        {routeName(sch.routeId)}
                      </div>
                      <div className="dim small" style={{ fontSize: '0.75rem' }}>
                        {fmtClock(sch)} · {buses.map((b) => b.reg).join(', ') || 'No bus'}
                      </div>
                    </div>

                    <div
                      style={{
                        flex: 1,
                        position: 'relative',
                        height: 36,
                        background: 'var(--bg-card)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      {/* Grid guidelines */}
                      {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                        <div
                          key={h}
                          style={{
                            position: 'absolute',
                            left: `${(h / 24) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: 'rgba(255, 255, 255, 0.05)',
                          }}
                        />
                      ))}

                      {/* Render trips as blocks */}
                      {tripsForSch.map((t) => {
                        const tripRoute = ROUTES[t.routeId] || route
                        const duration = tripRoute ? tripRoute.hours : 4
                        const start = t.depHour + (t.depMin ?? 0) / 60
                        const leftPct = (start / 24) * 100
                        const widthPct = Math.min(100 - leftPct, (duration / 24) * 100)
                        const cap = seatCap(t)
                        const lf = cap > 0 ? t.sold / cap : 0
                        const bus = s.buses[t.busId]
                        const model = bus ? BUS_MODELS[bus.modelId] : undefined
                        const isCargo = isCargoModel(model)
                        const cargoCap = model?.cargoCapKg ?? 0
                        const toneColor = isCargo
                          ? '#3b82f6'
                          : lf >= 0.75
                            ? '#22c55e'
                            : lf >= 0.4
                              ? '#eab308'
                              : '#ef4444'
                        const hasConflict = conflictTripIds.has(t.id)

                        return (
                          <div
                            key={t.id}
                            title={`${routeName(t.routeId)} (${t.direction}) · ${bus?.reg ?? 'Bus'} · ${Math.round(lf * 100)}% load`}
                            style={{
                              position: 'absolute',
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              top: 3,
                              bottom: 3,
                              background: toneColor,
                              color: '#0f172a',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 3,
                              border: hasConflict ? '2px solid #ef4444' : '1px solid rgba(0,0,0,0.25)',
                              boxShadow: hasConflict ? '0 0 8px #ef4444' : undefined,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              padding: '0 4px',
                              cursor: 'pointer',
                              zIndex: hasConflict ? 2 : 1,
                            }}
                          >
                            {isCargo
                              ? `📦 ${(cargoCap / 1000).toFixed(1)}T`
                              : `${t.direction === 'AB' ? 'Out' : 'Ret'} (${Math.round(lf * 100)}%)`}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: COMPLETED RUN HISTORY & TRIP PERFORMANCE                           */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <Panel
          title="Completed Trips Log — Last Run Date of Each Route"
          flat
          info="Detailed operational outcomes, passenger satisfaction, luggage freight revenue, direct operating costs, and net margin."
          right={
            recent.length > 0 ? (
              <span className="dim small">
                {recent.length} departure{recent.length === 1 ? '' : 's'} · {new Set(recent.map((t) => t.routeId)).size} route(s)
              </span>
            ) : undefined
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Run Date</th>
                  <th>Route & Direction</th>
                  <th>Coach</th>
                  <th className="num">Occ / Pax</th>
                  <th className="num">Fare</th>
                  <th className="num">Cargo</th>
                  <th className="num">Gross Rev</th>
                  <th className="num">Operating Cost</th>
                  <th className="num">Net Margin</th>
                  <th className="num">PSS / Star</th>
                  <th>Punctuality</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="dim" style={{ textAlign: 'center', padding: '16px' }}>
                      No completed runs recorded yet. Advance the game day to dispatch scheduled trips.
                    </td>
                  </tr>
                ) : (
                  recent.map((t) => {
                    const route = ROUTES[t.routeId]
                    const bus = s.buses[t.busId]
                    const model = bus ? BUS_MODELS[bus.modelId] : undefined
                    const hybrid = hybridClassStats(t, model)
                    const cap = seatCap(t)
                    const lf = cap > 0 ? t.sold / cap : 0
                    const isCargo = isCargoTrip(s, t)
                    const cargoCap = model?.cargoCapKg ?? 0
                    const cargoKg = t.outcome?.cargoKg ?? 0
                    const pss = t.outcome?.pss
                    const pssClass = pss !== undefined ? (pss >= 7.5 ? 'good' : pss < 5 ? 'bad' : 'warn') : 'dim'

                    const ticketRev = t.revenue + t.cancelledRevenue
                    const cargoRev = t.outcome?.cargoRevenue ?? 0
                    const totalRev = ticketRev + cargoRev
                    const costs = t.outcome?.tripCosts ?? 0
                    const netProfit = totalRev - costs

                    const delay = t.outcome?.delayMin ?? 0
                    const isDelayed = delay > 5
                    const fromCity = route ? cityName(t.direction === 'AB' ? route.from : route.to) : 'Origin'
                    const toCity = route ? cityName(t.direction === 'AB' ? route.to : route.from) : 'Destination'
                    const daysAgo = Math.max(0, s.day - t.day)
                    const relDay = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`
                    const isExpanded = expandedTripId === t.id

                    const assignedStaff = Object.values(s.staff).filter((st) => st.busId === t.busId)
                    const drivers = assignedStaff.filter((st) => st.role === 'driver')
                    const conductor = assignedStaff.find((st) => st.role === 'conductor')

                    return (
                      <Fragment key={t.id}>
                        <tr>
                          <td>
                            <div><b>{fmtDateShort(t.day)}</b> <span className="dim small">({relDay})</span></div>
                            <div className="dim small">{fmtClock(t)}</div>
                          </td>
                          <td>
                            <div>
                              <span className="accent"><b>{fromCity}</b></span>
                              <span className="dim"> → </span>
                              <b>{toCity}</b>
                              {isCargo && <span className="pill small purple" style={{ marginLeft: 6 }}>Freight</span>}
                            </div>
                            <div className="dim small">{t.direction === 'AB' ? '↑ Outbound' : '↓ Return'}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <GroupBadge group={groupForTrip(s, t)} />
                              <div>
                                <div className="font-mono"><b>{bus?.reg ?? '—'}</b></div>
                                <div className="dim small">{model ? modelTitle(model) : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className={`num ${occTone(lf)}`}>
                            <b>{Math.round(lf * 100)}%</b>
                            <div className="dim small">{t.sold}/{cap} pax</div>
                          </td>
                          <td className="num">
                            <M v={t.fare} />
                          </td>
                          <td className="num">
                            {cargoKg > 0 ? (
                              <div>
                                <span>{tonnes(cargoKg)} t</span>
                                {cargoCap > 0 && <span className="dim small"> ({Math.round((cargoKg / cargoCap) * 100)}%)</span>}
                                <div className="dim small"><M v={cargoRev} /></div>
                              </div>
                            ) : (
                              <span className="dim">—</span>
                            )}
                          </td>
                          <td className="num">
                            <b><M v={totalRev} /></b>
                          </td>
                          <td className="num">
                            <M v={costs} />
                          </td>
                          <td className={`num ${netProfit >= 0 ? 'good' : 'bad'}`}>
                            <b><M v={netProfit} /></b>
                          </td>
                          <td className="num">
                            <span className={pssClass}>
                              {pss !== undefined ? `${pss.toFixed(1)}/10` : '—'}
                            </span>
                            {t.outcome?.reviewScore && (
                              <div className="dim small">★ {t.outcome.reviewScore.toFixed(1)}</div>
                            )}
                          </td>
                          <td>
                            {t.status === 'cancelled' ? (
                              <span className="pill bad small">Cancelled</span>
                            ) : isDelayed ? (
                              <span className={`pill small ${delay > 30 ? 'bad' : 'warn'}`}>+{delay}m late</span>
                            ) : (
                              <span className="pill good small">✓ On Time</span>
                            )}
                          </td>
                          <td className="num">
                            <button
                              className="small"
                              onClick={() => setExpandedTripId(isExpanded ? null : t.id)}
                            >
                              {isExpanded ? '▲ Hide' : '▼ Inspect'}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <td colSpan={12} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                                <div>
                                  <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>
                                    Financial P&L Breakdown
                                  </div>
                                  <KV rows={[
                                    ['Passenger Ticket Revenue', <M v={t.revenue} />],
                                    ['Cancellation Fees Retained', <M v={t.cancelledRevenue} />],
                                    ['Cargo Luggage Freight', <M v={cargoRev} />],
                                    ['Total Gross Earnings', <b style={{ color: 'var(--text-main)' }}><M v={totalRev} /></b>],
                                    ['Fuel & Energy Cost', <M v={t.outcome?.fuelCost ?? 0} />],
                                    ['Highway FASTag Tolls', <M v={t.outcome?.tollCost ?? 0} />],
                                    ...(t.outcome?.amenitiesCost ? [['Passenger Amenities', <M v={t.outcome.amenitiesCost} />] as [React.ReactNode, React.ReactNode]] : []),
                                    ['Crew Bata & Misc', <M v={Math.max(0, costs - ((t.outcome?.fuelCost ?? 0) + (t.outcome?.tollCost ?? 0) + (t.outcome?.amenitiesCost ?? 0)))} />],
                                    ['Total Operating Costs', <b className="bad"><M v={costs} /></b>],
                                    ['Net Trip Contribution', <b className={netProfit >= 0 ? 'good' : 'bad'}><M v={netProfit} signed /></b>],
                                  ]} />
                                </div>

                                <div>
                                  <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>
                                    Pax & Booking Channels
                                  </div>
                                  <KV rows={[
                                    ['Seats Sold', `${t.sold} / ${cap} seats (${Math.round(lf * 100)}% LF)`],
                                    ...(hybrid ? [
                                      ['Sleeper Berths', `${hybrid.sleeper.sold} / ${hybrid.sleeper.cap} berths`] as [React.ReactNode, React.ReactNode],
                                      ['Cabin Seater', `${hybrid.seater.sold} / ${hybrid.seater.cap} seats`] as [React.ReactNode, React.ReactNode],
                                    ] : []),
                                    ['RedBus Channel', `${t.channelSold?.redbus ?? 0} seats`],
                                    ['AbhiBus Channel', `${t.channelSold?.abhibus ?? 0} seats`],
                                    ['Own Mobile App', `${t.channelSold?.ownapp ?? 0} seats`],
                                    ['Counter / Agent', `${t.channelSold?.counter ?? 0} seats`],
                                    ['Luggage Boot Load', `${tonnes(cargoKg)} t (${cargoRev > 0 ? fmtCompact(cargoRev) : 'no rev'})`],
                                  ]} />
                                </div>

                                <div>
                                  <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>
                                    Assigned Bus & Crew
                                  </div>
                                  <KV rows={[
                                    ['Bus Registration', <span className="accent font-mono"><b>{bus?.reg ?? '—'}</b></span>],
                                    ['Coach Model', model ? `${modelTitle(model)} (${coachKind(model)})` : '—'],
                                    ['Odometer Reading', `${(bus?.odometer ?? 0).toLocaleString()} km`],
                                    ['Driver(s) on Duty', drivers.length > 0 ? drivers.map((d) => `${d.name} (${d.skill}★)`).join(', ') : 'Depot driver'],
                                    ['Conductor', conductor ? `${conductor.name} (${conductor.skill}★)` : 'None required'],
                                    ['Mechanical Status', t.outcome?.breakdown ? <span className="bad">Breakdown reported</span> : <span className="good">Healthy / No issues</span>],
                                    ...(t.outcome?.reliefDispatched ? [['Relief Bus Dispatched', <span className="good">✓ Spare bus rescued passengers</span>] as [React.ReactNode, React.ReactNode]] : []),
                                    ...(t.outcome?.ecoBonusPaid ? [['Eco-Driving Bonus', <span className="good">✓ ₹250/driver eco bonus paid</span>] as [React.ReactNode, React.ReactNode]] : []),
                                    ['Safety Audit', t.outcome?.accident ? <span className="bad">Incident reported</span> : <span className="good">Zero accidents</span>],
                                  ]} />
                                </div>

                                <div>
                                  <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>
                                    Timetable & Customer Audit
                                  </div>
                                  <KV rows={[
                                    ['Departure Slot', `${fmtClock(t)} (${t.direction === 'AB' ? 'Outbound' : 'Return'})`],
                                    ['Departure Date', `${fmtDateShort(t.day)} (${relDay})`],
                                    ['Punctuality Delay', delay <= 5 ? <span className="good">On Time</span> : <span className="warn">+{delay}m late</span>],
                                    ['Passenger Satisfaction', <span className={pssClass}>{pss !== undefined ? `${pss.toFixed(1)} / 10 PSS` : '—'}</span>],
                                    ['Customer Star Rating', t.outcome?.reviewScore ? <span className={ratingTone(t.outcome.reviewScore)}>★ {t.outcome.reviewScore.toFixed(1)} / 5.0</span> : '—'],
                                    ['Dispatch Log Note', <span className="dim small" style={{ fontStyle: 'italic' }}>{t.outcome?.note ?? t.status}</span>],
                                  ]} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}
