/**
 * Maintenance: workshop jobs (service, repairs, tyres), document renewals
 * (insurance, fitness, AITP/state tax), workshop upgrades.
 */
import { BAL, nextWorkshopBayCost, workshopJobDiscount, workshopJobSpeedup } from '../data/balance'
import { BUS_MODELS } from '../data/busModels'
import { ROUTES } from '../data/routes'
import { cityName } from '../data/cities'
import { fmtCompact, type Money } from '../core/money'
import { SUBSYSTEMS, type Bus, type GameState, type SubsystemId, type ID, type ServiceTierId, type TyreBrand, type TyreAxle, type MechanicTrade, type Staff } from '../types'
// (SUBSYSTEMS also used for owner-side upkeep of attached buses)
import { isFestivalDay } from '../core/calendar'
import { canAfford, spend, capitalOut } from './finance'
import { pushLog } from './log'
import { fleetManagerOnDuty, staffedWorkshopBays, docsManagerOnDuty, workshopMechanicsOnDuty, monthlyOfficeAdminCost } from './staffing'
import { releaseFinishedCovers, tryCoverBus } from './cover'
import { worstSubsystem, busAgeYears, effectiveAgeYears } from './fleet'
import { serviceCostMult } from './serviceCost'
import { deskCapacity, deskCoverage } from './span'
import { FITTING_CATALOG, busHasFitting, setBusFitting, fittingById } from '../data/amenitiesCatalog'

export type RetrofitFeature = string

/** Free staffed bays in own workshop (ignoring outside commercial garage jobs). */
export function freeStaffedBays(s: GameState): number {
  const staffed = staffedWorkshopBays(s)
  if (staffed <= 0) return 0
  const occupied = Object.values(s.buses).filter((b) => b.status === 'workshop' && !b.outsideGarage).length
  return Math.max(0, staffed - occupied)
}

/** Owned coaches claim staffed bays before attached / leased. */
export function workshopBayPriority(bus: Bus): number {
  return bus.ownership === 'owned' ? 0 : 1
}

export function sortWorkshopBayJobs(jobs: Bus[]): Bus[] {
  return [...jobs].sort((a, b) =>
    workshopBayPriority(a) - workshopBayPriority(b)
    || (a.workshopUntilDay ?? 0) - (b.workshopUntilDay ?? 0),
  )
}

function ownedWorkshopOccupancy(s: GameState): number {
  return Object.values(s.buses).filter((b) => b.status === 'workshop' && b.ownership === 'owned' && !b.outsideGarage).length
}

function workshopOccupancy(s: GameState): number {
  return Object.values(s.buses).filter((b) => b.status === 'workshop' && !b.outsideGarage).length
}

export function freeWorkshopBays(s: GameState): number {
  return Math.max(0, (s.workshop.bays ?? 0) - workshopOccupancy(s))
}

/**
 * Own-shop rates/slots: owned are never blocked by attached/leased.
 * Attached/leased may use leftover staffed bays after owned claim theirs.
 */
export function inOwnWorkshop(s: GameState, bus?: Bus): boolean {
  if (bus?.outsideGarage) return false
  const bays = s.workshop.bays ?? 0
  if (bays <= 0) return false
  const staffed = staffedWorkshopBays(s)
  if (staffed <= 0) return false
  if (!bus || bus.ownership === 'owned') return true
  const ownedBusy = ownedWorkshopOccupancy(s)
  const leftovers = staffed - ownedBusy
  if (leftovers <= 0) return false
  const othersBusy = workshopOccupancy(s) - ownedBusy
  return othersBusy < leftovers
}

function jobCost(s: GameState, base: Money, bus?: Bus): Money {
  let disc = inOwnWorkshop(s, bus) ? workshopJobDiscount(s.workshop.bays) : 0
  if (disc > 0 && fleetManagerOnDuty(s)) {
    disc *= Math.max(0.5, deskCoverage(s, 'workshop'))
  }
  return Math.round(base * (1 - disc))
}

function jobDays(s: GameState, base: number, bus?: Bus): number {
  let speedup = inOwnWorkshop(s, bus) ? workshopJobSpeedup(s.workshop.bays) : 0
  if (speedup > 0 && fleetManagerOnDuty(s)) {
    speedup *= Math.max(0.5, deskCoverage(s, 'workshop'))
  }
  return Math.max(1, Math.round(base * (1 - speedup)))
}

export type WorkshopJobKind = SubsystemId | ServiceTierId | 'tyres'

export function requiredTradeForJob(kind: WorkshopJobKind): MechanicTrade {
  if (kind === 'engine' || kind === 'gearbox' || kind === 'a' || kind === 'b' || kind === 'overhaul') {
    return 'engine_gearbox'
  }
  if (kind === 'ac' || kind === 'electrical') {
    return 'electrical_ac'
  }
  if (kind === 'body' || kind === 'suspension' || kind === 'brakes' || kind === 'tyres') {
    return 'body_suspension'
  }
  return 'general'
}

export function tradeMultipliers(mechTrade?: MechanicTrade, requiredTrade?: MechanicTrade): { costMult: number; daysMult: number } {
  if (!mechTrade || !requiredTrade || mechTrade === 'general') {
    return { costMult: 1, daysMult: 1 }
  }
  if (mechTrade === requiredTrade) {
    return { costMult: 0.80, daysMult: 0.70 }
  }
  return { costMult: 1, daysMult: 1.20 }
}

export function findMechanicForBus(s: GameState, bus: Bus): Staff | undefined {
  if (bus.outsideGarage) return undefined
  if (s.workshop.level === 0 || s.workshop.bays <= 0) return undefined
  const mechIds = s.workshop.mechanicIds ?? []
  if (mechIds.length === 0) return undefined

  const onDuty = new Set(workshopMechanicsOnDuty(s).map((m) => m.id))
  const jobs = sortWorkshopBayJobs(Object.values(s.buses).filter((b) => b.status === 'workshop' && !b.outsideGarage))

  let jobCursor = 0
  for (let i = 0; i < s.workshop.bays; i++) {
    const mid = mechIds[i]
    const mech = mid ? s.staff[mid] : undefined
    const hasMechOnDuty = mech && onDuty.has(mech.id)
    if (hasMechOnDuty) {
      if (jobCursor < jobs.length) {
        const assignedJob = jobs[jobCursor++]
        if (assignedJob.id === bus.id) return mech
      }
    }
  }

  jobCursor = 0
  for (let i = 0; i < s.workshop.bays; i++) {
    const mid = mechIds[i]
    const mech = mid ? s.staff[mid] : undefined
    const hasMechOnDuty = mech && onDuty.has(mech.id)
    if (hasMechOnDuty) {
      if (jobCursor < jobs.length) {
        jobCursor++
      } else {
        return mech
      }
    }
  }

  const firstDuty = workshopMechanicsOnDuty(s)[0]
  return inOwnWorkshop(s, bus) ? firstDuty : undefined
}

export function determineDueServiceTier(s: GameState, bus: Bus): ServiceTierId {
  // 1. Annual Overhaul: 365 days or 250k km
  const overhaulDaysDue = (s.day - (bus.lastOverhaulDay ?? bus.acquiredDay)) >= BAL.serviceTiers.overhaul.intervalDays
  const overhaulKmDue = (bus.odometer - (bus.lastOverhaulOdo ?? 0)) >= BAL.serviceTiers.overhaul.intervalKm
  if (overhaulDaysDue || overhaulKmDue) return 'overhaul'

  // 2. B-Service: 100k km
  if ((bus.odometer - (bus.lastMajorServiceOdo ?? 0)) >= BAL.serviceTiers.b.intervalKm) return 'b'

  // 3. A-Service: 25k km
  return 'a'
}

export function serviceDueKm(bus: Bus): number {
  return bus.odometer - bus.lastServiceOdo - BAL.serviceTiers.a.intervalKm
}

export function bServiceDueKm(bus: Bus): number {
  return bus.odometer - (bus.lastMajorServiceOdo ?? 0) - BAL.serviceTiers.b.intervalKm
}

/* ===================== Festival service deferral ===================== */

/** Days after a festival window closes before a scheduled coach may be serviced. */
export const FESTIVAL_SERVICE_COOLDOWN_DAYS = 3

