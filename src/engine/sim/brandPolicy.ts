import type { Bus, BusGroup, GameState, ID, Money } from '../types'
import { rs } from '../core/money'
import { isCargoModel } from '../data/busModels'
import { fmtCompact } from '../core/money'
import { spend } from './finance'
import { pushLog } from './log'
import { busAgeYears } from './fleet'

/**
 * Brand standards and targets. A brand is more than a badge: these settings change fares,
 * crew expectations, cleaning, marketing and what the advisor nags about.
 */

const groupOf = (s: GameState, id?: ID): BusGroup | undefined => (id && s.groups ? s.groups[id] : undefined)

/** Keep a fare inside the brand's floor and ceiling (percent of the normal market fare). */
export function clampBrandFare(s: GameState, groupId: ID | undefined, fare: Money, normal: Money): Money {
  const p = groupOf(s, groupId)?.farePolicy
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
  const min = groupOf(s, groupId)?.minDriverSkill
  if (!min || avgDriverSkill >= min) return 0
  return Math.min(1, (min - avgDriverSkill) * 0.15)
}

/** Coaches of this brand older than its age cap. */
export function overAgeBuses(s: GameState, group: BusGroup): Bus[] {
  const cap = group.maxBusAgeYears
  if (!cap) return []
  return Object.values(s.buses).filter(
    (b) => b.groupId === group.id && !isCargoModel(b.modelId) && busAgeYears(s, b) > cap,
  )
}

const CLEAN_PER_BUS_DAY = rs(120)

/** Brands that clean after every trip keep their coaches spotless for a daily cost per active coach. */
export function dailyBrandPass(s: GameState): void {
  for (const g of Object.values(s.groups ?? {})) {
    if (g.status !== 'active' || g.cleaningStandard !== 'every_trip') continue
    for (const b of Object.values(s.buses)) {
      if (b.groupId !== g.id || b.status !== 'active' || !b.scheduleId) continue
      b.busCleanliness = Math.min(95, (b.busCleanliness ?? 85) + 10)
      spend(s, 'parking_cleaning', CLEAN_PER_BUS_DAY, { busId: b.id, note: `${g.name}: clean after every trip` })
    }
  }
}

/** Route profit of one brand over the last 30 days, from the per-day route history. */
export function brandRouteProfit30d(s: GameState, groupId: ID): Money {
  const from = s.day - 30
  let total = 0
  for (const days of Object.values(s.routeHistory ?? {})) {
    for (const d of days ?? []) {
      if (d.day <= from) continue
      const row = d.byBrand?.[groupId]
      if (row) total += row.revenue - row.cost
    }
  }
  return total
}

/** Month end: pay marketing and judge each brand against its profit target. */
export function monthlyBrandPass(s: GameState): void {
  for (const g of Object.values(s.groups ?? {})) {
    if (g.status !== 'active') continue

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
