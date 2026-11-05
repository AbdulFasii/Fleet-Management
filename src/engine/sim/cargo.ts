/**
 * Cargo is a finite pool per city pair and direction, the same way passengers are.
 *
 * The parcel market for a lane is what the corridor's private buses carry in
 * their bellies (real departures x a typical load). Our parcel book follows
 * our share of those departures, scaled by the desk (manager, price,
 * punctuality); truck freight is a share of a separate gravity market. Departures draw their slot's weight of that
 * book and stop near a natural load — they do not keep loading until the bay is full.
 *
 * Contracts are one direction of one lane. Alias routes (Madurai–Chennai and
 * Chennai–Madurai) share a pool, so the same kilograms cannot be sold twice.
 */
import { BAL } from '../data/balance'
import { CITIES, cityFreightProfile } from '../data/cities'
import { isCargoModel } from '../data/busModels'
import { ROUTES, routeName, canonicalRouteId } from '../data/routes'
import { corridorSupply, realParcelKgPerDay } from '../data/corridorSupply'
import { FESTIVALS, dow, fmtDate, fromCivil, seasonInfo, toCivil, ymKey } from '../core/calendar'
import { rngFor, rChance, rJitter, rPick, type Rng } from '../core/rng'
import { nextId } from '../core/ids'
import { rs, fmtCompact } from '../core/money'
import type {
  CargoContract,
  CargoHaulLine,
  CargoLaneDay,
  CargoPoolState,
  CargoServicePermit,
  CargoCargoType,
  GameState,
  Money,
  Permit,
  RouteDef,
  Staff,
  SpotCargoOffer,
} from '../types'
import { corridorProfile, windowMass } from './corridor'
import { canAfford, routeDayFor, spend } from './finance'
import { pushLog } from './log'
import { cargoManagerOnDuty } from './staffing'
import { assistantsToCover, deskCapacity, deskCoverage } from './span'
import { tonnesText } from '../core/units'

export const CARGO_DENSITY: Record<CargoCargoType, number> = {
  hardware: 250,
  mixed: 167,
  agri: 140,
  textiles: 120,
  fmcg: 120,
}

export function chargeableKg(
  actualKg: number,
  volumeCbm: number,
  cargoType: CargoCargoType = 'mixed',
): number {
  const density = CARGO_DENSITY[cargoType] ?? 167
  const volumetricKg = Math.round(volumeCbm * density)
  return Math.max(actualKg, volumetricKg)
}

export function cargoEffSkill(s: GameState): number {
  const mgr = cargoManagerOnDuty(s)
  if (!mgr) return 0
  return mgr.skill * deskCoverage(s, 'cargo')
}

export function cargoFillRate(mgr: Staff | undefined, effSkill?: number): number {
  if (!mgr) return BAL.cargoManagerFillFloor
  const sk = effSkill ?? mgr.skill
  return Math.min(0.85, BAL.cargoManagerFillFloor + sk * BAL.cargoManagerFillPerSkill)
}

export function cargoRouteMult(km: number): number {
  if (km < 300) return BAL.cargoShortRouteMult
  if (km > 800) return BAL.cargoLongRouteMult
  return 1
}

/**
 * Pricing strategy multipliers:
 * - normal: matches normal rate (1.0x price, 1.0x fill)
 * - aggressive: 10% to 20% higher pricing (+15%), lower occupancy (~85%)
 * - discount: 5% to 15% lower pricing (-10%), higher occupancy (~115%)
 */
export function cargoPricingMult(s: GameState): { priceMult: number; fillMult: number } {
  const type = s.config?.cargoPricingType ?? 'normal'
  if (type === 'aggressive') return { priceMult: 1.15, fillMult: 0.92 }
  if (type === 'discount') return { priceMult: 0.90, fillMult: 1.08 }
  return { priceMult: 1.00, fillMult: 1.00 }
}

/** ₹ per kg for a full trip (before manager / jitter). Parcel / belly rate. */
export function cargoRatePerKg(s: GameState, km: number, hasManager: boolean): number {
  const rate = (parcelRatePerKg100Km(s) / 100) * cargoRouteMult(km) * (hasManager ? 1 : BAL.cargoNoManagerRatePenalty)
  return rate * km
}

/** Player parcel slider, ₹/kg per 100 km, after the pricing strategy. This is the spot / walk-up rate. */
export function parcelRatePerKg100Km(s: GameState): number {
  return (s.config?.cargoBaseRateRs ?? BAL.cargoBaseRateDefaultRs) * cargoPricingMult(s).priceMult
}

/** Dedicated-truck part-load rate, ₹/kg per 100 km. Bulk tonnage still carries a volume discount. */
export function truckRatePerKg100Km(s: GameState): number {
  const scaled = parcelRatePerKg100Km(s) * BAL.cargoTruckRateVsParcel
  return Math.min(BAL.cargoTruckRateCapRs, Math.max(0.2, scaled))
}

/** Posted rate a bucket bills at before the contract discount. */
function bucketListRatePerKg100Km(s: GameState, bucket: 'parcel' | 'bulk'): number {
  return bucket === 'bulk' ? truckRatePerKg100Km(s) : parcelRatePerKg100Km(s)
}

/** Stored contract rates from older saves are pulled into this bucket's contract band. */
export function effectiveContractRatePerKg100Km(
  s: GameState,
  stored: number,
  bucket: 'parcel' | 'bulk' = 'parcel',
): number {
  const list = bucketListRatePerKg100Km(s, bucket)
  const hi = list * BAL.cargoContractRateHi
  const lo = list * BAL.cargoContractRateLo
  if (!Number.isFinite(stored) || stored <= 0) return hi
  return Math.min(hi, Math.max(lo, Math.min(stored, hi)))
}

/** Rupees (not paise) for hauled kilograms at a ₹/kg/100 km rate. */
export function cargoFreightRupees(kg: number, km: number, ratePerKg100Km: number, routeMult = 1): number {
  return kg * km * (ratePerKg100Km / 100) * routeMult
}

export function cargoOriginId(route: RouteDef, direction: 'AB' | 'BA'): string {
  return direction === 'AB' ? route.from : route.to
}

export function cargoDestId(route: RouteDef, direction: 'AB' | 'BA'): string {
  return direction === 'AB' ? route.to : route.from
}

/** Physical direction. `mdu-maa` AB and `maa-mdu` BA are both `mdu>maa`. */
export function cargoLaneKey(route: RouteDef, direction: 'AB' | 'BA'): string {
  const o = cargoOriginId(route, direction)
  const d = cargoDestId(route, direction)
  const canon = canonicalRouteId(route.id)
  // Path variants share endpoints with another corridor — keep freight pools distinct.
  if (canon.split('-').length > 2) return `${canon}:${o}>${d}`
  return `${o}>${d}`
}

export function cargoLegLabel(route: RouteDef, direction: 'AB' | 'BA'): string {
  const o = CITIES[cargoOriginId(route, direction)]?.name ?? cargoOriginId(route, direction)
  const d = CITIES[cargoDestId(route, direction)]?.name ?? cargoDestId(route, direction)
  return `${o} → ${d}`
}

export function cargoCorridorLabel(route: RouteDef): string {
  const o = CITIES[route.from]?.name ?? route.from
  const d = CITIES[route.to]?.name ?? route.to
  return `${o} ⇄ ${d}`
}

/** Directional freight imbalance ratio between origin→dest vs dest→origin. */
export function cargoLaneImbalance(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  day: number = s.day,
): number {
  const fwd = corridorCargoMarketKg(s, route, direction, day)
  const revDir: 'AB' | 'BA' = direction === 'AB' ? 'BA' : 'AB'
  const rev = corridorCargoMarketKg(s, route, revDir, day)
  const fwdTotal = fwd.parcelMarketKg + fwd.bulkMarketKg
  const revTotal = rev.parcelMarketKg + rev.bulkMarketKg
  return Math.round((fwdTotal / Math.max(1, revTotal)) * 100) / 100
}

/** Going ₹/kg per 100 km on this origin → dest today, incorporating directional imbalance. */
export function cargoGoingRateRs(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  day: number = s.day,
): number {
  const key = cargoLaneKey(route, direction)
  const sticky = 0.78 + rngFor(s.seed, 'cargo-mkt', key)() * 0.52
  const daily = 0.86 + rngFor(s.seed, 'cargo-mkt-day', key, day)() * 0.32
  const kmAdj = 0.92 + 0.08 * cargoRouteMult(route.km)

  // Imbalance premium (headhaul) / discount (backhaul)
  const imb = cargoLaneImbalance(s, route, direction, day)
  const headhaulThreshold = BAL.cargoImbalanceHeadhaul ?? 1.25
  const backhaulThreshold = BAL.cargoImbalanceBackhaul ?? 0.80
  const imbMult = imb > headhaulThreshold
    ? Math.min(1.35, 1 + (imb - headhaulThreshold) * 0.35)
    : imb < backhaulThreshold
    ? Math.max(0.70, 0.75 + 0.25 * (imb / backhaulThreshold))
    : 1.0

  return BAL.cargoBaseRateDefaultRs * sticky * daily * kmAdj * imbMult
}

/** How hard this lane shrugs off a price change. Thin reverse flows are pickier. */
function cargoLaneElasticity(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  day: number,
): number {
  const flow = cargoLaneMult(s, route, direction, day)
  const hunger = 0.48 + 0.85 / (0.35 + flow)
  const wobble = 0.88 + rngFor(s.seed, 'cargo-el', cargoLaneKey(route, direction), day)() * 0.28
  return BAL.cargoPriceElasticity * hunger * wobble
}

/** Posted rate vs this lane's going rate. Elasticity + pricing strategy factor. */
export function cargoPriceFillMult(
  s: GameState,
  route?: RouteDef,
  direction: 'AB' | 'BA' = 'AB',
  day: number = s.day,
): number {
  const { priceMult, fillMult } = cargoPricingMult(s)
  const base = s.config?.cargoBaseRateRs ?? BAL.cargoBaseRateDefaultRs
  const ours = Math.max(0.25, base * priceMult)
  const market = route
    ? cargoGoingRateRs(s, route, direction, day)
    : BAL.cargoBaseRateDefaultRs * (0.88 + rngFor(s.seed, 'cargo-mkt-day', 'fleet', day)() * 0.28)
  const el = route
    ? cargoLaneElasticity(s, route, direction, day)
    : BAL.cargoPriceElasticity
  const m = (market / ours) ** el
  if (!Number.isFinite(m) || m <= 0) return fillMult
  return m * fillMult
}

export function companyCargoFillRate(s: GameState): number {
  const { fillMult } = cargoPricingMult(s)
  return Math.min(1, cargoFillRate(cargoManagerOnDuty(s), cargoEffSkill(s)) * fillMult)
}

