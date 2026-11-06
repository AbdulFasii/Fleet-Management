import type { Bus, BusGroup, GameState, ID, Money } from '../types'
import { rs } from '../core/money'
import { isCargoModel } from '../data/busModels'
import { fmtCompact } from '../core/money'
import { spend } from './finance'
import { pushLog } from './log'
import { busAgeYears } from './fleet'
import { fleetDescendantIds } from './groups'
import { TIER_STANDARD, resolveStandard } from './brandModifiers'

/**
 * Brand standards and targets. A brand is more than a badge: these settings change fares,
 * crew expectations, cleaning, marketing and what the advisor nags about.
 */

const groupOf = (s: GameState, id?: ID): BusGroup | undefined => (id && s.groups ? s.groups[id] : undefined)

/** Keep a fare inside the brand's floor and ceiling (percent of the normal market fare). */
export function clampBrandFare(s: GameState, groupId: ID | undefined, fare: Money, normal: Money): Money {
  const p = resolveStandard(s.groups, groupOf(s, groupId), 'farePolicy').value
  if (!p) return fare
  let out = fare
  if (p.floorPct !== undefined) out = Math.max(out, Math.round((normal * p.floorPct) / 100))
  if (p.ceilingPct !== undefined) out = Math.min(out, Math.round((normal * p.ceilingPct) / 100))
  return out
}

/**
 * Passenger satisfaction points lost when the crew on a trip is below the brand's promise.
 * No penalty at or above the standard; each skill point short costs 0.15, capped at 1.
 */
export function crewStandardPenalty(s: GameState, groupId: ID | undefined, avgDriverSkill: number): number {
  const min = resolveStandard(s.groups, groupOf(s, groupId), 'minDriverSkill').value
  if (!min || avgDriverSkill >= min) return 0
  return Math.min(1, (min - avgDriverSkill) * 0.15)
}

/** Coaches of this brand older than its age cap. */
export function overAgeBuses(s: GameState, group: BusGroup): Bus[] {
  const cap = resolveStandard(s.groups, group, 'maxBusAgeYears').value
  if (!cap) return []
  return Object.values(s.buses).filter(
    (b) => b.groupId === group.id && !isCargoModel(b.modelId) && busAgeYears(s, b) > cap,
  )
}

const CLEAN_PER_BUS_DAY = rs(120)

/** Brands that clean after every trip keep their coaches spotless for a daily cost per active coach. */
export function dailyBrandPass(s: GameState): void {
  for (const g of Object.values(s.groups ?? {})) {
    if (g.status !== 'active' || resolveStandard(s.groups, g, 'cleaningStandard').value !== 'every_trip') continue
    for (const b of Object.values(s.buses)) {
      if (b.groupId !== g.id || b.status !== 'active' || !b.scheduleId) continue
      b.busCleanliness = Math.min(95, (b.busCleanliness ?? 85) + 10)
      spend(s, 'parking_cleaning', CLEAN_PER_BUS_DAY, { busId: b.id, note: `${g.name}: clean after every trip` })
    }
  }
}

function brandMoney30d(s: GameState, groupId: ID, pick: (row: { revenue: Money; cost: Money }) => Money): Money {
  const from = s.day - 30
  const keys = s.groups?.[groupId]?.kind === 'operator' ? [...fleetDescendantIds(s, groupId)] : [groupId]
  let total = 0
  for (const days of Object.values(s.routeHistory ?? {})) {
    for (const d of days ?? []) {
      if (d.day <= from) continue
      for (const k of keys) {
        const row = d.byBrand?.[k]
        if (row) total += pick(row)
      }
    }
  }
  return total
}

/**
 * Route profit of one brand over the last 30 days, from the per-day route history.
 * An operator brand reports the combined profit of every fleet brand beneath it.
 */
export function brandRouteProfit30d(s: GameState, groupId: ID): Money {
  return brandMoney30d(s, groupId, (r) => r.revenue - r.cost)
}

/** Route revenue of one brand (or all brands under an operator) over the last 30 days. */
export function brandRevenue30d(s: GameState, groupId: ID): Money {
  return brandMoney30d(s, groupId, (r) => r.revenue)
}

/** Line coaches of a brand that fall short of the quality bar of its default service tier. */
export function belowStandardBuses(s: GameState, group: BusGroup): Bus[] {
  const tier = group.defaultServiceTier
  if (!tier) return []
  const min = TIER_STANDARD[tier].minQuality
  if (min <= 0) return []
  return Object.values(s.buses).filter(
    (b) => b.groupId === group.id && !isCargoModel(b.modelId) && (b.qualityScore ?? 3) < min,
  )
}

/** Month end: pay marketing and judge each brand against its profit target. */
export function monthlyBrandPass(s: GameState): void {
  for (const g of Object.values(s.groups ?? {})) {
    if (g.status !== 'active') continue

    // Finished campaigns drop off.
    if (g.campaigns?.length) {
      g.campaigns = g.campaigns.filter((c) => c.endDay >= s.day)
      if (g.campaigns.length === 0) delete g.campaigns
    }

    if (g.kind !== 'operator') {
      // Loyalty scheme: the discount given back to repeat passengers comes out of this month's revenue.
      const loyalty = resolveStandard(s.groups, g, 'loyaltyPct').value ?? 0
      if (loyalty > 0) {
        const cost = Math.round((brandRevenue30d(s, g.id) * loyalty) / 100)
        if (cost > 0) spend(s, 'marketing', cost, { note: `${g.name}: ${loyalty}% loyalty discounts` })
      }
      const short = belowStandardBuses(s, g)
      if (g.defaultServiceTier && short.length > 0) {
        pushLog(
          s,
          'alert',
          `${g.name} sells ${TIER_STANDARD[g.defaultServiceTier].label} service, but ${short.length} coach${short.length === 1 ? '' : 'es'} fall short of its quality bar. Passengers notice: demand is dented until they are replaced or refurbished.`,
          '/settings?tab=subsidiaries',
        )
      }
    }

    const budget = g.marketingBudgetMonthly ?? 0
    if (budget > 0) {
      spend(s, 'marketing', budget, { note: `${g.name}: brand marketing` })
      // Roughly +0.4 points of awareness per ₹1 lakh, capped per month.
      s.company.brandAwareness = Math.min(1, s.company.brandAwareness + Math.min(0.02, (budget / rs(100_000)) * 0.004))
    }

    const target = g.profitTargetMonthly ?? 0
    if (target > 0) {
      const profit = brandRouteProfit30d(s, g.id)
      g.lastMonthProfit = profit
      if (profit < target) {
        g.targetMissMonths = (g.targetMissMonths ?? 0) + 1
        pushLog(
          s,
          'alert',
          `${g.name} missed its profit target: ${fmtCompact(profit)} against ${fmtCompact(target)} (${g.targetMissMonths} month${g.targetMissMonths === 1 ? '' : 's'} in a row).`,
          '/settings?tab=subsidiaries',
        )
      } else {
        g.targetMissMonths = 0
      }
    } else {
      g.lastMonthProfit = undefined
      g.targetMissMonths = 0
    }
  }
}
