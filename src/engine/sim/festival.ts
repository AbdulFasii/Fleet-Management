/**
 * Festival-only schedules: planned anytime, run only on festival calendar days.
 * Schedule manager auto-assigns idle buses; ops auto-staffs; teardown when fest ends.
 */
import { festivalRunEffect, festivalRunSlot, isFestivalDay } from '../core/calendar'
import { ROUTES, ROUTE_LIST, routeName } from '../data/routes'
import { cityName } from '../data/cities'
import { BUS_MODELS, coachKind, modelTitle } from '../data/busModels'
import { nextId } from '../core/ids'
import { fmtCompact, rs } from '../core/money'
import { rngFor, rChance, rPick } from '../core/rng'
import type { Bus, GameState, ID, Money, RouteDef, Schedule, SeasonalRunRecord, Trip } from '../types'
import { pushLog } from './log'
import { releaseCoverFor } from './cover'
import { cancelOpenTripsForBus } from './booking'
import { opsAutoStaffPass, scheduleManagerOnDuty } from './staffing'
import { deskCapacity } from './span'
import { applyWear } from './dispatch'
import { isBusBusyOnCharter } from './charter'
import { earn, spend } from './finance'

export { isFestivalDay }

/**
 * Returns the next upcoming festival name and day within leadDays (default 3).
 * Uses the festival *run* window, so the one-day service pad either side of the
 * named window still counts — that is when the repositioning runs are booked.
 */
export function getUpcomingFestival(day: number, leadDays = 3): { name: string; day: number } | null {
  for (let d = day; d <= day + leadDays; d++) {
    const fest = festivalRunEffect(d)
    if (fest.name) return { name: fest.name, day: d }
  }
  return null
}

/** Returns true if a festival day occurs today or within leadDays (default 3 days). */
export function hasFestivalWithin(day: number, leadDays = 3): boolean {
  return getUpcomingFestival(day, leadDays) !== null
}

export function isScheduleFestivalOpen(s: GameState, sch: Schedule, leadDays = 3): boolean {
  const permit = s.permits[sch.routeId]
  if (!permit?.seasonal || permit.seasonal.status !== 'active') return false
  return hasFestivalWithin(s.day, leadDays)
}

export function festivalOnlySchedules(s: GameState): Schedule[] {
  return Object.values(s.schedules).filter(
    (sch) => (sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))) && sch.active,
  )
}

/** Idle line coaches free for festival auto-assign. */
function idleFestivalBuses(s: GameState): ID[] {
  return Object.values(s.buses)
    .filter(
      (b) =>
        b.status === 'active'
        && b.duty !== 'charter'
        && !b.scheduleId
        && !b.coveringBusId
        && b.ownership !== 'attached',
    )
    .map((b) => b.id)
}

function busesNeeded(sch: Schedule): number {
  const route = ROUTES[sch.routeId]
  // A short run turns the same coach around the same day. A long run leaves
  // that coach at the far end, so the other direction needs its own vehicle —
  // paired or not. One coach alone only opens one side of a festival.
  if (route && route.hours > 6) return 2
  if (!sch.paired) return 1
  return 1
}

function releaseFestivalBus(s: GameState, sch: Schedule, busId: ID): void {
  sch.busIds = sch.busIds.filter((id) => id !== busId)
  if (sch.autoAssignedBusIds) {
    sch.autoAssignedBusIds = sch.autoAssignedBusIds.filter((id) => id !== busId)
  }
  const bus = s.buses[busId]
  if (bus && bus.scheduleId === sch.id) {
    bus.scheduleId = undefined
    releaseCoverFor(s, busId)
    // Cancel only future fest trips still open for this bus on this schedule.
    cancelOpenTripsForBus(s, busId, 'festival ended — bus released')
  }
}

/** Pull all coaches/crew off festival-only services when not in open festival window. */
export function festivalTeardownPass(s: GameState): void {
  let released = 0
  for (const sch of Object.values(s.schedules)) {
    if (!sch.active) continue
    const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
    // Release auto-assigned buses only when the festival window (and upcoming lead) has fully ended
    if (isAllFest && !isScheduleFestivalOpen(s, sch, 3)) {
      const toRelease = sch.autoAssignedBusIds ? [...sch.autoAssignedBusIds] : []
      for (const busId of toRelease) {
        releaseFestivalBus(s, sch, busId)
        released++
      }
      sch.autoAssignedBusIds = []
    }
  }
  if (released > 0) {
    opsAutoStaffPass(s)
    pushLog(
      s,
      'info',
      `Festival window closed — released ${released} auto-assigned coach${released === 1 ? '' : 'es'} from festival services (crew cleared).`,
    )
  }
}

/**
 * Ahead of festival days (3d lead before booking opens), Schedule manager parks idle buses onto festival services.
 * Ops auto-staff then crews them.
 */