/** Last day of the festival window running today, or that ended in the last few days. */
const windowEndByDay = new Map<number, number | null>()
function festivalWindowEndDay(day: number): number | null {
  const cached = windowEndByDay.get(day)
  if (cached !== undefined) return cached

  let end: number | null = null
  if (isFestivalDay(day)) {
    // Windows are contiguous (pre → festival day → post); walk to the last day.
    end = day
    while (isFestivalDay(end + 1) && end - day <= 60) end++
  } else {
    for (let d = day; d >= day - FESTIVAL_SERVICE_COOLDOWN_DAYS; d--) {
      if (isFestivalDay(d)) { end = d; break }
    }
  }

  if (windowEndByDay.size > 2048) windowEndByDay.clear()
  windowEndByDay.set(day, end)
  return end
}

/** True while scheduled coaches must keep running: festival window or 3 days after it. */
export function serviceHoldActive(day: number): boolean {
  return festivalWindowEndDay(day) !== null
}

/** First day scheduled coaches may be pulled into the shop, or null if no hold today. */
export function serviceResumeDay(day: number): number | null {
  const end = festivalWindowEndDay(day)
  return end === null ? null : end + FESTIVAL_SERVICE_COOLDOWN_DAYS + 1
}

/**
 * Scheduled (line) coaches are never taken off the road for a routine service during
 * a festival window or the 3 days after it — the service simply stays due until then.
 */
export function serviceDeferredForBus(s: GameState, bus: Bus): boolean {
  if (!serviceHoldActive(s.day)) return false
  if (bus.scheduleId) return true
  return Object.values(s.schedules).some((sch) => sch.active && sch.busIds.includes(bus.id))
}

export function overhaulDueInfo(s: GameState, bus: Bus): { dueKm: number; dueDays: number; isDue: boolean } {
  const kmSince = bus.odometer - (bus.lastOverhaulOdo ?? 0)
  const daysSince = s.day - (bus.lastOverhaulDay ?? bus.acquiredDay)
  const dueKm = kmSince - BAL.serviceTiers.overhaul.intervalKm
  const dueDays = daysSince - BAL.serviceTiers.overhaul.intervalDays
  return {
    dueKm,
    dueDays,
    isDue: dueKm > 0 || dueDays > 0,
  }
}

export function quoteService(
  s: GameState,
  bus: Bus,
  tier: ServiceTierId = 'a',
  outside?: boolean,
): { cost: Money; days: number; tier: ServiceTierId; label: string; outside: boolean } {
  const model = BUS_MODELS[bus.modelId]
  const age = effectiveAgeYears(s, bus)
  const rawBase = Math.round(BAL.serviceCostBase * model.maintCostIndex * serviceCostMult(age, bus.odometer, model.ac))
  const tierDef = BAL.serviceTiers[tier]
  const rawCost = Math.round(rawBase * tierDef.costMult)
  const hasOwnBays = (s.workshop.bays ?? 0) > 0
  const isOutside = outside !== undefined ? outside : !hasOwnBays
  let cost = isOutside ? rawCost : jobCost(s, rawCost, bus)
  let days = isOutside ? tierDef.days : jobDays(s, tierDef.days, bus)

  if (!isOutside) {
    const mech = findMechanicForBus(s, bus)
    if (mech?.mechanicTrade) {
      const tm = tradeMultipliers(mech.mechanicTrade, requiredTradeForJob(tier))
      cost = Math.round(cost * tm.costMult)
      days = Math.max(1, Math.round(days * tm.daysMult))
    }
  }

  return { cost, days, tier, label: tierDef.label, outside: isOutside }
}

/** Current tyre life for this set / axle. */
export function tyreLifeFor(bus: Bus, axle?: 'front' | 'rear'): number {
  if (axle === 'front') {
    const brand = bus.frontBrand ?? 'oem'
    return BAL.tyres[brand]?.frontLifeKm ?? BAL.tyreLifeKm
  }
  if (axle === 'rear') {
    const brand = bus.rearBrand ?? (bus.tyresRetreaded ? 'retread' : 'oem')
    return BAL.tyres[brand]?.rearLifeKm ?? BAL.tyreLifeKm
  }
  const frontBrand = bus.frontBrand ?? 'oem'
  return BAL.tyres[frontBrand]?.frontLifeKm ?? (bus.tyresRetreaded ? BAL.tyreLifeRetreadKm : BAL.tyreLifeKm)
}

export function axleTyresDue(bus: Bus): {
  frontDue: boolean
  rearDue: boolean
  frontPct: number
  rearPct: number
  frontKm: number
  rearKm: number
  frontLife: number
  rearLife: number
} {
  const frontLife = tyreLifeFor(bus, 'front')
  const rearLife = tyreLifeFor(bus, 'rear')
  const frontKm = bus.frontTyreKm ?? bus.tyreKm ?? 0
  const rearKm = bus.rearTyreKm ?? bus.tyreKm ?? 0
  const frontPct = frontKm / frontLife
  const rearPct = rearKm / rearLife
  return {
    frontDue: frontPct >= BAL.tyres.alertThreshold,
    rearDue: rearPct >= BAL.tyres.alertThreshold,
    frontPct,
    rearPct,
    frontKm,
    rearKm,
    frontLife,
    rearLife,
  }
}

/** True when either front or rear axle has reached alert wear threshold (90%+). */
export function tyresDue(bus: Bus): boolean {
  const info = axleTyresDue(bus)
  return info.frontDue || info.rearDue
}

export function setTyrePressure(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  bus.tyrePressure = 'ok'
  pushLog(s, 'good', `Tyre pressure checked and corrected for ${bus.reg}.`)
  return null
}

/** Leased / attached: the bus owner pays service, tyres and overhauls. We only staff. */
export function ownerPaysService(bus: Bus): boolean {
  return bus.ownership === 'leased' || bus.ownership === 'attached'
}

function applyScheduledService(s: GameState, bus: Bus, tier: ServiceTierId): void {
  if (tier === 'overhaul') {
    bus.lastOverhaulDay = s.day
    bus.lastOverhaulOdo = bus.odometer
    bus.lastMajorServiceOdo = bus.odometer
    bus.lastServiceOdo = bus.odometer
    bus.busCleanliness = 95
    for (const sub of SUBSYSTEMS) {
      bus.condition[sub] = 98
    }
  } else if (tier === 'b') {
    bus.lastMajorServiceOdo = bus.odometer
    bus.lastServiceOdo = bus.odometer
    for (const sub of SUBSYSTEMS) {
      const next = Math.min(100, bus.condition[sub] + BAL.serviceRestore[sub] * 2.5)
      bus.condition[sub] = Math.max(next, 85)
    }
  } else {
    bus.lastServiceOdo = bus.odometer
    for (const sub of SUBSYSTEMS) {
      let next = Math.min(100, bus.condition[sub] + BAL.serviceRestore[sub])
      if (next >= 50) next = Math.min(100, Math.max(next, BAL.serviceKeepFloor))
      bus.condition[sub] = next
    }
  }
}

function ownerServiceRefusal(): string {
  return 'The bus owner pays for service. You only staff this vehicle.'
}

export function serviceBus(
  s: GameState,
  busId: ID,
  tier?: ServiceTierId,
  opts?: { outside?: boolean },
): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (ownerPaysService(bus)) return ownerServiceRefusal()
  if (bus.status !== 'active') return 'Bus is not available.'

  // Scheduled coaches stay on the road through festival dates (and 3 days after) —
  // their service simply carries on as due until the hold lifts.
  if (serviceDeferredForBus(s, bus)) {
    const resume = serviceResumeDay(s.day)
    return `${bus.reg} is on a scheduled service — workshop booking deferred${
      resume !== null ? ` until day ${resume} (3 days after the festival ends)` : ''
    }. It keeps running with the service due.`
  }

  const hasOwnBays = (s.workshop.bays ?? 0) > 0
  const isOutside = hasOwnBays ? Boolean(opts?.outside) : true
  const chosenTier = tier ?? determineDueServiceTier(s, bus)
  const q = quoteService(s, bus, chosenTier, isOutside)
  if (!canAfford(s, q.cost)) return `${q.label} costs ${fmtCompact(q.cost)}.`

  spend(s, 'maintenance', q.cost, { busId, note: isOutside ? `${q.label} (outside garage)` : q.label })

  if (!s.company.serviceSpendByTier) s.company.serviceSpendByTier = { a: 0, b: 0, overhaul: 0 }
  if (!s.company.serviceCountByTier) s.company.serviceCountByTier = { a: 0, b: 0, overhaul: 0 }
  s.company.serviceSpendByTier[chosenTier] += q.cost
  s.company.serviceCountByTier[chosenTier]++

  bus.status = 'workshop'
  bus.outsideGarage = isOutside
  bus.workshopUntilDay = s.day + q.days
  bus.workshopJob = isOutside ? `${q.label} (outside)` : q.label
  applyScheduledService(s, bus, chosenTier)
  tryCoverBus(s, busId)
  if (isOutside) {
    pushLog(s, 'good', `${bus.reg}: Sent to outside garage for ${q.label} (${fmtCompact(q.cost)}, ${q.days}d turnaround).`)
  } else {
    pushLog(s, 'good', `${bus.reg}: Sent to workshop for ${q.label} (${fmtCompact(q.cost)}, ${q.days}d turnaround).`)
  }
  return null
}

