/**
 * Route permits and schedule management.
 */
import { BAL } from '../data/balance'
import { ROUTES, boardingPointsForRoute, routeName, canonicalRouteId } from '../data/routes'
import { BUS_MODELS, isCargoModel } from '../data/busModels'
import { CITIES } from '../data/cities'
import { nextId } from '../core/ids'
import { rngFor, rInt, rChance } from '../core/rng'
import { clockFromMinutes, clockMinutes, festivalEffect, fmtClock, fmtDateShort } from '../core/calendar'
import { fmtCompact } from '../core/money'
import type { GameState, Schedule, ScheduleDefaults, ID, SeasonId, RouteDef, PassengerAmenities, ServiceTier } from '../types'
import { canAfford, spend } from './finance'
import { terminateCargoContractsOnRoute } from './cargo'
import { cancelOpenTripsForBus, cancelTrip, generateTrips, pruneInvalidSeasonalTrips } from './booking'
import { pushLog } from './log'
import { releaseCoverFor } from './cover'
import { opsAutoStaffPass, docsManagerOnDuty } from './staffing'
import { deskCoverage } from './span'
import { isReturnValid, suggestReturnSlot } from './pairing'
import { DEFAULT_CHANNELS, normalizeChannels } from '../data/channels'
import { syncRouteShare } from './rivals'
import { resolveTripFare, roundFare, isReturnTrip, serviceTierFareMult } from './pricing'

const OCC_RECENT_DAYS = 30

type OccBucket = { day: number; sold: number; seats: number }[]

function pushOcc(bucket: OccBucket, day: number, sold: number, seats: number): void {
  const row = bucket.find((r) => r.day === day)
  if (row) {
    row.sold += sold
    row.seats += seats
  } else {
    bucket.push({ day, sold, seats })
  }
}

/**
 * Record a completed trip's fill into the schedule's rolling occupancy window.
 * Slot 2 trips (matching returnDepHour) go to `occRecentReturn`; Slot 1 (depHour) to `occRecent`.
 * If depHour is omitted, falls back to `dir === 'BA'` for backwards compatibility.
 */
export function recordScheduleOcc(
  s: GameState,
  schId: ID,
  day: number,
  sold: number,
  seats: number,
  dir: 'AB' | 'BA' = 'AB',
  depHour?: number,
  depMin?: number,
): void {
  const sch = s.schedules[schId]
  if (!sch || seats <= 0) return

  let isReturnLeg = false
  if (sch.paired && sch.returnDepHour !== undefined) {
    if (depHour !== undefined) {
      // Check proximity to returnDepHour vs depHour
      const tripMin = depHour * 60 + (depMin ?? 0)
      const outMin = sch.depHour * 60 + (sch.depMin ?? 0)
      const retMin = sch.returnDepHour * 60 + (sch.returnDepMin ?? 0)
      const distOut = Math.min(Math.abs(tripMin - outMin), 1440 - Math.abs(tripMin - outMin))
      const distRet = Math.min(Math.abs(tripMin - retMin), 1440 - Math.abs(tripMin - retMin))
      isReturnLeg = distRet < distOut
    } else {
      isReturnLeg = dir === 'BA'
    }
  }

  if (isReturnLeg) {
    if (!sch.occRecentReturn) sch.occRecentReturn = []
    pushOcc(sch.occRecentReturn, day, sold, seats)
  } else {
    if (!sch.occRecent) sch.occRecent = []
    pushOcc(sch.occRecent, day, sold, seats)
  }
  pruneScheduleOcc(sch, s.day)
}

export function pruneScheduleOcc(sch: Schedule, today: number): void {
  if (!sch.occRecent) sch.occRecent = []
  const cut = today - OCC_RECENT_DAYS
  sch.occRecent = sch.occRecent.filter((r) => r.day > cut)
  if (sch.occRecentReturn) {
    sch.occRecentReturn = sch.occRecentReturn.filter((r) => r.day > cut)
  }
}

/** Load factor for completed trips in the last `days` days. Use `return` for paired BA strip. */
export function scheduleOccLf(
  sch: Schedule,
  today: number,
  days = OCC_RECENT_DAYS,
  leg: 'out' | 'return' = 'out',
): number | null {
  const rows = leg === 'return' ? sch.occRecentReturn : sch.occRecent
  if (!rows?.length) return null
  const cut = today - days
  let sold = 0
  let seats = 0
  for (const r of rows) {
    if (r.day <= cut || r.day > today) continue
    sold += r.sold
    seats += r.seats
  }
  return seats > 0 ? sold / seats : null
}

/** Drop corridors removed from the atlas so old saves do not crash. */
export function pruneRetiredRoutes(s: GameState): void {
  for (const id of Object.keys(s.permits)) {
    if (!ROUTES[id]) delete s.permits[id]
  }
  for (const sch of Object.values(s.schedules)) {
    if (ROUTES[sch.routeId]) continue
    for (const busId of [...sch.busIds]) {
      const bus = s.buses[busId]
      if (bus) bus.scheduleId = undefined
    }
    delete s.schedules[sch.id]
  }
  for (const sch of Object.values(s.schedules)) {
    sch.boardingPoints = boardingPointsForRoute(sch.routeId)
  }
  for (const rec of [s.world.fareIndex, s.world.demandShock, s.world.closures, s.world.priceWars, s.routeStats, s.routeHistory ?? {}]) {
    for (const id of Object.keys(rec)) {
      if (!ROUTES[id]) delete rec[id]
    }
  }
  // Drop economics for corridors the player no longer holds (discontinued / rejected).
  for (const id of Object.keys(s.routeStats ?? {})) {
    if (!s.permits[id]) delete s.routeStats[id]
  }
  if (s.routeHistory) {
    for (const id of Object.keys(s.routeHistory)) {
      if (!s.permits[id]) delete s.routeHistory[id]
    }
  }
}

