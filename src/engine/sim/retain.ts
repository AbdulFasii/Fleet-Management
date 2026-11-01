import { BAL } from '../data/balance'
import type { GameState } from '../types'
import { pruneInbox } from './log'
import { trimTxns, trimRouteHistory } from './finance'
import { packColdTripSeats } from './seatstate'

/**
 * Daily retention and pruning pass to enforce storage caps and clean up stale state.
 * Called at the end of advanceDay in src/engine/tick.ts.
 *
 * Why it matters: the live state is deep-cloned for every player action and
 * re-encoded for every autosave. Anything that grows with the calendar (raw
 * ledger rows, resolved grievances, closed claims, expired market offers) turns
 * a five-year game into a multi-hundred-megabyte working set, which is what
 * browsers report as "out of memory". Every list below has an explicit budget.
 */
export function retainDay(s: GameState): void {
  // 1. Inbox retention (last 30 days, capped)
  pruneInbox(s)
  if (s.inbox.length > BAL.inboxKeep) s.inbox = s.inbox.slice(-BAL.inboxKeep)

  // 2. Financial ledger & route history trims
  trimTxns(s)
  trimRouteHistory(s)

  // 3. KPI strip: the dashboard shows the last 30 days, not years of them.
  if (s.kpis.length > BAL.kpiHistoryDays) s.kpis = s.kpis.slice(-BAL.kpiHistoryDays)

  // 4. Month summaries: reports use 12–24; keep a five-year archive.
  if (s.monthly.length > BAL.monthlyKeep) s.monthly = s.monthly.slice(-BAL.monthlyKeep)

  // 5. Drop expired festival specials older than 30 days
  if (s.festivalSpecials) {
    s.festivalSpecials = s.festivalSpecials.filter((f) => f.untilDay >= s.day - 30)
  }

  // 6. Drop inactive cargo contracts a quarter after they end
  if (s.company.cargoContracts) {
    s.company.cargoContracts = s.company.cargoContracts.filter(
      (c) => c.active || c.expiresDay >= s.day - BAL.cargoContractKeepDays,
    )
  }

  // 7. Drop loans with balance 0 and last activity older than 90 days
  if (s.loans) {
    for (const [id, loan] of Object.entries(s.loans)) {
      if (loan.balance <= 0 || loan.status === 'closed') {
        if (loan.busId && s.buses[loan.busId]?.loanId === id) {
          s.buses[loan.busId].loanId = undefined
        }
        const lastActivity = loan.nextEmiDay || loan.startDay
        if (s.day - lastActivity > 90) {
          delete s.loans[id]
        }
      }
    }
  }

  // 8. Grievance caps: open max 40, resolved rows dropped after 14 days
  const co = s.company as typeof s.company & {
    grievances?: { id: string; day: number; status: string }[]
  }
  if (co.grievances && Array.isArray(co.grievances)) {
    co.grievances = co.grievances.filter(
      (g) => g.status === 'open' || g.day >= s.day - 14,
    )
    const openGrievances = co.grievances.filter((g) => g.status === 'open')
    if (openGrievances.length > 40) {
      const openToKeep = new Set(openGrievances.slice(-40).map((g) => g.id))
      co.grievances = co.grievances.filter(
        (g) => g.status !== 'open' || openToKeep.has(g.id),
      )
    }
    co.grievanceCount = co.grievances.filter((g) => g.status === 'open').length
  }

  // 9. Corridor share history cap 180 days per route
  const w = s.world as typeof s.world & {
    shareHistory?: Record<string, { day: number; player: number }[]>
  }
  if (w.shareHistory) {
    for (const [routeId, hist] of Object.entries(w.shareHistory)) {
      if (!hist || hist.length === 0) {
        delete w.shareHistory[routeId]
        continue
      }
      if (hist.length > 180) w.shareHistory[routeId] = hist.slice(-180)
      else if (hist[0]!.day <= s.day - 400) delete w.shareHistory[routeId]
    }
  }

  // 10. Auto-expire stale decisions that passed their deadline so fast-forward/skip isn't blocked
  if (s.decisions && s.decisions.length > 0) {
    s.decisions = s.decisions.filter((d) => {
      if (d.expiresDay && d.expiresDay < s.day) {
        if (d.kind === 'driver_union_demand') {
          s.world.lastUnionDemandDay = s.day
        }
        return false
      }
      return true
    })
  }

  trimExpiredWorldState(s)
  trimExpiredMarketOffers(s)
  trimClaims(s)
  trimSeasonalRuns(s)
  trimTripInventory(s)
}

