/**
 * Demand model, in the order a real booking happens:
 *
 *   1. the corridor's pax pool for that day and direction — calendar,
 *      archetypes, festivals, payday, dynamic rail spillover, weather & ghats —
 *      spread across the departure clock (see corridor.ts)
 *   2. our share of the shoppers looking at our window, against the rival
 *      seats parked there: fare elasticity, ratings, brand, punctuality,
 *      complete coach mechanical health (suspension, electrical/chargers, NVH, body),
 *      odometer fresh-coach status, maintenance discipline, chassis class, crew quality,
 *      and listing reach
 *   3. the booking curve, which releases that share across the open window.
 *      A week out, most of a fair coach is already sold; the last two days
 *      add the rest rather than the whole bus.
 *
 * Load factor is an outcome here, not an input. A bus cannot fill past the
 * shoppers who exist, two of our own buses in one slot split the same pool,
 * and a festival date sells out because rival supply cannot follow demand.
 */
import { BAL, DIFFICULTIES, getDirectionalOccupancyRange, elapsedBookingFrac } from '../data/balance'
import { BUS_MODELS, hybridSleeperCount } from '../data/busModels'
import { busComfort } from '../data/bodyBuilders'
import { ROUTES } from '../data/routes'
import { corridorSupply } from '../data/corridorSupply'
import { DOW_DEMAND, daysInMonth, dow, festivalRunEffect, seasonInfo, toCivil, clockMinutes, FESTIVALS } from '../core/calendar'
import { rngFor, rJitter } from '../core/rng'
import type { Bus, BusClassId, BusModel, Channel, Company, GameState, RouteDef, Schedule, Trip, ID } from '../types'
import { groupForTrip } from './groups'
import {
  classFit,
  classHourAppeal,
  corridorProfile,
  departureTimeFit,
  haulLayoutAppeal,
  hybridZoneFactors,
  isHomebound,
  ownSubstitutionWeight,
  windowMass,
  wrapDistMin,
  } from './corridor'
import { marketFare, tripWobbleRate } from './pricing'
import { busFittingsDemandMult } from '../data/amenitiesCatalog'
import { isTripFrontRun, getCorridorStance } from './rivalIntelligence'
import { getLoungeDemandBoost } from './lounge'
import { routeLifeMult } from './routeLife'

export { isHomebound } from './corridor'

const M = BAL.market

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/* ============================ booking curve ============================ */

/** Normalised so balance edits are relative weights, not a fragile sum. */
const CURVE: number[] = (() => {
  let total = 0
  for (const x of BAL.bookingCurve) total += x
  return BAL.bookingCurve.map((x) => x / (total || 1))
})()

/* ========================= stage 1: corridor pool ========================= */

export type CorridorArchetype = 'tech' | 'pilgrim' | 'leisure' | 'commercial' | 'marathon'

export function corridorArchetype(routeId: string): CorridorArchetype {
  switch (routeId) {
    case 'blr-hyd':
    case 'blr-maa':
    case 'maa-blr':
    case 'maa-hyd':
      return 'tech'
    case 'maa-tir':
    case 'blr-tir':
    case 'mdu-maa':
    case 'maa-mdu':
    case 'mdu-maa-ecr':
    case 'maa-mdu-ecr':
    case 'mdu-blr':
    case 'blr-mdu':
    case 'maa-kkm':
    case 'maa-rmd':
      return 'pilgrim'
    case 'maa-pdy':
    case 'blr-goa':
    case 'maa-goa':
    case 'hyd-goa':
    case 'maa-mys':
      return 'leisure'
    case 'maa-mum':
    case 'maa-viz':
    case 'maa-koc':
    case 'maa-trv':
    case 'maa-clt':
    case 'maa-mlr':
    case 'koc-blr':
    case 'maa-ten':
    case 'blr-mum':
      return 'marathon'
    default:
      return 'commercial'
  }
}

/** Commuter rhythm and demographic surges specific to corridor archetype. */
export function archetypeFactor(route: RouteDef, depDay: number, depHour: number, depMin = 0): number {
  const arch = corridorArchetype(route.id)
  const d = dow(depDay)
  const h = depHour + (depMin === 30 ? 0.5 : 0)

  switch (arch) {
    case 'tech': {
      // Tech corridors (e.g. BLR-HYD, BLR-MAA): heavy weekend migration
      if (d === 4 && h >= 18) return 1.15 // Thu evening early weekend escape
      if (d === 5) return 1.20 // Friday full exodus
      if (d === 0 && h >= 15) return 1.18 // Sunday night return
      if (d === 1 && h <= 9) return 1.12 // Monday morning office run
      if (d === 2 || d === 3) return 0.94 // Midweek corporate lull
      return 1.0
    }
    case 'pilgrim': {
      // Pilgrim corridors (e.g. MAA-TIR, BLR-TIR): weekend visits + lunar cycle peaks
      const lunarPeak = (depDay % 15 === 0 || depDay % 15 === 14) ? 1.16 : 1.0
      const arrivalH = (h + route.hours) % 24
      const earlyDarshan = (arrivalH >= 4.5 && arrivalH <= 7.0) ? 1.08 : 1.0
      const weekend = (d === 0 || d === 5 || d === 6) ? 1.12 : 0.93
      return weekend * lunarPeak * earlyDarshan
    }
    case 'leisure': {
      // Leisure & holiday corridors (e.g. MAA-PDY, BLR-GOA)
      if (d === 5 && h >= 14) return 1.24 // Friday afternoon/evening outward
      if (d === 6 && h <= 12) return 1.18 // Saturday morning getaway
      if (d === 0 && h >= 14) return 1.28 // Sunday return rush
      if (d >= 2 && d <= 4) return 0.80 // Midweek thin leisure
      return 0.96
    }
    case 'marathon': {
      // Interstate long hauls: evening departure slots capture the vast majority of shoppers
      if (h >= 16 && h <= 21.5) return 1.05
      if (h >= 0 && h <= 5.5) return 0.72 // Dead-of-night marathon departure
      return 0.96
    }
    case 'commercial':
    default: {
      // Steady business flow Monday through Friday
      if (d >= 1 && d <= 5) return 1.04
      return 0.96
    }
  }
}

export interface DemandFactors {
  /** Day-of-week swing. A fixed timetable barely answers it. */
  weekly: number
  /** Season and festival window. Rivals do add buses for these. */
  seasonal: number
  /** Pressure rivals cannot plan for (difficulty, corridor shocks). */
  structural: number
  mult: number
  festival: string | null
  season: string | null
  archetype?: CorridorArchetype
}

/** Calendar-driven demand multiplier for a departure day + direction. */
export function demandFactors(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  depDay: number,
  ctx?: BookingCtx,
): DemandFactors {
  const cacheKey = ctx?.demandFactorsCache ? `${route.id}:${direction}:${depDay}` : null
  if (cacheKey && ctx?.demandFactorsCache?.has(cacheKey)) {
    return ctx.demandFactorsCache.get(cacheKey)!
  }
  // Run effect includes the one-day service pad each side of the festival
  // window, so the repositioning departures see the surge they live on.
  const fest = festivalRunEffect(depDay)
  const season = seasonInfo(depDay)
  const festMult = isHomebound(route, direction) ? fest.homebound : fest.returning
  const weekly = DOW_DEMAND[dow(depDay)]!
  const seasonal = season.demand * festMult
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)!
  let structural = diff.demandMult
  const shock = s.world.demandShock[route.id]
  if (shock && shock.untilDay >= depDay) structural *= shock.mult
  const factors: DemandFactors = {
    weekly,
    seasonal,
    structural,
    mult: weekly * seasonal * structural,
    festival: fest.name,
    season: season.name,
    archetype: corridorArchetype(route.id),
  }
  if (cacheKey && ctx?.demandFactorsCache) {
    ctx.demandFactorsCache.set(cacheKey, factors)
  }
  return factors
}