/* ------------------------------ permits ------------------------------ */

export function statesOnRoute(route: RouteDef): string[] {
  const s1 = CITIES[route.from]?.state
  const s2 = CITIES[route.to]?.state
  const states: string[] = []
  if (s1) states.push(s1)
  if (s2 && s2 !== s1) states.push(s2)
  return states
}

export function applyForPermit(s: GameState, routeId: string): string | null {
  const route = ROUTES[routeId]
  if (!route) return 'Unknown route.'
  const canon = canonicalRouteId(routeId)
  if (
    s.permits[routeId] ||
    s.permits[canon] ||
    Object.values(s.permits).some((p) => canonicalRouteId(p.routeId) === canon)
  ) {
    return 'Already applied or active.'
  }
  if (s.company.reputation < route.unlockRep) {
    return `RTO wants an established operator here (reputation ${route.unlockRep}+ required).`
  }
  if (!canAfford(s, BAL.routePermitFee)) return `Permit fee is ${fmtCompact(BAL.routePermitFee)}.`
  spend(s, 'permit_tax', BAL.routePermitFee, { routeId: canon, note: 'permit application fee' })
  s.permits[canon] = { routeId: canon, status: 'applied', appliedDay: s.day }
  pushLog(s, 'info', `Permit application filed for ${routeName(canon)}. RTO says 2-4 weeks.`)
  return null
}

export function applySeasonalPermit(s: GameState, routeId: string, seasonId?: SeasonId): string | null {
  const route = ROUTES[routeId]
  if (!route) return 'Unknown route.'
  const permit = s.permits[routeId]
  if (!permit || permit.status !== 'active') return 'You need an active annual permit first.'
  if (permit.seasonal?.status === 'applied') return 'Seasonal permit application already pending.'
  if (permit.seasonal?.status === 'active') {
    return 'Seasonal permit is already active on this corridor.'
  }
  const fee = BAL.seasonalPermitFee ?? Math.round(BAL.routePermitFee * 0.40)
  if (!canAfford(s, fee)) return `Seasonal permit fee is ${fmtCompact(fee)}.`
  spend(s, 'permit_tax', fee, { routeId, note: 'seasonal permit fee' })
  permit.seasonal = {
    status: 'applied',
    seasonId: seasonId ?? 'summer',
    appliedDay: s.day,
  }
  pushLog(s, 'info', `Seasonal permit filed for ${routeName(routeId)}. RTO says 2-4 weeks.`)
  return null
}

export function renewSeasonalPermit(s: GameState, routeId: string): string | null {
  const permit = s.permits[routeId]
  if (!permit || !permit.seasonal) return 'No seasonal permit on this route.'
  const renewalFee = BAL.seasonalPermitRenewal ?? Math.round(BAL.routePermitRenewal * 0.40)
  if (!canAfford(s, renewalFee)) return `Seasonal renewal fee is ${fmtCompact(renewalFee)}.`
  spend(s, 'permit_tax', renewalFee, { routeId, note: 'seasonal permit renewal' })
  permit.seasonal.status = 'active'
  permit.seasonal.activeFromDay = s.day
  permit.seasonal.expiryDay = s.day + 180
  pushLog(s, 'good', `Seasonal permit renewed for ${routeName(routeId)} until Day ${permit.seasonal.expiryDay}.`)
  return null
}

export function withdrawSeasonalPermit(s: GameState, routeId: string): string | null {
  const permit = s.permits[routeId]
  if (!permit?.seasonal || permit.seasonal.status !== 'applied') return 'No pending seasonal permit to withdraw.'
  delete permit.seasonal
  pushLog(s, 'info', `Seasonal permit application for ${routeName(routeId)} withdrawn. Application fee is not refunded.`)
  return null
}

/**
 * Surrender a corridor: cancel open trips, delete schedules, drop the permit.
 * Applied (pending) permits can be withdrawn with no schedule impact.
 */
export function discontinueRoute(s: GameState, routeId: string): string | null {
  const route = ROUTES[routeId]
  if (!route) return 'Unknown route.'
  const canon = canonicalRouteId(routeId)
  const permit =
    s.permits[routeId] ??
    s.permits[canon] ??
    Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
  if (!permit) return 'No permit on this corridor.'

  const pRouteId = permit.routeId
  if (permit.status === 'applied') {
    delete s.permits[pRouteId]
    if (pRouteId !== routeId) delete s.permits[routeId]
    delete s.permits[canon]
    pushLog(s, 'info', `Permit application for ${routeName(routeId)} withdrawn. Application fee is not refunded.`)
    return null
  }

  const schIds = Object.values(s.schedules)
    .filter((sch) => sch.routeId === routeId || sch.routeId === pRouteId || canonicalRouteId(sch.routeId) === canon)
    .map((sch) => sch.id)
  for (const id of schIds) deleteSchedule(s, id)
  // The cargo licence rides on the corridor permit; contracts go with it.
  const cargoClosed = terminateCargoContractsOnRoute(s, routeId)
  delete s.permits[pRouteId]
  if (pRouteId !== routeId) delete s.permits[routeId]
  delete s.permits[canon]
  delete s.routeStats[routeId]
  delete s.routeStats[canon]
  if (s.routeHistory) {
    delete s.routeHistory[routeId]
    delete s.routeHistory[canon]
  }
  pushLog(
    s,
    'alert',
    `Discontinued ${routeName(routeId)} — permit surrendered${schIds.length ? `, ${schIds.length} schedule(s) closed` : ''}${cargoClosed ? `, ${cargoClosed} cargo contract(s) closed` : ''}. Re-apply anytime (full fee).`,
  )
  return null
}