/** How hard this city ships parcels (metro desks + a sticky per-save wobble). */
function cargoCityBase(s: GameState, cityId: string): number {
  const metro = CITIES[cityId]?.metro ?? 0.3
  const sticky = 0.88 + rngFor(s.seed, 'cargo-city', cityId)() * 0.24
  return (0.12 + metro * 1.85) * sticky
}

/** City desks have good days and quiet days — every origin moves together. */
function cargoCityDaily(s: GameState, cityId: string, day: number): number {
  return 0.82 + rngFor(s.seed, 'cargo-city-day', cityId, day)() * 0.36
}

/**
 * Metro origins ship more than a small city. Each physical direction leans
 * one way for the life of the save, independent of which route id is stored.
 */
export function cargoDirectionMult(s: GameState, route: RouteDef, direction: 'AB' | 'BA'): number {
  const originId = cargoOriginId(route, direction)
  const destId = cargoDestId(route, direction)
  const destMetro = CITIES[destId]?.metro ?? 0.3
  const inbound = 0.88 + destMetro * 0.22
  const lean = rngFor(s.seed, 'cargo-lean', cargoLaneKey(route, direction))() * 2 - 1
  return cargoCityBase(s, originId) * inbound * (1 + 0.16 * lean)
}

/** Daily shock for this physical lane, on top of the origin city's day. */
export function cargoDailyMult(s: GameState, route: RouteDef, direction: 'AB' | 'BA', day: number): number {
  const originDay = cargoCityDaily(s, cargoOriginId(route, direction), day)
  const lane = 0.88 + rngFor(s.seed, 'cargo-flow', cargoLaneKey(route, direction), day)() * 0.24
  return originDay * lane
}

export function cargoLaneMult(s: GameState, route: RouteDef, direction: 'AB' | 'BA', day: number): number {
  return cargoDirectionMult(s, route, direction) * cargoDailyMult(s, route, direction, day)
}

export function cargoDowMult(day: number): number {
  return BAL.cargoDowMult[dow(day)] ?? 1
}

/**
 * Parcels around a festival: shops restock, families send gifts and textiles
 * move in the weeks before (bigger festivals lift more), then markets shut on
 * the day itself and stay slow for a couple of days after.
 */
const cargoFestCache = new Map<number, number>()

export function cargoFestivalMult(day: number): number {
  const hit = cargoFestCache.get(day)
  if (hit !== undefined) return hit
  const m = computeCargoFestivalMult(day)
  if (cargoFestCache.size > 2048) cargoFestCache.clear()
  cargoFestCache.set(day, m)
  return m
}

function computeCargoFestivalMult(day: number): number {
  const cf = BAL.cargoFestival
  const c = toCivil(day)
  let lift = 0
  let drop = 1
  for (const f of FESTIVALS) {
    for (const yy of [c.y - 1, c.y, c.y + 1]) {
      const until = fromCivil(yy, f.month, f.day) - day // days until the festival date
      const k = Math.min(1, Math.max(0, (f.peak - 1.35) / 1.45))
      const peakLift = cf.liftMin + (cf.liftMax - cf.liftMin) * k
      if (until >= 1 && until <= cf.leadDays) {
        const ramp = until <= cf.fullLiftDays ? 1 : (cf.leadDays - until) / (cf.leadDays - cf.fullLiftDays)
        lift = Math.max(lift, peakLift * ramp)
      } else if (until === 0) {
        drop = Math.min(drop, cf.dayOf)
      } else if (until < 0 && -until <= cf.afterDays) {
        drop = Math.min(drop, cf.after)
      }
    }
  }
  return drop < 1 ? drop : 1 + lift
}

export function cargoSeasonMult(day: number): number {
  const season = seasonInfo(day)
  let m = 1
  if (season.weatherRisk > 0) m *= 0.82
  else m *= season.demand > 1 ? 0.96 : 1
  return m * cargoFestivalMult(day)
}

function brandShare(mgr: Staff | undefined, effSkill?: number): number {
  if (!mgr) return BAL.cargoNoManagerShare
  const sk = effSkill ?? mgr.skill
  return BAL.cargoMarketShare * (0.45 + 0.55 * (sk / 10))
}

function cargoMixMult(s: GameState): number {
  const cat = s.company.cargoCargoType ?? 'mixed'
  if (cat === 'hardware') return 1.15
  if (cat === 'agri') return 1.08
  if (cat === 'fmcg') return 1.05
  if (cat === 'textiles') return 0.90
  return 1.0
}

/**
 * Which way this lane's parcels lean: origin shipping strength times the
 * destination's pull, against the average of both directions (mean 1).
 */
function parcelDirectionLean(route: RouteDef, direction: 'AB' | 'BA'): number {
  const o = cityFreightProfile(cargoOriginId(route, direction))
  const d = cityFreightProfile(cargoDestId(route, direction))
  const fwd = o.shipIndex * d.attractIndex
  const rev = d.shipIndex * o.attractIndex
  const mean = (fwd + rev) / 2
  return mean > 0 ? fwd / mean : 1
}

/**
 * Kilograms the corridor ships today. Parcels ride in the bellies of the
 * corridor's private buses, so the parcel market is the real departure count
 * times a typical belly load (data/corridorSupply), leaned by which city
 * ships harder. Truck freight still follows the city gravity model and exists
 * only while the dedicated cargo subsidiary is active.
 */
export function corridorCargoMarketKg(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  day: number,
): { parcelMarketKg: number; bulkMarketKg: number } {
  const originProfile = cityFreightProfile(cargoOriginId(route, direction))
  const destProfile = cityFreightProfile(cargoDestId(route, direction))

  const km = Math.max(80, route.km)
  const bulkDistMult = km < 300 ? 0.65 : km <= 800 ? 1.20 : 0.90

  const dowM = cargoDowMult(day)
  const seasonM = cargoSeasonMult(day)
  const corpGrowth = corporateYearInfo(s).mult
  const mixM = cargoMixMult(s)

  const key = cargoLaneKey(route, direction)
  const dailyJitter = 0.88 + rngFor(s.seed, 'cargo-mkt-day', key, day)() * 0.24
  const daily = dowM * seasonM * corpGrowth * mixM * dailyJitter

  const parcelMarketKg = Math.max(30, Math.round(realParcelKgPerDay(route.id) * parcelDirectionLean(route, direction) * daily))

  let bulkMarketKg = 0
  if (s.company.dedicatedCargoSubsidiary) {
    // Gravity formula: K * ship * attract * distDecay * daily factors
    const distBaseDecay = Math.pow(500 / Math.max(150, km), 0.35)
    const parcelDistMult = km < 300 ? (BAL.cargoShortRouteMult ?? 1.5) : km > 800 ? (BAL.cargoLongRouteMult ?? 0.8) : 1.0
    const parcelRatio = Math.max(0.10, Math.min(0.65, 0.25 * parcelDistMult))
    const gravityKg = (BAL.cargoGravityK ?? 16_000) * originProfile.shipIndex * destProfile.attractIndex * distBaseDecay * daily
    bulkMarketKg = Math.max(0, Math.round(Math.max(80, gravityKg) * (1 - parcelRatio) * bulkDistMult))
  }

  return { parcelMarketKg, bulkMarketKg }
}

/**
 * Our daily departures on this corridor (each direction). One active,
 * year-round schedule runs one departure each way a day; festival-only
 * services are left out.
 */
export function ourCorridorDeparturesPerDay(s: GameState, route: RouteDef): number {
  const canon = canonicalRouteId(route.id)
  let n = 0
  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.active || sch.festivalOnly || sch.busIds.length === 0) continue
    if (canonicalRouteId(sch.routeId) === canon) n++
  }
  return n
}

/**
 * Kilograms our desk can actually book on this lane today. Never larger than the market.
 *
 * Parcels: each departure's booking counters bring in their own shippers, so
 * our share of the parcel market is our share of the corridor's departures,
 * scaled by how well the desk sells (manager, posted rate, punctuality).
 * Trucks: a share of the freight book, as before.
 */
export function cargoBookKg(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  day: number,
): { parcelBookKg: number; bulkBookKg: number } {
  const market = corridorCargoMarketKg(s, route, direction, day)
  const price = cargoPriceFillMult(s, route, direction, day)
  const damp = Math.max(0.35, 1 - BAL.cargoShareCompetitionDamp * route.competition)
  const bonus = s.company.dedicatedCargoSubsidiary ? (1 + BAL.cargoSubsidiaryShareBonus) : 1
  const mgr = cargoManagerOnDuty(s)
  const fillEff = cargoFillRate(mgr, cargoEffSkill(s))
  // Shippers favour carriers that arrive on time; a bandh/flood on the lane shuts most bookings.
  const reliability = Math.max(0.7, Math.min(1.1, 0.8 + 0.4 * (s.company.punctuality - 0.5)))
  const closure = s.world.closures?.[route.id]
  const closureMult = closure && closure.untilDay >= day ? 0.4 : 1
  const desk = brandShare(mgr, cargoEffSkill(s)) * (0.55 + fillEff * 0.45)

  const ours = ourCorridorDeparturesPerDay(s, route)
  const theirs = corridorSupply(route.id).departures
  const depShare = ours / Math.max(1, ours + theirs)
  const deskSell = (desk / BAL.cargoMarketShare) * BAL.cargoParcelCaptureScale
  const parcelCapture = Math.min(0.85, depShare * deskSell * price * bonus * reliability * closureMult)

  const bulkCapture = Math.min(0.85, Math.max(0.04, desk * price * damp * bonus * reliability * closureMult))
  const adHoc = BAL.cargoAdHocParcelMult ?? 1
  return {
    // Walk-in + spot parcels share this book; scale ad-hoc volume without touching bulk trucks.
    parcelBookKg: Math.round(market.parcelMarketKg * parcelCapture * adHoc),
    bulkBookKg: Math.round(market.bulkMarketKg * bulkCapture),
  }
}

/** Mean book over the trailing week, including today. Contracts are sized from this, not from one hot day. */
export function averageBookKg(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  days = 7,
): { parcel: number; bulk: number } {
  let parcel = 0
  let bulk = 0
  const n = Math.max(1, days)
  for (let i = 0; i < n; i++) {
    const book = cargoBookKg(s, route, direction, dayOffset(s, i))
    parcel += book.parcelBookKg
    bulk += book.bulkBookKg
  }
  return { parcel: parcel / n, bulk: bulk / n }
}

function dayOffset(s: GameState, ago: number): number {
  return s.day - ago
}

/* ============================ lane history ============================ */