/** How many seats rivals put on the corridor against this day's demand. */
function supplyResponse(f: DemandFactors): number {
  const weekly = Math.pow(Math.max(0.2, f.weekly), M.supplyElasticityWeekly)
  const seasonal = Math.pow(Math.max(0.2, f.seasonal), M.supplyElasticitySeason)
  return weekly * Math.min(M.supplySurgeCap, seasonal)
}

/**
 * Dynamic rail interaction:
 * When demand surges on festivals or peak weekends, Indian Railways trains sell out
 * weeks ahead (Tatkal WL 100+). Rather than stealing bus riders, overflow demand
 * spills into private buses!
 * On quiet off-peak weekdays, express trains actively siphon price-sensitive travellers.
 */
export function railFactor(route: RouteDef, depDay: number, f?: DemandFactors): number {
  const d = dow(depDay)
  const weekend = d === 0 || d === 6
  const baseSteal = route.railCompetition * BAL.railSteal * (weekend ? 0.55 : 1)

  const isPeak = (f && f.mult >= 1.20) || (f?.festival !== null) || (weekend && route.railCompetition > 0.4)
  if (isPeak) {
    const spillover = Math.min(M.railSpilloverPeak, route.railCompetition * 0.28 * (f?.mult ? Math.min(1.4, f.mult - 1) : 0.25))
    return Math.min(1.28, 1 + spillover)
  }

  const isQuietMidweek = (d === 2 || d === 3) && (!f || f.mult < 1.05)
  const theft = isQuietMidweek ? baseSteal * 1.06 : baseSteal
  return Math.max(0.42, 1 - theft)
}

/** Salary week fills the homebound side; month-end thins it out. */
export function paydayFactor(route: RouteDef, direction: 'AB' | 'BA', depDay: number): number {
  const c = toCivil(depDay)
  const last = daysInMonth(c.y, c.m)
  if (c.d > 5 && c.d < last - 2) return 1
  return isHomebound(route, direction) ? BAL.paydayHomebound : BAL.paydayReturn
}

/** Friday out, Sunday back — the weekly tide on every metro corridor. */
export function weekdayFlowFactor(
  route: RouteDef,
  direction: 'AB' | 'BA',
  depDay: number,
  depHour: number,
  depMin: number,
): number {
  const w = BAL.weekdayFlow
  const d = dow(depDay)
  const h = depHour + (depMin === 30 ? 0.5 : 0)
  const home = isHomebound(route, direction)
  if (d === 5 && h >= w.friFromHour) return home ? w.friHomebound : w.friReturn
  if (d === 0 && h >= w.sunFromHour) return home ? w.sunHomebound : w.sunReturn
  if (d === 6) return w.satBoth
  return 1
}

/**
 * Weather & ghat infrastructure dynamics.
 * Monsoon brings heavy rains and landslide alerts on ghat routes, cooling leisure
 * travel; clear pleasant winter weather encourages scenic ghat journeys.
 */
function weatherFactor(s: GameState, route: RouteDef, depDay: number, cache?: Map<number, number>): number {
  const hit = cache?.get(depDay)
  let w = hit
  if (w === undefined) {
    const season = seasonInfo(depDay)
    w = rJitter(rngFor(s.seed, 'wx', depDay), 1, BAL.demandNoiseSd * 0.7)
    if (season.weatherRisk > 0) w *= rJitter(rngFor(s.seed, 'wxm', depDay), 0.95, 0.08)
    cache?.set(depDay, w)
  }

  if (route.ghat) {
    const season = seasonInfo(depDay)
    if (season.weatherRisk > 0) {
      w *= 0.88 // 12% drag on ghats during monsoon
    } else if (season.name === 'Winter' || season.name === 'Pleasant winter') {
      w *= 1.05 // pleasant scenic hill travel
    }
  }
  return w
}

/** This corridor runs lean or fat in this save — permanent, learnable. */
function corridorBias(s: GameState, route: RouteDef): number {
  return rJitter(rngFor(s.seed, 'corrbias', route.id), 1, M.corridorBiasSd)
}

/** Soft weeks and hot weeks on a corridor — sticky for seven days. */
function weekMood(s: GameState, route: RouteDef, depDay: number): number {
  return rJitter(rngFor(s.seed, 'corrmood', route.id, Math.floor(depDay / 7)), 1, M.weekMoodSd)
}

/** Total shoppers in this corridor and direction on a departure day. */
export function corridorPool(s: GameState, route: RouteDef, trip: Trip, f: DemandFactors, ctx?: BookingCtx): number {
  const depMin = trip.depMin ?? 0
  return route.baseDemand
    * f.mult
    * archetypeFactor(route, trip.day, trip.depHour, depMin)
    * (M.archetype.pool[corridorArchetype(route.id)] ?? 1)
    * weekdayFlowFactor(route, trip.direction, trip.day, trip.depHour, depMin)
    * paydayFactor(route, trip.direction, trip.day)
    * railFactor(route, trip.day, f)
    * weatherFactor(s, route, trip.day, ctx?.weatherByDay)
    * corridorBias(s, route)
    * weekMood(s, route, trip.day)
}

/* ======================= stage 2: share of the window ======================= */

/** Fare vs this coach's own going rate. Moves share, not the corridor's size. */
export function priceAttr(rel: number, daysToDep: number, elasticityMult = 1): number {
  const late = daysToDep <= M.elasticityLateDays ? M.elasticityLateMult : 1
  return clamp(Math.pow(Math.max(0.2, rel), -M.priceElasticity * late * elasticityMult), M.priceAttrMin, M.priceAttrMax)
}

/**
 * Stars, shrunk toward the market average until we have reviews to back them.
 * A bad rating hurts harder than a good one helps — RedBus shoppers filter.
 */
export function ratingAttrFrom(rating: number, ratingCount: number): number {
  const nEff = ratingCount / (ratingCount + M.ratingReviewHalfLife)
  const shrunk = BAL.ratingBase + (rating - BAL.ratingBase) * nEff
  const t = Math.tanh((shrunk - BAL.ratingBase) / M.ratingWidth)
  return 1 + M.ratingSpread * (t >= 0 ? t : t * M.ratingLossMult)
}

export function ratingAttr(c: Company): number {
  return ratingAttrFrom(c.rating, c.ratingCount)
}

function brandAttr(c: Company): number {
  return Math.min(BAL.brandAwarenessMax, 1 + M.brandScale * c.brandAwareness)
}

function punctualityAttr(c: Company): number {
  return 1 + M.punctualityScale * (c.punctuality - 0.85)
}

