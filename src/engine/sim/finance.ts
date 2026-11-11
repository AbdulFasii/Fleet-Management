/**
 * Ledger-first finance. Every rupee movement is a Txn. P&L, cash flow and
 * per-bus/per-route stats derive from the ledger, so numbers always
 * reconcile. Channel revenue flows through receivables (settlement lag) -
 * the game's central working-capital tension.
 */
import { BAL } from '../data/balance'
import { BUS_MODELS, layoutShares } from '../data/busModels'
import { nextId } from '../core/ids'
import { ymKey } from '../core/calendar'
import type { Money } from '../core/money'
import type { Channel, Bus, GameState, MonthlySummary, RouteDayStats, RouteLayoutStats, RouteStats, Txn, TxnHead, ID, RefundBreakdown, RefundCategory, DetailedMonthlyTicketBreakdown, MonthlyFuelBreakdown, DepreciationMethod } from '../types'
import { groupOnDay } from './groups'

export const UNASSIGNED_BRAND_KEY = '__unassigned__'

export function emptyRouteStats(): RouteStats {
  return { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0, byLayout: {}, byBrand: {} }
}

function emptyLayout(): RouteLayoutStats {
  return { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 }
}

function addLayoutMoney(
  byLayout: Record<string, RouteLayoutStats>,
  key: string,
  revenue: Money,
  cost: Money,
): void {
  if (revenue === 0 && cost === 0) return
  const lay = (byLayout[key] ??= emptyLayout())
  lay.revenue += revenue
  lay.cost += cost
}

/** Brand key used in routeHistory / routeStats byBrand maps. */
export function brandKeyForBus(s: GameState, busId: ID | undefined, day = s.day): string {
  if (!busId) return UNASSIGNED_BRAND_KEY
  return groupOnDay(s, busId, day) ?? UNASSIGNED_BRAND_KEY
}

/**
 * Brand for corridor economics: prefer the service (schedule) brand over the
 * coach's current brand so covers / reassignments don't pollute other brands.
 */
export function brandKeyForService(
  s: GameState,
  refs: { busId?: ID; tripId?: ID; scheduleId?: ID } = {},
  day = s.day,
): string {
  const trip = refs.tripId ? s.trips[refs.tripId] : undefined
  const schId = refs.scheduleId ?? trip?.scheduleId ?? (refs.busId ? s.buses[refs.busId]?.scheduleId : undefined)
  if (schId) {
    const sch = s.schedules[schId]
    if (sch) return sch.groupId ?? UNASSIGNED_BRAND_KEY
  }
  return brandKeyForBus(s, refs.busId ?? trip?.busId, day)
}

function addBrandMoney(
  byBrand: Record<string, RouteLayoutStats> | undefined,
  key: string,
  revenue: Money,
  cost: Money,
): Record<string, RouteLayoutStats> {
  const map = byBrand ?? {}
  if (revenue === 0 && cost === 0) return map
  const row = (map[key] ??= emptyLayout())
  row.revenue += revenue
  row.cost += cost
  return map
}

/** Fold stored Hybrid buckets into Sleeper + Semi-sleeper (capacity split). */
export function foldHybridLayouts(byLayout: Record<string, RouteLayoutStats> | undefined): void {
  if (!byLayout) return
  for (const key of Object.keys(byLayout)) {
    if (!/^Hybrid\b/.test(key)) continue
    const src = byLayout[key]!
    delete byLayout[key]
    const ac = /\sNon-AC$/.test(key) ? ' Non-AC' : ' AC'
    const slpKey = `Sleeper 2+1${ac}`
    const semiKey = `Semi-sleeper 2+2${ac}`
    const split = (dstKey: string, share: number, tripsFull: boolean) => {
      const dst = (byLayout[dstKey] ??= emptyLayout())
      dst.revenue += Math.round(src.revenue * share)
      dst.cost += Math.round(src.cost * share)
      dst.paxKm += src.paxKm * share
      dst.seatKm += src.seatKm * share
      dst.trips += tripsFull ? src.trips : Math.round(src.trips * share)
    }
    split(slpKey, 0.5, true)
    split(semiKey, 0.5, true)
  }
}

function bumpLayoutMoney(
  rs: RouteStats,
  day: RouteDayStats,
  modelId: string,
  revenue: Money,
  cost: Money,
  overrideKey?: string,
): void {
  if (overrideKey) {
    addLayoutMoney(rs.byLayout, overrideKey, revenue, cost)
    addLayoutMoney(day.byLayout, overrideKey, revenue, cost)
    return
  }
  const parts = layoutShares(modelId)
  let leftR = revenue
  let leftC = cost
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    const r = last ? leftR : Math.round(revenue * parts[i]!.share)
    const c = last ? leftC : Math.round(cost * parts[i]!.share)
    leftR -= r
    leftC -= c
    addLayoutMoney(rs.byLayout, parts[i]!.key, r, c)
    addLayoutMoney(day.byLayout, parts[i]!.key, r, c)
  }
}

/** Daily detail kept for Analytics windows; older months live in routeStats lifetime. */
const ROUTE_HISTORY_DAYS = BAL.routeHistoryDays