export function festivalAssignPass(s: GameState): void {
  const festSch = Object.values(s.schedules).filter(
    (sch) => sch.active && (sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))) && isScheduleFestivalOpen(s, sch, 3),
  )
  if (festSch.length === 0) return

  const mgr = scheduleManagerOnDuty(s)
  const upcoming = getUpcomingFestival(s.day, 3)
  const festName = upcoming?.name || 'Festival'
  if (!mgr) {
    const needing = festSch.some((sch) => sch.busIds.length === 0)
    if (needing) {
      pushLog(
        s,
        'alert',
        `${festName}: festival services need a vehicle assigned before booking opens in 3d (assign a coach or appoint a Schedule manager).`,
      )
    }
    return
  }

  const cap = Math.floor(deskCapacity(s, 'schedule'))
  festSch.sort((a, b) => (ROUTES[b.routeId]?.baseDemand ?? 0) - (ROUTES[a.routeId]?.baseDemand ?? 0))
  const targetSch = festSch.slice(0, cap)

  const pool = idleFestivalBuses(s)
  let assigned = 0
  for (const sch of targetSch) {
    const need = busesNeeded(sch) - sch.busIds.length
    if (need <= 0) continue
    const schBrand = sch.groupId ?? null
    for (let i = 0; i < need; i++) {
      // Prefer same subsidiary brand (or unassigned↔unassigned); never cross brands.
      const idx = pool.findIndex((id) => {
        const b = s.buses[id]
        return b && (b.groupId ?? null) === schBrand
      })
      if (idx < 0) break
      const busId = pool.splice(idx, 1)[0]!
      const bus = s.buses[busId]
      if (!bus) continue
      sch.busIds.push(busId)
      bus.scheduleId = sch.id
      const route = ROUTES[sch.routeId]
      // The second coach stands at the far city so both directions open
      // together. The first coach stays at home.
      if (route && sch.busIds.length === 2) bus.parkedCityId = route.to
      else if (route && !bus.parkedCityId) bus.parkedCityId = route.from
      if (!sch.autoAssignedBusIds) sch.autoAssignedBusIds = []
      sch.autoAssignedBusIds.push(busId)
      assigned++
    }
  }
  if (assigned > 0) {
    pushLog(
      s,
      'good',
      `${festName}: Schedule manager ${mgr.name} selected ${assigned} idle coach${assigned === 1 ? '' : 'es'} for festival service before booking opens (3d lead).`,
    )
    opsAutoStaffPass(s)
  } else if (festSch.some((sch) => sch.busIds.length < busesNeeded(sch)) && pool.length === 0) {
    const short = festSch.filter((sch) => sch.busIds.length < busesNeeded(sch))
    const oneSided = short.some((sch) => sch.busIds.length === 1 && busesNeeded(sch) === 2)
    pushLog(
      s,
      'alert',
      oneSided
        ? `${festName}: a long festival service still has only one coach on ${routeName(short[0]!.routeId)} — free a second vehicle so both ends run.`
        : `${festName}: no idle buses to select for festival service on ${routeName(festSch[0]!.routeId)} before booking opens — assign a coach or free one from depot.`,
    )
  }
}

/** Daily festival fleet pass: teardown off-window, assign on-window. */
export function festivalFleetPass(s: GameState): void {
  festivalTeardownPass(s)
  festivalAssignPass(s)
}

/* =============================== Seasonal Run Tracking =============================== */

/** Check if a trip belongs to a seasonal / festival scheduled service run. */
export function isSeasonalTrip(s: GameState, trip: Trip): boolean {
  if (trip.isSeasonal) return true
  const sch = trip.scheduleId ? s.schedules[trip.scheduleId] : undefined
  if (!sch) return false
  if (sch.festivalOnly) return true
  const duty = trip.pairOfTripId
    ? (sch.returnDuty ?? (sch.festivalOnly ? 'festival' : 'daily'))
    : (sch.outboundDuty ?? (sch.festivalOnly ? 'festival' : 'daily'))
  return duty === 'festival' && festivalRunSlot(trip.day) !== null
}