function acFactor(bus: Bus, depDay: number): number {
  const model = BUS_MODELS[bus.modelId]
  const season = seasonInfo(depDay)
  const health = bus.condition.ac / 100
  const hot = season.name === 'Summer holidays' || season.weatherRisk > 0
  if (!model.ac) return hot ? 0.88 : 1.0
  if (hot) return 0.92 + 0.14 * health
  return 0.98 + 0.06 * health
}

/**
 * Coach state as shoppers see it in the listing and on boarding: overdue
 * service, retreads, accident history, odometer and AC health. Graded, not
 * on/off, so two sleepers on one corridor do not tie.
 */
function coachStateAttr(model: BusModel, bus: Bus, depDay: number): number {
  const cs = M.coachState
  let mult = 1

  const overdueKm = bus.odometer - bus.lastServiceOdo - BAL.serviceIntervalKm
  if (overdueKm > 0) {
    mult *= 1 - Math.min(cs.overdueMax, cs.overdueBase + cs.overduePer10k * (overdueKm / 10_000))
  }
  if (bus.tyresRetreaded) mult *= 1 - cs.retread
  if (bus.accidentHistory) mult *= 1 - cs.accident

  if (bus.odometer < M.newBusOdoKm * 2) {
    mult *= 1 + cs.freshOdoBonus * (1 - bus.odometer / (M.newBusOdoKm * 2))
  } else if (bus.odometer > M.highOdoKm) {
    const lakhs = (bus.odometer - M.highOdoKm) / 100_000
    mult *= 1 - Math.min(cs.highOdoMax, lakhs * cs.highOdoPer100k)
  }

  if (model.ac) {
    const health = bus.condition.ac / 100
    const season = seasonInfo(depDay)
    const hot = season.name === 'Summer holidays' || season.weatherRisk > 0
    if (health < cs.acFloorHealth) {
      mult *= 1 - (cs.acFloorHealth - health) * cs.acWeight * (hot ? cs.acHotMult : 1)
    } else if (health >= 0.92) {
      mult *= 1 + cs.acHealthyBonus * ((health - 0.92) / 0.08)
    }
  }

  return clamp(mult, cs.floor, cs.ceil)
}

function coachAttr(model: BusModel, bus: Bus, depDay: number, s?: GameState): number {
  const comfort = busComfort(s, bus)
  return (1 + M.comfortScale * (comfort - 7))
    * (1 + M.qualityScale * (bus.qualityScore - 3))
    * acFactor(bus, depDay)
    * coachStateAttr(model, bus, depDay)
}

/**
 * What this corridor's crowd shops on. IT corridors read stars, brand and
 * punctuality; pilgrim families read price (see archetype priceMult); leisure
 * reads the coach itself; marathons read mechanical condition.
 */
function archetypeShareAttr(
  arch: CorridorArchetype,
  p: { rating: number; brand: number; coach: number; subsystems: number; punctuality: number },
): number {
  const w = M.archetype[arch]
  const v = 1
    + w.rating * (p.rating - 1)
    + w.brand * (p.brand - 1)
    + w.coach * (p.coach - 1)
    + w.cond * (p.subsystems - 1)
    + w.punct * (p.punctuality - 1)
  return clamp(v, M.archetype.min, M.archetype.max)
}

/**
 * Soft cap on rating × brand × Primo placement. Past the knee, extra stars
 * add a diminishing share. Returns the ≤1 multiplier to apply to raw appeal.
 */
function starStackCap(rating: number, brand: number, primo: boolean): number {
  const stack = rating * brand * (primo ? BAL.primoVisibility : 1)
  if (stack <= M.starStackKnee) return 1
  const excess = stack - M.starStackKnee
  const capped = M.starStackKnee + excess / (1 + M.starStackSlope * excess)
  return capped / stack
}

/**
 * Full mechanical subsystem evaluation:
 * - Suspension: smooth air-glide vs bumpy motion sickness (critical on ghats / overnights)
 * - Electrical: 220V/USB phone charging ports & reading lights
 * - NVH: quiet cruise vs engine clatter & gearbox shudder
 * - Body: clean, quiet berth cabin vs rattling trim
 */
function busConditionAttr(bus: Bus, route: RouteDef): number {
  const susp = bus.condition.suspension / 100
  const elec = bus.condition.electrical / 100
  const nvh = (bus.condition.engine + bus.condition.gearbox) / 200
  const body = bus.condition.body / 100

  let suspMult = 1.0
  if (susp >= 0.85) {
    suspMult += (susp - 0.85) * 0.35 // air-suspension float
  } else if (susp < 0.65) {
    const penaltyWeight = route.ghat || route.hours >= 8 ? 0.40 : 0.25
    suspMult -= (0.65 - susp) * penaltyWeight // bumpy nausea
  }

  let elecMult = 1.0
  if (elec < 0.65) {
    elecMult -= (0.65 - elec) * 0.24 // dead phone chargers
  }

  let nvhMult = 1.0
  if (nvh < 0.65) {
    nvhMult -= (0.65 - nvh) * 0.20 // cabin drone / gear shudder
  }

  let bodyMult = 1.0
  if (body < 0.60) {
    bodyMult -= (0.60 - body) * 0.18 // loose rattling panels
  }

  return Math.max(0.55, suspMult * elecMult * nvhMult * bodyMult)
}

/**
 * Bus age & odometer factor:
 * - Fresh coach (<80k km, <2 yrs old): RedBus "New Launch" highlight
 * - High-mileage (>400k km): subtle aging fatigue unless kept in top shape
 */
function busMileageAttr(bus: Bus, depDay: number): number {
  const c = toCivil(depDay)
  const ageYears = Math.max(0, c.y - bus.mfgYear)

  if (bus.odometer <= M.newBusOdoKm && ageYears <= 2) {
    return 1 + M.newBusBonus
  }

  if (bus.odometer > M.highOdoKm) {
    const extraLakh = (bus.odometer - M.highOdoKm) / 100_000
    const rawDrag = Math.min(M.highOdoMaxDrag, extraLakh * M.highOdoDragPer100k)
    const mitigation = Math.max(0, (bus.qualityScore - 3) * 0.02)
    return Math.max(0.88, 1 - Math.max(0, rawDrag - mitigation))
  }

  return 1.0
}

/**
 * Maintenance discipline & tyres:
 * - Overdue service: unserviced engine sound & dirty exterior
 * - Retreaded tyres: coarse road drone
 * - Accident history: minor passenger hesitation
 */
function busMaintenanceAttr(bus: Bus): number {
  let mult = 1.0
  if (bus.odometer - bus.lastServiceOdo > BAL.serviceIntervalKm) {
    mult *= (1 - M.overdueServiceDrag)
  }
  if (bus.tyresRetreaded) {
    mult *= (1 - M.retreadTyreDrag)
  }
  if (bus.accidentHistory) {
    mult *= (1 - M.accidentHistoryDrag)
  }
  return mult
}

/**
 * Chassis class & multi-axle appeal:
 * Multi-axle coaches (Volvo 9600, 9400, Scania Metrolink, BharatBenz 1824hd)
 * provide superior highway cruise stability on long overnight and ghat routes.
 */
