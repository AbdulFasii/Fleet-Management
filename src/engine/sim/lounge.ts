import type { GameState, LoungeAmenityId, LoungeSeating, LoungeTier, PassengerLounge } from '../types'
import { LOUNGE_SEATING, getLoungeTierDef, loungeAmenityIds, loungePackage, loungePackageOf, tierAllows, amenityDef } from '../data/loungeCatalog'
import { CITIES } from '../data/cities'
import { ROUTES, routeName } from '../data/routes'
import { nextId } from '../core/ids'
import { canAfford, capitalOut, earn, spend } from './finance'
import { fmtCompact } from '../core/money'
import { pushLog } from './log'
import { rngFor, rJitter } from '../core/rng'

/** Get active lounges list, ensuring array initialization */
export function getLounges(s: GameState): PassengerLounge[] {
  if (!s.company.lounges) {
    s.company.lounges = []
  }
  return s.company.lounges
}

/**
 * Breakdown of schedules handled by a lounge in a city:
 * Counts schedules and trips departing from or arriving at this city.
 */
export function getLoungeSchedulesHandled(s: GameState, cityId: string): {
  departures: number
  arrivals: number
  total: number
  routeNames: string[]
} {
  let departures = 0
  let arrivals = 0
  const routeSet = new Set<string>()

  // An active schedule runs the outbound leg daily and, when paired, the return leg too.
  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.active) continue
    const route = ROUTES[sch.routeId]
    if (!route) continue
    const both = Boolean(sch.paired)
    if (route.from === cityId) {
      departures += 1
      if (both) arrivals += 1
      routeSet.add(routeName(route.id))
    }
    if (route.to === cityId) {
      arrivals += 1
      if (both) departures += 1
      routeSet.add(routeName(route.id))
    }
  }

  return {
    departures,
    arrivals,
    total: departures + arrivals,
    routeNames: Array.from(routeSet),
  }
}

/** Open a new passenger waiting lounge in a city and location */
export function openLounge(
  s: GameState,
  cityId: string,
  locationName: string,
  tier: LoungeTier,
  seating: LoungeSeating = 'cushioned',
  amenities?: LoungeAmenityId[],
): string | null {
  if (!cityId) return 'Please select a valid city.'
  if (!locationName.trim()) return 'Please enter a location name (e.g. Gandhipuram Omni Bus Stand).'

  const lounges = getLounges(s)
  if (lounges.some((l) => l.cityId === cityId && l.locationName.toLowerCase() === locationName.trim().toLowerCase())) {
    return `A lounge already exists at ${locationName} in ${CITIES[cityId]?.name ?? cityId}.`
  }

  if (!tierAllows(tier, LOUNGE_SEATING[seating].minTier)) return `${LOUNGE_SEATING[seating].label} need a larger lounge.`
  const tierDef = getLoungeTierDef(tier)
  const keep = amenities?.filter((id) => tierAllows(tier, amenityDef(id).minTier))
  const pkg = loungePackage(tier, seating, keep ?? [])
  if (!canAfford(s, pkg.setupCost)) {
    return `Need ${fmtCompact(pkg.setupCost)} CapEx to lease and furnish this ${tierDef.name}.`
  }

  capitalOut(s, 'lounge_capex', pkg.setupCost, {
    note: `Opened ${tierDef.name} at ${locationName}, ${CITIES[cityId]?.name ?? cityId}`,
  })

  const newLounge: PassengerLounge = {
    id: nextId(s.ids, 'lng'),
    cityId,
    locationName: locationName.trim(),
    tier,
    seating,
    ...(keep ? { amenities: keep } : {}),
    openedDay: s.day,
    yesterdayPax: 0,
    yesterdaySnackRevenue: 0,
    yesterdayRentExpense: 0,
    yesterdayElectricExpense: 0,
    yesterdayStaffExpense: 0,
    yesterdayNetProfit: 0,
    lifetimePax: 0,
    lifetimeRevenue: 0,
    lifetimeExpense: 0,
  }

  lounges.push(newLounge)
  pushLog(
    s,
    'good',
    `Opened ${tierDef.name} at ${locationName} (${CITIES[cityId]?.name ?? cityId}). Setup cost: ${fmtCompact(pkg.setupCost)}.`,
  )
  return null
}