/** Day row for any simulated day, inserted in order. Cargo history uses days other than today. */
export function routeDayFor(s: GameState, routeId: string, day: number): RouteDayStats {
  if (!s.routeHistory) s.routeHistory = {}
  const list = (s.routeHistory[routeId] ??= [])
  // Rows are kept in day order and today's is almost always last, so look there before scanning.
  const last = list[list.length - 1]
  const found = last && last.day === day ? last : list.find((r) => r.day === day)
  if (found) {
    if (!found.byLayout) found.byLayout = {}
    if (!found.byBrand) found.byBrand = {}
    return found
  }
  const row: RouteDayStats = {
    day, revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0, byLayout: {}, byBrand: {},
  }
  const idx = list.findIndex((r) => r.day > day)
  if (idx < 0) list.push(row)
  else list.splice(idx, 0, row)
  return row
}

export function todayRouteDay(s: GameState, routeId: string): RouteDayStats {
  return routeDayFor(s, routeId, s.day)
}

export function trimRouteHistory(s: GameState): void {
  if (!s.routeHistory) { s.routeHistory = {}; return }
  const cut = s.day - ROUTE_HISTORY_DAYS
  for (const [rid, list] of Object.entries(s.routeHistory)) {
    const next = list.filter((r) => r.day > cut)
    if (next.length) s.routeHistory[rid] = next
    else delete s.routeHistory[rid]
  }
}

function cloneFoldedStats(st: RouteStats): RouteStats {
  const byLayout: Record<string, RouteLayoutStats> = {}
  for (const [k, v] of Object.entries(st.byLayout ?? {})) byLayout[k] = { ...v }
  foldHybridLayouts(byLayout)
  return { ...st, byLayout }
}

/** Aggregate route economics for a trailing window, or lifetime if days is null. */
export function routeStatsForPeriod(s: GameState, days: number | null): Record<string, RouteStats> {
  const held = (rid: string) => Boolean(s.permits[rid])
  if (days === null) {
    const out: Record<string, RouteStats> = {}
    for (const [rid, st] of Object.entries(s.routeStats ?? {})) {
      if (held(rid)) out[rid] = cloneFoldedStats(st)
    }
    return out
  }
  if (!s.routeHistory) return {}
  const cut = s.day - days
  const out: Record<string, RouteStats> = {}
  for (const [rid, hist] of Object.entries(s.routeHistory)) {
    if (!held(rid)) continue
    const acc = emptyRouteStats()
    for (const d of hist) {
      if (d.day <= cut || d.day > s.day) continue
      acc.revenue += d.revenue
      acc.cost += d.cost
      acc.trips += d.trips
      acc.paxKm += d.paxKm
      acc.seatKm += d.seatKm
      for (const [key, lay] of Object.entries(d.byLayout ?? {})) {
        const a = (acc.byLayout[key] ??= emptyLayout())
        a.revenue += lay.revenue
        a.cost += lay.cost
        a.trips += lay.trips
        a.paxKm += lay.paxKm
        a.seatKm += lay.seatKm
      }
    }
    foldHybridLayouts(acc.byLayout)
    if (acc.trips > 0 || acc.revenue !== 0 || acc.cost !== 0 || acc.seatKm > 0) {
      out[rid] = acc
    }
  }
  return out
}

/**
 * Brand totals (trips, pax-km, seat-km, revenue, cost) over a trailing window, summed from the
 * per-day brand history. `days === null` is lifetime: the folded corridor totals.
 * Brands with no activity in the window are left out.
 */
export function brandStatsForPeriod(s: GameState, days: number | null): Record<string, RouteLayoutStats> {
  const out: Record<string, RouteLayoutStats> = {}
  const add = (key: string, lay: RouteLayoutStats) => {
    const a = (out[key] ??= emptyLayout())
    a.revenue += lay.revenue
    a.cost += lay.cost
    a.trips += lay.trips
    a.paxKm += lay.paxKm
    a.seatKm += lay.seatKm
  }
  if (days === null) {
    for (const st of Object.values(s.routeStats ?? {})) {
      for (const [key, lay] of Object.entries(st.byBrand ?? {})) add(key, lay)
    }
  } else {
    const cut = s.day - days
    for (const hist of Object.values(s.routeHistory ?? {})) {
      for (const d of hist) {
        if (d.day <= cut || d.day > s.day) continue
        for (const [key, lay] of Object.entries(d.byBrand ?? {})) add(key, lay)
      }
    }
  }
  for (const [key, lay] of Object.entries(out)) {
    if (lay.trips === 0 && lay.revenue === 0 && lay.cost === 0 && lay.seatKm === 0) delete out[key]
  }
  return out
}

/** Fleet-wide seat fill over a trailing window (1 = today only). Null if no operated seat-km. */
export function fleetOccupancy(s: GameState, days: number): number | null {
  const stats = routeStatsForPeriod(s, days)
  let paxKm = 0
  let seatKm = 0
  for (const st of Object.values(stats)) {
    paxKm += st.paxKm
    seatKm += st.seatKm
  }
  return seatKm > 0 ? paxKm / seatKm : null
}

export interface TxnRefs {
  busId?: ID
  routeId?: string
  tripId?: ID
  note?: string
  /** Hybrid ticket: pin this rupee to sleeper or semi-sleeper instead of splitting. */
  layoutKey?: string
  refundCategory?: RefundCategory
}