/** Record a completed seasonal trip run into dedicated seasonal tracking structures. */
export function recordSeasonalTripRun(
  s: GameState,
  trip: Trip,
  bus: Bus,
  route: RouteDef,
  pax: number,
  cap: number,
  fuelCost: number,
  tollCost: number,
  bata: number,
  cargoRevenue: number,
  adblueCost: number,
  borderTaxCost: number,
  parkingCleaning: number,
  attachedOwnerShare: number,
): void {
  if (!s.seasonalStats) {
    s.seasonalStats = {
      lifetime: { trips: 0, revenue: 0, expenses: 0, profit: 0, pax: 0, seatKm: 0, paxKm: 0 },
      history: [],
    }
  }

  // Avoid duplicate recording of the same trip
  if (s.seasonalStats.history.some((h) => h.tripId === trip.id)) {
    return
  }

  const ticketRevenue = trip.revenue
  const totalRevenue = ticketRevenue + cargoRevenue
  const otherCosts = adblueCost + borderTaxCost + parkingCleaning + attachedOwnerShare
  const totalExpenses = fuelCost + tollCost + bata + otherCosts
  const profit = totalRevenue - totalExpenses

  const paxKm = pax * route.km
  const seatKm = cap * route.km

  const record: SeasonalRunRecord = {
    tripId: trip.id,
    scheduleId: trip.scheduleId,
    routeId: route.id,
    busId: bus.id,
    day: s.day,
    direction: trip.direction,
    pax,
    seats: cap,
    paxKm,
    seatKm,
    revenue: totalRevenue,
    ticketRevenue,
    cargoRevenue,
    expenses: totalExpenses,
    fuelCost,
    tollCost,
    bata,
    otherCosts,
    profit,
  }

  s.seasonalStats.history.push(record)

  // Keep rolling history up to ~400 days (matching routeHistory)
  if (s.seasonalStats.history.length > 500) {
    const cutoff = s.day - 400
    s.seasonalStats.history = s.seasonalStats.history.filter((r) => r.day >= cutoff)
  }

  const lt = s.seasonalStats.lifetime
  lt.trips += 1
  lt.revenue += totalRevenue
  lt.expenses += totalExpenses
  lt.profit += profit
  lt.pax += pax
  lt.seatKm += seatKm
  lt.paxKm += paxKm
}

export interface CharterQuote {
  roundTripKm: number
  billableKm: number
  ratePerKm: number
  fee: Money
  fuelCost: Money
  tollCost: Money
  bataCost: Money
  adblueCost: Money
  otherCosts: Money
  totalExpenses: Money
  profit: Money
  seats: number
  coachType: 'semi' | 'sleeper' | 'hybrid'
}

/**
 * Calculates industry-standard charter quote tariffs for a private return tour charter in India.
 * Accounts for minimum billable distance floor (400 km), per-km coach rates, FASTag tolls,
 * crew tour bata, and realistic operating expenses (fuel, tolls, driver bata, AdBlue).
 */
export function calculateCharterQuote(
  s: GameState,
  bus: Bus,
  route: RouteDef,
): CharterQuote {
  const model = BUS_MODELS[bus.modelId]
  const seats = model?.seats || 36
  const isSemi = model ? (model.layout.kind === 'semi' || !model.sleeper) : false
  const isHybrid = model ? model.layout.kind === 'hybrid' : false
  const isPrem = model ? (model.cls === 'AC_SLEEPER_PREM' || model.cls === 'AC_SEMI_PREM' || model.maker === 'Volvo' || model.maker === 'Scania') : false
  const coachType: 'semi' | 'sleeper' | 'hybrid' = isSemi ? 'semi' : isHybrid ? 'hybrid' : 'sleeper'

  const roundTripKm = route.km * 2
  // Indian bus charter contracts have a standard 400 km minimum billable floor
  const billableKm = Math.max(roundTripKm, 400)

  // Real-world per-km tariffs in South India (tourist / private contract carriage):
  // - Premium multi-axle (Volvo 9600, Scania): ₹86 - ₹94/km
  // - Standard AC Sleeper (BharatBenz 1824, Leyland): ₹64 - ₹70/km
  // - AC Hybrid (40-46 berths/seats): ₹58 - ₹64/km
  // - AC Semi-Sleeper (44-50 seats): ₹50 - ₹56/km
  const baseRate = isPrem ? 88 : isSemi ? 52 : isHybrid ? 60 : 66

  // Jitter slightly by route demand/season (±5%)
  const fareFactor = s.world.fareIndex[route.id] ?? 1.0
  const ratePerKm = Math.round(baseRate * Math.max(0.92, Math.min(1.15, fareFactor)))

  const roundTripToll = Math.round(roundTripKm * (route.tollPerKm || 0))
  const interstateTax = (!bus.attach && route.interstate) ? (route.borderTaxPerTrip || 0) * 2 : 0
  const crewBata = rs(2_500) // 2-day driver + conductor tour allowance

  // Direct operating costs in paise:
  const mileage = model?.mileage || 3.6
  const dieselPaise = s.world.dieselPaise || 9000
  const fuelLitres = roundTripKm / mileage
  const fuelCost = model?.electric ? 0 : Math.round(fuelLitres * dieselPaise)
  const tollCost = roundTripToll
  const bataCost = crewBata
  const adblueCost = model?.electric ? 0 : Math.round(fuelCost * 0.05)
  const otherCosts = interstateTax + rs(600) // Cleaning & parking
  const totalExpenses = fuelCost + tollCost + bataCost + adblueCost + otherCosts

  // All-inclusive tour charter contract value in paise (base distance tariff + tolls + taxes + bata)
  const tariffPaise = rs(billableKm * ratePerKm)
  const rawContract = tariffPaise + roundTripToll + interstateTax + crewBata
  // Enforce healthy commercial margin floor (at least 35% above direct expenses)
  const finalRaw = Math.max(rawContract, Math.round(totalExpenses * 1.35))
  const fee = Math.round(finalRaw / rs(500)) * rs(500)
  const profit = Math.max(rs(5_000), fee - totalExpenses)

  return {
    roundTripKm,
    billableKm,
    ratePerKm,
    fee,
    fuelCost,
    tollCost,
    bataCost,
    adblueCost,
    otherCosts,
    totalExpenses,
    profit,
    seats,
    coachType,
  }
}