/** Upgrade an existing lounge to a higher tier */
export function upgradeLounge(s: GameState, loungeId: string, newTier: LoungeTier): string | null {
  const lounges = getLounges(s)
  const lounge = lounges.find((l) => l.id === loungeId)
  if (!lounge) return 'Lounge not found.'
  if (lounge.tier === newTier) return 'Lounge is already at this tier.'

  const currentDef = getLoungeTierDef(lounge.tier)
  const newDef = getLoungeTierDef(newTier)
  if (newDef.sqft <= currentDef.sqft) {
    return 'Can only upgrade to a larger lounge tier.'
  }

  const upgradeCost = Math.max(0, newDef.setupCost - Math.round(currentDef.setupCost * 0.45))
  if (!canAfford(s, upgradeCost)) {
    return `Need ${fmtCompact(upgradeCost)} to expand and upgrade to ${newDef.name}.`
  }

  capitalOut(s, 'lounge_capex', upgradeCost, {
    note: `Upgraded lounge at ${lounge.locationName} to ${newDef.name}`,
  })

  lounge.tier = newTier
  pushLog(s, 'good', `Upgraded lounge at ${lounge.locationName} to ${newDef.name} (${newDef.sqft} sq ft, ${newDef.seats} seats).`)
  return null
}

/** Change a lounge's seating and amenities. Better seating costs the extra fit-out; amenities are free to change. */
export function refitLounge(
  s: GameState,
  loungeId: string,
  seating: LoungeSeating,
  amenities: LoungeAmenityId[],
): string | null {
  const lounge = getLounges(s).find((l) => l.id === loungeId)
  if (!lounge) return 'Lounge not found.'
  if (!tierAllows(lounge.tier, LOUNGE_SEATING[seating].minTier)) return `${LOUNGE_SEATING[seating].label} need a larger lounge.`
  const keep = amenities.filter((id) => tierAllows(lounge.tier, amenityDef(id).minTier))
  const before = loungePackage(lounge.tier, lounge.seating ?? 'cushioned', []).setupCost
  const after = loungePackage(lounge.tier, seating, []).setupCost
  const cost = Math.max(0, after - before)
  if (cost > 0) {
    if (!canAfford(s, cost)) return `Need ${fmtCompact(cost)} to refit the seating.`
    capitalOut(s, 'lounge_capex', cost, { note: `Seating refit: ${lounge.locationName}` })
  }
  lounge.seating = seating
  lounge.amenities = keep
  pushLog(s, 'info', `Refitted lounge at ${lounge.locationName}${cost > 0 ? ` for ${fmtCompact(cost)}` : ''}.`, '/lounges')
  return null
}

/** Close an existing lounge */
export function closeLounge(s: GameState, loungeId: string): string | null {
  const lounges = getLounges(s)
  const idx = lounges.findIndex((l) => l.id === loungeId)
  if (idx < 0) return 'Lounge not found.'

  const lounge = lounges[idx]
  // Recover 25% salvage on lease deposit & fixtures
  const salvage = Math.round(loungePackageOf(lounge, s.config?.passengerConfig).setupCost * 0.25)
  if (salvage > 0) {
    earn(s, 'other_income', salvage, {
      note: `Security deposit & fixture recovery: ${lounge.locationName}`,
    })
  }

  lounges.splice(idx, 1)
  pushLog(s, 'info', `Closed passenger lounge at ${lounge.locationName}. Recovered ${fmtCompact(salvage)} deposit.`)
  return null
}

/** Calculate demand boost multiplier for routes touching cities with passenger lounges */
export function getLoungeDemandBoost(s: GameState, routeId: string): number {
  const lounges = s.company.lounges
  if (!lounges || lounges.length === 0) return 1.0

  const route = ROUTES[routeId]
  if (!route) return 1.0

  let boost = 0
  for (const l of lounges) {
    if (l.cityId === route.from || l.cityId === route.to) {
      boost += loungePackageOf(l, s.config?.passengerConfig).conversion
    }
  }

  // Cap combined route lounge boost at +5%
  return 1.0 + Math.min(0.05, boost)
}

/**
 * Satisfaction bonus (PSS points) for passengers boarding in a city where we run a lounge.
 * Tier sets the base; each service policy adds a little. Capped so lounges help, never dominate.
 */
export function loungeServiceBonus(s: GameState, originCityId: string): number {
  const l = (s.company.lounges ?? []).find((x) => x.cityId === originCityId)
  if (!l) return 0
  const base = l.tier === 'business' ? 0.35 : l.tier === 'premium' ? 0.25 : 0.12
  return Math.max(0, Math.min(0.6, base + loungePackageOf(l, s.config?.passengerConfig).comfort))
}