export function emptyMonth(ym: string): MonthlySummary {
  return {
    ym, income: {}, expense: {},
    revenueTotal: 0, expenseTotal: 0, profit: 0,
    trips: 0, paxKm: 0, seatKm: 0, loadFactor: 0,
    cargoKgMtd: 0,
    cargoCoachRevenue: 0,
    cargoTruckRevenue: 0,
    cargoCoachKg: 0,
    cargoTruckKg: 0,
    charterPrivateRevenue: 0,
    charterFestivalRevenue: 0,
    refundBreakdown: { passenger: 0, crm: 0, busCancel: 0 },
    ticketBreakdown: {
      gross: 0,
      seats: 0,
      channels: {
        redbus: { revenue: 0, seats: 0, commission: 0 },
        abhibus: { revenue: 0, seats: 0, commission: 0 },
        ownapp: { revenue: 0, seats: 0, commission: 0 },
        counter: { revenue: 0, seats: 0, commission: 0 },
      },
      bySeatType: {
        sleeper: { revenue: 0, seats: 0 },
        seater: { revenue: 0, seats: 0 },
      },
    },
  }
}

/** Ticket-side postings: high volume, descriptive notes, no reporting parser. */
const FOLDED_HEADS: ReadonlySet<string> = new Set([
  'ticket',
  'agent_commission',
  'redbus_commission',
  'pg_fees',
])

/**
 * Index of today's foldable ledger rows, keyed by the identity pushTxn folds on. It mirrors the
 * old walk-back exactly: only the contiguous run of rows at the end of the ledger that share the
 * posting's day can absorb it, and the newest matching row wins. Kept outside the game state
 * (keyed by the ledger array itself), so saves and reference hashes are untouched; a ledger that
 * is replaced (trimmed, filtered, a new draft) simply rebuilds its index on first use.
 */
interface FoldIndex {
  day: number
  /** Ledger rows already looked at. */
  scanned: number
  rows: Map<string, Txn>
}
const foldIndexes = new WeakMap<Txn[], FoldIndex>()
const NONE = '\u0000'
const SEP = '\u0001'

function foldKey(t: Pick<Txn, 'head' | 'kind' | 'busId' | 'routeId' | 'refundCategory'>): string {
  return t.head + SEP + t.kind + SEP + (t.busId ?? NONE) + SEP + (t.routeId ?? NONE) + SEP + (t.refundCategory ?? NONE)
}

function foldIndexFor(txns: Txn[], day: number): FoldIndex {
  let ix = foldIndexes.get(txns)
  if (!ix || ix.day !== day || ix.scanned > txns.length) {
    // Find where today's contiguous tail starts, then index it oldest-first so the newest row wins.
    let start = txns.length
    while (start > 0 && txns[start - 1]!.day === day) start--
    ix = { day, scanned: start, rows: new Map() }
    foldIndexes.set(txns, ix)
  }
  // Rows appended since the last fold (other heads, other code paths).
  for (; ix.scanned < txns.length; ix.scanned++) {
    const row = txns[ix.scanned]!
    if (row.day !== day) {
      ix.rows.clear() // the walk-back would stop here: nothing before it can fold
      continue
    }
    if (FOLDED_HEADS.has(row.head)) ix.rows.set(foldKey(row), row)
  }
  return ix
}

export function pushTxn(s: GameState, t: Omit<Txn, 'id'>): void {
  // Every posting that names a bus carries that bus's brand, so charter and other
  // non-route income can still be rolled up per subsidiary.
  if (t.busId && !t.groupId) {
    const gid = s.buses[t.busId]?.groupId
    if (gid) t = { ...t, groupId: gid }
  }
  // Fold same-day ticket postings that share an identity (head + refs).
  // A 20-coach day posts hundreds of per-batch sale rows; keeping each one is
  // pure history — totals are identical after folding, and the ledger stays
  // readable. Every other head appends as its own row: expense and capital
  // notes are audited and must not be merged.
  if (!FOLDED_HEADS.has(t.head)) {
    s.txns.push({ ...t, id: nextId(s.ids, 't') })
    return
  }
  const ix = foldIndexFor(s.txns, t.day)
  const key = foldKey(t)
  const prev = ix.rows.get(key)
  if (prev) {
    prev.amount += t.amount
    prev.count = (prev.count ?? 1) + 1
    return
  }
  const row = { ...t, id: nextId(s.ids, 't') }
  s.txns.push(row)
  ix.rows.set(key, row)
  ix.scanned = s.txns.length
}

function bumpRouteStats(
  s: GameState,
  routeId: string | undefined,
  revenue: Money,
  cost: Money,
  busId?: ID,
  layoutKeyOverride?: string,
  tripId?: ID,
): void {
  if (!routeId || !s.permits[routeId]) return
  const rs = (s.routeStats[routeId] ??= emptyRouteStats())
  if (!rs.byLayout) rs.byLayout = {}
  if (!rs.byBrand) rs.byBrand = {}
  rs.revenue += revenue
  rs.cost += cost
  const day = todayRouteDay(s, routeId)
  if (!day.byBrand) day.byBrand = {}
  day.revenue += revenue
  day.cost += cost
  // Attribute to the service brand (schedule), not whatever coach is covering.
  const brandKey = brandKeyForService(s, { busId, tripId })
  rs.byBrand = addBrandMoney(rs.byBrand, brandKey, revenue, cost)
  day.byBrand = addBrandMoney(day.byBrand, brandKey, revenue, cost)
  if (!busId || !s.buses[busId]) return
  bumpLayoutMoney(rs, day, s.buses[busId]!.modelId, revenue, cost, layoutKeyOverride)
}

