import type {
  Bus,
  CharterContract,
  CharterOpsConfig,
  CharterPricingStrategy,
  GameState,
  ID,
  Money,
  Staff,
} from '../types'
import { CHARTER_ROUTES, type CharterRouteDef } from '../data/charterRoutes'
import { BUS_MODELS, isCargoModel, isCharterModel } from '../data/busModels'
import { CITIES } from '../data/cities'
import { BAL } from '../data/balance'
import { CHARTER_DEMAND, CHARTER_DETENTION_SHARE, CHARTER_MIN_KM_PER_DAY, capCharterPrice, charterRatePerKm } from '../data/charterRates'
import { ROUTES } from '../data/routes'
import { nextId } from '../core/ids'
import { fmtCompact, rs } from '../core/money'
import { rngFor, rInt, rPick, rChance, rPoisson } from '../core/rng'
import { earn, spend } from './finance'
import { pushLog } from './log'
import { charterManagerOnDuty } from './staffing'
import { fmtDate, isFestivalDay, toCivil } from '../core/calendar'
import { worstSubsystem } from './fleet'
import { applyWear, breakdownChance } from './dispatch'
import { healthBreakdownMult } from './health'
import { sanitizeInvalidRebodyJobs } from './maintenance'

export { charterManagerOnDuty }

export const DEFAULT_CHARTER_CONFIG: CharterOpsConfig = {
  pricingStrategy: 'market',
  operatingBaseCityId: 'maa',
  autoAccept: false,
  autoDispatch: true,
  minConditionScore: 55,
  minMarginPct: 0,
  depositPct: 0,
}

/** Get eligible operational base cities for charters: Home Depot always, plus cities with a Tour Office lounge */
export function getEligibleCharterBaseCities(s: GameState): { id: string; name: string; isHome: boolean }[] {
  const homeId = s.company.homeCityId || 'maa'
  const homeName = CITIES[homeId]?.name || 'Home Depot'
  const cities: { id: string; name: string; isHome: boolean }[] = [
    { id: homeId, name: `${homeName} (Home Depot)`, isHome: true },
  ]

  // Additional charter bases unlock ONLY when a Royal Premium Lounge & Tour Office or Royal Business Lounge is opened
  const lounges = s.company.lounges ?? []
  for (const l of lounges) {
    if (l.tier === 'premium' || l.tier === 'business') {
      if (l.cityId !== homeId && !cities.some((c) => c.id === l.cityId)) {
        const cityName = CITIES[l.cityId]?.name || l.cityId.toUpperCase()
        cities.push({ id: l.cityId, name: `${cityName} (Tour Office)`, isHome: false })
      }
    }
  }

  return cities
}

/** Get or initialize charter configuration, validating against eligible base cities */
export function getCharterConfig(s: GameState): CharterOpsConfig {
  if (!s.company.charterConfig) {
    s.company.charterConfig = {
      ...DEFAULT_CHARTER_CONFIG,
      operatingBaseCityId: s.company.homeCityId || 'maa',
    }
  }
  const eligible = getEligibleCharterBaseCities(s)
  const config = s.company.charterConfig!
  if (!eligible.some((c) => c.id === config.operatingBaseCityId)) {
    config.operatingBaseCityId = eligible[0]?.id || s.company.homeCityId || 'maa'
  }
  return s.company.charterConfig
}

/** Check if a bus is currently assigned to a running or booked charter on given dates */
export function isBusBusyOnCharter(s: GameState, busId: ID, startDay = s.day, endDay = startDay): boolean {
  return (s.charterContracts ?? []).some(
    (c) =>
      c.busId === busId &&
      (c.status === 'active' || c.status === 'booked') &&
      startDay <= c.endDay &&
      endDay >= c.startDay,
  )
}

/** Get all buses dedicated to charters */
export function getCharterFleet(s: GameState): Bus[] {
  return Object.values(s.buses ?? {}).filter(
    (b) => b.duty === 'charter' && b.status === 'active',
  )
}

export interface CharterCostBreakdown {
  fuelCost: Money
  fuelLitres: number
  fuelKmpl: number
  isElectric: boolean
  tollCost: Money
  driverBata: Money
  driverCount: number
  mealAllowanceActive: boolean
  maintenanceCost: Money
  totalDirectCost: Money
  netProfit: Money
  marginPct: number
}