/** True when any lounge runs CCTV luggage security; counts toward the Women-Friendly safety badge. */
export function loungesHaveCctv(s: GameState): boolean {
  const cfg = s.config?.passengerConfig
  return (s.company.lounges ?? []).some((l) => loungeAmenityIds(l, cfg).includes('cctv'))
}

/**
 * Daily Lounge Pass:
 * Runs once every game day in advanceDay.
 * Calculates waiting passengers, snack & beverage sales, deducts rent, electricity, and staff wages.
 */
export function dailyLoungePass(s: GameState): void {
  const lounges = getLounges(s)
  if (lounges.length === 0) return

  const pConfig = s.config?.passengerConfig ?? {}
  const rng = rngFor(s.seed, 'lounge-pass', s.day)

  // 1. Map total passenger boardings by city today
  const paxByCity: Record<string, { total: number; acPax: number }> = {}

  for (const trip of Object.values(s.trips ?? {})) {
    if (trip.day !== s.day) continue
    if (trip.status === 'cancelled') continue

    const route = ROUTES[trip.routeId]
    if (!route) continue

    const originCity = trip.direction === 'BA' ? route.to : route.from
    if (!paxByCity[originCity]) paxByCity[originCity] = { total: 0, acPax: 0 }

    const bus = trip.busId ? s.buses[trip.busId] : undefined
    const isAc = bus ? !bus.modelId.includes('nonac') && !bus.modelId.includes('ordinary') : true

    const sold = trip.sold ?? 0
    paxByCity[originCity].total += sold
    if (isAc) paxByCity[originCity].acPax += sold
  }

  // 2. Process each lounge
  for (const lounge of lounges) {
    const tierDef = getLoungeTierDef(lounge.tier)
    const pkg = loungePackageOf(lounge, pConfig)
    const cityPax = paxByCity[lounge.cityId] ?? { total: 0, acPax: 0 }

    // Consider access policy (AC tickets only vs all passengers)
    const eligiblePax = pConfig.accessPolicy === 'ac_only' ? cityPax.acPax : cityPax.total

    // Capture rate: Express ~40%, Premium ~65%, Business ~80% of departing passengers, plus amenities
    const captureRate = (lounge.tier === 'business' ? 0.80 : lounge.tier === 'premium' ? 0.65 : 0.40) + pkg.capture

    // Jittered daily capture, limited by what the seating can hold
    const jitteredRate = rJitter(rng, captureRate, 0.08)
    const rawPax = Math.round(eligiblePax * jitteredRate)
    const waitingPax = Math.min(pkg.capacity, Math.max(0, rawPax))

    // Snack & drink sales: each waiting passenger spends on tea, coffee, snacks, water
    const avgSpend = Number(tierDef.avgSnackSpend) * (1 + pkg.spend)
    const grossSnackSales = waitingPax * avgSpend
    const netSnackProfit = Math.round(grossSnackSales * tierDef.snackMargin * 1)

    // Amenity running costs: per passenger (free tea) and fixed per day
    const compBevCost = waitingPax > 0 ? Math.round(waitingPax * pkg.perPax) : 0
    const extraPolicyOpex = pkg.dailyFixed - tierDef.dailyRent - tierDef.dailyElectricity - tierDef.dailyStaffWage

    // Net Snack Revenue earned
    const totalSnackRevenue = Math.max(0, netSnackProfit)
    if (totalSnackRevenue > 0) {
      earn(s, 'lounge_revenue', totalSnackRevenue, {
        note: `lounge snack & drink sales: ${lounge.locationName} (${waitingPax} pax)`,
      })
    }

    // Fixed Daily Expenses (Rent, Electricity, Staff Wages)
    const dailyRent = tierDef.dailyRent
    const dailyElectric = tierDef.dailyElectricity
    const dailyStaffWage = tierDef.dailyStaffWage
    const totalOpex = dailyRent + dailyElectric + dailyStaffWage + compBevCost + extraPolicyOpex

    spend(s, 'lounge_opex', totalOpex, {
      note: `lounge rent, power & staff: ${lounge.locationName}`,
    })

    // Update stats on lounge record
    lounge.yesterdayPax = waitingPax
    lounge.yesterdaySnackRevenue = totalSnackRevenue
    lounge.yesterdayRentExpense = dailyRent
    lounge.yesterdayElectricExpense = dailyElectric
    lounge.yesterdayStaffExpense = dailyStaffWage + compBevCost + extraPolicyOpex
    lounge.yesterdayNetProfit = totalSnackRevenue - totalOpex

    lounge.lifetimePax += waitingPax
    lounge.lifetimeRevenue += totalSnackRevenue
    lounge.lifetimeExpense += totalOpex
  }
}