/**
 * Operating income. If `settleDays` > 0 the cash arrives later via a
 * receivable; P&L recognises it now.
 */
export function earn(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}, settleDays = 0, channel: Channel = 'counter'): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  const { layoutKey: layoutKeyOverride, ...txnRefs } = refs
  pushTxn(s, { day: s.day, head, kind: 'income', amount, ...txnRefs })
  s.curMonth.income[head] = (s.curMonth.income[head] ?? 0) + amount
  s.curMonth.revenueTotal += amount
  s.curMonth.profit += amount
  s.company.fyRevenue += amount
  s.company.fyProfit += amount
  s.lifetimeProfit += amount
  if (head === 'cargo' || head === 'cargo_spot') {
    s.company.cargoLifeRevenue = (s.company.cargoLifeRevenue ?? 0) + amount
  }
  if (refs.busId && s.buses[refs.busId]) s.buses[refs.busId].lifeRevenue += amount
  bumpRouteStats(s, refs.routeId, amount, 0, refs.busId, layoutKeyOverride, refs.tripId)
  if (settleDays > 0) {
    // One settlement row per channel per settle day, not one per booking batch:
    // cash timing is identical and a long game keeps ~50 rows instead of 2,000.
    const settleDay = s.day + settleDays
    const prev = s.receivables[s.receivables.length - 1]
    if (prev && !prev.bounced && prev.channel === channel && prev.settleDay === settleDay) {
      prev.amount += amount
    } else {
      s.receivables.push({ id: nextId(s.ids, 'rcv'), amount, settleDay, channel })
    }
  } else {
    s.company.cash += amount
  }
}

/** Operating expense. Cash goes out now (possibly pushing into OD territory). */
export function spend(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  const { layoutKey: layoutKeyOverride, refundCategory, ...txnRefs } = refs
  pushTxn(s, { day: s.day, head, kind: 'expense', amount, refundCategory, ...txnRefs })
  s.curMonth.expense[head] = (s.curMonth.expense[head] ?? 0) + amount
  s.curMonth.expenseTotal += amount
  s.curMonth.profit -= amount
  // Income tax is levied *on* fyProfit, so it must not shrink the base it is
  // computed from — otherwise each monthly provision would discount the next.
  if (head !== 'income_tax') s.company.fyProfit -= amount
  s.lifetimeProfit -= amount
  s.company.cash -= amount
  if (head === 'fuel') {
    s.company.gstInputCredit = (s.company.gstInputCredit ?? 0) + Math.round(amount * 0.05)
  }
  if (head === 'refund') {
    if (!s.curMonth.refundBreakdown) {
      s.curMonth.refundBreakdown = { passenger: 0, crm: 0, busCancel: 0 }
    }
    const cat = refundCategory ?? (
      refs.note?.toLowerCase().includes('crm') || refs.note?.toLowerCase().includes('grievance')
        ? 'crm'
        : refs.note?.toLowerCase().includes('passenger cancel') || refs.note?.toLowerCase().includes('by passenger')
          ? 'passenger'
          : refs.note?.toLowerCase().includes('passenger') && !refs.note?.toLowerCase().includes('cancel')
            ? 'crm'
            : 'busCancel'
    )
    s.curMonth.refundBreakdown[cat] = (s.curMonth.refundBreakdown[cat] ?? 0) + amount
  }
  if (refs.busId && s.buses[refs.busId]) s.buses[refs.busId].lifeCost += amount
  bumpRouteStats(s, refs.routeId, 0, amount, refs.busId, layoutKeyOverride, refs.tripId)
}

/** Compute breakdown of refunds (passenger cancel, CRM grievance, bus cancel) for any month. */
export function getMonthlyRefundBreakdown(s: GameState, m: MonthlySummary): RefundBreakdown {
  if (m.refundBreakdown) {
    const b = m.refundBreakdown
    return {
      passenger: b.passenger ?? 0,
      crm: b.crm ?? 0,
      busCancel: b.busCancel ?? 0,
    }
  }
  const res: RefundBreakdown = { passenger: 0, crm: 0, busCancel: 0 }
  for (const t of s.txns) {
    if (ymKey(t.day) !== m.ym || t.head !== 'refund') continue
    const cat: RefundCategory = t.refundCategory ?? (
      t.note?.toLowerCase().includes('crm') || t.note?.toLowerCase().includes('grievance')
        ? 'crm'
        : t.note?.toLowerCase().includes('passenger cancel') || t.note?.toLowerCase().includes('by passenger')
          ? 'passenger'
          : t.note?.toLowerCase().includes('passenger') && !t.note?.toLowerCase().includes('cancel')
            ? 'crm'
            : 'busCancel'
    )
    res[cat] += t.amount
  }
  return res
}

