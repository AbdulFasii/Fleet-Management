import { L, fmtCompact, type Money } from '../core/money'
import { nextId } from '../core/ids'
import { BAL } from '../data/balance'
import { routeName } from '../data/routes'
import type { BrandCampaign, BusGroup, GameState, ID } from '../types'
import { canAfford, capitalIn, spend } from './finance'
import { sellBus, sellSettlement } from './fleet'
import {
  assignBusToGroup,
  assignScheduleToGroup,
  createGroup,
  getDescendantGroupIds,
  retireGroup,
} from './groups'
import { pushLog } from './log'
import { unassignBus } from './schedules'
import { brandRouteProfit30d } from './brandPolicy'

/** Brand actions beyond the standards: campaigns, moving coaches around, merging, spinning off, selling. */

// ───────────────────────── Campaigns ─────────────────────────

export interface LaunchTier {
  id: 'local' | 'regional' | 'statewide'
  label: string
  cost: Money
  boost: number
  days: number
  /** Company-wide awareness gained. */
  awareness: number
}

export const LAUNCH_TIERS: LaunchTier[] = [
  { id: 'local', label: 'Local', cost: L(2), boost: 0.06, days: 30, awareness: 0.005 },
  { id: 'regional', label: 'Regional', cost: L(6), boost: 0.12, days: 30, awareness: 0.015 },
  { id: 'statewide', label: 'Statewide', cost: L(15), boost: 0.2, days: 30, awareness: 0.03 },
]

export const ROUTE_PUSH = { cost: L(3), boost: 0.15, days: 21 }

/** An operator-wide launch lifts every brand beneath it, so it costs more. */
export const OPERATOR_LAUNCH_MULT = 1.5

export function launchCost(g: BusGroup, tier: LaunchTier): Money {
  return Math.round(tier.cost * (g.kind === 'operator' ? OPERATOR_LAUNCH_MULT : 1))
}

export function activeCampaigns(s: GameState, g: BusGroup): BrandCampaign[] {
  return (g.campaigns ?? []).filter((c) => c.endDay >= s.day)
}

export function launchCampaign(
  s: GameState,
  groupId: ID,
  input: { kind: 'launch'; tier: LaunchTier['id'] } | { kind: 'route'; routeId: string },
): string | null {
  const g = s.groups?.[groupId]
  if (!g || g.status !== 'active') return 'Brand not found.'
  const running = activeCampaigns(s, g)

  let cost: Money
  let boost: number
  let days: number
  let awareness = 0
  let routeId: string | undefined
  let label: string

  if (input.kind === 'launch') {
    const tier = LAUNCH_TIERS.find((t) => t.id === input.tier)
    if (!tier) return 'Unknown campaign size.'
    if (running.some((c) => c.kind === 'launch')) return 'A launch campaign is already running for this brand.'
    cost = launchCost(g, tier)
    boost = tier.boost
    days = tier.days
    awareness = tier.awareness
    label = `${tier.label} launch campaign`
  } else {
    if (g.kind === 'operator') return 'Corridor pushes belong to fleet brands. Launch one on a brand that runs the route.'
    const runs = Object.values(s.schedules ?? {}).some((sch) => sch.groupId === g.id && sch.routeId === input.routeId)
    if (!runs) return `${g.name} runs no service on that route.`
    if (running.some((c) => c.kind === 'route' && c.routeId === input.routeId)) {
      return 'A push is already running on that route.'
    }
    cost = ROUTE_PUSH.cost
    boost = ROUTE_PUSH.boost
    days = ROUTE_PUSH.days
    routeId = input.routeId
    label = `corridor push on ${routeName(input.routeId)}`
  }

  if (!canAfford(s, cost)) return `Not enough cash: this costs ${fmtCompact(cost)}.`
  spend(s, 'marketing', cost, { note: `${g.name}: ${label}` })
  if (awareness > 0) s.company.brandAwareness = Math.min(1, s.company.brandAwareness + awareness)

  const campaign: BrandCampaign = {
    id: nextId(s.ids, 'cmp'),
    kind: input.kind,
    ...(routeId ? { routeId } : {}),
    startDay: s.day,
    endDay: s.day + days - 1,
    boost,
  }
  g.campaigns = [...(g.campaigns ?? []), campaign]
  pushLog(s, 'info', `${g.name}: ${label} started (${fmtCompact(cost)}, ${days} days).`)
  return null
}

export function stopCampaign(s: GameState, groupId: ID, campaignId: ID): string | null {
  const g = s.groups?.[groupId]
  if (!g) return 'Brand not found.'
  const before = g.campaigns?.length ?? 0
  g.campaigns = (g.campaigns ?? []).filter((c) => c.id !== campaignId)
  if (g.campaigns.length === 0) delete g.campaigns
  return before === (g.campaigns?.length ?? 0) ? 'Campaign not found.' : null
}