export function quoteRepair(s: GameState, busId: ID, sub: SubsystemId): { cost: Money; days: number; gap: number } | null {
  const bus = s.buses[busId]
  if (!bus) return null
  const gap = 95 - bus.condition[sub]
  if (gap <= 5) return null
  const model = BUS_MODELS[bus.modelId]
  const age = effectiveAgeYears(s, bus)
  const mult = BAL.repairCostMult[sub]
  const base = Math.round((gap / 10) * BAL.repairCostPer10Points * model.maintCostIndex * mult * serviceCostMult(age, bus.odometer, model.ac))
  let cost = jobCost(s, base, bus)
  let days = jobDays(s, Math.max(1, Math.round(gap / 20) * BAL.repairDaysPer20Points), bus)

  if (inOwnWorkshop(s, bus)) {
    const mech = findMechanicForBus(s, bus)
    if (mech?.mechanicTrade) {
      const tm = tradeMultipliers(mech.mechanicTrade, requiredTradeForJob(sub))
      cost = Math.round(cost * tm.costMult)
      days = Math.max(1, Math.round(days * tm.daysMult))
    }
  }

  return {
    cost,
    days,
    gap,
  }
}

/** Queue a subsystem overhaul. Additional jobs on a bus already in the shop
 *  run in parallel — downtime is the longest remaining job, not the sum. */
export function repairSubsystem(s: GameState, busId: ID, sub: SubsystemId): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (ownerPaysService(bus)) return ownerServiceRefusal()
  if (bus.status === 'delivery') return 'Bus is not available.'
  const quote = quoteRepair(s, busId, sub)
  if (!quote) return 'Nothing meaningful to repair.'
  if (!canAfford(s, quote.cost)) return `Repair costs ${fmtCompact(quote.cost)}.`
  spend(s, 'maintenance', quote.cost, { busId, note: `${sub} overhaul` })
  const label = `${sub} overhaul`
  const finish = s.day + quote.days
  if (bus.status === 'workshop') {
    bus.workshopUntilDay = Math.max(bus.workshopUntilDay ?? finish, finish)
    if (!bus.workshopJob?.includes(label)) {
      bus.workshopJob = bus.workshopJob ? `${bus.workshopJob}, ${label}` : label
    }
  } else {
    bus.status = 'workshop'
    bus.workshopUntilDay = finish
    bus.workshopJob = label
  }
  bus.condition[sub] = 95
  tryCoverBus(s, busId)
  return null
}

export function quoteReplaceTyres(
  s: GameState,
  bus: Bus,
  axle: TyreAxle,
  brand: TyreBrand,
  outside?: boolean,
): { cost: Money; days: number; count: number; outside: boolean } | string {
  if (axle === 'front' && brand === 'retread') {
    return 'Retread tyres cannot be fitted on the steer (front) axle by CMVR law.'
  }
  if (axle === 'both' && brand === 'retread') {
    return 'Retread tyres cannot be fitted on the steer (front) axle. Select rear axle only for retreads.'
  }
  const totalCount = bus.tyreCount ?? 6
  const count = axle === 'front' ? 2 : axle === 'rear' ? totalCount - 2 : totalCount
  const tyrePrice = BAL.tyres[brand]?.price ?? BAL.tyres.oem.price
  const baseCost = tyrePrice * count
  const hasOwnBays = (s.workshop.bays ?? 0) > 0
  const isOutside = outside !== undefined ? outside : !hasOwnBays
  let cost = isOutside ? baseCost : jobCost(s, baseCost, bus)
  let days = 1

  if (!isOutside) {
    const mech = findMechanicForBus(s, bus)
    if (mech?.mechanicTrade) {
      const tm = tradeMultipliers(mech.mechanicTrade, requiredTradeForJob('tyres'))
      cost = Math.round(cost * tm.costMult)
      days = Math.max(1, Math.round(days * tm.daysMult))
    }
  }

  return { cost, days, count, outside: isOutside }
}

export function replaceTyres(
  s: GameState,
  busId: ID,
  axleOrRetread?: TyreAxle | boolean,
  brandOrNothing?: TyreBrand,
  opts?: { outside?: boolean },
): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (ownerPaysService(bus)) return ownerServiceRefusal()
  if (bus.status !== 'active') return 'Bus is not available.'

  // Normalise parameters
  let axle: TyreAxle = 'both'
  let brand: TyreBrand = 'oem'
  if (typeof axleOrRetread === 'boolean') {
    axle = axleOrRetread ? 'rear' : 'both'
    brand = axleOrRetread ? 'retread' : 'oem'
  } else if (axleOrRetread) {
    axle = axleOrRetread
    brand = brandOrNothing ?? (axle === 'rear' && bus.rearBrand === 'retread' ? 'retread' : 'oem')
  }

  const hasOwnBays = (s.workshop.bays ?? 0) > 0
  const isOutside = hasOwnBays ? Boolean(opts?.outside) : true
  const quote = quoteReplaceTyres(s, bus, axle, brand, isOutside)
  if (typeof quote === 'string') return quote

  if (!canAfford(s, quote.cost)) return `Tyres cost ${fmtCompact(quote.cost)}.`

  spend(s, 'tyres', quote.cost, { busId, note: isOutside ? `${axle} tyres (${brand}) outside` : `${axle} tyres (${brand})` })

  if (axle === 'front' || axle === 'both') {
    bus.frontTyreKm = 0
    bus.frontBrand = brand as 'oem' | 'tier2'
  }
  if (axle === 'rear' || axle === 'both') {
    bus.rearTyreKm = 0
    bus.rearBrand = brand
    bus.tyresRetreaded = brand === 'retread'
  }
  bus.tyreKm = Math.max(bus.frontTyreKm, bus.rearTyreKm)

  bus.status = 'workshop'
  bus.outsideGarage = isOutside
  bus.workshopUntilDay = s.day + quote.days
  bus.workshopJob = isOutside ? `Tyres: ${axle} ${brand} (outside)` : `Tyres: ${axle} ${brand}`
  tryCoverBus(s, busId)
  if (isOutside) {
    pushLog(s, 'good', `${bus.reg}: Sent to outside garage for ${axle} tyres (${brand.toUpperCase()}) — ${fmtCompact(quote.cost)}.`)
  } else {
    pushLog(s, 'good', `${bus.reg}: ${axle} tyres replaced with ${brand.toUpperCase()} in workshop (${fmtCompact(quote.cost)}).`)
  }
  return null
}

/* ------------------- FM-03: re-body & seat refurbishment ------------------- */

/** Weakest of engine / gearbox / suspension — the chassis that must justify a new body. */
export function chassisCondition(bus: Bus): number {
  let worst = 100
  for (const sub of BAL.refurb.chassisSubsystems) worst = Math.min(worst, bus.condition[sub])
  return worst
}

/** Once per owned coach; the chassis has to be mechanically sound to be worth re-bodying. */
export function rebodyBlocker(bus: Bus): string | null {
  if (bus.ownership !== 'owned') {
    return 'Only owned coaches can be re-bodied — leased and attached buses keep their owner\'s papers.'
  }
  if (bus.refurbishedDay !== undefined) return 'Already re-bodied — a chassis can only take one new body.'
  if (bus.status !== 'active') return 'Bus must be active before it can go in for a re-body.'
  const chassis = chassisCondition(bus)
  if (chassis < BAL.refurb.chassisMinCondition) {
    return `Chassis at ${Math.round(chassis)}/100 — engine, gearbox and suspension must each be ${BAL.refurb.chassisMinCondition}+ first.`
  }
  return null
}