function chassisClassAttr(model: BusModel, route: RouteDef): number {
  const isMultiAxle = model.id.includes('9600') || model.id.includes('9400')
    || model.id === 'metrolink' || model.id.includes('1824') || model.id === 'leyacsleep2'

  if (isMultiAxle && (route.hours >= 8 || route.ghat)) {
    return 1 + M.multiAxleBonus
  }

  if (model.electric) {
    if (route.hours <= 5.5) return 1.08 // EV novelty on day hop
    if (route.hours >= 10) return 0.94 // range caution on marathon
  }

  return 1.0
}

/** Assigned driver safety & skill track record. */
function crewQualityAttr(bus: Bus, s: GameState, ctx?: BookingCtx): number {
  if (ctx?.crewQualityByBus.has(bus.id)) return ctx.crewQualityByBus.get(bus.id)!
  const drivers = Object.values(s.staff).filter((st) =>
    st.busId === bus.id && st.role === 'driver' && !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day),
  )
  if (drivers.length > 0) {
    const avgSafety = drivers.reduce((a, d) => a + d.safety, 0) / drivers.length
    const avgSkill = drivers.reduce((a, d) => a + d.skill, 0) / drivers.length
    if (avgSafety >= 7 && avgSkill >= 7) return 1.04
    if (avgSafety < 4) return 0.95
  }
  return 1.0
}

function crewAttr(bus: Bus, conductors: Set<string> | undefined, s: GameState): number {
  if (bus.ownership === 'attached') return 1
  if (conductors) return conductors.has(bus.id) ? 1 : BAL.noConductorDemand
  const cond = Object.values(s.staff).some((st) =>
    st.busId === bus.id && st.role === 'conductor' && !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day),
  )
  return cond ? 1 : BAL.noConductorDemand
}

function serviceTierDemandMult(tier?: Schedule['serviceTier']): number {
  switch (tier) {
    case 'gold': return BAL.amenities.goldTierDemandMult
    case 'premium': return BAL.amenities.premiumTierDemandMult
    case 'standard': return BAL.amenities.standardTierDemandMult
    case 'economy':
    default: return BAL.amenities.economyTierDemandMult
  }
}

/** Boarding points, refund policy, service tier and an on-board conductor. */
function serviceAttr(s: GameState, sch: Schedule, bus: Bus, ctx?: BookingCtx): number {
  const bp = sch.boardingPoints ?? BAL.bpDemandNormal
  const canc = sch.cancellation ?? 'standard'
  let mult = (1 + BAL.bpDemandPerPoint * (bp - BAL.bpDemandNormal))
    * (BAL.cancellationPolicyDemand[canc] ?? 1.0)
    * crewAttr(bus, ctx?.busesWithConductor, s)
    * serviceTierDemandMult(sch.serviceTier)

  // Quality Certifications
  if (s.company.certifications?.womenFriendly) mult *= BAL.certifications.womenFriendlyDemandMult
  if (s.company.certifications?.cleanCertified) mult *= BAL.certifications.cleanCertifiedDemandMult

  return mult * busFittingsDemandMult(bus)
}

/**
 * The coach a sensible rival fields on this corridor at this hour — sleepers
 * on the marathon, seats on the day hop.
 */
function rivalProductFit(route: RouteDef, depHour: number, depMin: number): number {
  let best = 0
  for (const cls of ['AC_SLEEPER', 'AC_SEMI', 'AC_HYBRID'] as BusClassId[]) {
    const fit = haulLayoutAppeal(cls, route.hours) * classHourAppeal(cls, depHour, depMin, route.hours)
    if (fit > best) best = fit
  }
  return best || 1
}

/** Being listed at all. RedBus alone is roughly the market normal. */
export function reachAttr(rawReach: number): number {
  return clamp(M.reachFloor + M.reachSpan * (rawReach / M.reachNormal), M.reachAttrMin, M.reachAttrMax)
}

/** Per-channel demand reach weights — sell-on flags are fleet-wide (Schedule defaults). */
export function channelWeights(s: GameState, sch: Schedule, ctx?: BookingCtx): Record<Channel, number> {
  const cached = ctx?.weightsBySchedule.get(sch.id)
  if (cached) return cached
  const c = s.company
  const flags = sch.channels ?? { redbus: true, abhibus: false, ownapp: false, counter: true }
  const w: Record<Channel, number> = {
    redbus: 0, abhibus: 0, ownapp: 0, counter: 0,
  }

  if (flags.redbus) {
    w.redbus = 1.0
    const grp = sch.groupId && s.groups ? s.groups[sch.groupId] : undefined
    const isPrimo = grp ? grp.primo : c.primo
    if (isPrimo) w.redbus *= BAL.primoVisibility
    if (sch.redDeal) w.redbus *= BAL.redDealVisibility
  }
  if (flags.abhibus) w.abhibus = 0.48

  if (flags.ownapp && c.app.tier > 0) {
    let tierMult = 1
    if (c.app.tier >= 2) tierMult *= 1.15
    if (c.app.tier >= 3) tierMult *= 1.15
    const parity = Math.max(1, BAL.appMauForParity)
    w.ownapp = Math.min(BAL.appMaxChannelWeight, (c.app.mau / parity) * tierMult)
    if (w.ownapp > 0 && BAL.appDisplaceRedbus > 0) {
      const displace = 1 / (1 + BAL.appDisplaceRedbus * Math.min(BAL.appMaxChannelWeight, w.ownapp))
      w.redbus *= displace
      w.abhibus *= displace
    }
  }
  w.counter = flags.counter ? 0.14 + 0.1 * c.brandAwareness : 0
  return w
}

/**
 * Soft saturation curve on compounding advantages:
 * In reality, having 4.6★ vs 4.2★ provides a solid 20-35% commercial edge,
 * not an exponential 300% multiplier.
 */
export function saturateAttr(raw: number): number {
  if (raw <= 1) {
    return Math.max(0.18, raw)
  }
  const excess = raw - 1
  return 1 + excess / (1 + M.attrSaturationSlope * excess)
}

/* ============================ booking context ============================ */

export interface BookingCtx {
  /** Our own substitution-weighted seats in each trip's departure window. */
  ownSeatsByTripId: Map<string, number>
  busesWithConductor: Set<string>
  /** Buses whose posted driver has an aggressive style (small fill bonus). */
  aggressiveByBus: Set<string>
  /** Precomputed crew-quality multiplier per bus (1.0 = average). */
  crewQualityByBus: Map<string, number>
  /** Brand ratings indexed by brand ID */
  ratingByGroup: Map<ID, { rating: number; count: number }>
  /** Channel reach weights per schedule (company + sell-on flags). */
  weightsBySchedule: Map<string, Record<Channel, number>>
  /** Company attrs computed once for the booking day. */
  rating: number
  brand: number
  punctuality: number
  weatherByDay: Map<number, number>
  demandFactorsCache: Map<string, DemandFactors>
  seed: number
}

/**
 * One index of our own supply per departure window plus crew, reused across
 * the day's booking pass. Own-supply uses a sorted clock kernel (O(n·w))
 * instead of a full pairwise product.
 */