export function emptyCargoLaneDay(): CargoLaneDay {
  return {
    trips: 0,
    cargoOnlyTrips: 0,
    kg: 0,
    cargoOnlyKg: 0,
    capKg: 0,
    marketKg: 0,
    bookKg: 0,
    revenue: 0,
    contractKg: 0,
    spotKg: 0,
    walkupKg: 0,
    contractRevenue: 0,
    spotRevenue: 0,
    walkupRevenue: 0,
    loading: 0,
    unloading: 0,
    liability: 0,
    shortfall: 0,
    fuel: 0,
    toll: 0,
    bata: 0,
  }
}

const CARGO_LANE_ADD = [
  'trips', 'cargoOnlyTrips', 'kg', 'cargoOnlyKg', 'capKg', 'revenue',
  'contractKg', 'spotKg', 'walkupKg', 'contractRevenue', 'spotRevenue', 'walkupRevenue',
  'loading', 'unloading', 'liability', 'shortfall', 'fuel', 'toll', 'bata',
] as const

/** Add one departure (or a shortfall) onto the corridor's kept daily history. */
export function recordCargoLane(
  s: GameState,
  routeId: string,
  direction: 'AB' | 'BA',
  day: number,
  patch: Partial<CargoLaneDay>,
): void {
  const row = routeDayFor(s, routeId, day)
  if (!row.cargo) row.cargo = {}
  const lane = (row.cargo[direction] ??= emptyCargoLaneDay())
  if (patch.marketKg) lane.marketKg = patch.marketKg
  if (patch.bookKg) lane.bookKg = patch.bookKg
  for (const key of CARGO_LANE_ADD) {
    const v = patch[key]
    if (typeof v === 'number' && v) lane[key] += v
  }
}

/* ============================ contracts ============================ */

export type CargoContractTier = 'local' | 'mid' | 'enterprise'

export function getContractTier(bucket: 'parcel' | 'bulk', kg: number): CargoContractTier {
  if (bucket === 'parcel') {
    if (kg < 200) return 'local'
    if (kg < 600) return 'mid'
    return 'enterprise'
  } else {
    if (kg < 800) return 'local'
    if (kg < 2000) return 'mid'
    return 'enterprise'
  }
}

export const LOCAL_PARCEL_PARTNERS = [
  'Coimbatore Textile Traders',
  'Tirupur Knitwear Consignment',
  'Madurai Jasmine & Agri Hub',
  'Madurai Sungudi Silks',
  'Chennai Hardware & Electricals',
  'George Town Traders',
  'Parrys Wholesale Stationers',
  'Salem Sago & Steel Fabricators',
  'Erode Turmeric & Spice Market',
  'Trichy Small Scale Ancillaries',
  'Cauvery Delta Agri Traders',
  'Tamil Nadu Regional Logistics',
]

export const MID_PARCEL_PARTNERS = [
  'DTDC Express',
  'Blue Dart Express',
  'Delhivery (DTH Express)',
  'The Professional Couriers (TPC)',
  'Trackon Couriers',
]

export const MEGA_PARCEL_PARTNERS = [
  'Amazon Logistics (Amazon ATS)',
  'Flipkart (Ekart Logistics)',
  'Meesho Mega Supply',
  'Reliance Retail Logistics',
  'Tata 1mg / BigBasket B2B',
]

export const LOCAL_BULK_PARTNERS = [
  'Kongu Spinning & Weaving Mills',
  'Salem Industrial Foundries',
  'Madurai Agro Wholesale Mandi',
  'Erode Industrial Powerloom',
  'Trichy Heavy Engineering Works',
  'Tamil Nadu Pulp & Paper Lot',
]

export const MID_BULK_PARTNERS = [
  'TVS Supply Chain',
  'Safechem Logistics',
  'V-Trans Logistics',
  'GATI-KWE Bulk Express',
  'TCI Freight Logistics',
]

export const MEGA_BULK_PARTNERS = [
  'Amazon Freight National Bulk',
  'Flipkart Wholesale Fulfilment',
  'Meesho Fulfilment Centers',
  'Reliance Logistics Park',
  'ITC FMCG National Distribution',
]

export const COURIER_PARTNERS: string[] = [
  ...LOCAL_PARCEL_PARTNERS,
  ...MID_PARCEL_PARTNERS,
  ...MEGA_PARCEL_PARTNERS,
  'DTDC',
  'Delhivery',
  'Blue Dart',
]

export const BULK_LOGISTICS_PARTNERS: string[] = [
  ...LOCAL_BULK_PARTNERS,
  ...MID_BULK_PARTNERS,
  ...MEGA_BULK_PARTNERS,
  'TVS Supply Chain',
  'Safechem Logistics',
  'Amazon Freight',
  'V-Trans Logistics',
]

export type CargoProposal = Omit<CargoContract, 'id' | 'active' | 'startDay' | 'expiresDay'>

export function contractBucket(partner: string): 'parcel' | 'bulk' {
  if (BULK_LOGISTICS_PARTNERS.includes(partner)) return 'bulk'
  const lower = partner.toLowerCase()
  if (
    lower.includes('bulk') ||
    lower.includes('freight') ||
    lower.includes('wholesale') ||
    lower.includes('mills') ||
    lower.includes('foundr') ||
    lower.includes('engineering') ||
    lower.includes('powerloom') ||
    lower.includes('paper')
  ) {
    return 'bulk'
  }
  return 'parcel'
}

export function pickContractPartner(
  rng: Rng,
  tier: CargoContractTier,
  bucket: 'parcel' | 'bulk',
  route: RouteDef,
  usedNames: Set<string>,
): string {
  let candidates: string[] = []

  if (bucket === 'parcel') {
    if (tier === 'local') {
      const touches = (cityId: string) => route.from === cityId || route.to === cityId
      if (touches('cbe')) {
        candidates = ['Tirupur Knitwear Consignment', 'Coimbatore Textile Traders', 'Tamil Nadu Regional Logistics']
      } else if (touches('mdu')) {
        candidates = ['Madurai Jasmine & Agri Hub', 'Madurai Sungudi Silks', 'Tamil Nadu Regional Logistics']
      } else if (touches('maa')) {
        candidates = ['Chennai Hardware & Electricals', 'George Town Traders', 'Parrys Wholesale Stationers']
      } else if (touches('slm')) {
        candidates = ['Salem Sago & Steel Fabricators', 'Tamil Nadu Regional Logistics']
      } else if (touches('erd')) {
        candidates = ['Erode Turmeric & Spice Market', 'Coimbatore Textile Traders']
      } else if (touches('trj')) {
        candidates = ['Trichy Small Scale Ancillaries', 'Cauvery Delta Agri Traders']
      } else {
        candidates = LOCAL_PARCEL_PARTNERS
      }
    } else if (tier === 'mid') {
      candidates = MID_PARCEL_PARTNERS
    } else {
      candidates = MEGA_PARCEL_PARTNERS
    }
  } else {
    if (tier === 'local') {
      candidates = LOCAL_BULK_PARTNERS
    } else if (tier === 'mid') {
      candidates = MID_BULK_PARTNERS
    } else {
      candidates = MEGA_BULK_PARTNERS
    }
  }

  const available = candidates.filter((n) => !usedNames.has(n))
  if (available.length > 0) {
    return rPick(rng, available)
  }
  return rPick(rng, candidates)
}

function activePermitRoutes(s: GameState): RouteDef[] {
  return Object.values(s.permits)
    .filter((p) => p.status === 'active')
    .map((p) => ROUTES[p.routeId])
    .filter((r): r is RouteDef => Boolean(r))
}

export interface CargoLaneRef {
  route: RouteDef
  direction: 'AB' | 'BA'
  laneKey: string
}

/** One entry per physical direction, even if both route ids are permitted. */
export function cargoLanesForPermits(s: GameState): CargoLaneRef[] {
  const seen = new Set<string>()
  const out: CargoLaneRef[] = []
  for (const route of activePermitRoutes(s)) {
    for (const direction of ['AB', 'BA'] as const) {
      const laneKey = cargoLaneKey(route, direction)
      if (seen.has(laneKey)) continue
      seen.add(laneKey)
      out.push({ route, direction, laneKey })
    }
  }
  return out
}

export function findRouteDef(routeId: string): RouteDef | undefined {
  const direct = ROUTES[routeId]
  if (direct) return direct
  const canon = canonicalRouteId(routeId)
  if (ROUTES[canon]) return ROUTES[canon]
  const parts = routeId.split('-')
  if (parts.length === 2) {
    return ROUTES[`${parts[1]}-${parts[0]}`]
  }
  return undefined
}

/** Every permit record whose route id aliases to the same corridor. */
function permitsMatchingRoute(s: GameState, routeId: string): Permit[] {
  const canon = canonicalRouteId(routeId)
  return Object.values(s.permits).filter((p) => canonicalRouteId(p.routeId) === canon)
}

function permitCoversRoute(s: GameState, routeId: string): boolean {
  return permitsMatchingRoute(s, routeId).some((p) => p.status === 'active')
}

/* ========================= cargo service licence ========================= */

/** Physical corridor key, so Madurai–Chennai and Chennai–Madurai count as one. */
function corridorKey(routeId: string): string {
  return canonicalRouteId(routeId)
}

/** Annual goods licence price: fixed RTO slab plus a distance charge. */
export function cargoPermitFee(route: RouteDef, opts: { renewal?: boolean } = {}): Money {
  const full = BAL.cargoPermitBaseFee + Math.round(BAL.cargoPermitPerKmFee * route.km)
  return opts.renewal ? Math.round(full * BAL.cargoPermitRenewalPct) : full
}

/** The permit record that carries this corridor's cargo licence, if any. */
function cargoPermitHolder(s: GameState, routeId: string): Permit | undefined {
  return permitsMatchingRoute(s, routeId).find((p) => p.cargo)
}

/** Live cargo licence on this corridor (either direction's permit). */
export function cargoPermitActive(s: GameState, routeId: string): boolean {
  const cargo = cargoPermitHolder(s, routeId)?.cargo
  return Boolean(cargo && cargo.status === 'active' && s.day <= cargo.expiryDay)
}

/** The licence record itself, resolved through corridor aliases. */
export function cargoLicence(s: GameState, routeId: string): CargoServicePermit | undefined {
  return cargoPermitHolder(s, routeId)?.cargo
}

/** Lanes the desk may solicit freight contracts on: passenger permit + cargo licence. */
export function cargoContractLanes(s: GameState): CargoLaneRef[] {
  return cargoLanesForPermits(s).filter((lane) => cargoPermitActive(s, lane.route.id))
}