/** Calculate direct operating trip costs (Fuel, Driver Bata, FASTag Tolls) strictly for an assigned vehicle */
export function calculateCharterBusCosts(
  s: GameState,
  contract: { roundTripKm: number; durationDays: number; payout: Money },
  bus: Bus,
): CharterCostBreakdown {
  const km = contract.roundTripKm
  const days = Math.max(1, contract.durationDays)
  const model = BUS_MODELS[bus.modelId]

  // 1. Fuel cost (following dispatch.ts logic)
  const isElectric = Boolean(model?.electric)
  let fuelLitres = 0
  let fuelKmpl = model?.mileage ?? 5.0
  let fuelCost = 0

  if (isElectric) {
    fuelCost = Math.round(km * BAL.electricCostPerKm)
    fuelKmpl = 0
    fuelLitres = 0
  } else {
    // Air-conditioned coach penalty (~5%)
    const effectiveKmpl = model?.ac ? Math.max(1, fuelKmpl * 0.95) : Math.max(1, fuelKmpl)
    fuelLitres = Math.round((km / effectiveKmpl) * 10) / 10
    const dieselPaise = s.world?.dieselPaise ?? 9400
    fuelCost = Math.round(fuelLitres * dieselPaise)
  }

  // 2. FASTag Tolls & Interstate Tourist Permits (₹3.50/km tolls + ₹800/day commercial entry permits)
  const tollCost = rs(Math.round(km * 3.5)) + rs(days * 800)

  // 3. Driver Outstation Bata (outstation lodging & tour allowance per driver)
  const driverCount = (km > 500 || days > 2) ? 2 : 1
  const driverBata = rs(days * driverCount * 1200)

  // 4. Maintenance wear, tyres, cleaning & vehicle standing retention allocation
  const minBillingKm = days * CHARTER_MIN_KM_PER_DAY
  const shortfallKm = Math.max(0, minBillingKm - km)
  const maintenanceCost =
    rs(Math.round(km * 5.0)) + // Running wear on tyres, engine oil, brakes
    rs(days * 400) + // Pre-trip & post-trip coach wash and sanitation
    rs(shortfallKm * 6) // Opportunity cost & holding reserve for un-run minimum days

  const totalDirectCost = fuelCost + tollCost + driverBata + maintenanceCost
  const netProfit = Math.max(0, contract.payout - totalDirectCost)
  const marginPct = contract.payout > 0 ? Math.round((netProfit / contract.payout) * 100) : 0

  return {
    fuelCost,
    fuelLitres,
    fuelKmpl,
    isElectric,
    tollCost,
    driverBata,
    driverCount,
    mealAllowanceActive: false,
    maintenanceCost,
    totalDirectCost,
    netProfit,
    marginPct,
  }
}

/** Strategy, peak-month and festival multipliers on the rate-based price. */
export function charterSeasonMult(s: GameState, peakMonths: number[]): number {
  let mult = 1
  if (peakMonths.includes(toCivil(s.day).m)) mult *= 1.15
  if (isFestivalDay(s.day)) mult *= 1.20
  return mult
}

function strategyMult(strategy: CharterPricingStrategy): number {
  return strategy === 'discount' ? 0.88 : strategy === 'premium' ? 1.20 : 1.0
}

export interface CharterPrice {
  payout: Money
  ratePerKm: number
  /** Price before the profit cap and cost floor. */
  rateBased: Money
  costs: CharterCostBreakdown
  /** The 50% profit cap cut this price. */
  capped: boolean
  /** The cost + 5% floor raised this price. */
  floored: boolean
}

/** Typical vehicle behind an indicative quote, before a coach is chosen. */
const REFERENCE_MODEL: Record<CharterRouteDef['preferredCoachKind'], string> = {
  van: 'traveller12',
  seater: 'eicher32',
  semi: 'cheetah',
  sleeper: 'leyacsleep',
}

/**
 * Price a hire for one vehicle. Running km (at least 300 a day) at the
 * vehicle's rate, the short km at detention rate, times strategy and season,
 * plus tolls, permits and driver bata passed through at cost. Then held
 * between direct cost + 5% and the 50% profit cap.
 */
export function priceCharterForVehicle(
  s: GameState,
  job: { roundTripKm: number; durationDays: number; positioningKm?: number },
  strategy: CharterPricingStrategy,
  seasonMult: number,
  bus: Pick<Bus, 'modelId'> & Partial<Bus>,
): CharterPrice {
  const model = BUS_MODELS[bus.modelId]
  const km = job.roundTripKm
  const days = Math.max(1, job.durationDays)
  const condition = bus.condition ? busHealthScore(bus as Bus) : 75
  const ratePerKm = model ? charterRatePerKm(model, condition) : 40
  const shortfallKm = Math.max(0, days * CHARTER_MIN_KM_PER_DAY - km)
  const hire = rs(km * ratePerKm + shortfallKm * ratePerKm * CHARTER_DETENTION_SHARE)

  // Tolls, permits and bata on the tour itself are billed to the client.
  const tour = calculateCharterBusCosts(s, { roundTripKm: km, durationDays: days, payout: 0 }, bus as Bus)
  const passThrough = tour.tollCost + tour.driverBata
  const rateBased = Math.round(hire * strategyMult(strategy) * seasonMult) + passThrough
  // The empty run from our base to the client's city and back is ours to pay.
  const posKm = Math.max(0, job.positioningKm ?? 0)
  const zero = posKm > 0
    ? calculateCharterBusCosts(s, { roundTripKm: km + posKm, durationDays: days, payout: 0 }, bus as Bus)
    : tour
  const { price, capped, floored } = capCharterPrice(rateBased, zero.totalDirectCost)
  // Round to ₹100 without crossing the cap or the floor.
  const round100 = capped ? Math.floor : floored ? Math.ceil : Math.round
  const payout = round100(price / rs(100)) * rs(100)
  const costs = calculateCharterBusCosts(s, { roundTripKm: km + posKm, durationDays: days, payout }, bus as Bus)
  return { payout, ratePerKm, rateBased, costs, capped, floored }
}

/** The price for this inquiry if `bus` takes it (strategy and season fixed when the inquiry came in). */
export function quoteCharterForBus(s: GameState, inq: CharterContract, bus: Bus): CharterPrice {
  return priceCharterForVehicle(s, inq, inq.pricingStrategy, inq.seasonMult ?? 1, bus)
}

/**
 * Chance the client books us rather than a rival, for this coach: our fee
 * against what a local operator would charge for the same coach (market
 * rates, no empty run), and our rating.
 */
