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
import { BUS_MODELS, isCharterModel } from '../data/busModels'
import { CITIES } from '../data/cities'
import { BAL, driverBataForKm } from '../data/balance'
import { nextId } from '../core/ids'
import { fmtCompact, rs } from '../core/money'
import { rngFor, rInt, rPick, rChance } from '../core/rng'
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

  // 2. FASTag Tolls (matching dispatch.ts ₹3.00/km)
  const tollCost = rs(Math.round(km * 3.0))

  // 3. Driver Bata (matching dispatch.ts driverBataForKm & meal allowance)
  const driverCount = (km > 500 || days > 2) ? 2 : 1
  const dailyKm = Math.max(150, Math.round(km / days))
  const dailyBataPerDriver = driverBataForKm(dailyKm)
  const mealAllowanceActive = Boolean(s.config?.mealAllowance)
  const driverBata = mealAllowanceActive ? 0 : dailyBataPerDriver * driverCount * days

  const totalDirectCost = fuelCost + tollCost + driverBata
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
    mealAllowanceActive,
    totalDirectCost,
    netProfit,
    marginPct,
  }
}

/** Calculate quote for a charter route */
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
  netProfitEst: Money
} {
  const km = route.roundTripKm
  const days = Math.max(1, route.durationDays)
  // Standard Indian omnibus hire: minimum 300 km billing per day
  const billableKm = Math.max(km, days * 300)

  // Calibrated real-world market rates per km for private bus rental in South India
  let ratePerKm = 52
  if (route.preferredCoachKind === 'sleeper') {
    ratePerKm = 66
  } else if (route.preferredCoachKind === 'semi') {
    ratePerKm = 52
  } else if (route.preferredCoachKind === 'seater') {
    ratePerKm = 46
  } else if (route.preferredCoachKind === 'van') {
    ratePerKm = 34
  }

  // Base contract payout
  const baseKmPricePaise = rs(billableKm * ratePerKm)
  // Allowance for driver outstation bata and tolls included in omnibus hire package
  const baseTollPaise = rs(Math.round(km * 3.0))
  const baseBataPaise = rs(days * 1000)
  const basePricePaise = baseKmPricePaise + baseTollPaise + baseBataPaise

  // Strategy adjustment
  let mult = 1.0
  if (strategy === 'discount') mult = 0.88 // 12% discount
  else if (strategy === 'premium') mult = 1.20 // 20% luxury premium

  // Seasonal peak adjustments
  const civil = toCivil(s.day)
  if (route.peakMonths.includes(civil.m)) mult *= 1.15
  if (isFestivalDay(s.day)) mult *= 1.20

  const payout = Math.round(basePricePaise * mult)

  if (bus) {
    const costs = calculateCharterBusCosts(s, { roundTripKm: km, durationDays: days, payout }, bus)
    return {
      payout,
      fuelCostEst: costs.fuelCost,
      tollCostEst: costs.tollCost,
      driverBataEst: costs.driverBata,
      netProfitEst: costs.netProfit,
    }
  }

  return {
    payout,
    fuelCostEst: 0,
    tollCostEst: 0,
    driverBataEst: 0,
    netProfitEst: 0,
  }
}