/** End every live contract on a corridor (both directions). Returns how many closed. */
export function terminateCargoContractsOnRoute(s: GameState, routeId: string): number {
  const key = corridorKey(routeId)
  let closed = 0
  for (const c of s.company.cargoContracts ?? []) {
    if (!c.active) continue
    if (corridorKey(c.routeId) !== key) continue
    c.active = false
    closed++
  }
  return closed
}

/** Live contracts on a corridor, either direction, ignoring route aliases. */
export function cargoContractsOnCorridor(s: GameState, routeId: string): CargoContract[] {
  const key = corridorKey(routeId)
  return (s.company.cargoContracts ?? []).filter((c) => c.active && corridorKey(c.routeId) === key)
}

/**
 * Buy the annual cargo licence on a corridor. Freight contracts are invited
 * only here — the passenger permit alone no longer wins courier deals.
 */
export function openCargoPermit(s: GameState, routeId: string): string | null {
  const route = findRouteDef(routeId)
  if (!route) return 'Unknown route.'
  const permit = permitsMatchingRoute(s, route.id).find((p) => p.status === 'active')
  if (!permit) return 'Hold the passenger permit on this corridor first.'
  if (cargoPermitActive(s, route.id)) return 'This corridor already holds a cargo licence.'
  const fee = cargoPermitFee(route)
  if (!canAfford(s, fee)) return `Cargo licence costs ${fmtCompact(fee)} a year.`
  spend(s, 'permit_tax', fee, { routeId: route.id, note: 'cargo service licence' })
  permit.cargo = {
    status: 'active',
    appliedDay: s.day,
    activeFromDay: s.day,
    expiryDay: s.day + BAL.cargoPermitTermDays,
    feePaid: fee,
  }
  pushLog(
    s,
    'good',
    `Cargo licence granted on ${routeName(route.id)} for ${fmtCompact(fee)} a year — courier and bulk contracts can now be invited both ways.`,
  )
  return null
}

export function renewCargoPermit(s: GameState, routeId: string): string | null {
  const route = findRouteDef(routeId)
  if (!route) return 'Unknown route.'
  const cargo = cargoPermitHolder(s, route.id)?.cargo
  if (!cargo) return 'No cargo licence on this corridor.'
  const fee = cargoPermitFee(route, { renewal: true })
  if (!canAfford(s, fee)) return `Cargo licence renewal costs ${fmtCompact(fee)}.`
  spend(s, 'permit_tax', fee, { routeId: route.id, note: 'cargo service licence renewal' })
  cargo.status = 'active'
  cargo.activeFromDay = s.day
  cargo.expiryDay = s.day + BAL.cargoPermitTermDays
  cargo.feePaid = fee
  pushLog(s, 'good', `Cargo licence renewed on ${routeName(route.id)} until ${fmtDate(cargo.expiryDay)} (${fmtCompact(fee)}).`)
  return null
}

/** Surrender the licence. Live contracts on the corridor end with it. */
export function closeCargoPermit(s: GameState, routeId: string): string | null {
  const route = findRouteDef(routeId)
  const targetId = route ? route.id : routeId
  const holder = cargoPermitHolder(s, targetId)
  if (!holder?.cargo) return 'No cargo licence on this corridor.'
  delete holder.cargo
  const closed = terminateCargoContractsOnRoute(s, targetId)
  pushLog(
    s,
    'alert',
    `Cargo licence surrendered on ${routeName(targetId)}${closed ? ` — ${closed} contract(s) closed` : ''}. No new freight invites until you licence the corridor again.`,
  )
  return null
}

/** Daily: auto-renew near expiry, lapse the rest and close their contracts. */
export function cargoPermitPass(s: GameState): void {
  for (const permit of Object.values(s.permits)) {
    const cargo = permit.cargo
    if (!cargo) continue
    const route = ROUTES[permit.routeId]
    if (!route) {
      delete permit.cargo
      continue
    }
    if (cargo.status !== 'active') continue
    const left = cargo.expiryDay - s.day
    if (left <= 0) {
      cargo.status = 'lapsed'
      const closed = terminateCargoContractsOnRoute(s, permit.routeId)
      pushLog(
        s,
        'alert',
        `Cargo licence EXPIRED on ${routeName(permit.routeId)}${closed ? ` — ${closed} contract(s) closed` : ''}. Renew it from Routes to take new freight.`,
      )
      continue
    }
    if (left > BAL.cargoPermitRenewLeadDays) continue
    if (s.config?.autoRenewDocs === false) continue
    const fee = cargoPermitFee(route, { renewal: true })
    if (!canAfford(s, fee)) continue
    spend(s, 'permit_tax', fee, { routeId: permit.routeId, note: 'cargo service licence renewal' })
    cargo.activeFromDay = s.day
    cargo.expiryDay = s.day + BAL.cargoPermitTermDays
    cargo.feePaid = fee
    pushLog(s, 'info', `Cargo licence renewed on ${routeName(permit.routeId)} until ${fmtDate(cargo.expiryDay)} (${fmtCompact(fee)}).`)
  }
}

export function liveContracts(s: GameState): CargoContract[] {
  return (s.company.cargoContracts ?? []).filter((c) => c.active && s.day <= c.expiresDay)
}

/**
 * Contract rate: a shade under the posted rate for this bucket, better with a
 * sharper manager. Parcels sit just below the base rate; bulk lots below the
 * truck part-load rate.
 */
function quoteContractRate(s: GameState, rng: Rng, mgr: Staff, bucket: 'parcel' | 'bulk'): number {
  const list = bucketListRatePerKg100Km(s, bucket)
  const lo = BAL.cargoContractRateLo
  const hi = BAL.cargoContractRateHi
  const skillT = Math.max(0, Math.min(1, (mgr.skill - 1) / 9))
  const wobble = 0.98 + rng() * 0.04
  const mult = Math.min(hi, lo + (hi - lo) * (0.25 + 0.75 * skillT) * wobble)
  return Math.round(list * mult * 100) / 100
}

/**
 * Calculates annual corporate offer capacity growth rate for a given operational year.
 * Fluctuates dynamically between -10% (-0.10) and +20% (+0.20) based on annual profitability vs losses.
 * - Profitable operations open up possibility of expansion (+1% up to +20%).
 * - Business losses cause client contraction (-10% up to +3%).
 */
export function calcAnnualCorporateGrowthRate(s: GameState, yearIndex: number): number {
  const rng = rngFor(s.seed, 'corp-annual-capacity', yearIndex)
  const rand = rng() // [0, 1)

  // Prior operational year P&L from historical months
  const startMonthIdx = Math.max(0, (yearIndex - 1) * 12)
  const endMonthIdx = yearIndex * 12
  const priorYearMonths = (s.monthly ?? []).slice(startMonthIdx, endMonthIdx)

  let priorYearProfit = 0
  if (priorYearMonths.length > 0) {
    priorYearProfit = priorYearMonths.reduce((acc, m) => acc + (m.profit ?? 0), 0)
  } else {
    // Fallback if fewer than 12 historical months archived (e.g. testing or fast-forward)
    priorYearProfit = s.company?.fyProfit ?? s.curMonth?.profit ?? 0
  }

  let rate: number
  if (priorYearProfit > 0) {
    // Profitable operations: positive expansion between +1% and +20%
    const profitScale = Math.min(1, priorYearProfit / 10_00_000) // maxed at ₹10L annual profit
    rate = 0.01 + 0.09 * profitScale + rand * (0.10 - 0.01 * (1 - profitScale))
  } else {
    // Business losses: contraction down to -10%, with poor market possibility up to +3%
    const lossScale = Math.min(1, Math.abs(priorYearProfit) / 5_00_000) // maxed at ₹5L loss
    rate = -0.10 + (1 - lossScale) * 0.07 + rand * 0.06
  }

  // Hard clamp strictly within [-10%, +20%]
  rate = Math.max(BAL.cargoCorporateOfferGrowthMinPct ?? -0.10, Math.min(BAL.cargoCorporateOfferGrowthMaxPct ?? 0.20, rate))
  return Math.round(rate * 1000) / 1000 // 3 decimal places e.g. +0.145 (+14.5%)
}

/**
 * Annual compound multiplier for corporate offer capacity:
 * Increases or contracts dynamically by -10% to +20% each operational year.
 * Year 1 (day 0..364): 1.00x (+0% base)
 * Subsequent years compound the annual rate based on profit vs loss performance.
 */
export function corporateOfferCapacityMult(s: GameState): number {
  const start = s.startDay ?? 0
  const years = Math.max(0, Math.floor((s.day - start) / 365))
  if (years === 0) return 1.0

  let mult = 1.0
  const recorded = s.company?.corporateAnnualRates ?? []
  for (let y = 1; y <= years; y++) {
    const rate = recorded[y - 1] ?? calcAnnualCorporateGrowthRate(s, y)
    mult *= (1 + rate)
  }
  return Math.max(0.5, Math.min(3.5, mult))
}

export interface CorporateYearInfo {
  yearIndex: number
  mult: number
  pctBonus: number
  latestYearRate: number
  latestYearPct: number
  profitable: boolean
}

/** Active operational year number and annual growth info for corporate tenders. */
export function corporateYearInfo(s: GameState): CorporateYearInfo {
  const start = s.startDay ?? 0
  const years = Math.max(0, Math.floor((s.day - start) / 365))
  const mult = corporateOfferCapacityMult(s)
  const recorded = s.company?.corporateAnnualRates ?? []
  const latestYearRate = years > 0 ? (recorded[years - 1] ?? calcAnnualCorporateGrowthRate(s, years)) : 0
  const priorProfit = s.company?.fyProfit ?? s.curMonth?.profit ?? 0
  return {
    yearIndex: years + 1,
    mult,
    pctBonus: Math.round((mult - 1) * 100),
    latestYearRate,
    latestYearPct: Math.round(latestYearRate * 100),
    profitable: priorProfit >= 0,
  }
}

/** A lane should not promise more freight than its departures can physically lift. */
export function contractDailyCapKg(s: GameState, bucket: 'parcel' | 'bulk'): number {
  const base = bucket === 'bulk' ? BAL.cargoContractDailyCapBulkKg : BAL.cargoContractDailyCapParcelKg
  return Math.round(base * corporateOfferCapacityMult(s))
}