/** 0-1 position of a model's upkeep index across the fleet — premium coaches cost more to re-body. */
function upkeepPosition(maintCostIndex: number): number {
  return Math.max(0, Math.min(1, (maintCostIndex - 0.9) / 0.6))
}

export function quoteRebody(s: GameState, bus: Bus): { cost: Money; days: number } {
  const model = BUS_MODELS[bus.modelId]
  const t = upkeepPosition(model?.maintCostIndex ?? 1)
  // Body building is specialist outside work — the own shop only shortens the job.
  const cost = Math.round(BAL.refurb.rebodyCostMin + (BAL.refurb.rebodyCostMax - BAL.refurb.rebodyCostMin) * t)
  return { cost, days: jobDays(s, BAL.refurb.rebodyDays, bus) }
}

/** New fibreglass body on the original chassis: body, AC and electrical back to 90, +5 years of life. */
export function rebodyBus(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  const blocker = rebodyBlocker(bus)
  if (blocker) return blocker
  const q = quoteRebody(s, bus)
  if (!canAfford(s, q.cost)) return `Re-body costs ${fmtCompact(q.cost)}.`

  spend(s, 'maintenance', q.cost, { busId, note: 're-body — new body, AC & electrical on existing chassis' })
  const restored = BAL.refurb.rebodyRestore
  // Never downgrade a coach that is already better than the new-body baseline.
  bus.condition.body = Math.max(bus.condition.body, restored)
  bus.condition.ac = Math.max(bus.condition.ac, restored)
  bus.condition.electrical = Math.max(bus.condition.electrical, restored)
  bus.refurbishedDay = s.day
  bus.lifeExtensionYears = (bus.lifeExtensionYears ?? 0) + BAL.refurb.rebodyLifeExtensionYears
  bus.status = 'workshop'
  bus.workshopUntilDay = s.day + q.days
  bus.workshopJob = 're-body (new body, AC & electrical)'
  tryCoverBus(s, busId)
  pushLog(
    s,
    'good',
    `${bus.reg}: Re-bodied — new fibreglass body, AC and electricals reset to ${restored}. Useful life extended by ${BAL.refurb.rebodyLifeExtensionYears} years (${fmtCompact(q.cost)}, ${q.days}d).`,
  )
  return null
}

/** True once the cabin has taken its full comfort gain. */
export function seatRefurbDone(bus: Bus): boolean {
  return (bus.comfortBonus ?? 0) >= BAL.refurb.seatRefurbComfortBonus - 1e-9
}

export function quoteSeatRefurb(s: GameState, bus: Bus): { cost: Money; days: number } {
  const model = BUS_MODELS[bus.modelId]
  const seatT = Math.max(0, Math.min(1, ((model?.seats ?? 40) - 30) / 20))
  const t = 0.5 * upkeepPosition(model?.maintCostIndex ?? 1) + 0.5 * seatT
  // Trimmer work is specialist outside work — the own shop only shortens the job.
  const cost = Math.round(
    BAL.refurb.seatRefurbCostMin + (BAL.refurb.seatRefurbCostMax - BAL.refurb.seatRefurbCostMin) * t,
  )
  return { cost, days: jobDays(s, BAL.refurb.seatRefurbDays, bus) }
}

/** Cushions, armrests and footrests: +1.5 comfort and a small PSS lift. Repeatable only up to the cap. */
export function refurbishSeats(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (bus.ownership !== 'owned') return 'Only owned coaches can be refurbished — the owner maintains leased and attached buses.'
  if (seatRefurbDone(bus)) return 'Seats are already refurbished to standard.'
  if (bus.status !== 'active') return 'Bus must be active before a seat refurbishment.'
  const q = quoteSeatRefurb(s, bus)
  if (!canAfford(s, q.cost)) return `Seat refurbishment costs ${fmtCompact(q.cost)}.`

  spend(s, 'maintenance', q.cost, { busId, note: 'seat refurbishment — cushions, armrests, footrests' })
  bus.comfortBonus = Math.min(
    BAL.refurb.seatRefurbComfortBonus,
    (bus.comfortBonus ?? 0) + BAL.refurb.seatRefurbComfortBonus,
  )
  bus.seatRefurbDay = s.day
  bus.status = 'workshop'
  bus.workshopUntilDay = s.day + q.days
  bus.workshopJob = 'seat refurbishment'
  tryCoverBus(s, busId)
  pushLog(
    s,
    'good',
    `${bus.reg}: Seats refurbished — new cushions, armrests and footrests. Comfort +${BAL.refurb.seatRefurbComfortBonus} (${fmtCompact(q.cost)}, ${q.days}d).`,
  )
  return null
}

export function retrofitBus(s: GameState, busId: ID, feature: RetrofitFeature): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (bus.ownership !== 'owned') return 'Only owned coaches can be retrofitted — the owner maintains leased and attached buses.'
  if (bus.status === 'delivery') return 'Bus has not been delivered yet.'

  const def = fittingById(feature)
  if (!def) return 'Invalid retrofit option.'
  if (busHasFitting(bus, feature)) return `${def.title} is already fitted on this coach.`
  if (!canAfford(s, def.retrofitCost)) return `${def.title} retrofit costs ${fmtCompact(def.retrofitCost)}.`

  spend(s, 'amenity_retrofit', def.retrofitCost, { busId, note: `${def.title} retrofit` })
  setBusFitting(bus, feature, true)

  pushLog(s, 'good', `${bus.reg}: Fitted ${def.title} (${fmtCompact(def.retrofitCost)}). Passenger satisfaction and appeal boosted!`)
  return null
}

/** All catalog fittings available for Bus Detail retrofit UI. */
export function retrofitCatalog() {
  return FITTING_CATALOG
}

/**
 * Cleanliness quality rating maintained by an assigned conductor based on their skill level (1-10).
 * - Skill <= 4: No automated deep clean; cleanliness drops naturally with trip wear.
 * - Skill 5: 70/100
 * - Skill 6: 75/100
 * - Skill 7: 80/100 (compliment threshold in CRM)
 * - Skill 8: 85/100 (high standard)
 * - Skill 9: 90/100 (premium standard)
 * - Skill 10: 95/100 (maximum deep clean rating)
 */
export function conductorCleanlinessTarget(skill: number): number {
  if (skill <= 4) return 0
  return Math.min(95, 70 + (Math.min(10, Math.max(5, skill)) - 5) * 5)
}

export function deepCleanBus(
  s: GameState,
  busId: string,
  targetQuality = 95,
  conductorName?: string,
  conductorSkill?: number,
): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  if (bus.status === 'workshop' || bus.status === 'delivery') return 'Bus is currently busy.'
  const cost = jobCost(s, BAL.deepCleanCost, bus)
  if (!canAfford(s, cost)) return `Deep clean costs ${fmtCompact(cost)}.`

  spend(s, 'cleaning', cost, { busId, note: 'weekly deep cabin cleaning & sanitation' })
  bus.busCleanliness = targetQuality
  bus.lastDeepCleanDay = s.day
  const byWho = conductorName ? `Conductor ${conductorName} (${conductorSkill}★)` : 'Completed'
  pushLog(s, 'good', `${bus.reg}: ${byWho} deep cleaning & sanitation (${fmtCompact(cost)}). Cleanliness restored to ${targetQuality}/100.`)
  return null
}

/**
 * Automates deep cleaning for buses with an assigned conductor.
 * Conductor triggers deep clean when cleanliness is below their maintained standard,
 * restoring cabin cleanliness to their skill-based target (up to 95 for 10-star).
 * Conductor with skill <= 4 performs no deep clean (cleanliness drops).
 */
export function conductorAutoClean(s: GameState): void {
  for (const bus of Object.values(s.buses)) {
    if (bus.status !== 'active') continue

    // Find assigned conductor
    const conductor = Object.values(s.staff).find(
      (st) => st.role === 'conductor' && st.busId === bus.id,
    )
    if (!conductor || conductor.skill <= 4) continue

    const target = conductorCleanlinessTarget(conductor.skill)
    const currentClean = bus.busCleanliness ?? 85

    // Conductor triggers deep clean if cleanliness has fallen below their standard
    // (either due for periodic deep clean >= 5 days, or dropped significantly <= target - 10)
    const daysSinceLast = bus.lastDeepCleanDay !== undefined ? s.day - bus.lastDeepCleanDay : 999
    const isDue = daysSinceLast >= 5 || currentClean <= target - 10

    if (currentClean < target && isDue && bus.lastDeepCleanDay !== s.day) {
      deepCleanBus(s, bus.id, target, conductor.name, conductor.skill)
    }
  }
}