export function charterWinChance(s: GameState, inq: CharterContract, bus: Bus): number {
  const D = CHARTER_DEMAND
  const ours = quoteCharterForBus(s, inq, bus).payout
  const market = priceCharterForVehicle(s, { ...inq, positioningKm: 0 }, 'market', inq.seasonMult ?? 1, bus).payout
  const rel = market > 0 ? ours / market : 1
  const stars = (s.company.rating ?? 3.5) - 3.5
  const p = D.winBase * Math.pow(Math.max(0.5, rel), -D.winPriceElasticity) * (1 + D.winPerStar * stars)
  return Math.max(D.winMin, Math.min(D.winMax, p))
}

const RIVAL_CHARTER_DESKS = ['KPN Travels', 'SRS Travels', 'Parveen Travels', 'VRL Travels', 'a local tour operator']

/* ------------------------------ road distances ------------------------------ */

let roadKmCache: Map<string, Map<string, number>> | null = null

/** Shortest road km between two cities over the corridor network (Dijkstra, cached). */
export function cityRoadKm(a: string, b: string): number {
  if (a === b) return 0
  if (!roadKmCache) {
    const adj = new Map<string, [string, number][]>()
    for (const r of Object.values(ROUTES)) {
      for (const [x, y] of [[r.from, r.to], [r.to, r.from]] as const) {
        if (!adj.has(x)) adj.set(x, [])
        adj.get(x)!.push([y, r.km])
      }
    }
    roadKmCache = new Map()
    for (const src of adj.keys()) {
      const dist = new Map<string, number>([[src, 0]])
      const done = new Set<string>()
      for (;;) {
        let u: string | undefined
        let best = Infinity
        for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; u = k }
        if (u === undefined) break
        done.add(u)
        for (const [v, w] of adj.get(u) ?? []) {
          const nd = best + w
          if (nd < (dist.get(v) ?? Infinity)) dist.set(v, nd)
        }
      }
      roadKmCache.set(src, dist)
    }
  }
  return roadKmCache.get(a)?.get(b) ?? 400
}

/**
 * Indicative quote for a charter route before a vehicle is chosen. Priced on
 * `bus` when given, else on a typical vehicle for the requested coach kind.
 */
export function calculateCharterQuote(
  s: GameState,
  route: CharterRouteDef,
  strategy: CharterPricingStrategy,
  bus?: Bus,
): {
  payout: Money
  fuelCostEst: Money
  tollCostEst: Money
  driverBataEst: Money
  maintenanceCostEst: Money
  netProfitEst: Money
} {
  const vehicle = bus ?? { modelId: REFERENCE_MODEL[route.preferredCoachKind] }
  const q = priceCharterForVehicle(s, route, strategy, charterSeasonMult(s, route.peakMonths), vehicle)
  return {
    payout: q.payout,
    fuelCostEst: bus ? q.costs.fuelCost : 0,
    tollCostEst: bus ? q.costs.tollCost : 0,
    driverBataEst: bus ? q.costs.driverBata : 0,
    maintenanceCostEst: bus ? q.costs.maintenanceCost : 0,
    netProfitEst: bus ? q.costs.netProfit : 0,
  }
}

/** Expected charter requests today: base city size, charter fleet, brand and the month. */
export function charterRequestRate(s: GameState): number {
  const D = CHARTER_DEMAND
  const cfg = getCharterConfig(s)
  const fleet = getCharterFleet(s).length
  const fleetFactor = fleet === 0 ? D.noFleetFactor : Math.min(D.fleetFactorMax, Math.sqrt(fleet))
  const stars = (s.company.rating ?? 3.5) - 3.5
  const brand = Math.max(0.5, Math.min(1.6, 1 + 0.2 * stars + 0.4 * ((s.company.brandAwareness ?? 0) - 0.2)))
  const metro = CITIES[cfg.operatingBaseCityId]?.metro ?? 0.3
  const city = 0.6 + 0.6 * metro
  const month = D.monthFactor[toCivil(s.day).m - 1] ?? 1
  return D.baseRequestsPerDay * fleetFactor * brand * city * month
}

function weightedPick<T>(rng: () => number, items: readonly T[], weight: (x: T) => number): T {
  let total = 0
  for (const x of items) total += weight(x)
  let roll = rng() * total
  for (const x of items) {
    roll -= weight(x)
    if (roll <= 0) return x
  }
  return items[items.length - 1]!
}