/** Daily: process permit approvals/rejections and yearly renewals. */
export function permitPass(s: GameState): void {
  const rng = rngFor(s.seed, 'permit', s.day)
  for (const p of Object.values(s.permits)) {
    // Annual permit
    if (p.status === 'applied') {
      const waited = s.day - p.appliedDay
      if (waited >= rInt(rngFor(s.seed, 'permitlead', p.routeId, p.appliedDay), BAL.permitLeadDaysMin, BAL.permitLeadDaysMax)) {
        const rejectChance = BAL.permitRejectChance / (1 + (docsManagerOnDuty(s) ? deskCoverage(s, 'documents') : 0))
        if (rChance(rng, rejectChance)) {
          delete s.permits[p.routeId]
          pushLog(s, 'alert', `Permit REJECTED for ${routeName(p.routeId)} - "incomplete documents". Fee forfeited; you may re-apply.`)
          continue
        } else {
          p.status = 'active'
          p.activeFromDay = s.day
          p.expiryDay = s.day + 365
          pushLog(s, 'good', `Permit GRANTED for ${routeName(p.routeId)}, valid one year. Create a schedule.`)
        }
      }
    } else if (p.status === 'active' && p.expiryDay !== undefined) {
      const left = p.expiryDay - s.day
      if (left <= BAL.docRenewLeadDays) {
        const autoRenew = s.config?.autoRenewDocs !== false || docsManagerOnDuty(s)
        if (autoRenew && canAfford(s, BAL.routePermitRenewal)) {
          spend(s, 'permit_tax', BAL.routePermitRenewal, { routeId: p.routeId, note: 'permit renewal' })
          p.expiryDay = s.day + 365
        } else if (left <= 0) {
          delete s.permits[p.routeId]
          for (const sch of Object.values(s.schedules)) {
            if (sch.routeId === p.routeId) sch.active = false
          }
          pushLog(s, 'alert', `Permit LAPSED for ${routeName(p.routeId)}${autoRenew ? ' - no cash for renewal' : ''}. Schedules suspended.`)
          continue
        } else if (autoRenew && left === BAL.docRenewLeadDays) {
          pushLog(s, 'info', `Permit for ${routeName(p.routeId)} expires in ${left}d — auto-renew needs ${fmtCompact(BAL.routePermitRenewal)}.`)
        }
      }
    }

    // Seasonal permit
    if (p.seasonal) {
      if (p.seasonal.status === 'applied') {
        const waited = s.day - p.seasonal.appliedDay
        const leadMin = BAL.permitLeadDaysMin
        const leadMax = BAL.permitLeadDaysMax
        const targetWait = rInt(rngFor(s.seed, 'seasonallead', p.routeId, p.seasonal.appliedDay), leadMin, leadMax)
        if (waited >= targetWait) {
          const rejectChance = BAL.permitRejectChance / (1 + (docsManagerOnDuty(s) ? deskCoverage(s, 'documents') : 0))
          if (rChance(rng, rejectChance)) {
            delete p.seasonal
            pushLog(s, 'alert', `Seasonal permit REJECTED for ${routeName(p.routeId)} - "incomplete documents". Fee forfeited; you may re-apply.`)
          } else {
            p.seasonal.status = 'active'
            p.seasonal.activeFromDay = s.day
            p.seasonal.expiryDay = s.day + 180
            pushLog(s, 'good', `Seasonal permit GRANTED for ${routeName(p.routeId)} (valid until ${fmtDateShort(p.seasonal.expiryDay)}).`)
          }
        }
      } else if (p.seasonal.status === 'active' && p.seasonal.expiryDay !== undefined) {
        const left = p.seasonal.expiryDay - s.day
        const docsMgr = docsManagerOnDuty(s)
        const hasUsedFestival = Object.values(s.schedules).some(
          (sch) => sch.routeId === p.routeId && (sch.outboundDuty === 'festival' || sch.returnDuty === 'festival' || sch.festivalOnly),
        )
        const renewalFee = BAL.seasonalPermitRenewal ?? Math.round(BAL.routePermitRenewal * 0.40)
        if (left <= 7 && left > 0 && docsMgr && deskCoverage(s, 'documents') >= 0.5 && hasUsedFestival && canAfford(s, renewalFee)) {
          spend(s, 'permit_tax', renewalFee, { routeId: p.routeId, note: 'seasonal permit renewal' })
          p.seasonal.activeFromDay = s.day
          p.seasonal.expiryDay = s.day + 180
          pushLog(s, 'good', `Docs manager renewed seasonal permit for ${routeName(p.routeId)}.`)
        } else if (left <= 0) {
          p.seasonal.status = 'expired'
          pushLog(s, 'alert', `Seasonal permit EXPIRED for ${routeName(p.routeId)}. Renew on Routes.`)
        }
      }
    }
  }
}

/* ------------------------------ schedules ------------------------------ */

export function defaultScheduleDefaults(): ScheduleDefaults {
  return {
    autoPrice: true,
    cancellation: 'standard',
    channels: { ...DEFAULT_CHANNELS },
    redDeal: false,
  }
}

/** Company defaults from Settings — sell-on channels are fleet-wide. */
export function getScheduleDefaults(s: GameState): ScheduleDefaults {
  const d = s.config?.scheduleDefaults
  const base = defaultScheduleDefaults()
  if (!d) return base
  return {
    autoPrice: d.autoPrice ?? base.autoPrice,
    cancellation: d.cancellation ?? base.cancellation,
    channels: normalizeChannels(d.channels),
    redDeal: d.redDeal ?? base.redDeal,
  }
}

/** Push global sell-on flags onto every schedule (channels are not per-service). */
export function syncScheduleChannels(s: GameState): void {
  const ch = getScheduleDefaults(s).channels
  for (const sch of Object.values(s.schedules)) {
    sch.channels = { ...ch }
  }
}