/** Record a completed charter run into dedicated seasonal & festival tracking structures. */
export function recordCharterTripRun(
  s: GameState,
  bus: Bus,
  route: RouteDef,
  fee: Money,
  expenses: Money,
  fuelCost: Money,
  tollCost: Money,
  bata: Money,
  otherCosts: Money,
  profit: Money,
  seats: number,
  coachType: 'semi' | 'sleeper' | 'hybrid' | string,
  roundTripKm: number,
): void {
  if (!s.seasonalStats) {
    s.seasonalStats = {
      lifetime: { trips: 0, revenue: 0, expenses: 0, profit: 0, pax: 0, seatKm: 0, paxKm: 0 },
      history: [],
    }
  }

  const pax = seats
  const paxKm = pax * roundTripKm
  const seatKm = seats * roundTripKm

  const record: SeasonalRunRecord = {
    tripId: nextId(s.ids, 'chr'),
    scheduleId: 'charter',
    routeId: route.id,
    busId: bus.id,
    day: s.day,
    direction: 'AB',
    pax,
    seats,
    paxKm,
    seatKm,
    revenue: fee,
    ticketRevenue: fee,
    cargoRevenue: 0,
    expenses,
    fuelCost,
    tollCost,
    bata,
    otherCosts,
    profit,
    kind: 'charter',
    coachType,
  }

  s.seasonalStats.history.push(record)

  if (s.seasonalStats.history.length > 500) {
    const cutoff = s.day - 400
    s.seasonalStats.history = s.seasonalStats.history.filter((r) => r.day >= cutoff)
  }

  const lt = s.seasonalStats.lifetime
  lt.trips += 1
  lt.revenue += fee
  lt.expenses += expenses
  lt.profit += profit
  lt.pax += pax
  lt.seatKm += seatKm
  lt.paxKm += paxKm
}

/**
 * Executes a charter contract: books revenue, incurs realistic direct operating expenses
 * (fuel, toll, crew bata, adblue), updates bus odometer and wear, and logs metrics.
 */
export function executeCharterContract(
  s: GameState,
  bus: Bus,
  route: RouteDef,
  q: CharterQuote,
): void {
  // 1. Earn gross charter revenue
  earn(s, 'charter', q.fee, {
    note: `Charter: ${routeName(route.id)} (${bus.reg})`,
    busId: bus.id,
    routeId: route.id,
  })
  s.curMonth.charterFestivalRevenue = (s.curMonth.charterFestivalRevenue ?? 0) + q.fee

  // 2. Spend realistic direct operating costs for the return charter journey
  spend(s, 'fuel', q.fuelCost, {
    busId: bus.id,
    routeId: route.id,
    note: `Charter diesel (${bus.reg} return run)`,
  })
  if (q.tollCost > 0) {
    spend(s, 'toll', q.tollCost, {
      busId: bus.id,
      routeId: route.id,
      note: `Charter FASTag tolls (${bus.reg} return)`,
    })
  }
  if (q.bataCost > 0) {
    spend(s, 'bata', q.bataCost, {
      busId: bus.id,
      routeId: route.id,
      note: `Charter crew tour bata (${bus.reg})`,
    })
  }
  if (q.adblueCost > 0) {
    spend(s, 'adblue', q.adblueCost, {
      busId: bus.id,
      routeId: route.id,
      note: `Charter AdBlue (${bus.reg})`,
    })
  }
  if (q.otherCosts > 0) {
    spend(s, 'parking_cleaning', q.otherCosts, {
      busId: bus.id,
      routeId: route.id,
      note: `Charter deep clean & parking (${bus.reg})`,
    })
  }

  // 3. Add round-trip distance and mechanical wear to coach
  applyWear(s, bus, q.roundTripKm) // same wear, odometer and tyre model as line trips
  bus.parkedCityId = route.from // return charter returns coach to origin depot

  // 4. Record run in seasonal and festival analytics
  recordCharterTripRun(
    s,
    bus,
    route,
    q.fee,
    q.totalExpenses,
    q.fuelCost,
    q.tollCost,
    q.bataCost,
    q.otherCosts,
    q.profit,
    q.seats,
    q.coachType,
    q.roundTripKm,
  )
}