export function buildBookingCtx(s: GameState): BookingCtx {
  const groups = new Map<string, { id: string; tMin: number; seats: number }[]>()
  for (const id of s.openTripIds) {
    const p = s.trips[id]
    if (!p || p.status !== 'open') continue
    const key = `${p.routeId}|${p.day}|${p.direction}`
    let g = groups.get(key)
    if (!g) { g = []; groups.set(key, g) }
    g.push({ id, tMin: clockMinutes(p), seats: p.seatCount || p.seats.length })
  }
  const ownSeatsByTripId = new Map<string, number>()
  for (const g of groups.values()) {
    for (const a of g) {
      let seats = a.seats
      // Roster spacing: a neighbour's weight follows the roster gap curve
      // (ownSubstitutionWeight) - 50% inside half an hour, 25% at an hour,
      // 10% at two, nothing by three.
      for (const b of g) {
        if (b.id === a.id) continue
        const w = ownSubstitutionWeight(wrapDistMin(a.tMin, b.tMin))
        if (w > 0) seats += b.seats * w
      }
      ownSeatsByTripId.set(a.id, seats)
    }
  }

  const busesWithConductor = new Set<string>()
  const aggressiveByBus = new Set<string>()
  const crewQualityByBus = new Map<string, number>()
  const driversByBus = new Map<string, { safety: number; skill: number; n: number }>()
  for (const st of Object.values(s.staff)) {
    if (!st.busId) continue
    // Driver trait is read for every departure, so it is indexed once. Leave is
    // deliberately ignored here: the trait describes the posted crew, and the
    // engine has always applied it even while the driver is on leave.
    if ((st.role === 'driver' || st.role === 'co_driver') && st.drivingStyle === 'aggressive') {
      aggressiveByBus.add(st.busId)
    }
    if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) continue
    if (st.role === 'conductor') busesWithConductor.add(st.busId)
    if (st.role === 'driver') {
      const cur = driversByBus.get(st.busId) ?? { safety: 0, skill: 0, n: 0 }
      cur.safety += st.safety
      cur.skill += st.skill
      cur.n++
      driversByBus.set(st.busId, cur)
    }
  }
  for (const [busId, d] of driversByBus) {
    const avgSafety = d.safety / d.n
    const avgSkill = d.skill / d.n
    let q = 1
    if (avgSafety >= 7 && avgSkill >= 7) q = 1.04
    else if (avgSafety < 4) q = 0.95
    crewQualityByBus.set(busId, q)
  }

  // Channel reach is per schedule (sell-on flags) but every schedule on the
  // fleet shares the same company terms — compute once for the whole day.
  const weightsBySchedule = new Map<string, Record<Channel, number>>()
  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.active || sch.busIds.length === 0) continue
    weightsBySchedule.set(sch.id, channelWeights(s, sch))
  }

  const ratingByGroup = new Map<ID, { rating: number; count: number }>()
  for (const g of Object.values(s.groups ?? {})) {
    ratingByGroup.set(g.id, { rating: g.rating, count: g.ratingCount })
  }

  return {
    ownSeatsByTripId,
    busesWithConductor,
    aggressiveByBus,
    crewQualityByBus,
    ratingByGroup,
    weightsBySchedule,
    rating: ratingAttr(s.company),
    brand: brandAttr(s.company),
    punctuality: punctualityAttr(s.company),
    weatherByDay: new Map(),
    demandFactorsCache: new Map(),
    seed: s.seed,
  }
}

/* ============================ target load factor ============================ */

export interface LoadFactorEstimate {
  /** Share of seats this trip can expect to sell by departure. */
  target: number
  /** Shoppers looking at this departure window. */
  pool: number
  /** Our substitution-weighted seats in the window. */
  ownSeats: number
  rivalSeats: number
  /** Our appeal vs the corridor's average operator (1.00 = market normal). */
  attr: number
  parts: {
    product: number
    haul: number
    hour: number
    taste: number
    price: number
    rating: number
    brand: number
    punctuality: number
    coach: number
    subsystems: number
    mileage: number
    maintenance: number
    chassis: number
    crewQuality: number
    service: number
    reach: number
    /** Corridor archetype: what this crowd shops on (1.00 = neutral). */
    corridor: number
    /** ≤1 soft cap on stacked rating × brand × Primo. */
    starCap: number
  }
  hybrid?: {
    sleeperTarget: number
    seaterTarget: number
    slpCap: number
    strCap: number
  }
}

const ZERO_LF: LoadFactorEstimate = {
  target: 0, pool: 0, ownSeats: 0, rivalSeats: 0, attr: 0,
  parts: {
    product: 0, haul: 0, hour: 0, taste: 0, price: 0, rating: 0,
    brand: 0, punctuality: 0, coach: 0, subsystems: 0, mileage: 0,
    maintenance: 0, chassis: 0, crewQuality: 0, service: 0, reach: 0,
    corridor: 0, starCap: 0,
  },
}

/** The LF the corridor's rival supply settles at — worse where it is crowded. */
export function equilibriumLf(route: RouteDef): number {
  return clamp(
    M.equilibriumLf - M.equilibriumLfPerCompetition * (route.competition - M.competitionRef),
    0.45,
    0.88,
  )
}

/**
 * Occupancy multiplier for a fare `rel` times the going rate. One elasticity
 * for the whole model: late shoppers care less, pilgrim crowds more. Dearer
 * fares lose fill without limit; discounts stop helping past a ceiling.
 */
export function fareElasticityMult(rel: number, daysToDep: number, archetypePriceMult = 1): number {
  if (Math.abs(rel - 1) <= 0.02) return 1
  const late = daysToDep <= M.elasticityLateDays ? M.elasticityLateMult : 1
  const e = M.priceElasticity * late * archetypePriceMult
  return Math.min(M.priceBoostMax, Math.pow(Math.max(0.2, rel), -e))
}

/** Share of a new coach's seats that turns into new corridor riders (rail, state-bus and car switchers). */
export function inducedDemandRate(departures: number): number {
  const curve = M.inducedDemand
  if (departures <= curve[0]![0]) return curve[0]![1]
  for (let i = 1; i < curve.length; i++) {
    const [at, w] = curve[i]!
    if (departures <= at) {
      const [prevAt, prevW] = curve[i - 1]!
      return prevW + ((w - prevW) * (departures - prevAt)) / (at - prevAt)
    }
  }
  return curve[curve.length - 1]![1]
}

/**
 * How our extra seats and a rival flood change this window's fill, relative
 * to one coach of ours sitting in an otherwise normal market. Shoppers split
 * evenly across the window's seats; every coach of ours also draws a few new
 * riders onto the corridor (more on thin corridors, almost none on the big
 * metro pairs). Exactly 1.0 for a lone coach with no flood.
 */
export function marketSupplyPressure(
  route: RouteDef,
  pool: number,
  rivalSeats: number,
  rivalExtraSeats: number,
  ownSeats: number,
  cap: number,
): number {
  if (pool <= 0 || cap <= 0) return 1
  const rate = inducedDemandRate(corridorSupply(route.id).departures)
  const fill = (own: number, extra: number) => (pool + own * rate) / Math.max(1, rivalSeats + extra + own)
  const ref = fill(cap, 0)
  if (ref <= 0) return 1
  return clamp(fill(ownSeats, rivalExtraSeats) / ref, M.supplyPressureMin, 1)
}

/**
 * What share of seats this trip is on course to sell, and why.
 */