// ───────────────────── Moving coaches between brands ─────────────────────

function rebrandTotal(count: number): Money {
  return BAL.rebrandCost * count
}

/**
 * Move coaches to another brand (or to Unassigned). A coach on a service of a different
 * brand is pulled off that service first, since a service only takes coaches of its own brand.
 */
function moveCoaches(s: GameState, busIds: ID[], toGroupId: ID | undefined, rebrand: boolean): string | null {
  for (const id of busIds) {
    const bus = s.buses[id]
    if (!bus) continue
    const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
    if (sch && (sch.groupId ?? undefined) !== toGroupId) unassignBus(s, sch.id, id)
    const err = assignBusToGroup(s, id, toGroupId, { chargeRebrand: rebrand && toGroupId !== undefined })
    if (err) return err
  }
  return null
}

export interface TransferQuote {
  moving: number
  rebrandCost: Money
}

export function quoteTransfer(s: GameState, busIds: ID[], toGroupId: ID | undefined, rebrand: boolean): TransferQuote {
  const moving = busIds.filter((id) => s.buses[id] && s.buses[id].groupId !== toGroupId).length
  return { moving, rebrandCost: rebrand && toGroupId !== undefined ? rebrandTotal(moving) : 0 }
}

export function transferCoaches(s: GameState, busIds: ID[], toGroupId: ID | undefined, rebrand: boolean): string | null {
  const dest = toGroupId ? s.groups?.[toGroupId] : undefined
  if (toGroupId && (!dest || dest.status !== 'active')) return 'Pick an active brand.'
  if (dest?.kind === 'operator') return `${dest.name} is an operator and owns no coaches. Pick one of its brands.`
  const ids = busIds.filter((id) => s.buses[id] && s.buses[id].groupId !== toGroupId)
  if (ids.length === 0) return 'No coaches to move.'
  const quote = quoteTransfer(s, ids, toGroupId, rebrand)
  if (quote.rebrandCost > 0 && !canAfford(s, quote.rebrandCost)) {
    return `Rebranding ${ids.length} coaches costs ${fmtCompact(quote.rebrandCost)}.`
  }
  const err = moveCoaches(s, ids, toGroupId, rebrand)
  if (err) return err
  pushLog(
    s,
    'info',
    `${ids.length} coach${ids.length === 1 ? '' : 'es'} moved to ${dest?.name ?? 'Unassigned'}` +
      (quote.rebrandCost > 0 ? ` (rebranding ${fmtCompact(quote.rebrandCost)}).` : '.'),
  )
  return null
}

// ───────────────────────────── Merge ─────────────────────────────

export interface MergeQuote {
  coaches: number
  services: number
  brandsMoved: number
  rebrandCost: Money
  error: string | null
}

export function quoteMerge(s: GameState, fromId: ID, intoId: ID): MergeQuote {
  const from = s.groups?.[fromId]
  const into = s.groups?.[intoId]
  const empty = { coaches: 0, services: 0, brandsMoved: 0, rebrandCost: 0 }
  if (!from || !into) return { ...empty, error: 'Brand not found.' }
  if (fromId === intoId) return { ...empty, error: 'Pick a different brand to merge into.' }
  if (from.status !== 'active' || into.status !== 'active') return { ...empty, error: 'Both brands must be active.' }
  if ((from.kind ?? 'fleet') !== (into.kind ?? 'fleet')) {
    return { ...empty, error: 'An operator can only merge into another operator, and a fleet brand into a fleet brand.' }
  }
  if (Boolean(from.cargoBrand) !== Boolean(into.cargoBrand)) {
    return { ...empty, error: 'Cargo brands only merge with cargo brands.' }
  }
  if (getDescendantGroupIds(s.groups ?? {}, fromId).has(intoId)) {
    return { ...empty, error: 'Cannot merge a brand into one of its own sub-brands.' }
  }
  const coaches = Object.values(s.buses).filter((b) => b.groupId === fromId).length
  const services = Object.values(s.schedules).filter((sch) => sch.groupId === fromId).length
  const brandsMoved = Object.values(s.groups ?? {}).filter((g) => g.parentGroupId === fromId && g.status === 'active').length
  return { coaches, services, brandsMoved, rebrandCost: rebrandTotal(coaches), error: null }
}

/**
 * Fold one brand into another: coaches (repainted at the usual rebrand fee), services,
 * sub-brands and reviews all move over, and the old brand is closed.
 */