/** Generate incoming charter inquiries */
export function generateCharterInquiries(s: GameState): void {
  if (!s.charterInquiries) s.charterInquiries = []
  const D = CHARTER_DEMAND

  const cfg = getCharterConfig(s)
  const charterFleet = getCharterFleet(s)
  const maxPending = Math.min(D.pendingMax, D.pendingBase + 2 * Math.max(1, charterFleet.length))
  if (s.charterInquiries.length >= maxPending) return

  const rng = rngFor(s.seed, 'charter-inq', s.day)
  const hasCharterVans = charterFleet.some((b) => {
    const m = BUS_MODELS[b.modelId]
    return m && (m.seats <= 17 || isCharterModel(m))
  })

  let candidateRoutes = CHARTER_ROUTES
  if (!hasCharterVans) {
    // Standard bus operator: inquiries are for semi-sleeper and sleeper buses (minSeats >= 20)
    candidateRoutes = CHARTER_ROUTES.filter((r) => r.preferredCoachKind !== 'van' && r.minSeats >= 20)
    if (candidateRoutes.length === 0) candidateRoutes = CHARTER_ROUTES
  }

  // Clients near our base find us first; tours in their own season are asked for more.
  const base = cfg.operatingBaseCityId
  const month = toCivil(s.day).m
  const routeWeight = (r: CharterRouteDef) => {
    const d = cityRoadKm(base, r.originCityId)
    const near = 1 / (1 + (d / D.baseHalfWeightKm) ** 2)
    return near * (r.peakMonths.includes(month) ? D.peakRouteWeight : 1)
  }

  const count = rPoisson(rng, charterRequestRate(s))
  for (let i = 0; i < count; i++) {
    if (s.charterInquiries.length >= maxPending) break

    const route = weightedPick(rng, candidateRoutes, routeWeight)
    const clientName = rPick(rng, route.clientTypes)
    const positioningKm = 2 * cityRoadKm(base, route.originCityId)

    // Booking lead: most clients plan weeks ahead (weddings furthest), a few call last-minute.
    const [lo, hi] = D.leadDays[route.category] ?? [7, 30]
    const lead = rChance(rng, D.lastMinuteShare) ? rInt(rng, 1, 6) : rInt(rng, lo, hi)
    const startDay = s.day + lead
    const endDay = startDay + route.durationDays - 1
    const seasonMult = charterSeasonMult(s, route.peakMonths)
    const indicative = priceCharterForVehicle(
      s,
      { roundTripKm: route.roundTripKm, durationDays: route.durationDays, positioningKm },
      cfg.pricingStrategy,
      seasonMult,
      { modelId: REFERENCE_MODEL[route.preferredCoachKind] },
    )

    const inquiry: CharterContract = {
      id: nextId(s.ids, 'chtr'),
      title: route.title,
      category: route.category,
      clientName,
      originCityId: route.originCityId,
      destinationName: route.destinationName,
      roundTripKm: route.roundTripKm,
      durationDays: route.durationDays,
      preferredCoachKind: route.preferredCoachKind,
      minSeats: route.minSeats,
      minCondition: cfg.pricingStrategy === 'premium' ? 75 : 50,
      payout: indicative.payout,
      seasonMult,
      positioningKm,
      respondByDay: Math.min(startDay - 1, s.day + D.answerDays),
      fuelCostEst: 0,
      tollCostEst: 0,
      driverBataEst: 0,
      maintenanceCostEst: 0,
      netProfitEst: 0,
      startDay,
      endDay,
      currentDayProgress: 0,
      status: 'inquiry',
      pricingStrategy: cfg.pricingStrategy,
      notes: route.description,
    }

    s.charterInquiries.push(inquiry)
  }
}

/** Compute health/condition percentage for a bus */
export function busHealthScore(bus: Bus): number {
  if (typeof bus.condition === 'number') return bus.condition
  if (!bus.condition) return 80
  return worstSubsystem(bus.condition)
}

/** Drivers who can take a charter on this coach: posted to it, or not posted anywhere. Line drivers are never poached. */
function charterDriverPool(s: GameState, bus: Bus): Staff[] {
  return Object.values(s.staff).filter((st) => {
    if (st.role !== 'driver' && st.role !== 'co_driver') return false
    if (st.busId === bus.id || !st.busId) return true
    const postedBus = s.buses[st.busId]
    if (postedBus && !postedBus.scheduleId && postedBus.status === 'active') return true
    return false
  })
}

/** Why no driver can take this tour, or null when one can. Counts tours that overlap the same dates. */
export function charterDriverShortfall(s: GameState, bus: Bus, contract: { startDay: number; endDay: number; id?: ID }): string | null {
  const pool = charterDriverPool(s, bus)
  if (pool.length === 0) return 'No driver: post one to this coach or leave one unassigned'
  const overlapping = (s.charterContracts ?? []).filter(
    (c) => c.id !== contract.id && (c.status === 'active' || c.status === 'booked') && contract.startDay <= c.endDay && contract.endDay >= c.startDay,
  ).length
  if (pool.length <= overlapping) return 'All spare drivers are on other tours then'
  return null
}

/** A rested driver for today: prefers the one posted to the coach, then the least tired. */
function pickCharterDriver(s: GameState, bus: Bus, taken: Set<ID>): Staff | undefined {
  return charterDriverPool(s, bus)
    .filter(
      (st) =>
        !taken.has(st.id) &&
        !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) &&
        (st.nightRestUntilDay ?? 0) <= s.day &&
        st.fatigue < 80,
    )
    .sort((a, b) => Number(b.busId === bus.id) - Number(a.busId === bus.id) || a.fatigue - b.fatigue || b.skill - a.skill)[0]
}

/** Check if a bus satisfies inquiry requirements */
export function canBusTakeContract(
  bus: Bus,
  contract: CharterContract,
  day?: number,
  allowIdleLineCoach = false,
): { ok: boolean; reason?: string } {
  if (bus.duty !== 'charter' && (!allowIdleLineCoach || bus.scheduleId || isCargoModel(bus.modelId))) {
    return { ok: false, reason: 'Bus must be dedicated to charter duty' }
  }
  if (bus.status !== 'active') return { ok: false, reason: `Bus status is ${bus.status}` }
  const checkDay = contract.endDay ?? day ?? 0
  if (bus.insuranceExpiryDay < checkDay || bus.fitnessExpiryDay < checkDay || bus.fitnessFailed) {
    return { ok: false, reason: 'Insurance or fitness papers lapse before the tour ends — renew first' }
  }
  const m = BUS_MODELS[bus.modelId]
  const seats = m?.seats ?? 0
  if (seats < contract.minSeats) {
    return { ok: false, reason: `Needs ${contract.minSeats} seats (bus has ${seats})` }
  }
  const health = busHealthScore(bus)
  if (health < contract.minCondition) {
    return { ok: false, reason: `Condition ${health}% is below required ${contract.minCondition}%` }
  }
  return { ok: true }
}