export interface ScheduleInput {
  routeId: string
  depHour: number
  depMin?: 0 | 30
  baseFare: number
  baseFareSleeper?: number
  baseFareSeater?: number
  autoPrice: boolean
  returnAutoPrice?: boolean
  returnBaseFare?: number
  returnBaseFareSleeper?: number
  returnBaseFareSeater?: number
  boardingPoints?: number // ignored — fixed from cities on the route
  cancellation: Schedule['cancellation']
  channels?: Partial<Schedule['channels']>
  redDeal: boolean
  paired?: boolean
  returnDepHour?: number
  returnDepMin?: 0 | 30
  festivalOnly?: boolean
  outboundDuty?: 'daily' | 'festival'
  returnDuty?: 'daily' | 'festival'
  serviceKind?: 'passenger' | 'cargo'
  groupId?: ID
  amenities?: PassengerAmenities
  serviceTier?: ServiceTier
}

/** Returns `{ id }` on success or `{ error }` on failure. */
export function createSchedule(s: GameState, input: ScheduleInput): { id: ID } | { error: string } {
  const canon = canonicalRouteId(input.routeId)
  const permit =
    s.permits[input.routeId] ??
    s.permits[canon] ??
    Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
  if (!permit || permit.status !== 'active') return { error: 'You need an active permit for this route.' }
  const route = ROUTES[input.routeId]
  if (!route) return { error: 'Unknown route.' }
  const depMin = input.depMin === 30 ? 30 : 0
  const out = { depHour: input.depHour, depMin }

  // A freight service is always a single one-way run: a truck is loaded at the
  // origin, unloaded at the destination, and picks up its next consignment
  // there. There is no same-day return trip, so never pair it.
  const isCargoService = input.serviceKind === 'cargo'
  let paired = !isCargoService && !!input.paired
  let returnDepHour = input.returnDepHour
  let returnDepMin: 0 | 30 | undefined = input.returnDepMin === 30 ? 30 : input.returnDepMin === 0 ? 0 : undefined
  if (paired) {
    const sug = suggestReturnSlot(out, route)
    if (returnDepHour === undefined) {
      returnDepHour = sug.depHour
      returnDepMin = sug.depMin
    }
    const retMin = (returnDepMin === 30 ? 30 : 0) as 0 | 30
    const dayOffset = sug.dayOffset
    // If player picked a clock earlier than earliest same-day, allow next-day offset.
    const sameDayOk = isReturnValid(out, { depHour: returnDepHour, depMin: retMin }, route, 0)
    const nextDayOk = isReturnValid(out, { depHour: returnDepHour, depMin: retMin }, route, 1)
    if (!sameDayOk && !nextDayOk) {
      return {
        error: `Return too early — earliest is ${fmtClock(sug)}${sug.dayOffset ? ' (next day)' : ''}.`,
      }
    }
    void dayOffset
  }

  if (input.serviceKind === 'cargo' && !s.company.dedicatedCargoSubsidiary) {
    return { error: 'Turn on the cargo subsidiary before opening a freight service.' }
  }

  const outboundDuty = input.outboundDuty ?? (input.festivalOnly ? 'festival' : 'daily')
  const returnDuty = paired ? (input.returnDuty ?? (input.festivalOnly ? 'festival' : 'daily')) : (outboundDuty === 'festival' ? 'festival' : 'daily')

  if (outboundDuty === 'festival' || returnDuty === 'festival') {
    if (!permit.seasonal || permit.seasonal.status !== 'active') {
      return { error: 'Festival duty requires an active seasonal permit on this route.' }
    }
  }

  const festivalOnly = paired
    ? (outboundDuty === 'festival' && returnDuty === 'festival')
    : (outboundDuty === 'festival')

  const sch: Schedule = {
    id: nextId(s.ids, 's'),
    routeId: input.routeId,
    groupId: input.groupId,
    busIds: [],
    depHour: input.depHour,
    depMin,
    baseFare: Math.round(input.baseFare),
    baseFareSleeper: input.baseFareSleeper ? Math.round(input.baseFareSleeper) : undefined,
    baseFareSeater: input.baseFareSeater ? Math.round(input.baseFareSeater) : undefined,
    autoPrice: input.autoPrice,
    boardingPoints: boardingPointsForRoute(input.routeId),
    cancellation: input.cancellation
      ?? (input.groupId && s.groups?.[input.groupId]?.defaultCancellation)
      ?? getScheduleDefaults(s).cancellation
      ?? 'standard',
    channels: normalizeChannels(input.channels ?? getScheduleDefaults(s).channels),
    redDeal: input.redDeal,
    active: true,
    createdDay: s.day,
    occRecent: [],
    outboundDuty,
    returnDuty,
    serviceKind: input.serviceKind === 'cargo' ? 'cargo' : 'passenger',
    serviceTier: input.serviceTier ?? (input.groupId && s.groups?.[input.groupId]?.defaultServiceTier) ?? s.company.defaultServiceTier ?? 'economy',
    ...(festivalOnly ? { festivalOnly: true } : {}),
    ...(paired
      ? {
          paired: true,
          returnDepHour: returnDepHour!,
          returnDepMin: (returnDepMin === 30 ? 30 : 0) as 0 | 30,
          returnAutoPrice: input.returnAutoPrice !== undefined ? input.returnAutoPrice : input.autoPrice,
          returnBaseFare: input.returnBaseFare !== undefined ? Math.round(input.returnBaseFare) : Math.round(input.baseFare),
          returnBaseFareSleeper: input.returnBaseFareSleeper !== undefined ? Math.round(input.returnBaseFareSleeper) : (input.baseFareSleeper ? Math.round(input.baseFareSleeper) : undefined),
          returnBaseFareSeater: input.returnBaseFareSeater !== undefined ? Math.round(input.returnBaseFareSeater) : (input.baseFareSeater ? Math.round(input.baseFareSeater) : undefined),
        }
      : {}),
  }
  s.schedules[sch.id] = sch
  return { id: sch.id }
}