export interface SeasonalRouteAggregate {
  routeId: string
  trips: number
  pax: number
  seats: number
  paxKm: number
  seatKm: number
  revenue: Money
  ticketRevenue: Money
  cargoRevenue: Money
  charterRevenue?: Money
  charterTrips?: number
  expenses: Money
  fuelCost: Money
  tollCost: Money
  bata: Money
  otherCosts: Money
  profit: Money
  occupancy: number
}

export interface SeasonalPeriodSummary {
  trips: number
  revenue: Money
  ticketRevenue: Money
  cargoRevenue: Money
  charterRevenue: Money
  charterTrips: number
  charterExpenses: Money
  charterProfit: Money
  charterFuelCost: Money
  charterTollCost: Money
  charterBataCost: Money
  charterOtherCosts: Money
  scheduledRevenue: Money
  scheduledTrips: number
  scheduledExpenses: Money
  scheduledProfit: Money
  scheduledFuelCost: Money
  scheduledTollCost: Money
  scheduledBataCost: Money
  scheduledOtherCosts: Money
  scheduledPax: number
  scheduledPaxKm: number
  scheduledSeatKm: number
  scheduledOccupancy: number
  expenses: Money
  fuelCost: Money
  tollCost: Money
  bata: Money
  otherCosts: Money
  profit: Money
  pax: number
  seats: number
  paxKm: number
  seatKm: number
  occupancy: number
  byRoute: Record<string, SeasonalRouteAggregate>
  charterBreakdown: {
    semiTrips: number
    semiRevenue: Money
    sleeperTrips: number
    sleeperRevenue: Money
    hybridTrips: number
    hybridRevenue: Money
  }
  recentRuns: SeasonalRunRecord[]
  lifetimeTotals: {
    trips: number
    revenue: Money
    expenses: Money
    profit: Money
    pax: number
    seatKm: number
    paxKm: number
    charterRevenue: Money
    charterExpenses?: Money
    charterProfit?: Money
    charterTrips: number
  }
}

function getCharterRunCosts(
  s: GameState,
  r: SeasonalRunRecord,
): { exp: Money; fuel: Money; toll: Money; bata: Money; other: Money; profit: Money } {
  if (r.kind !== 'charter' || (r.expenses > 0 && r.profit > 0)) {
    return {
      exp: r.expenses,
      fuel: r.fuelCost,
      toll: r.tollCost,
      bata: r.bata,
      other: r.otherCosts,
      profit: r.profit,
    }
  }

  const route = ROUTES[r.routeId]
  const roundTripKm = (route ? route.km : 400) * 2
  const bus = s.buses[r.busId]
  const model = bus ? BUS_MODELS[bus.modelId] : undefined
  const mileage = model?.mileage || 3.5
  const dieselPaise = s.world?.dieselPaise || 9000
  const fuel = model?.electric ? 0 : Math.round((roundTripKm / mileage) * dieselPaise)
  const toll = Math.round(roundTripKm * (route?.tollPerKm || 0))
  const bata = rs(2_500)
  const other = Math.round(fuel * 0.05) + rs(600)
  const exp = Math.min(Math.round(r.revenue * 0.52), fuel + toll + bata + other)
  const profit = Math.max(rs(5_000), r.revenue - exp)
  return { exp, fuel, toll, bata, other, profit }
}