export function upgradeWorkshop(s: GameState): string | null {
  if (!s.workshop.mechanicIds) s.workshop.mechanicIds = []
  const built = s.workshop.bays
  const cost = nextWorkshopBayCost(built)
  if (!canAfford(s, cost)) {
    return built <= 0
      ? `Opening a workshop costs ${fmtCompact(cost)}.`
      : `Next bay costs ${fmtCompact(cost)}.`
  }
  capitalOut(s, 'workshop_capex', cost, {
    note: built <= 0 ? 'open workshop (1 bay)' : `add workshop bay ${built + 1}`,
  })
  if (built <= 0) {
    s.workshop.level = 1
    s.workshop.bays = 1
    pushLog(
      s,
      'good',
      `Own workshop opened — 1 bay. Appoint one service mechanic per bay or jobs go to outside garages at full price.`,
    )
  } else {
    s.workshop.bays = built + 1
    s.workshop.level = Math.max(1, s.workshop.level)
    pushLog(
      s,
      'good',
      `Bay ${s.workshop.bays} built. Hire and appoint a mechanic to staff it — unstaffed bays cannot take jobs.`,
    )
  }
  return null
}

function managerAutoMaint(s: GameState): void {
  const mgr = fleetManagerOnDuty(s)
  if (!mgr) return

  // Must have at least one bay opened OR mechanics assigned to automate workshop operations
  const hasBayOrEmployees = (s.workshop.bays > 0) || ((s.workshop.mechanicIds?.length ?? 0) > 0)
  if (!hasBayOrEmployees) return

  // Workshop manager only books emergency deep clean for buses WITHOUT an assigned conductor
  for (const b of Object.values(s.buses)) {
    if (b.status !== 'active') continue
    const hasConductor = Object.values(s.staff).some(
      (st) => st.role === 'conductor' && st.busId === b.id,
    )
    if (!hasConductor && (b.busCleanliness ?? 100) < 50) {
      deepCleanBus(s, b.id, 95)
    }
  }

  let freeBays = freeStaffedBays(s)
  const cap = Math.floor(deskCapacity(s, 'workshop'))
  let booked = 0
  const dueLead = mgr.skill >= 8 ? -4000 : 0
  const repairAt = 48 + mgr.skill
  const queue = Object.values(s.buses)
    .filter((b) => b.status === 'active' && !ownerPaysService(b))
    .sort((a, b) => serviceDueKm(b) - serviceDueKm(a) || worstSubsystem(a.condition) - worstSubsystem(b.condition))
  const defaultBrand: 'oem' | 'tier2' = s.company.workshopTyreBrand ?? 'oem'

  for (const bus of queue) {
    if (booked >= cap) break
    if (bus.status !== 'active') continue

    // 1. General Service check (Minor A-Service 25k, Major B-Service 100k, Annual Overhaul 250k / 365d)
    // Scheduled coaches are deferred on festival dates.
    const isDue25k = serviceDueKm(bus) > dueLead
    const isDue100k = bServiceDueKm(bus) > 0
    const isDue250k = overhaulDueInfo(s, bus).isDue
    if ((isDue25k || isDue100k || isDue250k) && !serviceDeferredForBus(s, bus)) {
      const tier = determineDueServiceTier(s, bus)
      if (s.workshop.bays > 0) {
        // In-house workshop bays owned: service internally on our bays.
        // Never send outside to a commercial garage. If all bays are busy today,
        // the coach waits for our bay to free up.
        if (freeBays > 0) {
          if (!serviceBus(s, bus.id, tier)) {
            freeBays--
            booked++
            continue
          }
        }
      } else {
        // No in-house bays built: automate general service from third party (outside garage)
        if (!serviceBus(s, bus.id, tier, { outside: true })) {
          booked++
          continue
        }
      }
    }

    // 2. Tyres check (in-house bay)
    if (freeBays > 0) {
      const tyreInfo = axleTyresDue(bus)
      if (tyreInfo.frontDue || tyreInfo.rearDue) {
        if (tyreInfo.frontDue && tyreInfo.rearDue) {
          const frontBrand = bus.frontBrand ?? defaultBrand
          const rearBrand = bus.rearBrand ?? defaultBrand
          if (frontBrand === rearBrand && frontBrand !== 'retread') {
            if (!replaceTyres(s, bus.id, 'both', frontBrand)) { freeBays--; booked++; continue }
          } else {
            if (!replaceTyres(s, bus.id, 'front', frontBrand)) { freeBays--; booked++; continue }
          }
        } else if (tyreInfo.frontDue) {
          const frontBrand = bus.frontBrand ?? defaultBrand
          if (!replaceTyres(s, bus.id, 'front', frontBrand)) { freeBays--; booked++; continue }
        } else if (tyreInfo.rearDue) {
          const rearBrand = bus.rearBrand ?? defaultBrand
          if (!replaceTyres(s, bus.id, 'rear', rearBrand)) { freeBays--; booked++; continue }
        }
      }
    }

    // 3. Subsystem overhaul check (in-house bay)
    if (freeBays > 0) {
      const worst = worstSubsystem(bus.condition)
      const neglected = serviceDueKm(bus) > 0 || worst < 50
      if (neglected && worst < repairAt) {
        let sub = SUBSYSTEMS[0]
        for (const x of SUBSYSTEMS) if (bus.condition[x] < bus.condition[sub]) sub = x
        if (!repairSubsystem(s, bus.id, sub)) { freeBays--; booked++; continue }
      }
    }
  }
}

export function setWorkshopTyreBrand(s: GameState, brand: 'oem' | 'tier2'): void {
  s.company.workshopTyreBrand = brand
}

function autoRenewDocsEnabled(s: GameState): boolean {
  return s.config?.autoRenewDocs !== false || !!docsManagerOnDuty(s)
}

export function quoteInsurance(s: GameState, bus: Bus): Money {
  const model = BUS_MODELS[bus.modelId]
  if (!model) return BAL.insuranceMin
  const base = Math.max(BAL.insuranceMin, Math.round(Math.max(bus.bookValue, model.priceNew * 0.3) * BAL.insurancePctOfValue))
  let mult = bus.insurancePremiumMult ?? 1

  const drivers = Object.values(s.staff).filter((st) => st.busId === bus.id && (st.role === 'driver' || st.role === 'co_driver'))
  const maxAccidents = Math.max(0, ...drivers.map((d) => d.safetyRecord?.accidents ?? 0))
  const maxViolations = Math.max(0, ...drivers.map((d) => d.safetyRecord?.violations ?? 0))

  if (maxAccidents >= 3) {
    mult *= 1.30
  } else if (maxAccidents >= 1 || maxViolations >= 2) {
    mult *= 1.10
  }

  return Math.round(base * mult)
}

function tryRenewInsurance(s: GameState, bus: Bus, model: (typeof BUS_MODELS)[string], silent?: boolean): number {
  const left = bus.insuranceExpiryDay - s.day
  if (left > BAL.docRenewLeadDays) return 0
  const premium = quoteInsurance(s, bus)

  if (canAfford(s, premium)) {
    spend(s, 'insurance', premium, { busId: bus.id, note: 'insurance renewal' })
    bus.insuranceExpiryDay = Math.max(s.day, bus.insuranceExpiryDay) + 365
    if (bus.status === 'grounded' && bus.fitnessExpiryDay >= s.day && !bus.fitnessFailed && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day) && !bus.impoundUntilDay) {
      bus.status = 'active'
      if (!silent) pushLog(s, 'good', `Insurance renewed for ${bus.reg}. Bus back on road.`)
    }
    return premium
  } else if (left <= 0) {
    bus.status = 'grounded'
    pushLog(s, 'alert', `NO CASH to renew insurance for ${bus.reg} (${fmtCompact(premium)} needed). Bus GROUNDED until renewed.`)
  }
  return 0
}