/** Directional proposals that still fit the lane's contract cap. Contracts are a subsidiary product. */
export function getAvailableContracts(s: GameState): CargoProposal[] {
  if (!s.company.dedicatedCargoSubsidiary) return []
  const mgr = cargoManagerOnDuty(s)
  if (!mgr) return []
  // Only corridors that paid for the annual cargo licence get invites.
  const allLanes = cargoContractLanes(s)
  if (allLanes.length === 0) return []

  const cap = Math.floor(deskCapacity(s, 'cargo'))
  const laneFreights = new Map<string, number>()
  for (const l of allLanes) {
    const avg = averageBookKg(s, l.route, l.direction)
    laneFreights.set(l.laneKey, (avg.parcel || 0) + (avg.bulk || 0))
  }
  allLanes.sort((a, b) => (laneFreights.get(b.laneKey) ?? 0) - (laneFreights.get(a.laneKey) ?? 0))
  const lanes = allLanes.slice(0, cap)

  const list: CargoProposal[] = []
  const isDedicated = Boolean(s.company.dedicatedCargoSubsidiary)
  const offerChance = isDedicated ? 0.8 : 0.6
  const curMonth = Math.floor(s.day / 30)
  const live = liveContracts(s)
  const corpMult = corporateOfferCapacityMult(s)

  for (const lane of lanes) {
    const avg = averageBookKg(s, lane.route, lane.direction)
    const buckets: ('parcel' | 'bulk')[] = ['parcel', 'bulk']
    for (const bucket of buckets) {
      const book = bucket === 'bulk' ? avg.bulk : avg.parcel
      const minLot = bucket === 'bulk' ? 400 : 40
      const step = bucket === 'bulk' ? 50 : 10
      const same = live.filter((c) => c.laneKey === lane.laneKey && contractBucket(c.partner) === bucket)
      const laneCap = Math.min(Math.round(book * BAL.cargoContractBookShare * corpMult), contractDailyCapKg(s, bucket))
      let left = laneCap - same.reduce((a, c) => a + c.guaranteedKgPerDay, 0)
      let slots = BAL.cargoMaxContractsPerLane - same.length
      if (slots <= 0 || left < minLot) continue

      const usedOnLane = new Set<string>([
        ...same.map((c) => c.partner),
        ...list.filter((p) => p.laneKey === lane.laneKey).map((p) => p.partner),
      ])

      const maxOffers = Math.min(slots, 3)
      for (let slotIdx = 0; slotIdx < maxOffers; slotIdx++) {
        if (slots <= 0 || left < minLot) break
        const seedRng = rngFor(s.seed, 'cargo-offer-v2', lane.laneKey, curMonth, bucket, slotIdx)
        if (!rChance(seedRng, offerChance)) continue

        const frac = slots === 1 ? 0.6 + seedRng() * 0.35 : 0.35 + seedRng() * 0.35
        let kg = Math.round((left * frac) / step) * step
        kg = Math.max(minLot, Math.min(left, kg))
        if (kg < minLot) continue

        const tier = getContractTier(bucket, kg)
        const partner = pickContractPartner(seedRng, tier, bucket, lane.route, usedOnLane)
        const offerKey = `${partner}|${lane.route.id}|${lane.direction}|${curMonth}|${slotIdx + 1}`

        if (live.some((c) => c.offerKey === offerKey) || list.some((p) => p.offerKey === offerKey)) continue

        usedOnLane.add(partner)
        left -= kg
        slots -= 1

        list.push({
          partner,
          routeId: lane.route.id,
          direction: lane.direction,
          laneKey: lane.laneKey,
          offerKey,
          lot: (slotIdx + 1) as 1 | 2,
          tier,
          durationDays: rPick(seedRng, [30, 60, 90] as const),
          ratePerKg100Km: quoteContractRate(s, seedRng, mgr, bucket),
          guaranteedKgPerDay: kg,
        })
      }
    }
  }
  return list
}

export function signCargoContract(s: GameState, proposal: CargoProposal): string | null {
  if (!s.company.dedicatedCargoSubsidiary) {
    return 'Contracts need the dedicated cargo subsidiary. Turn it on to sign freight contracts.'
  }
  const mgr = cargoManagerOnDuty(s)
  if (!mgr) return 'Requires an active Cargo Manager on duty.'
  if (!proposal.direction || !proposal.laneKey || !proposal.offerKey) return 'That offer is no longer on the desk.'
  if (!permitCoversRoute(s, proposal.routeId)) return 'Route has no active permit.'
  if (!cargoPermitActive(s, proposal.routeId)) return 'This corridor has no cargo licence — licence it from Routes to take freight contracts.'
  const route = ROUTES[proposal.routeId]
  if (!route) return 'Route not found.'
  if (!s.company.cargoContracts) s.company.cargoContracts = []

  const bucket = contractBucket(proposal.partner)
  const live = liveContracts(s).filter((c) => c.laneKey === proposal.laneKey && contractBucket(c.partner) === bucket)
  if (live.some((c) => c.offerKey === proposal.offerKey)) return 'That contract is already signed.'
  if (live.length >= BAL.cargoMaxContractsPerLane) return 'This lane already has enough live contracts.'
  const avg = averageBookKg(s, route, proposal.direction)
  const book = bucket === 'bulk' ? avg.bulk : avg.parcel
  const corpMult = corporateOfferCapacityMult(s)
  const room = Math.min(book * BAL.cargoContractBookShare * corpMult, contractDailyCapKg(s, bucket))
  const used = live.reduce((a, c) => a + c.guaranteedKgPerDay, 0)
  if (used + proposal.guaranteedKgPerDay > room * 1.08) {
    return 'The lane cannot promise that many kilograms.'
  }

  const contract: CargoContract = {
    ...proposal,
    id: nextId(s.ids, 'cc'),
    startDay: s.day,
    expiresDay: s.day + proposal.durationDays,
    active: true,
  }
  s.company.cargoContracts.push(contract)
  pushLog(
    s,
    'good',
    `Signed ${contract.durationDays}d cargo contract with ${contract.partner} on ${cargoLegLabel(route, contract.direction)}: ${tonnesText(contract.guaranteedKgPerDay)}/day at ₹${contract.ratePerKg100Km}/kg/100km.`,
  )
  return null
}

export function cancelCargoContract(s: GameState, contractId: string): string | null {
  if (!s.company.cargoContracts) return 'No contracts.'
  const c = s.company.cargoContracts.find((x) => x.id === contractId)
  if (!c || !c.active) return 'Contract not found or not active.'
  c.active = false
  const route = ROUTES[c.routeId]
  const lane = route && c.direction ? cargoLegLabel(route, c.direction) : c.routeId
  pushLog(s, 'alert', `Terminated contract with ${c.partner} on ${lane}.`)
  return null
}

/**
 * Turning the subsidiary off ends the freight contracts only it can run, so no
 * promised kilograms keep accruing shortfall fees on a desk that cannot haul them.
 */
export function suspendCargoContracts(s: GameState): number {
  let ended = 0
  for (const c of s.company.cargoContracts ?? []) {
    if (!c.active) continue
    c.active = false
    ended += 1
  }
  return ended
}

function touchContractMonth(s: GameState, c: CargoContract): void {
  const ym = ymKey(s.day)
  if (c.mtdYm !== ym) {
    c.mtdYm = ym
    c.hauledKgMtd = 0
    c.earnedPaiseMtd = 0
    c.shortfallKgMtd = 0
  }
}

/* ============================ spots ============================ */

function quoteSpotPayment(route: RouteDef, weightKg: number, ratePer100: number, premium: number, fragile: boolean): number {
  const frag = fragile ? (1 + BAL.fragilePremium) : 1
  return rs(cargoFreightRupees(weightKg, route.km, ratePer100 * premium, cargoRouteMult(route.km)) * frag)
}

function buildSpotOffer(s: GameState, rng: ReturnType<typeof rngFor>, status: 'offered' | 'queued'): SpotCargoOffer | null {
  const lanes = cargoLanesForPermits(s)
  if (lanes.length === 0) return null
  const lane = rPick(rng, lanes)
  const route = lane.route
  const isDedicated = Boolean(s.company.dedicatedCargoSubsidiary)
  const book = cargoBookKg(s, route, lane.direction, s.day)
  const poolKg = isDedicated ? book.bulkBookKg : book.parcelBookKg
  if (poolKg < (isDedicated ? 400 : 40)) return null
  // A truck desk sells part loads of a few tonnes; a coach desk sells parcel lots.
  const frac = isDedicated ? 0.12 + rng() * 0.3 : 0.08 + rng() * 0.18
  const cap = isDedicated ? 8000 : 350
  const floor = isDedicated ? 500 : 30
  const weightKg = Math.max(floor, Math.min(cap, Math.round(poolKg * frac)))

  const originCity = cargoOriginId(route, lane.direction)
  const destCity = cargoDestId(route, lane.direction)
  const companyFav = s.company.cargoCargoType
  const mixKeys: CargoCargoType[] = ['textiles', 'hardware', 'agri', 'fmcg', 'mixed']
  const pickedType = (companyFav && rChance(rng, 0.4))
    ? companyFav
    : rPick(rng, mixKeys)

  const density = CARGO_DENSITY[pickedType] ?? 167
  const volumeCbm = Math.round((weightKg / (density * rJitter(rng, 1, 0.12))) * 10) / 10
  const chargeKg = chargeableKg(weightKg, volumeCbm, pickedType)

  const fragile = Boolean(s.company.cargoAcceptFragile) && rChance(rng, 0.28)
  // A spot booking pays the posted rate for its bucket - based on chargeable weight
  const rate = isDedicated ? truckRatePerKg100Km(s) : parcelRatePerKg100Km(s)
  return {
    id: nextId(s.ids, 'spot'),
    originCity,
    destCity,
    routeId: route.id,
    direction: lane.direction,
    weightKg,
    volumeCbm,
    cargoType: pickedType,
    fragile,
    chargeableKg: chargeKg,
    totalPayment: quoteSpotPayment(route, chargeKg, rate, 1, fragile),
    premiumMult: 1,
    offeredDay: s.day,
    expiresDay: s.day + 2,
    status,
    remainingKg: weightKg,
    shippedKg: 0,
  }
}

function openSpotCount(s: GameState): number {
  return (s.company.spotOffers ?? []).filter((o) => {
    const st = o.status ?? 'offered'
    return st === 'offered' || st === 'queued'
  }).length
}

function queueSpot(s: GameState, o: SpotCargoOffer, mgrName: string): void {
  o.status = 'queued'
  o.remainingKg = o.remainingKg ?? o.weightKg
  const from = CITIES[o.originCity]?.name ?? o.originCity
  const to = CITIES[o.destCity]?.name ?? o.destCity
  pushLog(
    s,
    'good',
    `Cargo Manager ${mgrName} queued spot cargo: ${tonnesText(o.weightKg)} ${o.fragile ? 'fragile ' : ''}${o.cargoType} (${from} → ${to}). It pays when a departure hauls it.`,
  )
}