export function mergeBrands(s: GameState, fromId: ID, intoId: ID): string | null {
  const q = quoteMerge(s, fromId, intoId)
  if (q.error) return q.error
  if (q.rebrandCost > 0 && !canAfford(s, q.rebrandCost)) {
    return `Repainting ${q.coaches} coaches costs ${fmtCompact(q.rebrandCost)}.`
  }
  const from = s.groups![fromId]
  const into = s.groups![intoId]

  const busIds = Object.values(s.buses).filter((b) => b.groupId === fromId).map((b) => b.id)
  for (const id of busIds) {
    const err = assignBusToGroup(s, id, intoId, { chargeRebrand: true })
    if (err) return err
  }
  for (const sch of Object.values(s.schedules)) {
    if (sch.groupId === fromId) assignScheduleToGroup(s, sch.id, intoId)
  }
  for (const child of Object.values(s.groups ?? {})) {
    if (child.parentGroupId === fromId) child.parentGroupId = intoId
  }

  // Blend reviews so the combined brand keeps its history.
  const n = into.ratingCount + from.ratingCount
  if (n > 0) {
    into.rating = (into.rating * into.ratingCount + from.rating * from.ratingCount) / n
    into.cancelRate = (into.cancelRate * into.ratingCount + from.cancelRate * from.ratingCount) / n
    into.ratingCount = n
  }

  from.status = 'retired'
  from.retiredDay = s.day
  delete from.campaigns
  pushLog(
    s,
    'info',
    `${from.name} merged into ${into.name}: ${q.coaches} coaches, ${q.services} services and ${q.brandsMoved} sub-brands moved` +
      (q.rebrandCost > 0 ? ` (repainting ${fmtCompact(q.rebrandCost)}).` : '.'),
  )
  return null
}

// ──────────────────────────── Spin off ────────────────────────────

export interface SpinOffInput {
  fromId: ID
  name: string
  code: string
  color?: string
  /** Services that move to the new brand, along with all their coaches. */
  scheduleIds: ID[]
  /** Extra coaches that move (those not on a service, or pulled off one). */
  busIds: ID[]
}

function spinOffBusIds(s: GameState, input: SpinOffInput): ID[] {
  const ids = new Set<ID>(input.busIds)
  for (const schId of input.scheduleIds) {
    for (const b of s.schedules[schId]?.busIds ?? []) ids.add(b)
  }
  return [...ids].filter((id) => s.buses[id])
}

export function quoteSpinOff(s: GameState, input: SpinOffInput): { coaches: number; services: number; rebrandCost: Money } {
  const coaches = spinOffBusIds(s, input).length
  return { coaches, services: input.scheduleIds.length, rebrandCost: rebrandTotal(coaches) }
}

/** Create a new brand next to the source and move chosen services and coaches into it. */
export function spinOffBrand(s: GameState, input: SpinOffInput): { id: ID } | { error: string } {
  const from = s.groups?.[input.fromId]
  if (!from || from.status !== 'active') return { error: 'Brand not found.' }
  if (from.kind === 'operator') return { error: 'Spin off from a fleet brand: operators own no coaches.' }
  for (const schId of input.scheduleIds) {
    if (s.schedules[schId]?.groupId !== input.fromId) return { error: 'A chosen service does not belong to this brand.' }
  }
  for (const id of input.busIds) {
    if (s.buses[id]?.groupId !== input.fromId) return { error: 'A chosen coach does not belong to this brand.' }
  }
  const busIds = spinOffBusIds(s, input)
  if (busIds.length === 0 && input.scheduleIds.length === 0) return { error: 'Pick at least one service or coach to move.' }
  for (const id of busIds) {
    if (s.buses[id]?.groupId !== input.fromId) return { error: 'A service has a coach from another brand.' }
  }
  const cost = rebrandTotal(busIds.length)
  if (cost > 0 && !canAfford(s, cost)) return { error: `Repainting ${busIds.length} coaches costs ${fmtCompact(cost)}.` }

  const res = createGroup(s, {
    name: input.name,
    code: input.code,
    color: input.color,
    cargoBrand: from.cargoBrand,
    parentGroupId: from.parentGroupId,
  })
  if ('error' in res) return res
  const created = s.groups![res.id]

  // Start from the source brand's standards and defaults.
  if (!from.cargoBrand) {
    created.defaultAmenities = from.defaultAmenities ? { ...from.defaultAmenities } : created.defaultAmenities
    created.defaultFittings = from.defaultFittings ? { ...from.defaultFittings } : created.defaultFittings
    created.defaultServiceTier = from.defaultServiceTier ?? created.defaultServiceTier
    created.defaultCancellation = from.defaultCancellation ?? created.defaultCancellation
  }
  if (from.farePolicy) created.farePolicy = { ...from.farePolicy }
  for (const k of ['minDriverSkill', 'maxBusAgeYears', 'cleaningStandard', 'loyaltyPct', 'odoHighlightKm'] as const) {
    if (from[k] !== undefined) (created as unknown as Record<string, unknown>)[k] = from[k]
  }

  for (const schId of input.scheduleIds) assignScheduleToGroup(s, schId, res.id)
  const err = moveCoaches(s, busIds, res.id, true)
  if (err) return { error: err }
  pushLog(
    s,
    'info',
    `${created.name} spun off from ${from.name} with ${busIds.length} coaches and ${input.scheduleIds.length} services` +
      (cost > 0 ? ` (repainting ${fmtCompact(cost)}).` : '.'),
  )
  return res
}