export function renewBusInsurance(s: GameState, busId: string): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  const premium = quoteInsurance(s, bus)
  if (!canAfford(s, premium)) return `Cannot afford insurance renewal (${fmtCompact(premium)} needed).`
  spend(s, 'insurance', premium, { busId: bus.id, note: 'insurance renewal' })
  bus.insuranceExpiryDay = Math.max(s.day, bus.insuranceExpiryDay) + 365
  if (bus.status === 'grounded' && bus.fitnessExpiryDay >= s.day && !bus.fitnessFailed && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day) && !bus.impoundUntilDay) {
    bus.status = 'active'
    pushLog(s, 'good', `Insurance renewed for ${bus.reg}. Bus back on road.`)
  } else {
    pushLog(s, 'good', `Insurance renewed for ${bus.reg} until day ${bus.insuranceExpiryDay}.`)
  }
  return null
}

export function quoteFitness(s: GameState, bus: Bus): Money {
  const age = busAgeYears(s, bus)
  return BAL.fitnessRenewalCost + (age > 8 || bus.odometer > 600_000 ? BAL.fitnessFailRepair : 0)
}

export function renewFitness(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  if (bus.fitnessFailed) return retestFitness(s, busId)
  const age = busAgeYears(s, bus)
  const worstMechanical = Math.min(bus.condition.brakes, bus.condition.suspension, bus.condition.body)
  if (age > 10 && worstMechanical < 40) {
    bus.fitnessFailed = true
    bus.status = 'grounded'
    pushLog(s, 'alert', `FITNESS REJECTED: ${bus.reg} failed RTO fitness test due to degraded chassis/brakes/body (<40%). Repair mechanicals in workshop first.`)
    return 'Failed RTO test: mechanicals under 40%.'
  }
  const cost = quoteFitness(s, bus)
  if (!canAfford(s, cost)) return `Cannot afford fitness renewal (${fmtCompact(cost)}).`
  spend(s, 'fitness', cost, { busId: bus.id, note: 'fitness certificate renewal' })
  const term = bus.odometer > 500_000 ? 365 : 730
  bus.fitnessExpiryDay = Math.max(s.day, bus.fitnessExpiryDay) + term
  bus.fitnessFailed = false
  if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day) && !bus.impoundUntilDay) {
    bus.status = 'active'
    pushLog(s, 'good', `Fitness cert renewed for ${bus.reg}. Bus restored to service.`)
  } else {
    pushLog(s, 'good', `Fitness cert renewed for ${bus.reg} until day ${bus.fitnessExpiryDay}.`)
  }
  return null
}

function tryRenewFitness(s: GameState, bus: Bus, silent?: boolean): number {
  const left = bus.fitnessExpiryDay - s.day
  if (left > BAL.docRenewLeadDays) return 0
  const age = busAgeYears(s, bus)
  const worstMechanical = Math.min(bus.condition.brakes, bus.condition.suspension, bus.condition.body)
  if (age > 10 && worstMechanical < 40) {
    bus.fitnessFailed = true
    bus.status = 'grounded'
    pushLog(s, 'alert', `FITNESS REJECTED: ${bus.reg} (age ${age}y) failed RTO fitness test due to degraded chassis/brakes/body (<40%). Bus GROUNDED until repaired and re-tested.`)
    return 0
  }
  const cost = BAL.fitnessRenewalCost + (age > 8 || bus.odometer > 600_000 ? BAL.fitnessFailRepair : 0)
  const term = bus.odometer > 500_000 ? 365 : 730
  if (canAfford(s, cost)) {
    spend(s, 'fitness', cost, { busId: bus.id, note: 'fitness certificate renewal' })
    bus.fitnessExpiryDay = s.day + term
    bus.fitnessFailed = false
    if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day) && !bus.impoundUntilDay) {
      bus.status = 'active'
      if (!silent) pushLog(s, 'good', `Fitness cert renewed for ${bus.reg}. Bus restored to service.`)
    }
    return cost
  } else if (left <= 0) {
    bus.status = 'grounded'
    pushLog(s, 'alert', `NO CASH for fitness renewal of ${bus.reg} (${fmtCompact(cost)} needed). Bus GROUNDED until renewed.`)
  }
  return 0
}

function tryRenewPuc(s: GameState, bus: Bus, silent?: boolean): number {
  const left = (bus.pucExpiryDay ?? s.day) - s.day
  if (left > BAL.docRenewLeadDays) return 0
  const cost = BAL.pucCost
  if (canAfford(s, cost)) {
    spend(s, 'puc', cost, { busId: bus.id, note: 'PUC renewal' })
    bus.pucExpiryDay = s.day + BAL.pucValidityDays
    if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && bus.fitnessExpiryDay >= s.day && !bus.fitnessFailed && !bus.impoundUntilDay) {
      bus.status = 'active'
      if (!silent) pushLog(s, 'good', `PUC renewed for ${bus.reg}. Bus restored to active service.`)
    }
    return cost
  } else if (left <= 0) {
    pushLog(s, 'alert', `NO CASH to renew PUC for ${bus.reg} (${fmtCompact(cost)} needed). Checkpost impound risk!`)
  }
  return 0
}

export function quotePuc(_bus: Bus): Money {
  return BAL.pucCost
}

export function renewPuc(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  const cost = quotePuc(bus)
  if (!canAfford(s, cost)) return `Cannot afford PUC renewal (${fmtCompact(cost)}).`
  spend(s, 'puc', cost, { busId: bus.id, note: 'PUC certification renewal' })
  bus.pucExpiryDay = s.day + BAL.pucValidityDays
  if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && bus.fitnessExpiryDay >= s.day && !bus.fitnessFailed) {
    bus.status = 'active'
    pushLog(s, 'good', `${bus.reg} PUC renewed. Bus restored to service.`)
  }
  return null
}

export function fitGps(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  if (bus.gpsDeviceFitted) return 'GPS already fitted on this bus.'
  const cost = BAL.gpsFitCost
  if (!canAfford(s, cost)) return `Cannot afford GPS retrofit (${fmtCompact(cost)}).`
  spend(s, 'gps_fit', cost, { busId: bus.id, note: 'AIS-140 GPS telematics retrofit' })
  bus.gpsDeviceFitted = true
  pushLog(s, 'good', `GPS unit installed on ${bus.reg}. Telematics tracking active.`)
  return null
}

export function retestFitness(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  const worstMechanical = Math.min(bus.condition.brakes, bus.condition.suspension, bus.condition.body)
  const age = busAgeYears(s, bus)
  if (age > 10 && worstMechanical < 40) {
    return `RTO Fitness Retest Failed: Chassis, brakes, or body condition still under 40% (currently ${worstMechanical}%). Repair in workshop first.`
  }
  bus.fitnessFailed = false
  const cost = BAL.fitnessRenewalCost
  if (!canAfford(s, cost)) return `Cannot afford fitness re-test fee (${fmtCompact(cost)}).`
  spend(s, 'fitness', cost, { busId: bus.id, note: 'RTO fitness inspection passing retest' })
  bus.fitnessExpiryDay = s.day + (bus.odometer > 500_000 ? 365 : 730)
  if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day)) {
    bus.status = 'active'
    pushLog(s, 'good', `Fitness passed for ${bus.reg}. Bus restored to active duty.`)
  }
  return null
}

export function docsDue(bus: Bus, day: number): { kind: string; dueDay: number; overdue: boolean }[] {
  const list: { kind: string; dueDay: number; overdue: boolean }[] = []
  list.push({ kind: 'Insurance', dueDay: bus.insuranceExpiryDay, overdue: bus.insuranceExpiryDay < day })
  list.push({ kind: 'Fitness', dueDay: bus.fitnessExpiryDay, overdue: bus.fitnessExpiryDay < day || !!bus.fitnessFailed })
  list.push({ kind: 'PUC', dueDay: bus.pucExpiryDay ?? day, overdue: (bus.pucExpiryDay ?? day) < day })
  if (bus.ownership === 'owned' && bus.roadTaxPayableDay !== undefined) {
    list.push({ kind: 'Road Tax', dueDay: bus.roadTaxPayableDay, overdue: day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays })
  }
  return list
}

function tryRenewRoadTax(s: GameState, bus: Bus): void {
  if (bus.ownership !== 'owned') return
  if (bus.aitpPaidUntilDay > s.day) return
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  const route = sch ? ROUTES[sch.routeId] : undefined
  const interstate = route?.interstate ?? false
  const tax = interstate ? BAL.aitpQuarterly : BAL.stateTaxQuarterly
  if (!canAfford(s, tax)) {
    pushLog(s, 'alert', `NO CASH for ${interstate ? 'AITP' : 'state MV'} tax on ${bus.reg} (${fmtCompact(tax)}).`)
    return
  }
  spend(s, 'permit_tax', tax, { busId: bus.id, note: interstate ? 'AITP quarterly tax' : 'state MV tax (quarter)' })
  bus.aitpPaidUntilDay = s.day + 90
}