/** Compute comprehensive ticket sales breakdown (by channel, seats, net deductions) for any month. */
export function getMonthlyTicketBreakdown(s: GameState, m: MonthlySummary): DetailedMonthlyTicketBreakdown {
  const gross = m.income.ticket ?? 0
  const cancellationFees = m.income.cancellation_fee ?? 0
  const redbusComm = m.expense.redbus_commission ?? 0
  const agentComm = m.expense.agent_commission ?? 0
  const pgFees = m.expense.pg_fees ?? 0

  if (m.ticketBreakdown && m.ticketBreakdown.gross > 0) {
    const tb = m.ticketBreakdown
    const redbus = tb.channels.redbus ?? { revenue: 0, seats: 0, commission: 0 }
    const abhibus = tb.channels.abhibus ?? { revenue: 0, seats: 0, commission: 0 }
    const ownapp = tb.channels.ownapp ?? { revenue: 0, seats: 0, commission: 0 }
    const counter = tb.channels.counter ?? { revenue: 0, seats: 0, commission: 0 }
    const totalDeductions = (redbus.commission || redbusComm) + abhibus.commission + (ownapp.commission || pgFees) + counter.commission
    return {
      gross,
      seats: tb.seats || 0,
      cancellationFees,
      channels: {
        redbus: { ...redbus, commission: redbus.commission || redbusComm },
        abhibus: { ...abhibus },
        ownapp: { ...ownapp, commission: ownapp.commission || pgFees },
        counter: { ...counter },
      },
      bySeatType: tb.bySeatType,
      totalDeductions,
      netRevenue: Math.max(0, gross - totalDeductions),
    }
  }

  // Fallback for older months or existing saves: calculate from s.txns and commission expenses
  const chMap: Record<Channel, { revenue: Money; seats: number }> = {
    redbus: { revenue: 0, seats: 0 },
    abhibus: { revenue: 0, seats: 0 },
    ownapp: { revenue: 0, seats: 0 },
    counter: { revenue: 0, seats: 0 },
  }

  const txns = (s.txns ?? []).filter((t) => t.head === 'ticket' && ymKey(t.day) === m.ym)
  for (const t of txns) {
    const note = t.note ?? ''
    const sm = note.match(/^(\d+)\s+seats?/i)
    const seats = sm ? parseInt(sm[1], 10) : 1
    if (note.includes('RedBus')) {
      chMap.redbus.revenue += t.amount
      chMap.redbus.seats += seats
    } else if (note.includes('AbhiBus')) {
      chMap.abhibus.revenue += t.amount
      chMap.abhibus.seats += seats
    } else if (note.includes('App')) {
      chMap.ownapp.revenue += t.amount
      chMap.ownapp.seats += seats
    } else {
      chMap.counter.revenue += t.amount
      chMap.counter.seats += seats
    }
  }

  const txnSum = chMap.redbus.revenue + chMap.abhibus.revenue + chMap.ownapp.revenue + chMap.counter.revenue
  let finalChannels: Record<Channel, { revenue: Money; seats: number; commission: Money }>
  let totalSeats = 0

  if (txnSum > 0) {
    const scale = (gross > 0 ? gross : txnSum) / txnSum
    const abhiCommShare = chMap.abhibus.revenue > 0 ? chMap.abhibus.revenue / (chMap.abhibus.revenue + chMap.counter.revenue || 1) : 0.6
    finalChannels = {
      redbus: {
        revenue: Math.round(chMap.redbus.revenue * scale),
        seats: Math.round(chMap.redbus.seats * scale),
        commission: redbusComm,
      },
      abhibus: {
        revenue: Math.round(chMap.abhibus.revenue * scale),
        seats: Math.round(chMap.abhibus.seats * scale),
        commission: Math.round(agentComm * abhiCommShare),
      },
      ownapp: {
        revenue: Math.round(chMap.ownapp.revenue * scale),
        seats: Math.round(chMap.ownapp.seats * scale),
        commission: pgFees,
      },
      counter: {
        revenue: Math.round(chMap.counter.revenue * scale),
        seats: Math.round(chMap.counter.seats * scale),
        commission: Math.max(0, agentComm - Math.round(agentComm * abhiCommShare)),
      },
    }
    totalSeats = finalChannels.redbus.seats + finalChannels.abhibus.seats + finalChannels.ownapp.seats + finalChannels.counter.seats
  } else {
    // If no transactions in memory, infer from commissions or default channel weights
    const estRedbus = redbusComm > 0 ? Math.round(redbusComm / 0.08) : Math.round(gross * 0.65)
    const estOwnapp = pgFees > 0 ? Math.round(pgFees / 0.02) : 0
    const rem = Math.max(0, gross - estRedbus - estOwnapp)
    const estAbhibus = Math.round(rem * 0.65)
    const estCounter = Math.max(0, rem - estAbhibus)
    const avgFare = 150000 // default ~1,500 Rs
    finalChannels = {
      redbus: { revenue: estRedbus, seats: Math.round(estRedbus / avgFare), commission: redbusComm },
      abhibus: { revenue: estAbhibus, seats: Math.round(estAbhibus / avgFare), commission: Math.round(agentComm * 0.6) },
      ownapp: { revenue: estOwnapp, seats: Math.round(estOwnapp / avgFare), commission: pgFees },
      counter: { revenue: estCounter, seats: Math.round(estCounter / avgFare), commission: Math.max(0, agentComm - Math.round(agentComm * 0.6)) },
    }
    totalSeats = finalChannels.redbus.seats + finalChannels.abhibus.seats + finalChannels.ownapp.seats + finalChannels.counter.seats
  }

  // Adjust for any rounding discrepancy so sum of channel revenues equals gross exactly
  const chanSum = finalChannels.redbus.revenue + finalChannels.abhibus.revenue + finalChannels.ownapp.revenue + finalChannels.counter.revenue
  if (chanSum !== gross && gross > 0) {
    finalChannels.redbus.revenue += (gross - chanSum)
  }

  const totalDeductions = redbusComm + agentComm + pgFees
  return {
    gross,
    seats: totalSeats,
    cancellationFees,
    channels: finalChannels,
    totalDeductions,
    netRevenue: Math.max(0, gross - totalDeductions),
  }
}