/** Create a service; optionally assign the first bus. Intent-friendly error string. */
export function launchSchedule(s: GameState, input: ScheduleInput, busId?: ID): string | null {
  const created = createSchedule(s, input)
  if ('error' in created) return created.error
  if (busId) {
    const err = assignBus(s, created.id, busId)
    if (err) {
      delete s.schedules[created.id]
      return err
    }
  }
  const sch = s.schedules[created.id]
  if (sch?.festivalOnly) {
    pushLog(
      s,
      'good',
      `Festival full on ${routeName(input.routeId)} ${fmtClock(sch)}: runs only on festival dates. `
      + `Appoint a Schedule manager to auto-park idle buses; Ops will crew them.`,
    )
  } else if (sch?.paired) {
    pushLog(
      s,
      'info',
      `Paired service on ${routeName(input.routeId)}: 1st ${fmtClock(sch)} · 2nd ${fmtClock({ depHour: sch.returnDepHour!, depMin: sch.returnDepMin })} (both directions, same day).`
      + (busId ? '' : ' Assign a bus to start selling.'),
    )
  } else if (!busId) {
    pushLog(s, 'info', `Schedule created on ${routeName(input.routeId)}, ${fmtClock({ depHour: input.depHour, depMin: input.depMin })} departure. Assign a bus to start selling.`)
  }
  return null
}

export function updateSchedule(s: GameState, schId: ID, patch: Partial<ScheduleInput> & { active?: boolean }): string | null {
  const sch = s.schedules[schId]
  if (!sch) return 'No such schedule.'
  const route = ROUTES[sch.routeId]
  const prevOut = { depHour: sch.depHour, depMin: sch.depMin }
  const prevRet = sch.returnDepHour !== undefined
    ? { depHour: sch.returnDepHour, depMin: (sch.returnDepMin === 30 ? 30 : 0) as 0 | 30 }
    : undefined
  if (patch.depHour !== undefined) sch.depHour = patch.depHour
  if (patch.depMin !== undefined) sch.depMin = patch.depMin === 30 ? 30 : 0
  if (patch.baseFare !== undefined) sch.baseFare = Math.round(patch.baseFare)
  if (patch.baseFareSleeper !== undefined) sch.baseFareSleeper = Math.round(patch.baseFareSleeper)
  if (patch.baseFareSeater !== undefined) sch.baseFareSeater = Math.round(patch.baseFareSeater)
  if (patch.autoPrice !== undefined) sch.autoPrice = patch.autoPrice

  if (patch.returnAutoPrice !== undefined) sch.returnAutoPrice = patch.returnAutoPrice
  if (patch.returnBaseFare !== undefined) sch.returnBaseFare = Math.round(patch.returnBaseFare)
  if (patch.returnBaseFareSleeper !== undefined) sch.returnBaseFareSleeper = Math.round(patch.returnBaseFareSleeper)
  if (patch.returnBaseFareSeater !== undefined) sch.returnBaseFareSeater = Math.round(patch.returnBaseFareSeater)

  sch.boardingPoints = boardingPointsForRoute(sch.routeId)
  if (patch.cancellation !== undefined) sch.cancellation = patch.cancellation
  if (patch.channels !== undefined) sch.channels = normalizeChannels({ ...sch.channels, ...patch.channels })
  if (patch.redDeal !== undefined) sch.redDeal = patch.redDeal
  if (patch.active !== undefined) sch.active = patch.active
  if (patch.groupId !== undefined) sch.groupId = patch.groupId
  const prevTier = sch.serviceTier
  if (patch.serviceTier !== undefined) {
    sch.serviceTier = patch.serviceTier
    // Keep schedule list prices aligned with the new brand tier when auto-pricing.
    if (sch.autoPrice && patch.serviceTier !== prevTier) {
      const ratio = serviceTierFareMult(patch.serviceTier) / serviceTierFareMult(prevTier)
      if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) > 0.001) {
        sch.baseFare = roundFare(sch.baseFare * ratio)
        if (sch.baseFareSleeper) sch.baseFareSleeper = roundFare(sch.baseFareSleeper * ratio)
        if (sch.baseFareSeater) sch.baseFareSeater = roundFare(sch.baseFareSeater * ratio)
        if (sch.returnBaseFare !== undefined) sch.returnBaseFare = roundFare(sch.returnBaseFare * ratio)
        if (sch.returnBaseFareSleeper) sch.returnBaseFareSleeper = roundFare(sch.returnBaseFareSleeper * ratio)
        if (sch.returnBaseFareSeater) sch.returnBaseFareSeater = roundFare(sch.returnBaseFareSeater * ratio)
      }
    }
  }

  // Pricing / timing flags
  const pricingChanged = patch.baseFare !== undefined || patch.baseFareSleeper !== undefined || patch.baseFareSeater !== undefined || patch.autoPrice !== undefined
    || patch.returnAutoPrice !== undefined || patch.returnBaseFare !== undefined || patch.returnBaseFareSleeper !== undefined || patch.returnBaseFareSeater !== undefined
    || patch.serviceTier !== undefined
  const timeChanged = patch.depHour !== undefined || patch.depMin !== undefined
    || patch.returnDepHour !== undefined || patch.returnDepMin !== undefined

  // Duties update
  let nextOutDuty = patch.outboundDuty ?? sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
  let nextRetDuty = patch.returnDuty ?? sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily')
  // `festivalOnly` is a convenience shortcut for "both legs seasonal". Only let
  // it force both duties when the caller did not pass explicit per-leg duties —
  // otherwise the mixed presets (seasonal 1st + daily 2nd, and the reverse) get
  // flattened back to all-daily.
  const dutiesGiven = patch.outboundDuty !== undefined || patch.returnDuty !== undefined
  if (patch.festivalOnly !== undefined && !dutiesGiven) {
    if (patch.festivalOnly) {
      nextOutDuty = 'festival'
      nextRetDuty = 'festival'
    } else {
      nextOutDuty = 'daily'
      nextRetDuty = 'daily'
    }
  }
  const isPaired = patch.paired !== undefined ? patch.paired : Boolean(sch.paired)
  if (nextOutDuty === 'festival' || (isPaired && nextRetDuty === 'festival')) {
    const permit = s.permits[sch.routeId]
    if (!permit?.seasonal || permit.seasonal.status !== 'active') {
      return 'Festival duty requires an active seasonal permit on this route.'
    }
  }
  sch.outboundDuty = nextOutDuty
  sch.returnDuty = isPaired ? nextRetDuty : (nextOutDuty === 'festival' ? 'festival' : 'daily')
  sch.festivalOnly = isPaired
    ? (nextOutDuty === 'festival' && sch.returnDuty === 'festival')
    : (nextOutDuty === 'festival')

  if (sch.festivalOnly) {
    pruneInvalidSeasonalTrips(s)
  }

  if (patch.paired !== undefined) {
    if (patch.paired) {
      // Freight services are one-way by nature — refuse to pair a cargo run.
      if (scheduleIsCargo(s, sch)) return 'A cargo service runs one way only — no 2nd trip.'
      sch.paired = true
      if (!route) return 'Unknown route.'
      const sug = suggestReturnSlot(sch, route)
      sch.returnDepHour = patch.returnDepHour ?? sch.returnDepHour ?? sug.depHour
      sch.returnDepMin = patch.returnDepMin === 30 ? 30 : patch.returnDepMin === 0 ? 0 : (sch.returnDepMin ?? sug.depMin)
    } else {
      sch.paired = false
      sch.returnDepHour = undefined
      sch.returnDepMin = undefined
    }
  } else if (sch.paired) {
    if (patch.returnDepHour !== undefined) sch.returnDepHour = patch.returnDepHour
    if (patch.returnDepMin !== undefined) sch.returnDepMin = patch.returnDepMin === 30 ? 30 : 0
    // Outbound moved: re-suggest return if it still matched the previous auto slot, or is now invalid.
    if (route && (patch.depHour !== undefined || patch.depMin !== undefined) && sch.returnDepHour !== undefined) {
      const sug = suggestReturnSlot(sch, route)
      const wasAuto = prevRet
        && route
        && (() => {
          const oldSug = suggestReturnSlot(prevOut, route)
          return prevRet.depHour === oldSug.depHour && prevRet.depMin === oldSug.depMin
        })()
      const ret = { depHour: sch.returnDepHour, depMin: sch.returnDepMin }
      const invalid = !isReturnValid(sch, ret, route, 0) && !isReturnValid(sch, ret, route, 1)
      if (wasAuto || invalid) {
        sch.returnDepHour = sug.depHour
        sch.returnDepMin = sug.depMin
      }
    }
  }

  // When pricing or departure time changes, immediately sync open trips on this schedule
  if (pricingChanged || timeChanged) {
    for (const tripId of s.openTripIds) {
      const t = s.trips[tripId]
      if (t && t.scheduleId === sch.id && t.status === 'open') {
        const isRet = isReturnTrip(t, sch)
        if (timeChanged) {
          if (isRet && sch.returnDepHour !== undefined) {
            t.depHour = sch.returnDepHour
            t.depMin = sch.returnDepMin === 30 ? 30 : 0
          } else {
            t.depHour = sch.depHour
            t.depMin = sch.depMin === 30 ? 30 : 0
          }
        }
        if (pricingChanged) {
          const bus = s.buses[t.busId]
          if (bus) {
            const daysToDep = t.day - s.day
            const tripAuto = isRet ? (sch.returnAutoPrice ?? sch.autoPrice) : sch.autoPrice
            const legBase = isRet ? (sch.returnBaseFare ?? sch.baseFare) : sch.baseFare
            const legSlp = isRet ? (sch.returnBaseFareSleeper ?? sch.baseFareSleeper) : sch.baseFareSleeper
            const legStr = isRet ? (sch.returnBaseFareSeater ?? sch.baseFareSeater) : sch.baseFareSeater

            t.fare = resolveTripFare(s, t, sch, bus, daysToDep)
            t.flatFare = !tripAuto
            t.fareLocked = false
            const m = BUS_MODELS[bus.modelId]
            const isHyb = m && (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID')
            if (isHyb && !tripAuto) {
              t.fareSleeper = legSlp ? roundFare(legSlp) : roundFare(legBase * 1.15)
              t.fareSeater = legStr ? roundFare(legStr) : roundFare(legBase * 0.85)
            } else {
              t.fareSleeper = undefined
              t.fareSeater = undefined
            }
          }
        }
      }
    }
  }
  if (patch.active !== undefined) opsAutoStaffPass(s)
  return null
}