/** Summarize separately tracked seasonal service run revenues and expenses for an Analytics period. Pure & read-only. */
export function getSeasonalStatsForPeriod(s: GameState, days: number | null): SeasonalPeriodSummary {
  const stats = s.seasonalStats
  const rawHistory = stats?.history ?? []
  const baseLifetime = stats?.lifetime ?? { trips: 0, revenue: 0, expenses: 0, profit: 0, pax: 0, seatKm: 0, paxKm: 0 }

  const cut = days === null ? -Infinity : s.day - days
  const filteredRuns = rawHistory.filter((r) => r.day > cut && r.day <= s.day)

  let allCharterRev = 0
  let allCharterExp = 0
  let allCharterProfit = 0
  let allCharterTrips = 0
  let allExpAcc = 0
  let allProfitAcc = 0

  for (const r of rawHistory) {
    const c = getCharterRunCosts(s, r)
    allExpAcc += c.exp
    allProfitAcc += c.profit
    if (r.kind === 'charter') {
      allCharterTrips += 1
      allCharterRev += r.revenue
      allCharterExp += c.exp
      allCharterProfit += c.profit
    }
  }

  const summary: SeasonalPeriodSummary = {
    trips: 0,
    revenue: 0,
    ticketRevenue: 0,
    cargoRevenue: 0,
    charterRevenue: 0,
    charterTrips: 0,
    charterExpenses: 0,
    charterProfit: 0,
    charterFuelCost: 0,
    charterTollCost: 0,
    charterBataCost: 0,
    charterOtherCosts: 0,
    scheduledRevenue: 0,
    scheduledTrips: 0,
    scheduledExpenses: 0,
    scheduledProfit: 0,
    scheduledFuelCost: 0,
    scheduledTollCost: 0,
    scheduledBataCost: 0,
    scheduledOtherCosts: 0,
    scheduledPax: 0,
    scheduledPaxKm: 0,
    scheduledSeatKm: 0,
    scheduledOccupancy: 0,
    expenses: 0,
    fuelCost: 0,
    tollCost: 0,
    bata: 0,
    otherCosts: 0,
    profit: 0,
    pax: 0,
    seats: 0,
    paxKm: 0,
    seatKm: 0,
    occupancy: 0,
    byRoute: {},
    charterBreakdown: {
      semiTrips: 0,
      semiRevenue: 0,
      sleeperTrips: 0,
      sleeperRevenue: 0,
      hybridTrips: 0,
      hybridRevenue: 0,
    },
    recentRuns: [],
    lifetimeTotals: {
      ...baseLifetime,
      expenses: baseLifetime.expenses > 0 ? baseLifetime.expenses : allExpAcc,
      profit: baseLifetime.profit !== 0 ? baseLifetime.profit : allProfitAcc,
      charterRevenue: allCharterRev,
      charterExpenses: allCharterExp,
      charterProfit: allCharterProfit,
      charterTrips: allCharterTrips,
    },
  }

  for (const r of filteredRuns) {
    const c = getCharterRunCosts(s, r)

    summary.trips += 1
    summary.revenue += r.revenue
    summary.expenses += c.exp
    summary.fuelCost += c.fuel
    summary.tollCost += c.toll
    summary.bata += c.bata
    summary.otherCosts += c.other
    summary.profit += c.profit
    summary.pax += r.pax
    summary.seats += r.seats
    summary.paxKm += r.paxKm
    summary.seatKm += r.seatKm

    if (r.kind === 'charter') {
      summary.charterTrips += 1
      summary.charterRevenue += r.revenue
      summary.charterExpenses += c.exp
      summary.charterProfit += c.profit
      summary.charterFuelCost += c.fuel
      summary.charterTollCost += c.toll
      summary.charterBataCost += c.bata
      summary.charterOtherCosts += c.other
      const cType = r.coachType ?? 'semi'
      if (cType === 'semi') {
        summary.charterBreakdown.semiTrips += 1
        summary.charterBreakdown.semiRevenue += r.revenue
      } else if (cType === 'hybrid') {
        summary.charterBreakdown.hybridTrips += 1
        summary.charterBreakdown.hybridRevenue += r.revenue
      } else {
        summary.charterBreakdown.sleeperTrips += 1
        summary.charterBreakdown.sleeperRevenue += r.revenue
      }
    } else {
      summary.scheduledTrips += 1
      summary.scheduledRevenue += r.revenue
      summary.scheduledExpenses += c.exp
      summary.scheduledProfit += c.profit
      summary.scheduledFuelCost += c.fuel
      summary.scheduledTollCost += c.toll
      summary.scheduledBataCost += c.bata
      summary.scheduledOtherCosts += c.other
      summary.scheduledPax += r.pax
      summary.scheduledPaxKm += r.paxKm
      summary.scheduledSeatKm += r.seatKm
      summary.ticketRevenue += r.ticketRevenue
      summary.cargoRevenue += r.cargoRevenue

      // Aggregate into byRoute ONLY for scheduled festival corridor runs (not charters)
      const br = (summary.byRoute[r.routeId] ??= {
        routeId: r.routeId,
        trips: 0,
        pax: 0,
        seats: 0,
        paxKm: 0,
        seatKm: 0,
        revenue: 0,
        ticketRevenue: 0,
        cargoRevenue: 0,
        charterRevenue: 0,
        charterTrips: 0,
        expenses: 0,
        fuelCost: 0,
        tollCost: 0,
        bata: 0,
        otherCosts: 0,
        profit: 0,
        occupancy: 0,
      })
      br.trips += 1
      br.pax += r.pax
      br.seats += r.seats
      br.paxKm += r.paxKm
      br.seatKm += r.seatKm
      br.revenue += r.revenue
      br.ticketRevenue += r.ticketRevenue
      br.cargoRevenue += r.cargoRevenue
      br.expenses += c.exp
      br.fuelCost += c.fuel
      br.tollCost += c.toll
      br.bata += c.bata
      br.otherCosts += c.other
      br.profit += c.profit
    }
  }

  summary.occupancy = summary.seatKm > 0 ? summary.paxKm / summary.seatKm : 0
  summary.scheduledOccupancy = summary.scheduledSeatKm > 0 ? summary.scheduledPaxKm / summary.scheduledSeatKm : 0
  for (const br of Object.values(summary.byRoute)) {
    br.occupancy = br.seatKm > 0 ? br.paxKm / br.seatKm : 0
  }

  // If period is lifetime and lifetime tracker has more trips than trimmed history, align summary with lifetime totals
  if (days === null && summary.lifetimeTotals.trips > summary.trips) {
    summary.trips = summary.lifetimeTotals.trips
    summary.revenue = summary.lifetimeTotals.revenue
    summary.expenses = summary.lifetimeTotals.expenses
    summary.profit = summary.lifetimeTotals.profit
    summary.pax = summary.lifetimeTotals.pax
    summary.seatKm = summary.lifetimeTotals.seatKm
    summary.paxKm = summary.lifetimeTotals.paxKm
    summary.occupancy = summary.seatKm > 0 ? summary.paxKm / summary.seatKm : 0
  }

  summary.recentRuns = [...rawHistory]
    .sort((a, b) => b.day - a.day)
    .slice(0, 10)

  return summary
}