/**
 * Annual Commercial Road Tax (₹15,000–₹45,000 per year)
 * Factors:
 * - Bus class: budget (₹18,000) / mid (₹25,000) / premium (₹36,000) / sleeper (₹42,000)
 * - State (from plate prefix): KA (1.15), KL (1.10), MH (1.05), TN (0.95), AP/TS (0.90)
 * - Vehicle age: green cess on older commercial vehicles (1.08–1.15)
 */
export function calculateAnnualRoadTax(s: GameState, bus: Bus): number {
  const model = BUS_MODELS[bus.modelId]
  const cls = model?.cls
  const baseByClass: Record<string, number> = {
    AC_SEMI: 24_000_00,
    AC_SEMI_PREM: 32_000_00,
    AC_HYBRID: 30_000_00,
    AC_SLEEPER: 38_000_00,
    AC_SLEEPER_PREM: 42_000_00,
    E_AC_SEMI: 16_000_00,
    CARGO: 25_000_00,
  }
  const base = (cls ? baseByClass[cls] : undefined) ?? 25_000_00

  const stateCode = (bus.reg.slice(0, 2) || '').toUpperCase()
  let stateMult = 1.0
  if (stateCode === 'KA') stateMult = 1.15
  else if (stateCode === 'KL') stateMult = 1.10
  else if (stateCode === 'MH') stateMult = 1.05
  else if (stateCode === 'TN') stateMult = 0.95
  else if (stateCode === 'AP' || stateCode === 'TS') stateMult = 0.90

  const age = busAgeYears(s, bus)
  let ageMult = 1.0
  if (age < 3) ageMult = 0.95
  else if (age <= 7) ageMult = 1.0
  else if (age <= 10) ageMult = 1.08
  else ageMult = 1.15

  const cost = Math.round(base * stateMult * ageMult)
  return Math.max(15_000_00, Math.min(45_000_00, cost))
}

export function payAnnualRoadTax(s: GameState, busId: string): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'
  if (ownerPaysService(bus)) return 'Road tax for leased or attached buses is paid by the owner.'
  const cost = calculateAnnualRoadTax(s, bus)
  if (!canAfford(s, cost)) {
    return `Cannot afford annual road tax of ${fmtCompact(cost)}.`
  }
  spend(s, 'road_tax', cost, { busId: bus.id, note: `Annual road tax renewal for ${bus.reg}` })
  bus.roadTaxPayableDay = Math.max(s.day, bus.roadTaxPayableDay ?? s.day) + 365
  if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && bus.fitnessExpiryDay >= s.day) {
    bus.status = 'active'
    pushLog(s, 'good', `Annual road tax paid. ${bus.reg} restored to active service!`)
  } else {
    pushLog(s, 'good', `Paid annual road tax for ${bus.reg} (${fmtCompact(cost)}). Next anniversary in 365 days.`)
  }
  return null
}

function tryRenewAnnualRoadTax(s: GameState, bus: Bus, silent?: boolean): number {
  if (bus.ownership !== 'owned') return 0
  if (bus.roadTaxPayableDay === undefined) bus.roadTaxPayableDay = s.day + 365

  const daysLeft = bus.roadTaxPayableDay - s.day
  const isDelinquent = s.day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays

  // Late penalties: ₹2,000/month after the 30-day grace period
  if (isDelinquent) {
    const overdueDays = s.day - (bus.roadTaxPayableDay + BAL.roadTaxGraceDays)
    if (overdueDays > 0 && overdueDays % 30 === 1) {
      spend(s, 'penalty', BAL.roadTaxPenaltyMonthly, { busId: bus.id, note: `Road tax delinquency penalty (${bus.reg})` })
      pushLog(s, 'alert', `RTO PENALTY: ₹2,000 monthly fine charged on ${bus.reg} for overdue annual road tax. Bus is at high risk of checkpost impound!`)
    }
  }

  // Auto-renew if enabled
  if (autoRenewDocsEnabled(s)) {
    if (daysLeft <= BAL.docRenewLeadDays || s.day >= bus.roadTaxPayableDay) {
      const cost = calculateAnnualRoadTax(s, bus)
      if (canAfford(s, cost)) {
        spend(s, 'road_tax', cost, { busId: bus.id, note: `Annual road tax renewal (${bus.reg})` })
        bus.roadTaxPayableDay = Math.max(s.day, bus.roadTaxPayableDay) + 365
        if (bus.status === 'grounded' && bus.insuranceExpiryDay >= s.day && bus.fitnessExpiryDay >= s.day && !bus.fitnessFailed && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day) && !bus.impoundUntilDay) {
          bus.status = 'active'
          if (!silent) pushLog(s, 'good', `Annual road tax auto-renewed (${fmtCompact(cost)}). ${bus.reg} restored to active service.`)
        } else if (!silent) {
          pushLog(s, 'good', `Annual road tax auto-renewed for ${bus.reg} (${fmtCompact(cost)}).`)
        }
        return cost
      } else if (isDelinquent) {
        pushLog(s, 'alert', `NO CASH to pay annual road tax for ${bus.reg} (${fmtCompact(cost)} needed). Fines accumulating & checkpost impound risk active!`)
      }
    }
  }
  return 0
}