export type DuplicateSlot = 'before' | 'same' | 'after' | 'hour'

/** Copy fare/channels onto a new empty service. Default: +1 hour. */
export function duplicateSchedule(s: GameState, schId: ID, slot: DuplicateSlot = 'hour'): string | null {
  const sch = s.schedules[schId]
  if (!sch) return 'No such schedule.'
  const shiftHalfHours = slot === 'before' ? -1 : slot === 'same' ? 0 : slot === 'hour' ? 2 : 1
  const { depHour, depMin } = clockFromMinutes(clockMinutes(sch) + shiftHalfHours * 30)
  const retShift = sch.paired && sch.returnDepHour !== undefined
    ? clockFromMinutes(clockMinutes({ depHour: sch.returnDepHour, depMin: sch.returnDepMin }) + shiftHalfHours * 30)
    : undefined
  return launchSchedule(s, {
    routeId: sch.routeId,
    depHour,
    depMin,
    baseFare: sch.baseFare,
    baseFareSleeper: sch.baseFareSleeper,
    baseFareSeater: sch.baseFareSeater,
    autoPrice: sch.autoPrice,
    returnAutoPrice: sch.returnAutoPrice,
    returnBaseFare: sch.returnBaseFare,
    returnBaseFareSleeper: sch.returnBaseFareSleeper,
    returnBaseFareSeater: sch.returnBaseFareSeater,
    paired: sch.paired,
    returnDepHour: retShift?.depHour,
    returnDepMin: retShift?.depMin,
    cancellation: sch.cancellation,
    channels: { ...sch.channels },
    redDeal: sch.redDeal,
    festivalOnly: sch.festivalOnly,
    outboundDuty: sch.outboundDuty,
    returnDuty: sch.returnDuty,
  })
}