/**
 * Generate a festival group charter inquiry.
 * Customers strongly prefer semi-sleeper coaches over sleeper coaches (6:3:1 weighting)
 * for group travel due to higher seating capacity and cost efficiency for pilgrim/tour groups.
 * If Schedules & Festivals manager is appointed, the offer is automatically accepted.
 */
export function createCharterInquiry(s: GameState, rng?: () => number): boolean {
  // Group charters are sourced only when a Schedules & Festivals manager is on duty
  const scheduleMgr = scheduleManagerOnDuty(s)
  if (!scheduleMgr) return false

  const depotCity = s.company.homeCityId || 'maa'

  // Charters strictly originate from our depot city
  const depotRoutes = ROUTE_LIST.filter((r) => r.from === depotCity)
  if (depotRoutes.length === 0) return false

  const allIdleBuses = Object.values(s.buses).filter(
    (b) =>
      b.status === 'active' &&
      !b.scheduleId &&
      !b.coveringBusId &&
      b.duty !== 'charter' && // dedicated charter coaches are booked through the Charters desk
      !isBusBusyOnCharter(s, b.id) &&
      b.ownership !== 'attached' &&
      (BUS_MODELS[b.modelId]?.seats ?? 0) > 0,
  )
  if (allIdleBuses.length === 0) return false

  // Prefer idle coaches currently stationed at our depot city
  const depotStationed = allIdleBuses.filter((b) => (b.parkedCityId ?? depotCity) === depotCity)
  const idleBuses = depotStationed.length > 0 ? depotStationed : allIdleBuses

  // Tour/pilgrim parties strongly prefer Semi-sleeper over Sleeper coaches (6:3:1 ratio)
  const weighted = idleBuses.map((bus) => {
    const m = BUS_MODELS[bus.modelId]
    const isSemi = m && (m.layout.kind === 'semi' || !m.sleeper)
    const isHybrid = m && m.layout.kind === 'hybrid'
    const weight = isSemi ? 6 : isHybrid ? 3 : 1
    return { bus, weight }
  })
  const totalW = weighted.reduce((acc, w) => acc + w.weight, 0)
  let roll = (rng ? rng() : Math.random()) * totalW
  let bus = idleBuses[0]
  for (const item of weighted) {
    roll -= item.weight
    if (roll <= 0) {
      bus = item.bus
      break
    }
  }

  const model = BUS_MODELS[bus.modelId]
  if (!model) return false

  // Select a return corridor strictly originating from our depot city
  const route = rPick(rng ?? Math.random, depotRoutes)

  const q = calculateCharterQuote(s, bus, route)

  if (s.company.scheduleAutoAcceptCharters !== false) {
    // Auto-accepted by appointed Schedules & Festivals manager!
    executeCharterContract(s, bus, route, q)
    pushLog(
      s,
      'good',
      `CHARTER AUTO-ACCEPTED: Schedules & Festivals Manager ${scheduleMgr.name} accepted ${coachKind(model)} charter from ${cityName(depotCity)} for ${bus.reg} on ${routeName(route.id)} (${fmtCompact(q.fee)} contract · +${fmtCompact(q.profit)} net profit).`,
    )
    return true
  }

  const prefNotice = q.coachType === 'semi'
    ? ' (Tour party specifically requested a high-capacity Semi-sleeper coach).'
    : q.coachType === 'hybrid'
      ? ' (Tour party booked a Hybrid coach with sleeper berths & seating).'
      : ' (Overnight pilgrim party chartered a Sleeper coach).'

  s.decisions.push({
    id: nextId(s.ids, 'dec'),
    day: s.day,
    expiresDay: s.day + 3,
    kind: 'festival_charter',
    title: `Festival Group Charter Request (${bus.reg})`,
    body: `A private tour group in our depot city (${cityName(depotCity)}) wants to hire ${bus.reg} (${modelTitle(model)}, ${q.seats} seats) for a return charter to ${cityName(route.to)} (${routeName(route.id)}, ${q.roundTripKm} km roundtrip).\n\nContract Value: ${fmtCompact(q.fee)} · Est. Operating Costs (Diesel, Tolls, Bata): ${fmtCompact(q.totalExpenses)} · Net Profit: +${fmtCompact(q.profit)} (Rate: ₹${q.ratePerKm}/km).${prefNotice} Sourced by Schedules & Festivals Manager ${scheduleMgr.name}.`,
    options: [
      { id: 'accept', key: 'accept', label: `Accept charter (+${fmtCompact(q.profit)} net)` },
      { id: 'refuse', key: 'refuse', label: 'Refuse charter' },
    ],
    data: {
      busId: bus.id,
      routeId: route.id,
      fee: q.fee,
      fuelCost: q.fuelCost,
      tollCost: q.tollCost,
      bataCost: q.bataCost,
      adblueCost: q.adblueCost,
      otherCosts: q.otherCosts,
      totalExpenses: q.totalExpenses,
      profit: q.profit,
      seats: q.seats,
      coachType: q.coachType,
      roundTripKm: q.roundTripKm,
      ratePerKm: q.ratePerKm,
    },
  })
  pushLog(
    s,
    'event',
    `CHARTER INQUIRY: Private festival tour group in ${cityName(depotCity)} requested full hire of ${bus.reg} (${coachKind(model)}) to ${cityName(route.to)} (${routeName(route.id)}) for ${fmtCompact(q.fee)} contract (+${fmtCompact(q.profit)} est. profit). Check Decisions.`,
  )
  return true
}