/** Compute breakdown of fuel expenses (highway roadside pumps, depot bulk tanker, OMC fleet card cashback, and net effective expense). */
export function getMonthlyFuelBreakdown(s: GameState, m: MonthlySummary): MonthlyFuelBreakdown {
  if (m.fuelBreakdown) {
    if (m.ym === s.curMonth.ym) {
      const liveCashback = (s.company.fuelCashbackAccrued ?? 0) + (m.income.fuel_cashback ?? 0)
      return {
        ...m.fuelBreakdown,
        cashback: liveCashback,
        net: Math.max(0, m.fuelBreakdown.gross - liveCashback),
      }
    }
    return m.fuelBreakdown
  }

  const gross = m.expense.fuel ?? 0
  let depotTanker = 0
  for (const t of (s.txns ?? [])) {
    if (ymKey(t.day) === m.ym && t.head === 'fuel') {
      const note = (t.note ?? '').toLowerCase()
      if (note.includes('bulk') || note.includes('tanker')) {
        depotTanker += t.amount
      }
    }
  }
  depotTanker = Math.min(gross, depotTanker)
  const roadside = Math.max(0, gross - depotTanker)

  let cashback = m.income.fuel_cashback ?? 0
  if (m.ym === s.curMonth.ym) {
    cashback += s.company.fuelCashbackAccrued ?? 0
  }
  const net = Math.max(0, gross - cashback)

  return {
    gross,
    roadside,
    depotTanker,
    cashback,
    net,
  }
}

export interface MonthlyCharterBreakdown {
  total: Money
  privateTour: Money
  festival: Money
}

export function getMonthlyCharterBreakdown(s: GameState, m: MonthlySummary): MonthlyCharterBreakdown {
  const total = m.income.charter ?? 0
  let privateTour = m.charterPrivateRevenue ?? 0
  let festival = m.charterFestivalRevenue ?? 0

  if (privateTour === 0 && festival === 0 && total > 0) {
    // Reconstruct breakdown from ledger transactions in that month
    for (const t of (s.txns ?? [])) {
      if (t.head === 'charter' && t.kind === 'income' && ymKey(t.day) === m.ym) {
        const note = t.note ?? ''
        if (note.includes('Charter deposit') || note.includes('Charter Payout') || (!t.routeId && note.includes('('))) {
          privateTour += t.amount
        } else {
          festival += t.amount
        }
      }
    }
    // If historical transactions were pruned or not classified, check charterHistory
    if (privateTour === 0 && festival === 0) {
      for (const h of (s.charterHistory ?? [])) {
        if (h.startDay && ymKey(h.startDay) === m.ym) {
          privateTour += (h.completedRevenue ?? h.payout)
        }
      }
      privateTour = Math.min(total, privateTour)
      festival = Math.max(0, total - privateTour)
      if (privateTour === 0 && festival === 0) {
        privateTour = total
      }
    }
  }

  return { total, privateTour, festival }
}

/**
 * Expense that never touches cash because it is deducted at source from a
 * receivable (RedBus commission, PG fees, agent cut). P&L only.
 */
export function spendNetted(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  const { layoutKey: layoutKeyOverride, ...txnRefs } = refs
  pushTxn(s, { day: s.day, head, kind: 'expense', amount, ...txnRefs, note: refs.note ?? 'netted from settlement' })
  s.curMonth.expense[head] = (s.curMonth.expense[head] ?? 0) + amount
  s.curMonth.expenseTotal += amount
  s.curMonth.profit -= amount
  if (head !== 'income_tax') s.company.fyProfit -= amount
  s.lifetimeProfit -= amount
  if (refs.busId && s.buses[refs.busId]) s.buses[refs.busId].lifeCost += amount
  bumpRouteStats(s, refs.routeId, 0, amount, refs.busId, layoutKeyOverride, refs.tripId)
}

/** Undo a prior spendNetted (or catch-up) so ticket cancellations reverse the owner share. */
function creditNetted(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  const { layoutKey: layoutKeyOverride, ...txnRefs } = refs
  pushTxn(s, {
    day: s.day, head, kind: 'income', amount, ...txnRefs,
    note: refs.note ?? 'attach owner share reversed',
  })
  s.curMonth.expense[head] = Math.max(0, (s.curMonth.expense[head] ?? 0) - amount)
  s.curMonth.expenseTotal = Math.max(0, s.curMonth.expenseTotal - amount)
  s.curMonth.profit += amount
  if (head !== 'income_tax') s.company.fyProfit += amount
  s.lifetimeProfit += amount
  if (refs.busId && s.buses[refs.busId]) {
    s.buses[refs.busId]!.lifeCost = Math.max(0, s.buses[refs.busId]!.lifeCost - amount)
  }
  bumpRouteStats(s, refs.routeId, 0, -amount, refs.busId, layoutKeyOverride, refs.tripId)
}