/** Generate incoming charter inquiries */
export function generateCharterInquiries(s: GameState): void {
  if (!s.charterInquiries) s.charterInquiries = []

  // Max 6 pending inquiries
  if (s.charterInquiries.length >= 6) return

  const cfg = getCharterConfig(s)
  const rng = rngFor(s.seed, 'charter-inq', s.day)

  // Do not restrict candidate routes based on operating city or van size!
  // South India charter inquiries arrive across all popular circuits.
  // Standard coaches are 30-50 seaters (semi-sleeper and sleeper).
  const charterFleet = getCharterFleet(s)
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

  // Count to generate (1 or 2 per day)
  const count = rChance(rng, 0.65) ? 2 : 1

  for (let i = 0; i < count; i++) {
    if (s.charterInquiries.length >= 6) break

    // Indian market split: 75% Semi-sleeper / Seater, 25% Full-sleeper
    const preferSleeper = rChance(rng, 0.25)
    let pool = candidateRoutes.filter((r) =>
      preferSleeper ? r.preferredCoachKind === 'sleeper' : r.preferredCoachKind !== 'sleeper',
    )
    if (pool.length === 0) pool = candidateRoutes

    const route = rPick(rng, pool)
    const clientName = rPick(rng, route.clientTypes)
    const quote = calculateCharterQuote(s, route, cfg.pricingStrategy)

    // Start day between tomorrow and 4 days out
    const startDay = s.day + rInt(rng, 1, 4)
    const endDay = startDay + route.durationDays - 1

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
      payout: quote.payout,
      fuelCostEst: 0,
      tollCostEst: 0,
      driverBataEst: 0,
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
  return Object.values(s.staff).filter(
    (st) => (st.role === 'driver' || st.role === 'co_driver') && (st.busId === bus.id || !st.busId),
  )
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
export function canBusTakeContract(bus: Bus, contract: CharterContract, day?: number): { ok: boolean; reason?: string } {
  if (bus.duty !== 'charter') return { ok: false, reason: 'Bus must be dedicated to charter duty' }
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

  const check = canBusTakeContract(bus, inq)
  if (!check.ok) return check.reason ?? 'Cannot assign bus'

  if (isBusBusyOnCharter(s, busId, inq.startDay, inq.endDay)) {
    return 'This bus is already booked on another charter during those dates.'
  }
  const noDriver = charterDriverShortfall(s, bus, inq)
  if (noDriver) return noDriver + '.'

  // Calculate direct costs strictly with the exact selected bus
  const costs = calculateCharterBusCosts(s, inq, bus)

  inq.busId = bus.id
  inq.status = 'booked'
  inq.fuelCostEst = costs.fuelCost
  inq.tollCostEst = costs.tollCost
  inq.driverBataEst = costs.driverBata
  inq.netProfitEst = costs.netProfit

  // Deposit: part of the fee is collected up front
  const depositPct = getCharterConfig(s).depositPct ?? 0
  if (depositPct > 0) {
    const deposit = Math.round((inq.payout * depositPct) / 100)
    if (deposit > 0) {
      earn(s, 'charter', deposit, { busId: bus.id, note: `Charter deposit: ${inq.title} (${inq.clientName})` })
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
  contract.completedRevenue = payout

  // Settle direct costs (fuel, fastag tolls, driver daily bata)
  const totalCost = contract.fuelCostEst + contract.tollCostEst + contract.driverBataEst
  spend(s, 'fuel', contract.fuelCostEst, {
    busId: contract.busId,
    note: `Charter Fuel: ${contract.title} (${contract.roundTripKm} km)`,
  })
  spend(s, 'toll', contract.tollCostEst, {
    busId: contract.busId,
    note: `Charter Toll: ${contract.title}`,
  })
  spend(s, 'bata', contract.driverBataEst, {
    busId: contract.busId,
    note: `Charter Driver Bata: ${contract.title}`,
  })
  contract.completedExpenses = totalCost

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
    if (item.payout > rs(350_000) || item.payout <= 0 || Number.isNaN(item.payout)) {
      if (route) {
        const q = calculateCharterQuote(s, route, item.pricingStrategy || 'market', bus)
        item.payout = q.payout
      } else {
        item.payout = rs(40_000)
      }
    }
    if (bus) {
      const costs = calculateCharterBusCosts(s, item, bus)
      item.fuelCostEst = costs.fuelCost
      item.tollCostEst = costs.tollCost
      item.driverBataEst = costs.driverBata
      item.netProfitEst = costs.netProfit
    }
  }
  for (const inq of s.charterInquiries ?? []) sanitizeItem(inq)
  for (const c of s.charterContracts ?? []) sanitizeItem(c)
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
export function autoAssignBestCharters(s: GameState): number {
  if (!s.charterInquiries || s.charterInquiries.length === 0) return 0
  const manager = charterManagerOnDuty(s)
  if (!manager) return 0

  sanitizeCharterData(s)

  let assignedCount = 0
  const charterFleet = getCharterFleet(s)
  const inquiries = [...s.charterInquiries]

  for (const inq of inquiries) {
    const eligibleBuses = charterFleet.filter((bus) => {
      const check = canBusTakeContract(bus, inq)
      if (!check.ok) return false
      return !isBusBusyOnCharter(s, bus.id, inq.startDay, inq.endDay) && !charterDriverShortfall(s, bus, inq)
    })

    if (eligibleBuses.length === 0) continue

    // Find the bus that yields the highest net profit and best vehicle match
    let bestBus: Bus | null = null
    let bestProfit = -Infinity

    for (const b of eligibleBuses) {
      const costs = calculateCharterBusCosts(s, inq, b)
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
      if (!err) assignedCount++
    }
  }

  return assignedCount
}

/** Daily charter simulation tick */
export function dailyCharterPass(s: GameState): void {
  if (!s.charterContracts) s.charterContracts = []
  if (!s.charterInquiries) s.charterInquiries = []

  sanitizeCharterData(s)

  const cfg = getCharterConfig(s)
  const manager = charterManagerOnDuty(s)

  // 1. Expire stale inquiries (past startDay or older than 3 days)
  s.charterInquiries = s.charterInquiries.filter((inq) => s.day < inq.startDay)

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
        tourDriver.fatigue = Math.min(100, tourDriver.fatigue + 8)
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
