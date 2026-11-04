/**
 * Fare composition. A coach's list price is the corridor's AC-sleeper
 * benchmark scaled by the model's fare index — class, layout and age are not
 * priced separately, so every coach fills against its own going rate. On top
 * of that sits the calendar swing (weekday normal, weekend, festival surge),
 * time-of-day demand side modulation, seeded trip-to-trip wobble (5% to 10%),
 * and a late occupancy yield adjustment (±3% inside the last 3 days).
 *
 * 300% is reserved for one case only: Diwali on a Saturday or Sunday, on the surging direction.
 */
import { clampBrandFare } from './brandPolicy'
import { BAL, getDirectionalOccupancyRange, elapsedBookingFrac } from '../data/balance'
import { BUS_MODELS } from '../data/busModels'
import { ROUTES } from '../data/routes'
import { FESTIVALS, festivalEffect, dow } from '../core/calendar'
import { rngFor } from '../core/rng'
import type { Money } from '../core/money'
import type { Bus, GameState, RouteDef, Schedule, ServiceTier, Trip, ID } from '../types'
import { isHomebound, departureTimeFit } from './corridor'

/** Brand service-tier ticket multiplier vs corridor AC benchmark. */
export function serviceTierFareMult(tier?: ServiceTier | null): number {
  switch (tier) {
    case 'gold': return BAL.amenities.goldTierFareMult
    case 'premium': return BAL.amenities.premiumTierFareMult
    case 'economy': return BAL.amenities.economyTierFareMult
    case 'standard':
    default: return BAL.amenities.standardTierFareMult
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Round fare:
 * - Round UP to next ₹50 for fares under ₹1,000.
 * - Round to NEAREST ₹100 for fares ₹1,000 and above.
 * Money is in integer paise (100 paise = ₹1).
 * ₹50 = 5,000 paise. ₹100 = 10,000 paise. ₹1,000 = 100,000 paise.
 */
export function roundFare(n: number): Money {
  if (!n || n <= 0 || isNaN(n)) return 0
  if (n < 100_000) {
    return Math.ceil(n / 5_000) * 5_000
  }
  return Math.round(n / 10_000) * 10_000
}

/**
 * Read the corridor's haul-aware clock (departureTimeFit in corridor.ts).
 * Peak departure windows are the demand side (~115%).
 * Off-peak windows (such as daytime morning on 8h+ overnight routes) sit at ~85%.
 * Shoulder windows sit around ~100%.
 */
export function timeDemandMultiplier(
  _seed: number,
  route: RouteDef,
  depHour: number,
  depMin = 0,
): { factor: number; isDemandSide: boolean } {
  const fit = departureTimeFit(route, depHour, depMin)
  if (fit.isPeak) {
    return { factor: 1.15, isDemandSide: true }
  }
  if (fit.isOffPeak) {
    return { factor: 0.85, isDemandSide: false }
  }
  return { factor: 1.00, isDemandSide: false }
}

/**
 * Trip-to-trip variation of 5% to 10%.
 * Seeded deterministically from trip id or schedule+day+direction so it never re-rolls.
 */
export function tripWobbleRate(
  seed: number,
  trip: { id?: string; scheduleId: string; day: number; direction: string; depHour?: number },
): number {
  const key = trip.id || `${trip.scheduleId}_${trip.day}_${trip.direction}_${trip.depHour ?? 0}`
  const rng = rngFor(seed, 'farewobble', key)
  const sign = rng() < 0.5 ? -1 : 1
  const mag = 0.05 + rng() * 0.05 // 5% to 10%
  return sign * mag
}

/**
 * Calendar multiplier for day-of-week and festival band.
 * - Weekday (Mon-Thu) normal: 100%
 * - Friday Chennai departures (homebound, high demand 80-95%): 130%
 * - Friday Madurai departures (return, 55-75%): 100%
 * - Sunday Madurai departures (return, high demand 80-95%): 130%
 * - Sunday Chennai departures (homebound, 50-70%): 105%
 * - Saturday (balanced weekend 65-85%): 125%
 * - Festival day itself (both directions 40-75%): 100%
 * - Surging festival direction: 150% to 250% (and up to 300% for Diwali weekend)
 * - Non-surging festival direction: near normal (100% to 115%)
 */
export function calendarFareMult(route: RouteDef, direction: 'AB' | 'BA', depDay: number): number {
  const d = dow(depDay)
  const fest = festivalEffect(depDay)
  const isHb = isHomebound(route, direction)
  const dirEffect = isHb ? fest.homebound : fest.returning
  const otherEffect = isHb ? fest.returning : fest.homebound
  const isSurging = dirEffect > 1.15 && dirEffect >= otherEffect

  if (fest.name && fest.phase === 'festival_day') {
    // Festival day itself: demand drops to 40-75% in both directions. Regular pricing.
    return 1.00
  }

  if (fest.name && isSurging) {
    const f = FESTIVALS.find((x) => x.name === fest.name || x.id === fest.id)
    const isDiwali = f?.id === 'diwali'
    const isWeekend = d === 0 || d === 6 || (d === 5 && isHb)
    const P = f ? f.peak : dirEffect
    const strength = clamp((dirEffect - 1.0) / Math.max(0.01, P - 1.0), 0, 1)

    if (isDiwali && isWeekend) {
      // Diwali on Saturday, Sunday or Friday homebound: 300% of normal on the surging direction
      return 1.25 + (3.00 - 1.25) * strength
    }
    if (isDiwali) {
      // Diwali on Weekday: about 250% of normal
      return 1.00 + (2.50 - 1.00) * strength
    }
    if (isWeekend) {
      // Any other festival on a weekend: 150% to 200% band
      const peakBand = 1.50 + ((P - 1.35) / Math.max(0.01, 2.50 - 1.35)) * (2.00 - 1.50)
      return 1.25 + (peakBand - 1.25) * strength
    }
    // Any other festival on a weekday: 150% to 250% band
    const peakBand = 1.50 + ((P - 1.35) / Math.max(0.01, 2.80 - 1.35)) * (2.50 - 1.50)
    return 1.00 + (peakBand - 1.00) * strength
  }

  if (fest.name && !isSurging) {
    // Festival period non-surging leg (e.g. return leg before festival)
    return clamp(dirEffect, 1.0, 1.15)
  }

  // Normal weekly calendar:
  // Price Friday Chennai departures higher when seats are selling quickly.
  if (d === 5) {
    return isHb ? 1.30 : 1.00
  }

  // Price Sunday Madurai departures higher when return demand is strong.
  if (d === 0) {
    return isHb ? 1.05 : 1.30
  }

  // Saturday: balanced weekend travel in both directions
  if (d === 6) {
    return 1.25
  }

  // Normal Midweek (Monday - Thursday)
  return 1.00
}

/**
 * Occupancy yield on the fare:
 * Keep late fill nudge inside ±3%, and only inside the last 3 days.
 */
export function occupancyFareAdj(occ: number, daysToDep: number, weight = 1): number {
  if (daysToDep > 3 || daysToDep < 0) return 0
  const targetOcc = 0.70
  const gap = occ - targetOcc
  return clamp(gap * 0.05 * weight, -0.03, 0.03)
}

function corridorFareIdx(s: GameState, routeId: string): number {
  if (s.company.corridorStance?.[routeId] === 'premium_hold') {
    return s.world.fareIndex[routeId] ?? 1 // Hold full price to defend margin and bleed rival
  }
  const war = s.world.priceWars[routeId]
  const warCut = war && war.untilDay >= s.day ? 1 - war.depth : 1
  return (s.world.fareIndex[routeId] ?? 1) * warCut
}

/** Market list price: route benchmark × model fare index × corridor factors × calendar × brand tier. */
export function marketFare(
  s: GameState,
  route: RouteDef,
  modelId: string,
  depDay: number,
  direction: 'AB' | 'BA' = 'AB',
  _bus?: Bus,
  depHour = 20,
  depMin = 0,
  serviceTier?: ServiceTier | null,
): Money {
  const model = BUS_MODELS[modelId]
  if (!model) return route.marketFareAC
  const tierMult = serviceTierFareMult(serviceTier)
  const normal = roundFare(route.marketFareAC * model.fareIndex * corridorFareIdx(s, route.id) * tierMult)

  const d = dow(depDay)
  const isHb = isHomebound(route, direction)
  const isWeekend = d === 0 || d === 6 || (d === 5 && isHb)
  const fest = festivalEffect(depDay)
  const dirEffect = isHb ? fest.homebound : fest.returning
  const otherEffect = isHb ? fest.returning : fest.homebound
  const isSurging = dirEffect > 1.15 && dirEffect >= otherEffect
  const f = FESTIVALS.find((x) => x.name === fest.name || x.id === fest.id)
  const isDiwaliWeekend = f?.id === 'diwali' && isWeekend && isSurging

  const calMult = calendarFareMult(route, direction, depDay)
  const time = timeDemandMultiplier(s.seed, route, depHour, depMin)

  let baseMult: number
  if (isDiwaliWeekend) {
    if (time.isDemandSide) {
      baseMult = 3.00
    } else {
      baseMult = 3.00 * (0.85 / 1.15)
    }
  } else {
    baseMult = clamp(calMult * time.factor, 0.70, 2.50)
  }

  return roundFare(normal * baseMult)
}

/** Scale a sleeper-benchmark fare by this model's fare index. */
export function classFare(sleeperFare: Money, modelId: string): Money {
  const model = BUS_MODELS[modelId]
  if (!model) return sleeperFare
  return roundFare(sleeperFare * model.fareIndex)
}

/**
 * Checks whether a trip is the 2nd (return) leg of a paired schedule.
 */
export function isReturnTrip(
  trip: { slot?: 1 | 2; pairOfTripId?: ID; depHour?: number; depMin?: number },
  sch: Schedule,
): boolean {
  if (trip.slot === 2) return true
  if (trip.slot === 1) return false
  if (!sch.paired || sch.returnDepHour === undefined) return false
  if (trip.pairOfTripId) return true
  return trip.depHour === sch.returnDepHour && (trip.depMin ?? 0) === (sch.returnDepMin ?? 0)
}

/**
 * Resolve trip base fare:
 * Auto-price: route benchmark × model.fareIndex × corridor fare index × brand tier
 * Manual: player's base (already tier-aware if seeded from the brand)
 * Then applies calendar band, time-of-day, seeded 5-10% wobble, and late occupancy nudge.
 */
export function resolveTripFare(
  s: GameState,
  trip: Trip,
  sch: Schedule,
  bus: Bus,
  daysToDep: number,
): Money {
  if (trip.fareLocked && trip.fare > 0) return trip.fare
  const route = ROUTES[trip.routeId]
  const model = BUS_MODELS[bus.modelId]
  if (!route || !model) return trip.fare

  const isHybrid = model.layout.kind === 'hybrid' || model.cls === 'AC_HYBRID'
  const isRet = isReturnTrip(trip, sch)
  const isAuto = isRet ? (sch.returnAutoPrice ?? sch.autoPrice) : sch.autoPrice
  const legBaseFare = isRet ? (sch.returnBaseFare ?? sch.baseFare) : sch.baseFare
  const legSlpFare = isRet ? (sch.returnBaseFareSleeper ?? sch.baseFareSleeper) : sch.baseFareSleeper
  const legStrFare = isRet ? (sch.returnBaseFareSeater ?? sch.baseFareSeater) : sch.baseFareSeater
  const tierMult = serviceTierFareMult(sch.serviceTier)

  // Manual flat fare mode: the manual entered amount is the final ticket price.
  // No dynamic calculations based on calendar, time-of-day, wobble, or late yield.
  if (!isAuto) {
    trip.flatFare = true
    if (isHybrid) {
      trip.fareSleeper = legSlpFare ? roundFare(legSlpFare) : roundFare(legBaseFare * 1.15)
      trip.fareSeater = legStrFare ? roundFare(legStrFare) : roundFare(legBaseFare * 0.85)
    } else {
      trip.fareSleeper = undefined
      trip.fareSeater = undefined
    }
    return roundFare(legBaseFare)
  }

  trip.flatFare = false
  trip.fareSleeper = undefined
  trip.fareSeater = undefined

  const normal = roundFare(route.marketFareAC * model.fareIndex * corridorFareIdx(s, route.id) * tierMult)

  const d = dow(trip.day)
  const isWeekend = d === 0 || d === 6
  const fest = festivalEffect(trip.day)
  const isHb = isHomebound(route, trip.direction)
  const dirEffect = isHb ? fest.homebound : fest.returning
  const otherEffect = isHb ? fest.returning : fest.homebound
  const isSurging = dirEffect > 1.15 && dirEffect >= otherEffect
  const f = FESTIVALS.find((x) => x.name === fest.name || x.id === fest.id)
  const isDiwaliWeekend = f?.id === 'diwali' && isWeekend && isSurging

  const calMult = calendarFareMult(route, trip.direction, trip.day)
  const time = timeDemandMultiplier(s.seed, route, trip.depHour, trip.depMin ?? 0)

  let baseMult: number
  if (isDiwaliWeekend) {
    if (time.isDemandSide) {
      baseMult = 3.00
    } else {
      baseMult = 3.00 * (0.85 / 1.15)
    }
  } else {
    // Clamp everything except Diwali-plus-weekend to at most 250% before wobble
    baseMult = clamp(calMult * time.factor, 0.70, 2.50)
  }

  const wobble = tripWobbleRate(s.seed, trip)
  let finalMult = baseMult * (1 + wobble)

  if (isDiwaliWeekend && time.isDemandSide) {
    finalMult = clamp(finalMult, 2.70, 3.30)
  } else {
    // Clamp everything except Diwali-plus-weekend to at most 275% after wobble
    finalMult = clamp(finalMult, 0.65, Math.max(1, Math.min(2.75, (s.config?.surgeCapPct ?? 275) / 100)))
  }

  // Cap upward yield moves when current sold is well behind pace
  // (sold/cap < elapsedBookingFrac * target * 0.7) so empty books don't get reverse-surged into staying empty.
  const [rangeMin, rangeMax] = getDirectionalOccupancyRange(model.cls, bus.qualityScore, route, trip.direction, trip.day)
  const target = (rangeMin + rangeMax) / 2
  const cap = trip.seatCount || trip.seats?.length || model.seats || 44
  const occ = cap > 0 ? (trip.sold || 0) / cap : 0
  const pace = elapsedBookingFrac(daysToDep) * target * 0.7
  if (trip.sold > 0 && occ < pace && finalMult > time.factor) {
    finalMult = time.factor
  }

  let fare = roundFare(normal * finalMult)

  // Late occupancy yield nudge inside last 3 days
  if (daysToDep <= 3 && daysToDep >= 0) {
    const cap = trip.seatCount || trip.seats?.length || 44
    const occ = cap > 0 ? (trip.sold || 0) / cap : 0
    const adj = occupancyFareAdj(occ, daysToDep, 1)
    // With dynamic surge off, a busy trip never gets a late fare rise (cuts still apply).
    if (adj !== 0 && !(adj > 0 && s.config?.dynamicYieldSurge === false)) {
      fare = roundFare(fare * (1 + adj))
    }
    // Optional last-day cut on trips that are still mostly empty.
    if (s.config?.lastMinuteDiscount && daysToDep <= 1 && occ < 0.4) {
      fare = roundFare(fare * ((s.config?.lastMinuteFloorPct ?? 85) / 100))
    }
  }

  // Flash Sale (-20%) vs Last-Minute Surge (+25%)
  if (trip.flashDeal) {
    fare = roundFare(fare * (1 - BAL.yieldDeals.flashSaleDiscount))
  } else if (trip.surgeDeal && s.config?.dynamicYieldSurge !== false) {
    fare = roundFare(fare * BAL.yieldDeals.surgePriceMultiplier)
  }

  return clampBrandFare(s, sch.groupId, fare, normal)
}

/** Auto-pricing: calendar market fare ± occupancy yield. */
export function autoPriceFare(s: GameState, trip: Trip, daysToDep: number): Money {
  const sch = s.schedules[trip.scheduleId]
  const bus = s.buses[trip.busId]
  if (!sch || !bus) return trip.fare
  return resolveTripFare(s, trip, sch, bus, daysToDep)
}