// ──────────────────────────── Sell a brand ────────────────────────────

export interface BrandSaleQuote {
  /** Price for the name, badge and reputation. */
  goodwill: Money
  ratingFactor: number
  profit30d: Money
  /** Owned coaches that go with the sale, with what each fetches after its loan. */
  coaches: { busId: ID; reg: string; net: Money; shortfall: Money }[]
  coachNet: Money
  /** Coaches that cannot be sold (leased, attached) and stay with you. */
  keptCoaches: number
  services: number
  total: Money
  error: string | null
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function quoteBrandSale(s: GameState, groupId: ID, includeCoaches: boolean): BrandSaleQuote {
  const g = s.groups?.[groupId]
  const blank: BrandSaleQuote = {
    goodwill: 0, ratingFactor: 0, profit30d: 0, coaches: [], coachNet: 0, keptCoaches: 0, services: 0, total: 0, error: null,
  }
  if (!g || g.status !== 'active') return { ...blank, error: 'Brand not found.' }
  if (g.kind === 'operator') return { ...blank, error: 'An operator is not for sale: close it, or sell the brands under it one by one.' }

  const rating = g.ratingCount >= BAL.groupRatingMinReviews ? g.rating : s.company.rating
  const ratingFactor = clamp(0.6 + (rating - 3) * 0.3, 0.4, 1.3)
  const profit30d = brandRouteProfit30d(s, groupId)
  // About six months of profit for the name (you keep the routes that earn it), plus a small floor for a clean badge.
  const raw = Math.max(0, profit30d) * 6 * 0.8 * ratingFactor * (g.primo ? 1.1 : 1) + L(0.5) * ratingFactor
  const goodwill = Math.round(raw / 100_000) * 100_000

  const coaches: BrandSaleQuote['coaches'] = []
  let kept = 0
  for (const b of Object.values(s.buses)) {
    if (b.groupId !== groupId) continue
    const st = includeCoaches && b.ownership === 'owned' ? sellSettlement(s, b.id) : null
    if (st) coaches.push({ busId: b.id, reg: b.reg, net: st.net, shortfall: st.shortfall })
    else kept++
  }
  const coachNet = coaches.reduce((n, c) => n + c.net, 0)
  const services = Object.values(s.schedules).filter((sch) => sch.groupId === groupId).length
  return { goodwill, ratingFactor, profit30d, coaches, coachNet, keptCoaches: kept, services, total: goodwill + coachNet, error: null }
}

/**
 * Sell a fleet brand: its name and reputation, plus (optionally) its owned coaches at market
 * value with their loans cleared. Services, permits and routes always stay with you. Any coach
 * that is not sold, and every service, moves to `moveTo` (a fleet brand, or Unassigned).
 */
export function sellBrand(
  s: GameState,
  groupId: ID,
  opts: { includeCoaches: boolean; moveTo: ID | undefined },
): string | null {
  const g = s.groups?.[groupId]
  const quote = quoteBrandSale(s, groupId, opts.includeCoaches)
  if (quote.error) return quote.error
  if (opts.moveTo === groupId) return 'Pick a different brand to keep the services under.'
  const dest = opts.moveTo ? s.groups?.[opts.moveTo] : undefined
  if (opts.moveTo && (!dest || dest.status !== 'active' || dest.kind === 'operator')) {
    return 'Services can only stay under an active fleet brand, or Unassigned.'
  }
  const name = g!.name

  // Sell coaches first so their loans clear; one that cannot be sold simply stays and moves with the services.
  let sold = 0
  for (const c of quote.coaches) {
    if (sellBus(s, c.busId) === null) sold++
  }

  const err = retireGroup(s, groupId, opts.moveTo)
  if (err) return err
  g!.soldDay = s.day
  g!.soldPrice = quote.goodwill
  delete g!.campaigns

  if (quote.goodwill > 0) capitalIn(s, 'asset_sale', quote.goodwill, { note: `sold brand ${name}` })
  pushLog(
    s,
    'good',
    `Sold the ${name} brand for ${fmtCompact(quote.goodwill)}` +
      (sold > 0 ? ` with ${sold} coach${sold === 1 ? '' : 'es'}` : '') +
      `. Its ${quote.services} services and routes stay with you under ${dest?.name ?? 'Unassigned'}.`,
  )
  return null
}