/** Shocks, closures and price wars are expired flags, not a permanent log. */
function trimExpiredWorldState(s: GameState): void {
  const w = s.world
  for (const [routeId, shock] of Object.entries(w.demandShock ?? {})) {
    if (!shock || shock.untilDay < s.day) delete w.demandShock[routeId]
  }
  for (const [routeId, closure] of Object.entries(w.closures ?? {})) {
    if (!closure || closure.untilDay < s.day) delete w.closures[routeId]
  }
  for (const [routeId, war] of Object.entries(w.priceWars ?? {})) {
    if (!war || war.untilDay < s.day) delete w.priceWars[routeId]
  }
  // Retired corridors leave no world flags behind.
  for (const bag of [w.demandShock, w.closures, w.priceWars]) {
    for (const routeId of Object.keys(bag ?? {})) {
      if (!s.permits[routeId]) delete bag[routeId]
    }
  }
}

/** Expired listings/offers are dead weight — the market refresh replaces them. */
function trimExpiredMarketOffers(s: GameState): void {
  if (s.usedMarket) s.usedMarket = s.usedMarket.filter((l) => l.expiresDay >= s.day)
  if (s.leaseOffers) s.leaseOffers = s.leaseOffers.filter((o) => o.expiresDay >= s.day)
  if (s.attachOffers) {
    s.attachOffers = s.attachOffers.filter((o) => o.expiresDay >= s.day)
  }
  if (s.busOrders) s.busOrders = s.busOrders.filter((o) => o.deliveryDay > s.day - 1)
}

/** Closed insurance claims are audit history: keep the tail, not the whole book. */
function trimClaims(s: GameState): void {
  const claims = s.insuranceClaims
  if (!claims || claims.length <= BAL.insuranceClaimKeep) return
  // Open claims must never be dropped, whatever their age.
  const open = claims.filter((c) => c.status === 'pending' || c.status === 'survey')
  const closed = claims.filter((c) => c.status !== 'pending' && c.status !== 'survey')
  const keepClosed = Math.max(0, BAL.insuranceClaimKeep - open.length)
  s.insuranceClaims = [...open, ...closed.slice(-keepClosed)]
}

/** Seasonal run rows feed one report; 300 rows is several festivals' worth. */
function trimSeasonalRuns(s: GameState): void {
  const hist = s.seasonalStats?.history
  if (!hist) return
  if (hist.length > BAL.seasonalRunKeep) {
    s.seasonalStats!.history = hist.slice(-BAL.seasonalRunKeep)
  }
}

/**
 * Keep the booking inventory lean:
 * - a finished/cancelled departure leaves only its compact outcome row,
 * - trips outside the sale window are not held at all,
 * - open trips keep a live seat map only near departure: cold departures shed
 *   their per-berth objects and carry `seatSales` instead (see seatstate.ts).
 */
function trimTripInventory(s: GameState): void {
  const keep = BAL.completedTripKeepDays
  const horizon = s.day + BAL.bookingWindowDays + 1
  for (const [id, t] of Object.entries(s.trips)) {
    if (t.status === 'open') {
      if (t.day > horizon) delete s.trips[id]
      else packColdTripSeats(s, t)
      continue
    }
    if (t.day < s.day - keep) {
      delete s.trips[id]
      continue
    }
    // Seats dominate trip size; a settled departure never needs its seat map.
    if (t.seats.length > 0 || t.seatSales?.length) {
      if (!t.seatCount) t.seatCount = t.seats.length
      t.seats = []
      delete t.seatSales
    }
  }
  const seen = new Set<string>()
  s.openTripIds = s.openTripIds.filter((id) => {
    if (seen.has(id)) return false
    const t = s.trips[id]
    if (!t || t.status !== 'open') return false
    seen.add(id)
    return true
  })
}

/**
 * Normalised state footprint for the UI/diagnostics: what the next deep clone
 * and autosave will have to copy.
 */
export function stateFootprint(s: GameState): {
  trips: number
  tripSeats: number
  packedSales: number
  txns: number
  routeDays: number
  totalRows: number
} {
  let tripSeats = 0
  let packedSales = 0
  for (const t of Object.values(s.trips)) {
    tripSeats += t.seats?.length ?? 0
    packedSales += t.seatSales?.length ?? 0
  }
  let routeDays = 0
  for (const days of Object.values(s.routeHistory ?? {})) routeDays += days?.length ?? 0
  return {
    trips: Object.keys(s.trips).length,
    tripSeats,
    packedSales,
    txns: s.txns.length,
    routeDays,
    totalRows: Object.keys(s.trips).length + s.txns.length + s.kpis.length
      + s.inbox.length + s.monthly.length + routeDays,
  }
}