/** Daily: release finished jobs, renew documents, quarterly road taxes, annual road taxes. */
export function dailyMaintenancePass(s: GameState): void {
  const docsMgr = docsManagerOnDuty(s)
  const hasDocsMgr = !!docsMgr
  const docsCoverage = docsMgr ? deskCoverage(s, 'documents') : 1
  const renewLimit = Math.ceil(BAL.span.docRenewalsPerPass * docsCoverage)
  let insCount = 0
  let fitCount = 0
  let pucCount = 0
  let roadTaxCount = 0
  let totalDocsCost = 0

  type DocCandidate = {
    bus: Bus
    kind: 'insurance' | 'fitness' | 'roadTax' | 'puc'
    priority: number
    daysLeft: number
  }
  const candidates: DocCandidate[] = []

  for (const bus of Object.values(s.buses)) {
    // workshop release
    if (bus.status === 'workshop' && (bus.workshopUntilDay ?? 0) <= s.day) {
      if (bus.workshopJob?.includes('accident repair')) {
        bus.condition.body = Math.min(100, (bus.condition.body ?? 80) + 30)
      }
      bus.status = 'active'
      bus.workshopUntilDay = undefined
      bus.workshopJob = undefined
      bus.outsideGarage = undefined
    }

    // impound release
    if (bus.impoundUntilDay !== undefined && bus.impoundUntilDay <= s.day) {
      bus.impoundUntilDay = undefined
      if (bus.status === 'grounded'
        && bus.insuranceExpiryDay >= s.day
        && bus.fitnessExpiryDay >= s.day
        && !bus.fitnessFailed
        && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day)
        && (bus.roadTaxPayableDay === undefined || s.day <= bus.roadTaxPayableDay + BAL.roadTaxGraceDays)
        && (bus.transferReadyDay === undefined || bus.transferReadyDay <= s.day)) {
        bus.status = 'active'
        pushLog(s, 'good', `${bus.reg} released from RTO impound and returned to active service.`)
      }
    }

    // Sticky docs: stay grounded until papers clear.
    if (bus.status === 'grounded'
      && bus.impoundUntilDay === undefined
      && bus.insuranceExpiryDay >= s.day
      && bus.fitnessExpiryDay >= s.day
      && !bus.fitnessFailed
      && (bus.pucExpiryDay === undefined || bus.pucExpiryDay >= s.day)
      && (bus.roadTaxPayableDay === undefined || s.day <= bus.roadTaxPayableDay + BAL.roadTaxGraceDays)
      && (bus.transferReadyDay === undefined || bus.transferReadyDay <= s.day)) {
      bus.status = 'active'
      pushLog(s, 'good', `${bus.reg} cleared — back on the road.`)
    }
    if (bus.transferReadyDay !== undefined && bus.transferReadyDay <= s.day) {
      bus.transferReadyDay = undefined
    }
    if (bus.status === 'delivery') continue

    const ownerKeeps = ownerPaysService(bus)

    // leased / attached: the owner services the bus and keeps its papers — we never pay
    if (ownerKeeps) {
      if (bus.ownership === 'attached' && bus.attach) {
        const cap = 50 + bus.attach.careLevel * 40
        for (const sub of SUBSYSTEMS) {
          if (bus.condition[sub] < cap) bus.condition[sub] = Math.min(cap, bus.condition[sub] + 0.6)
        }
        if (serviceDueKm(bus) > 0 && bus.attach.careLevel > 0.4) applyScheduledService(s, bus, determineDueServiceTier(s, bus))
        if (tyresDue(bus)) {
          bus.frontTyreKm = 0
          bus.rearTyreKm = 0
          bus.tyreKm = 0
        }
      } else if (bus.ownership === 'leased') {
        if (serviceDueKm(bus) > 0) applyScheduledService(s, bus, determineDueServiceTier(s, bus))
        if (tyresDue(bus)) {
          bus.frontTyreKm = 0
          bus.rearTyreKm = 0
          bus.tyreKm = 0
        }
        const cap = BAL.serviceKeepFloor
        for (const sub of SUBSYSTEMS) {
          if (bus.condition[sub] < cap) bus.condition[sub] = Math.min(cap, bus.condition[sub] + 0.6)
        }
      }
      bus.insuranceExpiryDay = Math.max(bus.insuranceExpiryDay, s.day + 30)
      bus.fitnessExpiryDay = Math.max(bus.fitnessExpiryDay, s.day + 30)
      bus.pucExpiryDay = Math.max(bus.pucExpiryDay ?? s.day, s.day + 30)
      bus.roadTaxPayableDay = Math.max(bus.roadTaxPayableDay ?? s.day, s.day + 365)
      bus.aitpPaidUntilDay = Math.max(bus.aitpPaidUntilDay, s.day + 90)
    } else {
      // Owned bus road tax delinquency fines & quarterly AITP tax
      if (bus.ownership === 'owned') {
        tryRenewRoadTax(s, bus)
        if (bus.roadTaxPayableDay === undefined) bus.roadTaxPayableDay = s.day + 365
        const isDelinquent = s.day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays
        if (isDelinquent) {
          const overdueDays = s.day - (bus.roadTaxPayableDay + BAL.roadTaxGraceDays)
          if (overdueDays > 0 && overdueDays % 30 === 1) {
            spend(s, 'penalty', BAL.roadTaxPenaltyMonthly, { busId: bus.id, note: `Road tax delinquency penalty (${bus.reg})` })
            pushLog(s, 'alert', `RTO PENALTY: ₹2,000 monthly fine charged on ${bus.reg} for overdue annual road tax. Bus is at high risk of checkpost impound!`)
          }
        }
      }

      if (autoRenewDocsEnabled(s)) {
        const insLeft = bus.insuranceExpiryDay - s.day
        if (insLeft <= BAL.docRenewLeadDays) {
          candidates.push({ bus, kind: 'insurance', priority: 1, daysLeft: insLeft })
        }
        const fitLeft = bus.fitnessExpiryDay - s.day
        if (fitLeft <= BAL.docRenewLeadDays) {
          candidates.push({ bus, kind: 'fitness', priority: 1, daysLeft: fitLeft })
        }
        if (bus.ownership === 'owned') {
          const rtLeft = (bus.roadTaxPayableDay ?? s.day) - s.day
          if (rtLeft <= BAL.docRenewLeadDays || s.day >= (bus.roadTaxPayableDay ?? s.day)) {
            candidates.push({ bus, kind: 'roadTax', priority: 2, daysLeft: rtLeft })
          }
        }
        const pucLeft = (bus.pucExpiryDay ?? s.day) - s.day
        if (pucLeft <= BAL.docRenewLeadDays) {
          candidates.push({ bus, kind: 'puc', priority: 3, daysLeft: pucLeft })
        }
      }
    }
  }

  // Prioritize closest expiry; insurance & fitness before road tax & PUC
  candidates.sort((a, b) => a.priority - b.priority || a.daysLeft - b.daysLeft)

  let renewedCount = 0
  for (const cand of candidates) {
    if (renewedCount >= renewLimit) break
    const model = BUS_MODELS[cand.bus.modelId]
    if (cand.kind === 'insurance') {
      const insCost = tryRenewInsurance(s, cand.bus, model, hasDocsMgr)
      if (insCost > 0) { insCount++; totalDocsCost += insCost; renewedCount++ }
    } else if (cand.kind === 'fitness') {
      const fitCost = tryRenewFitness(s, cand.bus, hasDocsMgr)
      if (fitCost > 0) { fitCount++; totalDocsCost += fitCost; renewedCount++ }
    } else if (cand.kind === 'roadTax') {
      const rtCost = tryRenewAnnualRoadTax(s, cand.bus, hasDocsMgr)
      if (rtCost > 0) { roadTaxCount++; totalDocsCost += rtCost; renewedCount++ }
    } else if (cand.kind === 'puc') {
      const pucCost = tryRenewPuc(s, cand.bus, hasDocsMgr)
      if (pucCost > 0) { pucCount++; totalDocsCost += pucCost; renewedCount++ }
    }
  }

  if (hasDocsMgr && (insCount + fitCount + pucCount + roadTaxCount > 0)) {
    const parts: string[] = []
    if (insCount > 0) parts.push(`${insCount} insurance`)
    if (fitCount > 0) parts.push(`${fitCount} fitness`)
    if (pucCount > 0) parts.push(`${pucCount} PUC`)
    if (roadTaxCount > 0) parts.push(`${roadTaxCount} road tax`)
    pushLog(s, 'info', `Docs renewed: ${parts.join(', ')} — ${fmtCompact(totalDocsCost)}`)
  }

  releaseFinishedCovers(s)
  conductorAutoClean(s)
  managerAutoMaint(s)
}

/** Month-end fixed fleet costs: GPS subs, lease rents, depot & office. */
export function monthlyFleetCosts(s: GameState): void {
  const buses = Object.values(s.buses)
  const nGps = buses.filter((b) => b.ownership !== 'attached' && b.gpsDeviceFitted === true).length
  if (nGps > 0) spend(s, 'gps_telematics', BAL.gpsPerBusMonth * nGps, { note: `GPS x${nGps}` })
  for (const bus of buses) {
    if (bus.ownership === 'leased' && bus.leaseOfferRent) {
      spend(s, 'lease_rent', bus.leaseOfferRent, { busId: bus.id, note: 'monthly lease rent' })
    }
  }
  const slots = s.depotSlots ?? BAL.depot.baseSlots
  const fleetVehicles = buses.filter((b) => b.status !== 'delivery').length
  const chargeableVehicles = Math.max(fleetVehicles, slots)
  const extraVehicles = Math.max(0, chargeableVehicles - BAL.depot.baseSlots)
  const depotBill = BAL.depotRentBase + extraVehicles * BAL.depotRentPerExtraBus
  const depotNote = extraVehicles > 0
    ? `depot parking (${fmtCompact(BAL.depotRentBase)} base + ${extraVehicles} extra bus${extraVehicles === 1 ? '' : 'es'} @ ${fmtCompact(BAL.depotRentPerExtraBus)})`
    : `depot parking (${fmtCompact(BAL.depotRentBase)} base)`
  spend(s, 'depot_rent', depotBill, { note: depotNote })
  for (const yard of s.yards ?? []) {
    spend(s, 'depot_rent', yard.monthlyRent, { note: `outstation yard rent (${cityName(yard.cityId)})` })
  }
  const officeCost = monthlyOfficeAdminCost(s)
  const officeNote = officeCost.assignedManagers > 0
    ? `head office & admin (${fmtCompact(officeCost.base)} base + ${officeCost.assignedManagers} manager desk${officeCost.assignedManagers === 1 ? '' : 's'} @ ${fmtCompact(BAL.officeAdminPerManager)})`
    : 'head office & admin'
  spend(s, 'office_admin', officeCost.total, { note: officeNote })
}

/** CAPEX: add one overnight parking slot at the home yard. */
export function expandDepot(s: GameState): string | null {
  const cost = BAL.depot.expandSlotCost
  if (!canAfford(s, cost)) return 'Cannot afford yard expansion.'
  capitalOut(s, 'depot_capex', cost, { note: 'depot yard expansion' })
  s.depotSlots = (s.depotSlots ?? BAL.depot.baseSlots) + 1
  pushLog(s, 'good', `Depot expanded to ${s.depotSlots} overnight slots.`)
  return null
}