/** Accept and book an inquiry with an assigned charter bus */
export function acceptCharterInquiry(s: GameState, inquiryId: ID, busId: ID): string | null {
  if (!s.charterInquiries) s.charterInquiries = []
  if (!s.charterContracts) s.charterContracts = []

  const inqIdx = s.charterInquiries.findIndex((i) => i.id === inquiryId)
  if (inqIdx === -1) return 'Inquiry not found or expired.'
  const inq = s.charterInquiries[inqIdx]

  const bus = s.buses[busId]
  if (!bus) return 'Bus not found.'

  if (bus.duty !== 'charter' && !bus.scheduleId && bus.status === 'active' && !isCargoModel(bus.modelId)) {
    bus.duty = 'charter'
  }

  const check = canBusTakeContract(bus, inq, undefined, true)
  if (!check.ok) return check.reason ?? 'Cannot assign bus'

  if (isBusBusyOnCharter(s, busId, inq.startDay, inq.endDay)) {
    return 'This bus is already booked on another charter during those dates.'
  }
  const noDriver = charterDriverShortfall(s, bus, inq)
  if (noDriver) return noDriver + '.'

  // Rival bids: the client may book someone else at our price.
  const win = charterWinChance(s, inq, bus)
  const bidRng = rngFor(s.seed, 'charter-bid', inq.id)
  if (!rChance(bidRng, win)) {
    const rival = rPick(bidRng, RIVAL_CHARTER_DESKS)
    s.charterInquiries.splice(inqIdx, 1)
    pushLog(s, 'info', `CHARTER LOST: ${inq.clientName} booked ${rival} for ${inq.title} (we had a ${Math.round(win * 100)}% chance at our quote).`)
    return `Lost the bid: ${inq.clientName} went with ${rival}.`
  }

  // Price and cost strictly with the exact selected bus
  const priced = quoteCharterForBus(s, inq, bus)
  const costs = priced.costs

  inq.payout = priced.payout
  inq.busId = bus.id
  inq.status = 'booked'
  inq.fuelCostEst = costs.fuelCost
  inq.tollCostEst = costs.tollCost
  inq.driverBataEst = costs.driverBata
  inq.maintenanceCostEst = costs.maintenanceCost
  inq.netProfitEst = costs.netProfit

  // Deposit: part of the fee is collected up front
  const depositPct = getCharterConfig(s).depositPct ?? 0
  if (depositPct > 0) {
    const deposit = Math.round((inq.payout * depositPct) / 100)
    if (deposit > 0) {
      earn(s, 'charter', deposit, { busId: bus.id, note: `Charter deposit: ${inq.title} (${inq.clientName})` })
      s.curMonth.charterPrivateRevenue = (s.curMonth.charterPrivateRevenue ?? 0) + deposit
      inq.depositPaid = deposit
    }
  }

  s.charterInquiries.splice(inqIdx, 1)
  s.charterContracts.push(inq)

  pushLog(
    s,
    'good',
    `CHARTER SIGNED: Booked ${inq.title} for ${inq.clientName} with ${bus.reg} (${fmtCompact(inq.payout)} payout · ${inq.durationDays} days · starts ${fmtDate(inq.startDay)}).`,
  )

  return null
}

/** Reject / decline an inquiry */
export function rejectCharterInquiry(s: GameState, inquiryId: ID): string | null {
  if (!s.charterInquiries) return null
  const idx = s.charterInquiries.findIndex((i) => i.id === inquiryId)
  if (idx !== -1) {
    s.charterInquiries.splice(idx, 1)
  }
  return null
}