export function tripLoadFactor(s: GameState, trip: Trip, daysToDep: number, ctx?: BookingCtx): LoadFactorEstimate {
  const sch = s.schedules[trip.scheduleId]
  const route = ROUTES[trip.routeId]
  const bus = s.buses[trip.busId]
  const model = bus ? BUS_MODELS[bus.modelId] : undefined
  if (!sch || !route || !bus || !model) return ZERO_LF
  const closure = s.world.closures[route.id]
  if (closure && closure.untilDay >= trip.day) return ZERO_LF

  const depMin = trip.depMin ?? 0
  const cap = trip.seatCount || trip.seats.length
  const f = demandFactors(s, route, trip.direction, trip.day, ctx)
  const profile = corridorProfile(s.seed, route)
  const mass = windowMass(profile, trip.depHour, depMin)

  const isHybrid = model && (model.layout.kind === 'hybrid' || model.cls === 'AC_HYBRID')
  const slpCount = isHybrid ? hybridSleeperCount(model) : 0
  const strCount = isHybrid ? Math.max(1, model.seats - slpCount) : 0
  const effectiveTripFare = (isHybrid && trip.fareSleeper && trip.fareSeater)
    ? Math.round((trip.fareSleeper * slpCount + trip.fareSeater * strCount) / model.seats)
    : trip.fare

  const autoFare = Math.max(1, marketFare(s, route, bus.modelId, trip.day, trip.direction, bus, trip.depHour, depMin, sch.serviceTier))
  const rel = effectiveTripFare / autoFare
  const weights = channelWeights(s, sch, ctx)
  const rawReach = weights.redbus + weights.abhibus + weights.ownapp + weights.counter

  const arch = corridorArchetype(route.id)
  let rating = ctx?.rating ?? ratingAttr(s.company)
  const tripGroup = groupForTrip(s, trip)
  if (tripGroup) {
    const grpInfo = ctx?.ratingByGroup?.get(tripGroup.id) ?? { rating: tripGroup.rating, count: tripGroup.ratingCount }
    if (grpInfo.count >= BAL.groupRatingMinReviews) {
      rating = ratingAttrFrom(grpInfo.rating, grpInfo.count)
    }
  }
  const brand = ctx?.brand ?? brandAttr(s.company)
  const punctuality = ctx?.punctuality ?? punctualityAttr(s.company)
  const coach = coachAttr(model, bus, trip.day, s)
  const subsystems = busConditionAttr(bus, route)
  const primoActive = tripGroup ? tripGroup.primo : s.company.primo
  const onPrimo = primoActive && weights.redbus > 0

  const parts = {
    product: BAL.classAppeal[model.cls] ?? 1,
    haul: haulLayoutAppeal(model.cls, route.hours),
    hour: classHourAppeal(model.cls, trip.depHour, depMin, route.hours),
    taste: classFit(route, bus.modelId, s.seed),
    price: priceAttr(rel, daysToDep, M.archetype.priceMult[arch] ?? 1),
    rating,
    brand,
    punctuality,
    coach,
    subsystems,
    mileage: busMileageAttr(bus, trip.day),
    maintenance: busMaintenanceAttr(bus),
    chassis: chassisClassAttr(model, route),
    crewQuality: crewQualityAttr(bus, s, ctx),
    service: serviceAttr(s, sch, bus, ctx),
    reach: reachAttr(rawReach),
    corridor: archetypeShareAttr(arch, { rating, brand, coach, subsystems, punctuality }),
    starCap: starStackCap(rating, brand, !!onPrimo),
  }

  let rawAttr = 1
  for (const v of Object.values(parts)) rawAttr *= v
  const attr = saturateAttr(rawAttr)

  const pool = corridorPool(s, route, trip, f, ctx) * mass.pool
  const corridorSeats = (route.baseDemand / equilibriumLf(route)) * supplyResponse(f) * mass.supply

  // Rivals do not pull buses off the corridor: our departures pile on top of
  // the private supply already running in this window.
  const ownSeats = Math.max(cap, ctx?.ownSeatsByTripId.get(trip.id) ?? cap)
  // A rival capacity flood (or predatory wave) puts real extra seats on the
  // corridor, concentrated on the peak slots it is aimed at.
  const rivalAct = s.world.rivalActions?.[route.id]
  const rivalExtraDaily = rivalAct && rivalAct.untilDay >= s.day && rivalAct.startDay <= s.day ? rivalAct.addedDailySeats : 0
  const rivalExtraSeats = rivalExtraDaily * mass.supply * M.rivalFloodPeakConcentration
  const rivalSeats = corridorSeats + rivalExtraSeats
  const supplyPressure = marketSupplyPressure(route, pool, corridorSeats, rivalExtraSeats, ownSeats, cap)

  // On heavily contested corridors, rival operators field high-tier fleets
  const rivalTier = 1 + M.rivalCompetitivenessScale * Math.max(0, route.competition - M.competitionRef)
  const rivalAttr = (1 + M.rivalAttrPerCompetition * (route.competition - M.competitionRef))
    * rivalProductFit(route, trip.depHour, depMin)
    * rivalTier

  const frontRunInfo = isTripFrontRun(s, route.id, trip.depHour, depMin)
  let effectiveRivalAttr = rivalAttr
  let effectiveAttr = attr
  if (frontRunInfo.frontRun) {
    const stance = getCorridorStance(s, route.id)
    const fr = M.frontRun
    if (stance === 'undercut') {
      // Player matched price, defending passengers: rival front-runner loses appeal advantage
      effectiveAttr *= fr.undercutLift
    } else if (stance === 'premium_hold') {
      // Player defends brand with comfort and quality
      const isHighQuality = (bus.qualityScore >= 4.0) || Boolean(s.company.primo)
      if (isHighQuality) {
        effectiveAttr *= fr.premiumHoldLift // Premium passengers stay loyal
      } else {
        effectiveRivalAttr *= fr.premiumHoldWeakRival // Lacking quality, rival takes share
      }
    } else if (stance === 'cargo_bundle') {
      effectiveRivalAttr *= fr.cargoBundleRival
    } else {
      // Neutral / uncountered: rival intercepts shoppers
      effectiveRivalAttr *= fr.uncounteredRival
    }
  }

  // Passenger Boarding Lounges in origin/dest cities provide attractive waiting experience (+1.5% to +5.0%)
  const loungeBoost = getLoungeDemandBoost(s, route.id)
  effectiveAttr *= loungeBoost

  // 1. Target occupancy range from directional travel period:
  // - Normal Friday night:                  Chennai → Madurai 80–95% | Madurai → Chennai 55–75%
  // - Normal Saturday night:                Chennai → Madurai 65–85% | Madurai → Chennai 65–85%
  // - Normal Sunday night:                  Chennai → Madurai 50–70% | Madurai → Chennai 80–95%
  // - 1–3 days before a major festival:     Chennai → Madurai 90–100% | Madurai → Chennai 60–85%
  // - Festival day itself:                  Chennai → Madurai 40–75% | Madurai → Chennai 40–75%
  // - First return day after festival:      Chennai → Madurai 60–85% | Madurai → Chennai 90–100%
  // - Final holiday return rush:            Chennai → Madurai 50–75% | Madurai → Chennai 90–100%
  const [rangeMin, rangeMax] = getDirectionalOccupancyRange(
    model.cls,
    bus.qualityScore,
    route,
    trip.direction,
    trip.day,
  )
  const span = rangeMax - rangeMin

  // 3. Performance score from operator and individual coach factors (positioning inside [rangeMin, rangeMax]):
  // A. Company Rating & Brand Awareness (rating ranges 1.0 - 5.0, brand 0.0 - 0.40)
  const ratingNorm = clamp((s.company.rating - 1.0) / 4.0, 0, 1)
  const brandNorm = clamp(s.company.brandAwareness / 0.30, 0, 1)
  const companyScore = clamp(ratingNorm * 0.75 + brandNorm * 0.25 + (onPrimo ? 0.06 : 0), 0, 1)

  // B. Individual coach stars outweigh comfort and condition. A 4★ sleeper
  // should sit higher in the band than an ordinary one on the same lane.
  const busQualityNorm = clamp((bus.qualityScore - 1.0) / 4.0, 0, 1)
  const comfortNorm = clamp((busComfort(s, bus) - 3.0) / 7.0, 0, 1)
  const avgCond = (
    bus.condition.engine +
    bus.condition.gearbox +
    bus.condition.suspension +
    bus.condition.brakes +
    bus.condition.body +
    bus.condition.ac +
    bus.condition.electrical
  ) / 7
  const conditionNorm = clamp((avgCond - 30) / 70, 0, 1)
  const busHealthScore = clamp(parts.subsystems * parts.maintenance * parts.mileage, 0.7, 1.15)
  const coachScore = clamp(
    (busQualityNorm * 0.64 + comfortNorm * 0.18 + conditionNorm * 0.18) * (busHealthScore / 1.0),
    0,
    1,
  )

  // C. Commercial Factors: Sales Reach, Service. Price is applied once, as a
  // straight elasticity on the target further down, not here as well.
  const reachFactor = clamp(parts.reach / 1.10, 0.6, 1.15)
  const serviceFactor = clamp(parts.service, 0.8, 1.10)
  const commercialFactor = clamp(reachFactor * serviceFactor, 0.5, 1.25)

  // Combined performance filling the remaining percentage (0.0 for worst case, ~0.50-0.60 for decent coach)
  const corePerformance = companyScore * 0.34 + coachScore * 0.66
  const perfScore = clamp(corePerformance * commercialFactor, 0, 1.0)

  // Haul-aware departure slot fit (corridor clock):
  const timeFit = departureTimeFit(route, trip.depHour, depMin, model?.cls)
  const timeOffset = (timeFit.appeal - 1.0) * 0.40

  // Position within [rangeMin, rangeMax]:
  // Baseline 0.35 + (perfScore - 0.50) * 0.50 + timeOffset
  const pos = clamp(0.35 + (perfScore - 0.50) * 0.50 + timeOffset, 0.05, 0.95)
  let target = rangeMin + span * pos
  // 3.5★ is neutral. Each star above that adds a few points of fill; each star below takes a few off.
  const starLift = clamp((bus.qualityScore - 3.5) * 0.05, -0.08, 0.06)
  target = target * (1 + starLift)

  // 4. Off-peak slot scaling (morning daytime on overnight hauls or dead-of-night slots):
  if (timeFit.appeal < 0.85) {
    target = target * Math.pow(timeFit.appeal / 0.85, 0.90)
  }

  // 5. Layout preference by travel duration:
  // A layout that doesn't suit the haul still books price-led travellers, so
  // the shortfall is compressed (a seater on a night haul, berths on a day hop).
  const layoutMult = parts.haul
  const layoutPenaltyExp = BAL.layoutDuration.penaltyExponent
  if (layoutMult < 0.85) {
    target = target * Math.pow(layoutMult / 0.85, layoutPenaltyExp)
  }

  // 6. Natural diversity across routes and individual buses:
  const cBias = corridorBias(s, route) // Corridor permanent bias
  const cMood = weekMood(s, route, trip.day) // Weekly mood
  const cArch = archetypeFactor(route, trip.day, trip.depHour, depMin) // Commuter rhythm
  const rFactor = railFactor(route, trip.day, f) // Rail interaction
  const weather = weatherFactor(s, route, trip.day, ctx?.weatherByDay) // Monsoon, cyclones, heat
  const payday = paydayFactor(route, trip.direction, trip.day) // Month-start homebound bump
  // Real-world swings now compound instead of averaging into a ±8% band. The
  // exponents keep the sticky per-save draws (bias, mood) and the daily
  // weather noise from stacking into extremes; rail and payday move the fill
  // at full strength.
  const corridorModifier = clamp(
    Math.pow(cBias, M.corridorModifier.biasExp)
      * Math.pow(cMood, M.corridorModifier.moodExp)
      * Math.pow(cArch, M.corridorModifier.archExp)
      * rFactor
      * Math.pow(weather, M.corridorModifier.weatherExp)
      * payday,
    M.corridorModifier.min,
    M.corridorModifier.max,
  )
  target = target * corridorModifier

  // Supply: our own extra coaches in the window, and any rival flood, split
  // the window's shoppers. The first coach is what the occupancy bands above
  // describe, so only the seats beyond it move the fill.
  target = target * supplyPressure

  // Head-to-head: a lounge at either end lifts our appeal, and a rival
  // front-running this departure takes shoppers unless our corridor stance
  // answers it. Both move the fill by how far they shift our appeal against
  // the rival's.
  const competitiveMult = (effectiveAttr / attr) * (rivalAttr / effectiveRivalAttr)
  target = target * competitiveMult

  // 7. Trip-to-trip wobble:
  const wobble = tripWobbleRate(s.seed, trip)
  if (timeFit.isPeak) {
    target = target * (1 + wobble * 0.5)
  } else {
    target = target * (1 - wobble * 0.5)
  }

  // Driver trait bonus
  const aggressive = ctx
    ? ctx.aggressiveByBus.has(trip.busId)
    : Object.values(s.staff).some(
      (st) => st.busId === trip.busId && (st.role === 'driver' || st.role === 'co_driver') && st.drivingStyle === 'aggressive',
    )
  if (aggressive) {
    target = clamp(target * 1.03, 0, M.lfMax)
  }

  // Price elasticity vs the auto-calculated market fare, applied once.
  const archPriceMult = M.archetype.priceMult[arch] ?? 1
  target = Math.min(M.lfMax, target * fareElasticityMult(rel, daysToDep, archPriceMult))

  // Anchor worst-case minimum while respecting soft caps, scaling minFloor down
  // if overpriced or if the window is flooded with seats.
  const floorScale = rel > 1.05 ? Math.pow(rel, -2.0) : 1.0
  const layoutFloor = layoutMult < 0.85 ? Math.pow(layoutMult / 0.85, layoutPenaltyExp) : 1.0
  const minFloor = rangeMin * 0.80 * (timeFit.isOffPeak ? 0.75 : 1.0) * floorScale * layoutFloor * supplyPressure
  target = clamp(target, Math.max(0.04, minFloor), M.lfMax)

  let hybridStats: LoadFactorEstimate['hybrid'] = undefined
  if (isHybrid) {
    // Zone demand is explicit per haul length: a mid-haul hybrid sells berths
    // and cabin seats at the same rate, and only an 8h+ overnight run tips the
    // cabin down to roughly half the berth rate.
    const zone = hybridZoneFactors(route.hours)
    const slpMult = zone.sleeper
    const strMult = zone.seater

    let slpTarget = Math.min(M.lfMax, Math.max(0.04, target * slpMult))
    let strTarget = Math.min(M.lfMax, Math.max(0.04, target * strMult))

    // Dedicated price elasticity for hybrid sleeper vs seater fares if manual fare specified:
    if (trip.fareSleeper) {
      const slpAuto = autoFare * 1.15
      const slpRel = trip.fareSleeper / slpAuto
      slpTarget = Math.min(M.lfMax, slpTarget * fareElasticityMult(slpRel, daysToDep, archPriceMult))
    }
    if (trip.fareSeater) {
      const strAuto = autoFare * 0.85
      const strRel = trip.fareSeater / strAuto
      strTarget = Math.min(M.lfMax, strTarget * fareElasticityMult(strRel, daysToDep, archPriceMult))
    }

    // Floor each zone at its own share of the coach floor, so a weak zone
    // cannot be carried entirely by the other one.
    const slpFloorMult = Math.min(1, slpMult)
    const strFloorMult = Math.min(1, strMult)
    slpTarget = clamp(slpTarget, Math.max(0.04, minFloor * slpFloorMult), M.lfMax)
    strTarget = clamp(strTarget, Math.max(0.04, minFloor * strFloorMult), M.lfMax)

    target = clamp((slpCount * slpTarget + strCount * strTarget) / cap, 0.04, M.lfMax)
    hybridStats = {
      sleeperTarget: slpTarget,
      seaterTarget: strTarget,
      slpCap: slpCount,
      strCap: strCount,
    }
  }

  const lifeMult = routeLifeMult(s, route.id)
  return { target: lifeMult < 1 ? Math.max(0.04, target * lifeMult) : target, pool, ownSeats, rivalSeats, attr, parts, hybrid: hybridStats }
}