/** Freight if the card was opened as cargo, or every assigned vehicle is a truck. */
export function scheduleIsCargo(s: GameState, sch: Schedule): boolean {
  if (sch.serviceKind === 'cargo') return true
  if (sch.serviceKind === 'passenger') return false
  const buses = sch.busIds.map((id) => s.buses[id]).filter(Boolean)
  return buses.length > 0 && buses.every((b) => isCargoModel(b.modelId))
}

/**
 * One vehicle can only serve one service. Older saves could end up listing the
 * same truck on two schedules (or twice on one), which silently made a single
 * vehicle depart both directions at the same clock time. Repair it: the
 * schedule the bus says it belongs to keeps it (else the oldest claim), extras
 * are dropped and their un-run departures cancelled.
 *
 * Returns the number of repairs made.
 */
export function sanitizeScheduleAssignments(s: GameState): number {
  const schedules = Object.values(s.schedules)
  if (schedules.length === 0) return 0

  type Claim = { sch: Schedule; busId: ID; preferred: boolean; order: number; slot: number }
  const claims: Claim[] = []
  for (const sch of schedules) {
    ;(sch.busIds ?? []).forEach((busId, slot) => {
      claims.push({
        sch,
        busId,
        preferred: s.buses[busId]?.scheduleId === sch.id,
        order: sch.createdDay ?? 0,
        slot,
      })
    })
  }
  if (claims.length === 0) return 0

  claims.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      a.order - b.order ||
      a.sch.id.localeCompare(b.sch.id) ||
      a.slot - b.slot,
  )

  const claimed = new Map<ID, ID>()
  const keep = new Map<ID, Set<number>>() // schedule id → kept slots (index in busIds)
  for (const c of claims) {
    const bus = s.buses[c.busId]
    if (!bus) continue
    if (claimed.has(c.busId)) continue
    const slots = keep.get(c.sch.id) ?? new Set<number>()
    if (slots.size >= 2) continue
    claimed.set(c.busId, c.sch.id)
    slots.add(c.slot)
    keep.set(c.sch.id, slots)
  }

  let fixes = 0

  // Rebuild bus lists, dropping duplicates, missing buses and second services.
  for (const sch of schedules) {
    const kept: ID[] = []
    ;(sch.busIds ?? []).forEach((busId, slot) => {
      if (!keep.get(sch.id)?.has(slot)) return
      if (kept.includes(busId)) return
      kept.push(busId)
    })
    if (kept.length !== (sch.busIds?.length ?? 0)) {
      sch.busIds = kept
      fixes++
    }
  }

  // Bus → schedule pointers follow the kept claim. Cover spares keep their host's id.
  for (const bus of Object.values(s.buses)) {
    if (bus.coveringBusId) continue
    const owner = claimed.get(bus.id)
    if (owner) {
      if (bus.scheduleId !== owner) {
        bus.scheduleId = owner
        fixes++
      }
    } else if (bus.scheduleId) {
      bus.scheduleId = undefined
      fixes++
    }
  }

  // Ghost departures: an open trip whose vehicle no longer serves that schedule.
  for (const id of [...s.openTripIds]) {
    const t = s.trips[id]
    if (!t || t.status !== 'open') continue
    const sch = s.schedules[t.scheduleId]
    if (!sch) continue
    if (sch.busIds.includes(t.busId)) continue
    const cover = s.buses[t.busId]?.coveringBusId
    if (cover && sch.busIds.includes(cover)) continue
    cancelTrip(s, id, 'vehicle no longer serves this schedule')
    fixes++
  }

  return fixes
}

export function assignBus(s: GameState, schId: ID, busId: ID): string | null {
  const sch = s.schedules[schId]
  const bus = s.buses[busId]
  if (!sch || !bus) return 'Missing schedule or bus.'
  if (sch.busIds.length >= 2) return 'A schedule takes at most 2 buses (one per direction).'
  if (sch.busIds.includes(busId)) return 'Already assigned.'
  if (bus.scheduleId && bus.scheduleId !== schId) return 'Bus is on another schedule - unassign it first.'
  // A stale bus.scheduleId must never let one vehicle run two services at once.
  const otherService = Object.values(s.schedules).find((sc) => sc.id !== schId && sc.busIds.includes(busId))
  if (otherService) return `Bus is on another schedule (${routeName(otherService.routeId)}) - unassign it first.`
  if (bus.coveringBusId) return 'This bus is covering another — wait until it is free.'
  if (bus.status === 'delivery') return 'Bus has not been delivered yet.'
  if (bus.status === 'workshop') return 'Bus is in the workshop — assign it when the job finishes.'
  const cargoBus = isCargoModel(bus.modelId)
  const freight = sch.serviceKind === 'cargo' || (sch.serviceKind !== 'passenger' && scheduleIsCargo(s, sch))
  if (freight && !cargoBus) return 'This freight service only takes cargo vehicles.'
  if (!freight && cargoBus) return 'Passenger services take coaches, not cargo vehicles.'
  // Brand-scoped services only take coaches from that brand; unassigned only unassigned.
  const schBrand = sch.groupId ?? null
  const busBrand = bus.groupId ?? null
  if (schBrand !== busBrand) {
    return schBrand
      ? 'This service is brand-scoped — assign a coach from the same subsidiary brand.'
      : 'Unassigned services only take unassigned coaches — not another brand.'
  }
  const route = ROUTES[sch.routeId]
  if (!route) return 'Unknown route.'
  if (route.interstate && bus.aitpPaidUntilDay < s.day - 90) {
    // AITP is auto-charged quarterly by the maintenance pass; just warn via log
    pushLog(s, 'info', `${bus.reg} will need AITP interstate tax for ${routeName(route.id)} (charged quarterly).`)
  }
  sch.busIds.push(busId)
  bus.scheduleId = schId
  const m = BUS_MODELS[bus.modelId]
  const isHyb = m && (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID')
  if (isHyb && (!sch.baseFareSleeper || !sch.baseFareSeater)) {
    sch.baseFareSleeper = roundFare(sch.baseFare * 1.15)
    sch.baseFareSeater = roundFare(sch.baseFare * 0.85)
  }
  if (sch.paired && sch.busIds.length === 2 && route) {
    bus.parkedCityId = route.to
  } else if (!bus.parkedCityId && route) {
    bus.parkedCityId = route.from
  }
  const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (sch.paired ? sch.returnDuty === 'festival' : true))
  const held = bus.status === 'grounded'
    ? ' It stays grounded until papers clear — selling starts the day it is active.'
    : isAllFest
    ? ' Festival booking window opens 3 days before the run; the service covers the festival window plus one day either side.'
    : ' Trips open for booking from tomorrow.'
  pushLog(s, 'info', `${bus.reg} assigned to ${routeName(sch.routeId)} ${fmtClock(sch)}.${held}`)
  opsAutoStaffPass(s)
  syncRouteShare(s, sch.routeId)
  generateTrips(s)
  return null
}