/**
 * Daily charter check: generates group charter inquiries with controlled frequency during festival periods
 * and auto-accepts pending charter decisions when a Schedules & Festivals manager is appointed.
 */
export function dailyCharterPass(s: GameState): void {
  // Group charters are sourced only when a Schedules & Festivals manager is appointed and on duty
  const scheduleMgr = scheduleManagerOnDuty(s)
  if (!scheduleMgr) return

  // Auto-accept any pending charters if enabled
  if (s.company.scheduleAutoAcceptCharters !== false) {
    const pendingCharters = s.decisions.filter((d) => d.kind === 'festival_charter')
    for (const d of pendingCharters) {
      const idx = s.decisions.indexOf(d)
      if (idx >= 0) {
        const busId = d.data?.busId as ID | undefined
        const routeId = (d.data?.routeId as string) || ROUTE_LIST[0].id
        const bus = busId ? s.buses[busId] : undefined
        const route = ROUTES[routeId] ?? ROUTE_LIST[0]
        if (bus && route) {
          const q = calculateCharterQuote(s, bus, route)
          executeCharterContract(s, bus, route, q)
          pushLog(
            s,
            'good',
            `CHARTER AUTO-ACCEPTED: Schedules & Festivals Manager ${scheduleMgr.name} accepted pending charter for ${bus.reg} (${fmtCompact(q.fee)} contract · +${fmtCompact(q.profit)} net profit).`,
          )
        }
        s.decisions.splice(idx, 1)
      }
    }
  }

  // 6-day minimum cooldown between charters to prevent spamming
  if (s.world.lastCharterDay && s.day - s.world.lastCharterDay < 6) return

  // Check if player has active idle buses
  const hasIdleBuses = Object.values(s.buses).some(
    (b) =>
      b.status === 'active' &&
      !b.scheduleId &&
      !b.coveringBusId &&
      b.ownership !== 'attached' &&
      (BUS_MODELS[b.modelId]?.seats ?? 0) > 0,
  )
  if (!hasIdleBuses) return

  // Limit pending charter decisions to 1 max
  const pendingCount = s.decisions.filter((d) => d.kind === 'festival_charter').length
  if (pendingCount >= 1) return

  const rng = rngFor(s.seed, 'charter', s.day)
  const isFest = hasFestivalWithin(s.day, 4) || isFestivalDay(s.day)
  // Controlled generation cadence: 18% during festival windows, 4% regular
  const chance = isFest ? 0.18 : 0.04
  if (rChance(rng, chance)) {
    s.world.lastCharterDay = s.day
    createCharterInquiry(s, rng)
  }
}