/* ========================= stage 3: today's arrivals ========================= */

export interface TripDemand {
  lambda: number
  byChannel: Record<Channel, number>
}

const ZERO_DEMAND: TripDemand = {
  lambda: 0,
  byChannel: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
}

/** Fraction of eventual sales that belong on the book before today's slice. */
export { elapsedBookingFrac }

/** Hot trips get booked further out; quiet ones still sell a late slice. */
function curveWeight(daysToDep: number, target: number): number {
  const base = CURVE[Math.min(daysToDep, CURVE.length - 1)] ?? 0
  const tilt = M.earlyBookingBoost * Math.max(0, target - M.earlyBookingLfRef)
  const lead = clamp((daysToDep - 3) / 7, -1, 1)
  return base * (1 + tilt * lead)
}

/** Expected booking arrivals for this trip today, split across channels. */
export function tripArrivals(
  s: GameState,
  trip: Trip,
  daysToDep: number,
  ctx?: BookingCtx,
  est?: LoadFactorEstimate,
): TripDemand {
  const sch = s.schedules[trip.scheduleId]
  if (!sch) return ZERO_DEMAND
  if (daysToDep < 0 || daysToDep > BAL.bookingWindowDays) return ZERO_DEMAND

  const lf = est ?? tripLoadFactor(s, trip, daysToDep, ctx)
  if (lf.target <= 0) return ZERO_DEMAND

  const cap = trip.seatCount || trip.seats.length
  const route = ROUTES[trip.routeId]
  const isHb = route ? isHomebound(route, trip.direction) : trip.direction === 'AB'
  const fest = festivalRunEffect(trip.day)
  const isFestSurging = fest.name != null && (
    (fest.phase === 'pre' && isHb) ||
    ((fest.phase === 'post_first' || fest.phase === 'post_late') && !isHb)
  )

  // Wire festival component of demandFactors into lambda headroom scaling
  const festDemandMult = isHb ? fest.homebound : fest.returning
  const festHeadroomScale = isFestSurging && festDemandMult > 1
    ? 1 + (festDemandMult - 1) * 0.20
    : 1
  const effectiveTarget = Math.min(1.0, lf.target * festHeadroomScale)
  const targetSeats = Math.min(cap, Math.round(effectiveTarget * cap))
  const headroom = Math.max(0, targetSeats - trip.sold)
  if (headroom <= 0) return ZERO_DEMAND

  const paceSold = cap * effectiveTarget * elapsedBookingFrac(daysToDep)
  let todaySlice = cap * lf.target * curveWeight(daysToDep, lf.target)

  // Festival advance booking pace multiplier
  if (isFestSurging) {
    const f = FESTIVALS.find((x) => x.name === fest.name || x.id === fest.id)
    const peak = f?.peak ?? 1.35
    const paceMult = 1.35 + Math.min(0.25, Math.max(0, (peak - 1.35) * (0.25 / 1.45)))
    if (daysToDep >= 3) {
      todaySlice *= paceMult
    } else if (daysToDep <= 1) {
      todaySlice *= 0.75
    }
  }

  // Behind the curve: close most of the deficit within a few days. The slice
  // multiple keeps a far-out day from dumping the whole gap at once, and
  // headroom refuses anything past the target LF.
  const gap = Math.max(0, paceSold - trip.sold)
  const catchUp = daysToDep === 0
    ? Math.min(gap, headroom)
    : Math.min(
        gap * M.catchUpRate,
        todaySlice * M.catchUpMaxFrac,
        headroom,
      )

  // The last seats are the bad seats: middle, last row, upper berth.
  const occ = cap > 0 ? trip.sold / cap : 0
  const drag = 1 - M.lastSeatsDrag * occ ** 3
  let rawLambda = (todaySlice + catchUp) * drag
  if (isFestSurging && festDemandMult > 1) {
    rawLambda *= 1 + (festDemandMult - 1) * 0.15
  }
  // Day-of booking luck on top of the stable target
  let lambda = Math.min(Math.max(0, rawLambda), headroom)
  if (trip.flashDeal) {
    lambda = Math.min(headroom, lambda * BAL.yieldDeals.flashSaleDemandBoost)
  }
  lambda = Math.min(headroom, Math.max(0, rJitter(rngFor(s.seed, 'arr', trip.id, s.day), lambda, M.arrivalNoiseSd)))

  const weights = channelWeights(s, sch, ctx)
  const chDen = weights.redbus + weights.abhibus + weights.ownapp + weights.counter
  if (chDen <= 0) return ZERO_DEMAND
  return {
    lambda,
    byChannel: {
      redbus: (lambda * weights.redbus) / chDen,
      abhibus: (lambda * weights.abhibus) / chDen,
      ownapp: (lambda * weights.ownapp) / chDen,
      counter: (lambda * weights.counter) / chDen,
    },
  }
}

/* ============================== hybrid coaches ============================== */

/**
 * Share of hybrid arrivals who want the rear cabin rather than a berth.
 * Derived from the same zone demand pull that sets each zone's target, so a
 * mid-haul hybrid (both zones sell at the same rate) splits arrivals 50/50.
 */
export function hybridCabinShare(hours = 10): number {
  const zone = hybridZoneFactors(hours)
  return clamp(zone.seater / (zone.sleeper + zone.seater), 0.18, 0.82)
}