export function unassignBus(s: GameState, schId: ID, busId: ID): string | null {
  const sch = s.schedules[schId]
  const bus = s.buses[busId]
  if (!sch || !bus) return 'Missing schedule or bus.'
  sch.busIds = sch.busIds.filter((b) => b !== busId)
  if (sch.autoAssignedBusIds) {
    sch.autoAssignedBusIds = sch.autoAssignedBusIds.filter((b) => b !== busId)
  }
  bus.scheduleId = undefined
  releaseCoverFor(s, busId)
  const n = cancelOpenTripsForBus(s, busId, 'bus removed from schedule')
  if (n > 0) pushLog(s, 'alert', `${n} open trips cancelled with full refunds after pulling ${bus.reg} off the schedule.`)
  // The coaches still on the duty keep running: rebuild the board right away so
  // the remaining bus takes the direction it now owns instead of waiting a day.
  if (sch.busIds.length > 0) generateTrips(s)
  opsAutoStaffPass(s)
  syncRouteShare(s, sch.routeId)
  return null
}

/**
 * Freight services are one-way by nature — a truck drops its load and picks up
 * the next consignment, so it never runs a same-day return leg. Older saves
 * could still pair one, which sold a phantom 2nd trip. Unpair those schedules;
 * `repairTripBoards` then reopens the single-leg board and cancels the return
 * departures. Returns how many schedules were corrected.
 */
export function unpairCargoSchedules(s: GameState): number {
  let changed = 0
  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.paired) continue
    if (!scheduleIsCargo(s, sch)) continue
    sch.paired = false
    sch.returnDepHour = undefined
    sch.returnDepMin = undefined
    sch.returnDuty = 'daily'
    sch.festivalOnly = sch.outboundDuty === 'festival'
    changed++
  }
  return changed
}

/**
 * Rebuild the open board for every schedule and report how many changed. A save
 * written before the trip-id reconcile could hold a coach's stale (or cancelled)
 * leg, which kept the replacement coach's departures closed.
 */
export function repairTripBoards(s: GameState): number {
  const snapshot = (schId: string) =>
    Object.values(s.trips)
      .filter((t) => t.status === 'open' && t.scheduleId === schId)
      .map((t) => t.id)
      .sort()
      .join('|')
  const before = new Map<string, string>()
  for (const sch of Object.values(s.schedules ?? {})) before.set(sch.id, snapshot(sch.id))
  generateTrips(s)
  let changed = 0
  for (const sch of Object.values(s.schedules ?? {})) {
    if (sch.busIds.length === 0) continue
    if (before.get(sch.id) !== snapshot(sch.id)) changed++
  }
  return changed
}

export function deleteSchedule(s: GameState, schId: ID): string | null {
  const sch = s.schedules[schId]
  if (!sch) return 'No such schedule.'
  for (const busId of [...sch.busIds]) unassignBus(s, schId, busId)
  delete s.schedules[schId]
  return null
}

/**
 * Mark (or create as) a festival-only service: planned anytime, runs only on
 * festival calendar days. Buses auto-assign via Schedule manager — no manual assign.
 */
export function makeFestivalFull(s: GameState, schId: ID): string | null {
  const sch = s.schedules[schId]
  if (!sch || !sch.active) return 'Schedule inactive.'
  if (sch.festivalOnly) return 'Already a festival-only service.'

  // Release permanent coaches — fest days will re-park idle ones.
  for (const busId of [...sch.busIds]) {
    unassignBus(s, schId, busId)
  }
  sch.festivalOnly = true
  sch.festivalUntilDay = undefined
  sch.busIds = []

  if (!s.festivalSpecials) s.festivalSpecials = []
  s.festivalSpecials.push({
    id: nextId(s.ids, 'fs'),
    scheduleId: schId,
    routeId: sch.routeId,
    untilDay: s.day, // bookmark; actual run days come from the festival calendar
    createdDay: s.day,
  })

  const today = festivalEffect(s.day)
  pushLog(
    s,
    'good',
    `Festival full on ${routeName(sch.routeId)} ${fmtClock(sch)}: runs only on festival dates. `
    + `Appoint a Schedule manager to auto-park idle buses; Ops will crew them. `
    + (today.name ? `Today is ${today.name} — assign pass runs at next dawn.` : 'Waiting for the next festival window.'),
  )
  return null
}