/**
 * The cargo manager answers spot offers themselves. Any offer still waiting on
 * the player (a decision posted before the appointment, or by a desk that was
 * briefly empty) gets queued on the manager's behalf and the decision is
 * withdrawn. Returns how many offers were taken over.
 */
export function cargoAutoQueuePendingOffers(s: GameState, mgrName: string): number {
  const pending = s.decisions.filter((d) => d.kind === 'spot_cargo')
  if (pending.length === 0) return 0
  let taken = 0
  for (const d of pending) {
    const offerId = d.data?.offerId as string | undefined
    const offer = offerId ? s.company.spotOffers?.find((o) => o.id === offerId) : undefined
    // Expired or already-moved loads are simply withdrawn — nothing to queue.
    if (offer && (offer.status ?? 'offered') === 'offered' && offer.expiresDay >= s.day) {
      queueSpot(s, offer, mgrName)
      taken++
    }
  }
  s.decisions = s.decisions.filter((d) => d.kind !== 'spot_cargo')
  return taken
}

function countPlannedDepartures(s: GameState, laneKey: string): number {
  let n = 0
  for (const t of Object.values(s.trips)) {
    if (t.day !== s.day || t.status === 'cancelled') continue
    const route = ROUTES[t.routeId]
    if (!route) continue
    if (cargoLaneKey(route, t.direction) === laneKey) n++
  }
  return n
}

/** Pools for the Cargo tab. After the day has run, these are the books dispatch actually drew. */
export function cargoPoolsForView(s: GameState): CargoPoolState[] {
  const live = s.company.cargoHaulDay
  if (live?.day === s.day && live.pools && Object.keys(live.pools).length > 0) {
    return Object.values(live.pools).sort((a, b) => b.parcelMarketKg + b.bulkMarketKg - (a.parcelMarketKg + a.bulkMarketKg))
  }
  return cargoLanesForPermits(s).map((lane) => {
    const market = corridorCargoMarketKg(s, lane.route, lane.direction, s.day)
    const book = cargoBookKg(s, lane.route, lane.direction, s.day)
    const due = liveContracts(s)
      .filter((c) => c.laneKey === lane.laneKey)
      .reduce((a, c) => a + c.guaranteedKgPerDay, 0)
    return {
      day: s.day,
      laneKey: lane.laneKey,
      routeId: lane.route.id,
      direction: lane.direction,
      parcelMarketKg: market.parcelMarketKg,
      bulkMarketKg: market.bulkMarketKg,
      parcelBookKg: book.parcelBookKg,
      bulkBookKg: book.bulkBookKg,
      parcelLoadedKg: 0,
      bulkLoadedKg: 0,
      contractDueKg: due,
      departuresPlanned: countPlannedDepartures(s, lane.laneKey),
      departuresServed: 0,
    }
  }).sort((a, b) => b.parcelMarketKg + b.bulkMarketKg - (a.parcelMarketKg + a.bulkMarketKg))
}

/** Daily pass: sign contracts that fit, queue spots, and post today's finite pools. Cash waits for dispatch. */
export function dailyCargoPass(s: GameState): void {
  const mgr = cargoManagerOnDuty(s)
  if (!s.company.cargoContracts) s.company.cargoContracts = []
  if (!s.company.spotOffers) s.company.spotOffers = []

  // Check annual corporate freight tender rollover (every 365 days)
  const start = s.startDay ?? 0
  const daysRunning = s.day - start
  if (daysRunning > 0 && daysRunning % 365 === 0) {
    const yearIndex = Math.floor(daysRunning / 365)
    if (!s.company.corporateAnnualRates) s.company.corporateAnnualRates = []
    if (s.company.corporateAnnualRates.length < yearIndex) {
      const rate = calcAnnualCorporateGrowthRate(s, yearIndex)
      s.company.corporateAnnualRates[yearIndex - 1] = rate
      const pct = Math.round(rate * 100)
      const sign = pct >= 0 ? `+${pct}%` : `${pct}%`
      if (rate >= 0) {
        pushLog(
          s,
          'good',
          `Year ${yearIndex + 1} Corporate Tender Expansion: Available freight capacity increased by ${sign} based on profitable operations.`,
        )
      } else {
        pushLog(
          s,
          'alert',
          `Year ${yearIndex + 1} Corporate Tender Contraction: Available freight capacity decreased by ${sign} due to recent business losses.`,
        )
      }
    }
  }

  // A manager on the desk takes over any offer still waiting on the player, so
  // the inbox never asks when someone is already paid to answer.
  if (mgr) cargoAutoQueuePendingOffers(s, mgr.name)

  // Licence clock first: a lapsed licence kills that corridor's contracts below.
  cargoPermitPass(s)

  for (const c of s.company.cargoContracts) {
    if (!c.active) continue
    if (s.day > c.expiresDay) {
      c.active = false
      pushLog(s, 'info', `Cargo contract with ${c.partner} on ${c.routeId} has expired.`)
    } else if (!cargoPermitActive(s, c.routeId)) {
      // Permit surrendered, expired or lapsed: the commitment cannot continue.
      c.active = false
      pushLog(
        s,
        'alert',
        `Cargo contract with ${c.partner} on ${routeName(c.routeId)} closed — the corridor no longer holds a cargo licence.`,
      )
    }
  }

  s.company.spotOffers = s.company.spotOffers.filter((o) => {
    const st = o.status ?? 'offered'
    if (st === 'shipped') return (o.shippedDay ?? o.offeredDay) >= s.day - 30
    if (o.expiresDay < s.day) {
      o.status = 'expired'
      return o.expiresDay >= s.day - 7
    }
    if (st === 'expired') return o.expiresDay >= s.day - 7
    return true
  })

  const isDedicated = Boolean(s.company.dedicatedCargoSubsidiary)
  const maxSpots = isDedicated ? 6 : 3
  if (mgr) {
    const cap = Math.floor(deskCapacity(s, 'cargo'))
    const allLanes = cargoContractLanes(s)
    if (allLanes.length > cap) {
      pushLog(
        s,
        'info',
        `Cargo manager span exceeded (${allLanes.length} lanes licensed · ${allLanes.length - cap} unattended). Appoint ${assistantsToCover(s, 'cargo')} assistant manager(s) to cover all lanes.`,
      )
    }

    // Contracts are a subsidiary product; without it the desk only queues coach spots.
    if (isDedicated && s.company.cargoAutoSignContracts !== false) {
      for (const proposal of getAvailableContracts(s)) {
        signCargoContract(s, proposal)
      }
    }
    for (const o of s.company.spotOffers) {
      if ((o.status ?? 'offered') === 'offered') queueSpot(s, o, mgr.name)
    }
    const rng = rngFor(s.seed, 'spot-cargo', s.day)
    const adHoc = BAL.cargoAdHocParcelMult ?? 1
    const chance = (isDedicated ? (0.65 + mgr.skill * 0.04) : (0.25 + mgr.skill * 0.05) * adHoc)
    if (openSpotCount(s) < maxSpots && rChance(rng, chance)) {
      const offer = buildSpotOffer(s, rng, 'queued')
      if (offer) {
        s.company.spotOffers.push(offer)
        queueSpot(s, offer, mgr.name)
      }
    }
  } else {
    // If no cargo manager is assigned to the desk, do not generate spot cargo offers
    // and do not popup decisions. Clear any lingering spot cargo decisions.
    if (s.decisions.some((d) => d.kind === 'spot_cargo')) {
      s.decisions = s.decisions.filter((d) => d.kind !== 'spot_cargo')
    }
  }

  const lines: CargoHaulLine[] = []
  for (const c of s.company.cargoContracts) {
    if (!c.active || s.day > c.expiresDay) continue
    const route = ROUTES[c.routeId]
    if (!route || !permitCoversRoute(s, c.routeId)) continue
    if (!c.direction || !c.laneKey) continue
    touchContractMonth(s, c)
    lines.push({
      contractId: c.id,
      routeId: c.routeId,
      direction: c.direction,
      laneKey: c.laneKey,
      promisedKg: Math.max(0, Math.round(c.guaranteedKgPerDay)),
      hauledKg: 0,
      ratePerKg100Km: effectiveContractRatePerKg100Km(s, c.ratePerKg100Km, contractBucket(c.partner)),
      km: route.km,
    })
  }

  const pools: Record<string, CargoPoolState> = {}
  for (const lane of cargoLanesForPermits(s)) {
    const market = corridorCargoMarketKg(s, lane.route, lane.direction, s.day)
    const book = cargoBookKg(s, lane.route, lane.direction, s.day)
    const due = lines.filter((l) => l.laneKey === lane.laneKey).reduce((a, l) => a + l.promisedKg, 0)
    pools[lane.laneKey] = {
      day: s.day,
      laneKey: lane.laneKey,
      routeId: lane.route.id,
      direction: lane.direction,
      parcelMarketKg: market.parcelMarketKg,
      bulkMarketKg: market.bulkMarketKg,
      parcelBookKg: book.parcelBookKg,
      bulkBookKg: book.bulkBookKg,
      parcelLoadedKg: 0,
      bulkLoadedKg: 0,
      contractDueKg: due,
      departuresPlanned: countPlannedDepartures(s, lane.laneKey),
      departuresServed: 0,
    }
  }
  s.company.cargoHaulDay = { day: s.day, lines, pools }
}

export function acceptSpotCargoOffer(s: GameState, offerId: string): string | null {
  if (!s.company.spotOffers) return 'No offers.'
  const offer = s.company.spotOffers.find((o) => o.id === offerId)
  if (!offer) return 'Offer not found or expired.'
  if (offer.status === 'shipped') return 'That load has already moved.'
  if (offer.status === 'expired' || offer.expiresDay < s.day) return 'Offer expired.'
  offer.status = 'queued'
  offer.remainingKg = offer.remainingKg ?? offer.weightKg
  pushLog(s, 'good', `Queued spot cargo: ${tonnesText(offer.weightKg)} ${offer.cargoType} on ${routeName(offer.routeId)}. It pays when a departure hauls it.`)
  return null
}

export function acceptAllSpotCargoOffers(s: GameState): string | null {
  if (!s.company.spotOffers || s.company.spotOffers.length === 0) return 'No offers.'
  let count = 0
  for (const offer of s.company.spotOffers) {
    if ((offer.status ?? 'offered') === 'offered' && offer.expiresDay >= s.day) {
      offer.status = 'queued'
      offer.remainingKg = offer.remainingKg ?? offer.weightKg
      count++
    }
  }
  if (count === 0) return 'No pending spot offers to queue.'
  pushLog(s, 'good', `Queued ${count} spot parcel consignments for upcoming departures.`)
  return null
}

/* ============================ allocation ============================ */