function attachShareParts(ticketGross: Money, ownerShare: number): { fullShare: Money; tds: Money; payout: Money } {
  const fullShare = Math.round(Math.max(0, ticketGross) * Math.max(0, Math.min(1, ownerShare)))
  const tds = Math.round(fullShare * 0.01)
  return { fullShare, tds, payout: fullShare - tds }
}

/**
 * Book the attached owner's ticket share into P&L when seats sell (same month as
 * ticket income). Cash is paid later at dispatch via settleAttachOwnerCash.
 */
export function accrueAttachOwnerShare(
  s: GameState,
  ticketGross: Money,
  ownerShare: number,
  refs: TxnRefs = {},
): void {
  const { fullShare, tds, payout } = attachShareParts(ticketGross, ownerShare)
  if (fullShare <= 0) return
  spendNetted(s, 'attach_owner_share', payout, {
    ...refs,
    note: refs.note ?? `owner share ${Math.round(ownerShare * 100)}% of tickets`,
  })
  if (tds > 0) {
    spendNetted(s, 'tds', tds, { ...refs, note: 'TDS withheld (1% u/s 194C)' })
    s.company.tdsPayable = (s.company.tdsPayable ?? 0) + tds
  }
  s.company.attachOwnerPayable = (s.company.attachOwnerPayable ?? 0) + payout
}

/** Reverse an accrual when attached-bus tickets are refunded or cancelled. */
export function reverseAttachOwnerShare(
  s: GameState,
  ticketGross: Money,
  ownerShare: number,
  refs: TxnRefs = {},
): void {
  const { fullShare, tds, payout } = attachShareParts(ticketGross, ownerShare)
  if (fullShare <= 0) return
  creditNetted(s, 'attach_owner_share', payout, {
    ...refs,
    note: refs.note ?? 'owner share reversed on cancelled tickets',
  })
  if (tds > 0) {
    creditNetted(s, 'tds', tds, { ...refs, note: 'TDS reversed on cancelled tickets' })
    s.company.tdsPayable = Math.max(0, (s.company.tdsPayable ?? 0) - tds)
  }
  s.company.attachOwnerPayable = Math.max(0, (s.company.attachOwnerPayable ?? 0) - payout)
}

/**
 * Pay cash for the remaining ticket share when an attached coach departs.
 * P&L was already booked at sale; this only settles the payable (with a
 * catch-up accrual if seats were sold before accrual existed).
 */
export function settleAttachOwnerCash(
  s: GameState,
  tripRevenue: Money,
  ownerShare: number,
  refs: TxnRefs = {},
): void {
  const { tds, payout } = attachShareParts(tripRevenue, ownerShare)
  if (payout <= 0) return

  let payable = s.company.attachOwnerPayable ?? 0
  if (payable < payout) {
    const missing = payout - payable
    spendNetted(s, 'attach_owner_share', missing, {
      ...refs,
      note: refs.note ?? 'attach owner share catch-up',
    })
    // Proportional TDS for the unaccrued slice.
    const missingTds = Math.round(missing * (tds / Math.max(1, payout)))
    if (missingTds > 0) {
      spendNetted(s, 'tds', missingTds, { ...refs, note: 'TDS withheld (1% u/s 194C)' })
      s.company.tdsPayable = (s.company.tdsPayable ?? 0) + missingTds
    }
    s.company.attachOwnerPayable = (s.company.attachOwnerPayable ?? 0) + missing
    payable = s.company.attachOwnerPayable
  }

  s.company.cash -= payout
  s.company.attachOwnerPayable = Math.max(0, payable - payout)
  // Ledger trail only — monthly P&L already holds the accrual.
  pushTxn(s, {
    day: s.day,
    head: 'attach_owner_share',
    kind: 'capital_out',
    amount: payout,
    ...refs,
    note: refs.note ?? 'attach owner share paid',
  })
}

/** Capital movement in (loan disbursal, seed, asset sale proceeds). Not P&L. */
export function capitalIn(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  pushTxn(s, { day: s.day, head, kind: 'capital_in', amount, ...refs })
  s.company.cash += amount
}

/** Capital movement out (bus purchase, principal repayment). Not P&L. */
export function capitalOut(s: GameState, head: TxnHead, amount: Money, refs: TxnRefs = {}): void {
  if (amount <= 0) return
  amount = Math.round(amount)
  pushTxn(s, { day: s.day, head, kind: 'capital_out', amount, ...refs })
  s.company.cash -= amount
}

/** Total cash the company can still deploy (cash + unused OD). */
export function liquidity(s: GameState): Money {
  return s.company.cash + (s.od.limit - s.od.drawn)
}

export function canAfford(s: GameState, amount: Money): boolean {
  return liquidity(s) >= amount
}

/** Settle receivables due today; credit cash. */
export function settleReceivables(s: GameState): Money {
  let settled = 0
  const rest = []
  for (const r of s.receivables) {
    // A bounced cheque never auto-settles — it waits for the decision
    // (collection agency or write-off).
    if (r.settleDay <= s.day && !r.bounced) {
      s.company.cash += r.amount
      settled += r.amount
    } else rest.push(r)
  }
  s.receivables = rest
  return settled
}

export function receivablesTotal(s: GameState): Money {
  return s.receivables.reduce((a, r) => a + r.amount, 0)
}