/** Complete an active contract and disburse revenues and expenses */
function completeCharterContract(s: GameState, contract: CharterContract): void {
  contract.status = 'completed'
  contract.currentDayProgress = contract.durationDays

  const bus = contract.busId ? s.buses[contract.busId] : undefined

  // Real-world risk: the same wear and breakdown model line trips use.
  // A neglected coach can now fail mid-tour, costing the client's goodwill and part of the fee.
  let brokeDown = false
  if (bus) {
    const rng = rngFor(s.seed, 'charter-risk', contract.id)
    applyWear(s, bus, contract.roundTripKm)
    const perDay = Math.min(0.35, breakdownChance(bus) * healthBreakdownMult(s))
    const p = 1 - Math.pow(1 - perDay, Math.max(1, contract.durationDays))
    brokeDown = rChance(rng, Math.min(0.6, p))
  }
  const penalty = brokeDown ? Math.round(contract.payout * 0.15) : 0
  const payout = contract.payout - penalty
  if (brokeDown && bus) {
    const repair = Math.round(rs(6_000) + contract.roundTripKm * 4)
    spend(s, 'maintenance', repair, {
      busId: bus.id,
      note: `Charter breakdown recovery: ${contract.title}`,
    })
    contract.notes = `${contract.notes ?? ''} Breakdown en route: fee cut ${fmtCompact(penalty)}, recovery ${fmtCompact(repair)}.`.trim()
    pushLog(
      s,
      'alert',
      `CHARTER BREAKDOWN: ${bus.reg} failed during ${contract.title}. ${contract.clientName} cut the fee by ${fmtCompact(penalty)}. Service the coach before the next tour.`,
      `/fleet/${bus.id}`,
    )
  }

  // Earn revenue
  // The deposit was collected at booking; the balance arrives now
  const balance = Math.max(0, payout - (contract.depositPaid ?? 0))
  earn(s, 'charter', balance, {
    busId: contract.busId,
    note: `Charter Payout: ${contract.title} (${contract.clientName})`,
  })
  s.curMonth.charterPrivateRevenue = (s.curMonth.charterPrivateRevenue ?? 0) + balance
  contract.completedRevenue = payout

  // Settle direct costs (fuel, fastag tolls & permits, driver daily bata, maintenance & prep)
  const maintCost = contract.maintenanceCostEst ?? 0
  const totalCost = contract.fuelCostEst + contract.tollCostEst + contract.driverBataEst + maintCost
  spend(s, 'fuel', contract.fuelCostEst, {
    busId: contract.busId,
    note: `Charter Fuel: ${contract.title} (${contract.roundTripKm} km)`,
  })
  spend(s, 'toll', contract.tollCostEst, {
    busId: contract.busId,
    note: `Charter Toll & Permits: ${contract.title}`,
  })
  spend(s, 'bata', contract.driverBataEst, {
    busId: contract.busId,
    note: `Charter Driver Bata: ${contract.title}`,
  })
  if (maintCost > 0) {
    spend(s, 'maintenance', maintCost, {
      busId: contract.busId,
      note: `Charter Wear & Prep: ${contract.title}`,
    })
  }
  contract.completedExpenses = totalCost

  const driver = contract.driverId ? s.staff[contract.driverId] : undefined
  if (driver) {
    driver.fatigue = Math.min(100, Math.max(driver.fatigue, 35))
    driver.lastTripDay = s.day
  }

  const netProfit = payout - totalCost

  // Client Rating
  let rating = brokeDown ? 3.0 : 4.5
  if (bus) {
    // odometer and wear were already applied by applyWear above
    bus.busCleanliness = Math.max(25, bus.busCleanliness - 12 * contract.durationDays)
    bus.lifeRevenue += payout
    bus.lifeCost += totalCost
    bus.lifeTrips += 1

    if (bus.busCleanliness > 80) rating += 0.4
    if (bus.qualityScore >= 4.0) rating += 0.2
    if (contract.preferredCoachKind === 'sleeper' && (BUS_MODELS[bus.modelId]?.sleeper || bus.modelId.includes('slp'))) {
      rating += 0.3
    }
  }
  contract.clientRating = Math.min(5.0, Math.round(rating * 10) / 10)

  // Charter clients are customers too: their verdict moves company standing like a line trip does.
  s.company.rating = Math.max(1, Math.min(5, Math.round((s.company.rating * 0.97 + contract.clientRating * 0.03) * 100) / 100))
  s.company.reputation = Math.max(
    0,
    Math.min(100, s.company.reputation + (brokeDown ? -1.5 : contract.clientRating >= 4.5 ? 0.6 : 0.2)),
  )
  const grp = bus?.groupId && s.groups ? s.groups[bus.groupId] : undefined
  if (grp) grp.rating = Math.max(1, Math.min(5, Math.round((grp.rating * 0.97 + contract.clientRating * 0.03) * 100) / 100))

  // Update history (keep last 50)
  if (!s.charterHistory) s.charterHistory = []
  s.charterHistory.unshift(contract)
  if (s.charterHistory.length > 50) s.charterHistory.pop()

  // Update lifetime stats
  if (!s.charterStats) {
    s.charterStats = { totalContracts: 0, totalRevenue: 0, totalProfit: 0, avgRating: 4.8 }
  }
  s.charterStats.totalContracts += 1
  s.charterStats.totalRevenue += payout
  s.charterStats.totalProfit += netProfit
  s.charterStats.avgRating =
    Math.round(
      ((s.charterStats.avgRating * (s.charterStats.totalContracts - 1) + contract.clientRating) /
        s.charterStats.totalContracts) *
        10,
    ) / 10

  pushLog(
    s,
    'good',
    `CHARTER COMPLETED: ${contract.title} finished by ${bus?.reg || 'coach'}. Earned ${fmtCompact(payout)} (+${fmtCompact(netProfit)} net profit) · Client Rating ${contract.clientRating}★.`,
  )
}