export interface CargoAllocation {
  kg: number
  /** Paise earned for the kilograms actually loaded. */
  revenue: number
  contractKg: number
  spotKg: number
  walkupKg: number
  contractRevenue: number
  spotRevenue: number
  walkupRevenue: number
}

export interface CargoDepartureRef {
  tripId: string
  routeId: string
  capKg: number
  depHour: number
  depMin: number
  isCargo: boolean
}

export interface CorridorCargoPool {
  laneKey: string
  routeId: string
  direction: 'AB' | 'BA'
  state: CargoPoolState
  contracts: { line: CargoHaulLine; remainingKg: number }[]
  /** Share of the parcel book this departure may draw. Coaches, or trucks when no coach runs. */
  parcelWeight: Map<string, number>
  /** Share of the bulk book. Trucks only. */
  bulkWeight: Map<string, number>
}

function weightShares(seed: number, departures: CargoDepartureRef[], kind: 'parcel' | 'bulk'): Map<string, number> {
  const weights = new Map<string, number>()
  let total = 0
  for (const d of departures) {
    const route = ROUTES[d.routeId]
    if (!route) continue
    const mass = Math.max(0.015, windowMass(corridorProfile(seed, route), d.depHour, d.depMin).pool)
    const appetite = kind === 'parcel' && d.isCargo ? Math.min(d.capKg, 700) : d.capKg
    const w = mass * Math.max(40, appetite)
    weights.set(d.tripId, w)
    total += w
  }
  if (total <= 0) return weights
  for (const [id, w] of weights) weights.set(id, w / total)
  return weights
}

function ensurePoolState(s: GameState, route: RouteDef, direction: 'AB' | 'BA', laneKey: string): CargoPoolState {
  const led = s.company.cargoHaulDay
  const existing = led?.day === s.day ? led.pools?.[laneKey] : undefined
  if (existing) return existing
  const market = corridorCargoMarketKg(s, route, direction, s.day)
  const book = cargoBookKg(s, route, direction, s.day)
  const state: CargoPoolState = {
    day: s.day,
    laneKey,
    routeId: route.id,
    direction,
    parcelMarketKg: market.parcelMarketKg,
    bulkMarketKg: market.bulkMarketKg,
    parcelBookKg: book.parcelBookKg,
    bulkBookKg: book.bulkBookKg,
    parcelLoadedKg: 0,
    bulkLoadedKg: 0,
    contractDueKg: 0,
    departuresPlanned: 0,
    departuresServed: 0,
  }
  if (led?.day === s.day) {
    led.pools ??= {}
    led.pools[laneKey] = state
  }
  return state
}

export function makeCorridorCargoPool(
  s: GameState,
  route: RouteDef,
  direction: 'AB' | 'BA',
  departures: CargoDepartureRef[],
): CorridorCargoPool {
  const laneKey = cargoLaneKey(route, direction)
  const state = ensurePoolState(s, route, direction, laneKey)
  const lines = (s.company.cargoHaulDay?.day === s.day ? s.company.cargoHaulDay.lines : [])
    .filter((l) => (l.laneKey ?? laneKeyOfLine(l)) === laneKey)
  const trucks = departures.filter((d) => d.isCargo)
  // The parcel book is shared by every departure that can carry parcels. Contract
  // kilograms are truck-only, so only cargo vehicles ever draw from `contracts`.
  const parcelDeps = departures
  return {
    laneKey,
    routeId: route.id,
    direction,
    state,
    contracts: lines.map((line) => ({ line, remainingKg: Math.max(0, line.promisedKg - line.hauledKg) })),
    parcelWeight: weightShares(s.seed, parcelDeps, 'parcel'),
    bulkWeight: weightShares(s.seed, trucks, 'bulk'),
  }
}

function laneKeyOfLine(line: CargoHaulLine): string {
  const route = ROUTES[line.routeId]
  if (!route) return line.laneKey ?? line.routeId
  return cargoLaneKey(route, line.direction)
}

function spotIsBulk(s: GameState, o: SpotCargoOffer): boolean {
  return Boolean(s.company.dedicatedCargoSubsidiary) && o.weightKg >= 800
}

function spotOnLane(o: SpotCargoOffer, laneKey: string): boolean {
  const route = ROUTES[o.routeId]
  if (!route) return false
  return cargoLaneKey(route, o.direction ?? 'AB') === laneKey
}

/**
 * Today's cargo-vehicle departures on a lane. Promised contract kilograms only
 * load on a cargo bus, so a lane without one cannot service its contracts.
 */
export function cargoVehicleDeparturesOnLane(s: GameState, route: RouteDef, direction: 'AB' | 'BA'): number {
  let n = 0
  for (const t of Object.values(s.trips ?? {})) {
    if (t.routeId !== route.id || t.direction !== direction || t.day !== s.day) continue
    if (t.status !== 'open' && t.status !== 'completed') continue
    if (isCargoModel(s.buses[t.busId]?.modelId)) n += 1
  }
  return n
}

/**
 * Load one departure from its share of the lane book.
 * Contracts first, then queued spots, then walk-up. Bay fills based on actual leftover book,
 * with no artificial 70% governor.
 */
export function allocateCargoForTrip(
  s: GameState,
  pool: CorridorCargoPool,
  route: RouteDef,
  tripId: string,
  capKg: number,
  isCargo: boolean,
): CargoAllocation {
  const out: CargoAllocation = {
    kg: 0, revenue: 0, contractKg: 0, spotKg: 0, walkupKg: 0,
    contractRevenue: 0, spotRevenue: 0, walkupRevenue: 0,
  }
  pool.state.departuresServed += 1
  if (capKg <= 0) return out

  const rng = rngFor(s.seed, 'cargo-load', tripId)
  const jitter = rJitter(rng, 1, BAL.cargoLoadJitter)

  // Thin-book empty chance: only when both contracts and book are negligible relative to capacity
  const contractWaiting = isCargo ? pool.contracts.reduce((a, c) => a + c.remainingKg, 0) : 0
  const bookWaiting = isCargo
    ? (pool.state.bulkBookKg - pool.state.bulkLoadedKg) + (pool.state.parcelBookKg - pool.state.parcelLoadedKg)
    : (pool.state.parcelBookKg - pool.state.parcelLoadedKg)
  if (contractWaiting < capKg * 0.05 && bookWaiting < capKg * 0.12) {
    if (rChance(rng, BAL.cargoEmptyChance * 1.5)) return out
  }

  const mgrOn = Boolean(cargoManagerOnDuty(s))
  const routeMult = cargoRouteMult(route.km)
  const penalty = mgrOn ? 1 : BAL.cargoNoManagerRatePenalty
  const truckRate = truckRatePerKg100Km(s)
  const parcelRate = parcelRatePerKg100Km(s)
  const walkRate = isCargo ? truckRate : parcelRate

  const take = (budget: number, want: number, ratePer100: number, fragile: boolean): { kg: number; pay: number; budget: number } => {
    const got = Math.max(0, Math.min(budget, Math.round(want)))
    if (got <= 0) return { kg: 0, pay: 0, budget }
    const frag = fragile ? (1 + BAL.fragilePremium) : 1
    const pay = rs(cargoFreightRupees(got, route.km, ratePer100, routeMult) * penalty * frag)
    out.kg += got
    out.revenue += pay
    return { kg: got, pay, budget: budget - got }
  }

  const drawContracts = (kind: 'parcel' | 'bulk', budget: number): number => {
    for (const c of pool.contracts) {
      if (budget <= 0) break
      const bulk = contractIsBulk(s, c.line.contractId)
      if ((kind === 'bulk') !== bulk) continue
      const rate = c.line.ratePerKg100Km
      const res = take(budget, c.remainingKg, rate, false)
      if (res.kg <= 0) continue
      budget = res.budget
      c.remainingKg -= res.kg
      c.line.hauledKg += res.kg
      out.contractKg += res.kg
      out.contractRevenue += res.pay
      if (kind === 'bulk') pool.state.bulkLoadedKg += res.kg
      else pool.state.parcelLoadedKg += res.kg
      const contract = s.company.cargoContracts?.find((x) => x.id === c.line.contractId)
      if (contract) {
        touchContractMonth(s, contract)
        contract.hauledKgMtd = (contract.hauledKgMtd ?? 0) + res.kg
        contract.earnedPaiseMtd = (contract.earnedPaiseMtd ?? 0) + res.pay
      }
    }
    return budget
  }

  const drawSpots = (kind: 'parcel' | 'bulk', budget: number): number => {
    for (const o of s.company.spotOffers ?? []) {
      if (budget <= 0) break
      if (!spotOnLane(o, pool.laneKey)) continue
      if ((o.status ?? 'offered') !== 'queued') continue
      const bulk = spotIsBulk(s, o)
      if ((kind === 'bulk') !== bulk) continue
      const leftActual = o.remainingKg ?? o.weightKg
      if (leftActual <= 0) continue

      // Use chargeable weight for bay room and draw
      const cbm = o.volumeCbm ?? 0
      const cType = o.cargoType ?? 'mixed'
      const chargeTotal = o.chargeableKg ?? chargeableKg(o.weightKg, cbm, cType)
      const chargeRatio = o.weightKg > 0 ? chargeTotal / o.weightKg : 1.0
      const leftChargeable = Math.round(leftActual * chargeRatio)

      const bookLeft = kind === 'bulk'
        ? Math.max(0, pool.state.bulkBookKg - pool.state.bulkLoadedKg)
        : Math.max(0, pool.state.parcelBookKg - pool.state.parcelLoadedKg)
      const base = kind === 'bulk' || isCargo ? truckRate : parcelRate
      const prem = o.premiumMult ?? 1
      const wantChargeable = Math.min(leftChargeable, Math.round(bookLeft * chargeRatio))
      const res = take(budget, wantChargeable, base * prem, Boolean(o.fragile))
      if (res.kg <= 0) continue
      budget = res.budget

      const actualDrawn = Math.min(leftActual, Math.round(res.kg / chargeRatio))
      o.remainingKg = Math.max(0, leftActual - actualDrawn)
      o.shippedKg = (o.shippedKg ?? 0) + actualDrawn
      out.spotKg += res.kg
      out.spotRevenue += res.pay
      if (kind === 'bulk') pool.state.bulkLoadedKg += res.kg
      else pool.state.parcelLoadedKg += res.kg
      if ((o.remainingKg ?? 0) <= 0) {
        o.status = 'shipped'
        o.shippedDay = s.day
        o.remainingKg = 0
      }
    }
    return budget
  }

  const drawWalk = (kind: 'parcel' | 'bulk', budget: number): number => {
    if (budget <= 0) return budget
    const bookLeft = kind === 'bulk'
      ? Math.max(0, pool.state.bulkBookKg - pool.state.bulkLoadedKg)
      : Math.max(0, pool.state.parcelBookKg - pool.state.parcelLoadedKg)
    if (bookLeft <= 0) return budget
    const res = take(budget, bookLeft, walkRate, false)
    if (res.kg <= 0) return budget
    out.walkupKg += res.kg
    out.walkupRevenue += res.pay
    if (kind === 'bulk') pool.state.bulkLoadedKg += res.kg
    else pool.state.parcelLoadedKg += res.kg
    return res.budget
  }

  if (isCargo) {
    // 1. Contracts first up to full bay
    let room = capKg
    room = drawContracts('bulk', room)
    room = drawContracts('parcel', room)
    // 2. Spots fill leftover bay up to full capacity
    room = drawSpots('bulk', room)
    room = drawSpots('parcel', room)
    // 3. Walk-up freight fills remainder
    room = drawWalk('bulk', room)
    drawWalk('parcel', room)
    return out
  }

  // Passenger coaches: take parcel spots and walk-up up to bay capacity
  const parcelLeft = Math.max(0, pool.state.parcelBookKg - pool.state.parcelLoadedKg)
  const departureWeight = pool.parcelWeight.get(tripId) ?? (1 / Math.max(1, pool.state.departuresPlanned))
  const departureShare = Math.round(pool.state.parcelBookKg * departureWeight * (0.85 + jitter * 0.3))
  let coachRoom = Math.min(capKg, parcelLeft, Math.max(Math.round(capKg * 0.25), departureShare))

  coachRoom = drawSpots('parcel', coachRoom)
  drawWalk('parcel', coachRoom)
  return out
}