export function fleetBookValue(s: GameState): Money {
  return Object.values(s.buses).reduce((a, b) => a + (b.ownership === 'owned' ? (b.bookValue ?? 0) : 0), 0)
}

/**
 * Cash value of an owned coach for sale proceeds, repossession recovery and
 * collateral. The accounting policy must not mint money: a coach booked with no
 * depreciation is still only worth what the used market pays for its age.
 */
export function assetCashValue(s: GameState, bus: Bus): Money {
  if (bus.depreciationMethod !== 'NONE') return bus.bookValue
  const model = BUS_MODELS[bus.modelId]
  if (!model) return bus.bookValue
  const ageYears = Math.max(0, (s.day - bus.acquiredDay) / 365)
  const market = Math.round(model.priceNew * Math.pow(1 - BAL.usedDepreciationYr, ageYears))
  return Math.max(0, Math.min(bus.bookValue, market))
}

export function loansOutstanding(s: GameState): Money {
  return Object.values(s.loans).reduce((a, l) => a + (l.status === 'active' ? l.balance : 0), 0)
}

export function netWorth(s: GameState): Money {
  return (
    s.company.cash + receivablesTotal(s) + fleetBookValue(s)
    - loansOutstanding(s) - s.od.drawn - s.company.gstPayable - s.company.taxProvision
  )
}

/** Trim the raw txn window; monthly summaries keep history forever. */
export function trimTxns(s: GameState): void {
  const cutoff = s.day - BAL.txnRetentionDays
  if (s.txns.length > 0 && s.txns[0].day < cutoff) {
    s.txns = s.txns.filter((t) => t.day >= cutoff)
  }
  if (s.txns.length > BAL.txnMaxCount) {
    s.txns = s.txns.slice(-BAL.txnMaxCount)
  }
}

/** Month-end close: archive the live month accumulator. */
export function closeMonth(s: GameState): MonthlySummary {
  const m = s.curMonth
  m.loadFactor = m.seatKm > 0 ? m.paxKm / m.seatKm : 0
  m.refundBreakdown = getMonthlyRefundBreakdown(s, m)
  m.ticketBreakdown = getMonthlyTicketBreakdown(s, m)
  m.fuelBreakdown = getMonthlyFuelBreakdown(s, m)
  s.monthly.push(m)
  if (s.monthly.length > 60) s.monthly.shift()
  s.curMonth = emptyMonth(ymKey(s.day + 1))
  return m
}

/** First-month write-off on a coach bought at `cost` under a given policy. */
export function monthlyDepreciationFor(cost: Money, method: DepreciationMethod, ratePct: number, book?: Money): Money {
  if (method === 'NONE') return 0
  const base = method === 'WDV' ? (book ?? cost) : cost
  return Math.round((base * ratePct) / 100 / 12)
}

/** Years until a coach under this policy reaches the salvage floor. */
export function depreciationLifeYears(method: DepreciationMethod, ratePct: number): number {
  const r = Math.max(0.01, ratePct / 100)
  const floor = BAL.depreciationResidualPct
  if (method === 'NONE') return Infinity
  if (method === 'WDV') return Math.log(floor) / Math.log(1 - r)
  return (1 - floor) / r
}

/** Monthly depreciation on owned buses (P&L expense, non-cash).
 *  Supports SLM (straight line), WDV (written-down value) and NONE (asset
 *  carried at cost, no write-off and no tax shield). The annual rate is chosen
 *  by the player (5–30%) and fixed per coach at purchase: SLM writes that share
 *  of cost off each year, WDV applies it to the falling book value. Either way
 *  the coach never goes below its residual value. Coaches bought before rates
 *  were selectable keep the legacy policy (SLM over 15 years, WDV at 30%). */
export function applyDepreciation(s: GameState): Money {
  let total = 0
  const lifeMonths = Math.max(12, Math.round(BAL.depreciationLifeYears * 12))
  const residualPct = BAL.depreciationResidualPct
  for (const b of Object.values(s.buses)) {
    if (b.ownership !== 'owned' || b.bookValue <= 0) continue
    if (b.depreciationMethod === 'NONE') continue
    const model = BUS_MODELS[b.modelId]
    const cost = b.acquiredPrice > 0 ? b.acquiredPrice : (model?.priceNew ?? b.bookValue)
    const residual = Math.round(cost * residualPct)
    if (b.bookValue <= residual) continue

    const ratePct = b.depreciationRatePct
    let dep = 0
    if (b.depreciationMethod === 'WDV') {
      const annual = ratePct ?? 30
      dep = Math.min(Math.round((b.bookValue * annual) / 100 / 12), b.bookValue - residual)
    } else if (ratePct !== undefined) {
      dep = Math.min(Math.round((cost * ratePct) / 100 / 12), b.bookValue - residual)
    } else {
      const monthly = Math.round((cost - residual) / lifeMonths)
      dep = Math.min(Math.max(0, monthly), b.bookValue - residual)
    }
    dep = Math.max(0, dep)
    b.bookValue -= dep
    total += dep
  }
  return total
}

/** GST accrual on an AC-bus ticket (fare is GST-inclusive). */
export function accrueGstOnTicket(s: GameState, fare: Money, isAc: boolean): void {
  if (!isAc) return
  const gst = Math.round((fare * BAL.gstAcBps) / (10000 + BAL.gstAcBps))
  s.company.gstPayable += gst
}