/** Sanitize charter data to guard against NaN values or uncalibrated historic quotes */
export function sanitizeCharterData(s: GameState): void {
  sanitizeInvalidRebodyJobs(s)
  // Cash sanity
  if (typeof s.company.cash !== 'number' || Number.isNaN(s.company.cash)) {
    s.company.cash = rs(2_500_000)
  }
  if (typeof s.curMonth.revenueTotal !== 'number' || Number.isNaN(s.curMonth.revenueTotal)) {
    s.curMonth.revenueTotal = 0
  }
  if (typeof s.curMonth.profit !== 'number' || Number.isNaN(s.curMonth.profit)) {
    s.curMonth.profit = 0
  }
  if (typeof s.curMonth.expenseTotal !== 'number' || Number.isNaN(s.curMonth.expenseTotal)) {
    s.curMonth.expenseTotal = 0
  }
  if (typeof s.company.fyRevenue !== 'number' || Number.isNaN(s.company.fyRevenue)) {
    s.company.fyRevenue = 0
  }
  if (typeof s.company.fyProfit !== 'number' || Number.isNaN(s.company.fyProfit)) {
    s.company.fyProfit = 0
  }
  if (typeof s.lifetimeProfit !== 'number' || Number.isNaN(s.lifetimeProfit)) {
    s.lifetimeProfit = s.company.cash
  }

  // Lifetime stats sanity
  if (s.charterStats) {
    if (Number.isNaN(s.charterStats.totalRevenue) || s.charterStats.totalRevenue > rs(50_000_000)) {
      s.charterStats.totalRevenue = 0
    }
    if (Number.isNaN(s.charterStats.totalProfit) || s.charterStats.totalProfit > rs(50_000_000)) {
      s.charterStats.totalProfit = 0
    }
    if (Number.isNaN(s.charterStats.avgRating)) {
      s.charterStats.avgRating = 4.8
    }
  }

  // Sanitize existing open inquiries and active/booked contracts with inflated payouts
  const sanitizeItem = (item: CharterContract) => {
    const route = CHARTER_ROUTES.find((r) => r.title === item.title)
    const bus = item.busId ? s.buses[item.busId] : undefined
    if (route) {
      const q = calculateCharterQuote(s, route, item.pricingStrategy || 'market', bus)
      if (item.payout > rs(120_000) || item.payout <= 0 || Number.isNaN(item.payout) || !item.maintenanceCostEst) {
        item.payout = q.payout
      }
    } else if (item.payout > rs(120_000) || item.payout <= 0 || Number.isNaN(item.payout)) {
      item.payout = rs(25_000)
    }
    if (bus) {
      const costs = calculateCharterBusCosts(s, item, bus)
      item.fuelCostEst = costs.fuelCost
      item.tollCostEst = costs.tollCost
      item.driverBataEst = costs.driverBata
      item.maintenanceCostEst = costs.maintenanceCost
      item.netProfitEst = costs.netProfit
    }
  }
  for (const inq of s.charterInquiries ?? []) sanitizeItem(inq)
  for (const c of s.charterContracts ?? []) sanitizeItem(c)

  // Recalibrate completed history contracts so profit margins match South India market economics (28-35%)
  for (const h of s.charterHistory ?? []) {
    const route = CHARTER_ROUTES.find((r) => r.title === h.title)
    if (route) {
      const q = calculateCharterQuote(s, route, h.pricingStrategy || 'market')
      if (h.payout > q.payout * 1.35) {
        h.payout = q.payout
        if (h.completedRevenue) h.completedRevenue = q.payout
      }
    }
    const bus = h.busId ? s.buses[h.busId] : undefined
    if (bus) {
      const costs = calculateCharterBusCosts(s, h, bus)
      h.fuelCostEst = costs.fuelCost
      h.tollCostEst = costs.tollCost
      h.driverBataEst = costs.driverBata
      h.maintenanceCostEst = costs.maintenanceCost
      h.completedExpenses = costs.totalDirectCost
      h.netProfitEst = costs.netProfit
    } else {
      const estCosts = Math.round(h.payout * 0.70)
      if (!h.completedExpenses || h.completedExpenses < estCosts * 0.8) {
        h.completedExpenses = estCosts
      }
    }
  }

  // Update lifetime charter stats to reconcile with history
  if (s.charterStats && s.charterHistory && s.charterHistory.length > 0) {
    let totRev = 0
    let totProfit = 0
    for (const h of s.charterHistory) {
      const rev = h.completedRevenue ?? h.payout
      const exp = h.completedExpenses ?? (h.fuelCostEst + h.tollCostEst + h.driverBataEst + (h.maintenanceCostEst ?? 0))
      totRev += rev
      totProfit += Math.max(0, rev - exp)
    }
    s.charterStats.totalRevenue = totRev
    s.charterStats.totalProfit = totProfit
  }
}

/** Score a bus for how well it matches a contract's passenger sizing and preferences */
export function scoreBusForContract(bus: Bus, inq: CharterContract): number {
  const m = BUS_MODELS[bus.modelId]
  const seats = m?.seats ?? 36
  const excessSeats = Math.max(0, seats - inq.minSeats)

  let score = 100
  // Right-sizing penalty: -2 points per excess seat to avoid putting heavy multi-axles on small tours
  score -= excessSeats * 2

  // Layout affinity
  const isSleeper = Boolean(m?.sleeper || bus.modelId.includes('slp'))
  if (inq.preferredCoachKind === 'sleeper' && isSleeper) score += 40
  if (inq.preferredCoachKind === 'semi' && !isSleeper) score += 30
  if (inq.preferredCoachKind === 'semi' && isSleeper) score -= 25

  // Bus condition & cleanliness
  score += busHealthScore(bus) * 0.2
  score += (bus.busCleanliness ?? 80) * 0.1

  return score
}

/**
 * Smart Auto-Accept for appointed Charter Manager:
 * Evaluates available dedicated charter coaches, calculates direct operating expenses (Fuel, Bata, Tolls),
 * and automatically assigns the most profitable, best-matched coach for pipeline inquiries.
 */
export interface AutoAssignDetails {
  assigned: number
  bidsLost: number
  inquiriesProcessed: number
  reason?: string
}