function contractIsBulk(s: GameState, contractId: string): boolean {
  const partner = s.company.cargoContracts?.find((c) => c.id === contractId)?.partner ?? ''
  return contractBucket(partner) === 'bulk'
}

/** Charge a fraction of the freight for promised kilograms that never moved. */
export function settleCargoShortfall(s: GameState): void {
  const led = s.company.cargoHaulDay
  if (!led || led.day !== s.day || led.lines.length === 0) return
  const byId = new Map<string, CargoHaulLine[]>()
  for (const line of led.lines) {
    const arr = byId.get(line.contractId) ?? []
    arr.push(line)
    byId.set(line.contractId, arr)
  }
  for (const [id, lines] of byId) {
    const promised = lines.reduce((a, l) => a + l.promisedKg, 0)
    const hauled = lines.reduce((a, l) => a + l.hauledKg, 0)
    const miss = promised - hauled
    const routeId = lines[0]!.routeId
    // SLA: a freight run that broke down or arrived >2h late costs 10% of the freight actually moved
    // and dents reputation, even when every kilogram eventually arrived.
    const lateRun = Object.values(s.trips).some(
      (t) =>
        t.routeId === routeId && t.day === s.day && t.status === 'completed' &&
        isCargoModel(s.buses[t.busId]?.modelId) &&
        (t.outcome?.breakdown || (t.outcome?.delayMin ?? 0) > (s.config?.slaToleranceMin ?? 120)),
    )
    if (lateRun && hauled > 0) {
      const slaFee = rs(lines.reduce((a, l) => a + cargoFreightRupees(l.hauledKg, l.km, l.ratePerKg100Km), 0) * 0.1)
      if (slaFee > 0) {
        spend(s, 'penalty', slaFee, { routeId, note: 'Cargo SLA penalty (late/broken-down delivery)' })
        s.company.reputation = Math.max(0, s.company.reputation - 0.5)
        pushLog(s, 'alert', `Cargo SLA breach on ${routeName(routeId)}: late delivery cost ${fmtCompact(slaFee)} and reputation.`, '/cargo')
      }
    }
    if (miss < 20) continue
    // Failing a signed contract hurts standing in proportion to what was left behind.
    s.company.reputation = Math.max(0, s.company.reputation - Math.min(2, 0.3 + miss / 2000))
    const partner = s.company.cargoContracts?.find((c) => c.id === id)?.partner ?? 'partner'
    const completed = Object.values(s.trips).filter(
      (t) => t.routeId === routeId && t.day === s.day && t.status === 'completed',
    )
    const ran = completed.length > 0
    const cargoRan = completed.some((t) => isCargoModel(s.buses[t.busId]?.modelId))
    if (!ran) {
      pushLog(s, 'alert', `Contract missed — no bus ran on ${routeName(routeId)} (${partner}).`)
    } else if (!cargoRan) {
      pushLog(s, 'alert', `Contract missed — no cargo vehicle ran on ${routeName(routeId)} (${partner}). Promised freight only loads on a cargo bus.`)
    }
    for (const line of lines) {
      const lineMiss = Math.max(0, line.promisedKg - line.hauledKg)
      const fee = rs(cargoFreightRupees(lineMiss, line.km, line.ratePerKg100Km) * BAL.cargoShortfallFeePct)
      if (fee <= 0) continue
      spend(s, 'penalty', fee, { routeId, note: `Cargo contract shortfall (${tonnesText(lineMiss)})` })
      recordCargoLane(s, routeId, line.direction, s.day, { shortfall: fee })
    }
    const contract = s.company.cargoContracts?.find((c) => c.id === id)
    if (contract) {
      touchContractMonth(s, contract)
      contract.shortfallKgMtd = (contract.shortfallKgMtd ?? 0) + miss
    }
    if (ran) {
      pushLog(s, 'alert', `Cargo shortfall on ${routeName(routeId)}: ${tonnesText(miss)} not hauled.`)
    }
  }
}

/* ============================ save migration ============================ */

/**
 * Contracts used to be signable on any permitted corridor. Saves that were
 * already running freight get the cargo licence on those corridors for a year,
 * so live commitments are not torn up by the new gate.
 */
export function migrateCargoPermits(s: GameState): void {
  const granted = new Map<string, number>()
  for (const c of s.company.cargoContracts ?? []) {
    if (!c.active || s.day > c.expiresDay) continue
    if (cargoPermitActive(s, c.routeId)) continue
    const route = findRouteDef(c.routeId)
    if (!route) continue
    const permit = permitsMatchingRoute(s, c.routeId).find((p) => p.status === 'active')
    if (!permit) continue
    permit.cargo = {
      status: 'active',
      appliedDay: s.day,
      activeFromDay: s.day,
      expiryDay: s.day + BAL.cargoPermitTermDays,
      feePaid: 0,
    }
    granted.set(permit.routeId, (granted.get(permit.routeId) ?? 0) + 1)
  }
  for (const [routeId, count] of granted) {
    pushLog(
      s,
      'info',
      `Cargo licence issued (no fee) on ${routeName(routeId)} to grandfather ${count} running contract${count === 1 ? '' : 's'}.`,
    )
  }
}

/** Split directionless contracts and pull promises down to what the lane can actually sell. */
export function migrateCargoContracts(s: GameState): void {
  const list = s.company.cargoContracts
  if (!list) return
  const added: CargoContract[] = []
  for (const c of list) {
    const legacy = !c.direction || !c.laneKey || !c.offerKey
    if (!legacy) continue
    const route = ROUTES[c.routeId]
    const original = c.guaranteedKgPerDay
    const half = Math.round(original / 2)
    const rest = Math.max(0, original - half)
    const apply = (dir: 'AB' | 'BA', kg: number, id: string, offerSuffix: string): CargoContract | null => {
      if (!route) return null
      const bucket = contractBucket(c.partner)
      const book = cargoBookKg(s, route, dir, s.day)
      const ceiling = Math.round((bucket === 'bulk' ? book.bulkBookKg : book.parcelBookKg) * BAL.cargoContractBookShare)
      const promised = Math.max(0, Math.min(kg, ceiling))
      if (promised < 20) return null
      return {
        ...c,
        id,
        direction: dir,
        laneKey: cargoLaneKey(route, dir),
        offerKey: `${c.partner}|${c.routeId}|${dir}|legacy|${offerSuffix}`,
        guaranteedKgPerDay: promised,
      }
    }
    const ab = route ? apply('AB', half, c.id, c.id) : null
    const ba = route ? apply('BA', rest, `${c.id}_ba`, `${c.id}_ba`) : null
    if (ab) {
      c.direction = ab.direction
      c.laneKey = ab.laneKey
      c.offerKey = ab.offerKey
      c.guaranteedKgPerDay = ab.guaranteedKgPerDay
    } else if (route) {
      c.active = false
    }
    if (ba) added.push(ba)
  }
  list.push(...added)
}

/** Seed lane rows from the few completed trips a save still holds. */
export function backfillCargoLaneHistory(s: GameState): void {
  for (const t of Object.values(s.trips ?? {})) {
    if (t.status !== 'completed' || !t.outcome) continue
    const kg = t.outcome.cargoKg ?? 0
    const revenue = t.outcome.cargoRevenue ?? 0
    if (kg <= 0 && revenue <= 0) continue
    recordCargoLane(s, t.routeId, t.direction, t.day, {
      trips: 1,
      kg,
      capKg: t.outcome.cargoCapKg ?? 0,
      revenue,
      contractKg: t.outcome.cargoContractKg ?? 0,
      spotKg: t.outcome.cargoSpotKg ?? 0,
      walkupKg: t.outcome.cargoWalkupKg ?? 0,
    })
  }
}

/**
 * Older saves booked one flat "hamali" charge per lane. Split it into the origin
 * loading leg and the destination unloading leg so the books show the breakdown.
 */
export function migrateCargoLoadingBreakdown(s: GameState): void {
  for (const days of Object.values(s.routeHistory ?? {})) {
    for (const day of days ?? []) {
      if (!day.cargo) continue
      for (const dir of ['AB', 'BA'] as const) {
        const lane = day.cargo[dir] as (CargoLaneDay & { hamali?: number }) | undefined
        if (!lane || typeof lane.hamali !== 'number') continue
        const total = Math.max(0, lane.hamali)
        lane.loading = Math.round(total * 0.6)
        lane.unloading = Math.max(0, total - lane.loading)
        delete lane.hamali
      }
    }
  }
}

/**
 * Spot quotes used to carry a 1.15×–1.85× surcharge. Spots now bill the posted
 * rate, so open offers are re-quoted at par with their lane.
 */
export function migrateSpotRates(s: GameState): void {
  for (const o of s.company.spotOffers ?? []) {
    const st = o.status ?? 'offered'
    if (st === 'shipped' || st === 'expired') continue
    const prem = o.premiumMult
    if (typeof prem !== 'number' || Math.abs(prem - 1) < 1e-6) continue
    if (prem > 0) o.totalPayment = Math.round(o.totalPayment / prem)
    o.premiumMult = 1
  }
}