export function autoAssignChartersWithDetails(s: GameState): AutoAssignDetails {
  if (!s.charterInquiries || s.charterInquiries.length === 0) {
    return { assigned: 0, bidsLost: 0, inquiriesProcessed: 0, reason: 'No open charter inquiries to assign.' }
  }
  const manager = charterManagerOnDuty(s)
  if (!manager) {
    return { assigned: 0, bidsLost: 0, inquiriesProcessed: 0, reason: 'Appoint a Charter Manager first.' }
  }

  sanitizeCharterData(s)

  let assignedCount = 0
  let bidsLostCount = 0
  const inquiries = [...s.charterInquiries]

  const dedicated = getCharterFleet(s)
  const idleDepotCoaches = Object.values(s.buses ?? {}).filter(
    (b) => b.duty !== 'charter' && b.status === 'active' && !b.scheduleId && !isCargoModel(b.modelId),
  )
  const candidateFleet = [...dedicated, ...idleDepotCoaches]

  if (candidateFleet.length === 0) {
    return { assigned: 0, bidsLost: 0, inquiriesProcessed: 0, reason: 'No coaches available in depot or charter fleet. Free a coach from route schedule or buy one.' }
  }

  const blockerReasons = new Set<string>()

  for (const inq of inquiries) {
    const eligibleBuses = candidateFleet.filter((bus) => {
      const check = canBusTakeContract(bus, inq, undefined, true)
      if (!check.ok) {
        if (check.reason) blockerReasons.add(check.reason)
        return false
      }
      if (isBusBusyOnCharter(s, bus.id, inq.startDay, inq.endDay)) {
        blockerReasons.add('Coach booked on overlapping dates')
        return false
      }
      const shortfall = charterDriverShortfall(s, bus, inq)
      if (shortfall) {
        blockerReasons.add(shortfall)
        return false
      }
      return true
    })

    if (eligibleBuses.length === 0) continue

    let bestBus: Bus | null = null
    let bestProfit = -Infinity

    for (const b of eligibleBuses) {
      const costs = quoteCharterForBus(s, inq, b).costs
      if (costs.marginPct < (getCharterConfig(s).minMarginPct ?? 0)) continue
      const score = scoreBusForContract(b, inq)
      const weightedProfit = costs.netProfit + score * 1000
      if (weightedProfit > bestProfit) {
        bestProfit = weightedProfit
        bestBus = b
      }
    }

    if (bestBus) {
      const err = acceptCharterInquiry(s, inq.id, bestBus.id)
      if (!err) {
        assignedCount++
      } else if (err.includes('Lost the bid')) {
        bidsLostCount++
      }
    }
  }

  let finalReason: string | undefined
  if (assignedCount === 0 && bidsLostCount === 0) {
    if (blockerReasons.size > 0) {
      finalReason = Array.from(blockerReasons).slice(0, 2).join('; ')
    } else {
      finalReason = 'No available charter coach meets profit margin threshold or inquiry requirements.'
    }
  }

  return {
    assigned: assignedCount,
    bidsLost: bidsLostCount,
    inquiriesProcessed: assignedCount + bidsLostCount,
    reason: finalReason,
  }
}

export function autoAssignBestCharters(s: GameState): number {
  return autoAssignChartersWithDetails(s).assigned
}

/** Daily charter simulation tick */
export function dailyCharterPass(s: GameState): void {
  if (!s.charterContracts) s.charterContracts = []
  if (!s.charterInquiries) s.charterInquiries = []

  sanitizeCharterData(s)

  const cfg = getCharterConfig(s)
  const manager = charterManagerOnDuty(s)

  // 1. Expire inquiries the client stopped waiting on (or that start today)
  s.charterInquiries = s.charterInquiries.filter((inq) => s.day < inq.startDay && s.day <= (inq.respondByDay ?? inq.startDay - 1))

  // 2. Generate new inquiries
  generateCharterInquiries(s)

  // 3. Manager Auto-Accept & Auto-Dispatch if enabled
  if (manager && cfg.autoAccept) {
    autoAssignBestCharters(s)
  }

  // 4. Progress active and booked contracts
  const stillActiveOrBooked: CharterContract[] = []

  for (const c of s.charterContracts) {
    // If booked and today is startDay, dispatch once a driver is free
    if (c.status === 'booked' && s.day >= c.startDay) {
      const bus = c.busId ? s.buses[c.busId] : undefined
      const taken = new Set(s.charterContracts.map((x) => x.driverId).filter(Boolean) as ID[])
      const onStrike = Boolean(s.world.strikeUntilDay && s.world.strikeUntilDay >= s.day)
      const driver = bus && bus.status === 'active' && !onStrike ? pickCharterDriver(s, bus, taken) : undefined
      if (!driver) {
        if (s.day > c.startDay + 1) {
          // Two days late with no crew: the client walks away and talks.
          c.status = 'cancelled'
          if (c.depositPaid) spend(s, 'refund', c.depositPaid, { busId: c.busId, note: `Charter deposit refunded: ${c.title}` })
          s.company.reputation = Math.max(0, s.company.reputation - 1)
          pushLog(
            s,
            'alert',
            `CHARTER CANCELLED: no driver or coach for ${c.title} (${c.clientName}) by ${fmtDate(c.startDay + 1)}. The client walked away. Reputation -1.`,
            '/charters',
          )
          continue
        }
        if (s.day === c.startDay) {
          pushLog(s, 'alert', `CHARTER WAITING: ${c.title} has no free driver or coach today. It is cancelled if none is found by tomorrow.`, '/staff')
        }
        stillActiveOrBooked.push(c)
        continue
      }
      c.driverId = driver.id
      driver.lastTripDay = s.day
      driver.fatigue = Math.min(100, driver.fatigue + 14)
      c.status = 'active'
      c.currentDayProgress = 1
      pushLog(
        s,
        'info',
        `CHARTER DISPATCHED: ${bus?.reg || 'Coach'} with ${driver.name} departed on ${c.title} for ${c.clientName} (${c.durationDays} day tour).`,
      )
      stillActiveOrBooked.push(c)
      continue
    }

    // If active, increment progress
    if (c.status === 'active') {
      c.currentDayProgress += 1
      const tourDriver = c.driverId ? s.staff[c.driverId] : undefined
      if (tourDriver) {
        tourDriver.fatigue = Math.min(100, tourDriver.fatigue + 18)
        tourDriver.lastTripDay = s.day // on the road: no overnight reset
      }

      // Check if finished
      if (c.currentDayProgress >= c.durationDays || s.day > c.endDay) {
        completeCharterContract(s, c)
      } else {
        stillActiveOrBooked.push(c)
      }
      continue
    }

    if (c.status === 'booked') {
      stillActiveOrBooked.push(c)
    }
  }

  s.charterContracts = stillActiveOrBooked
}
