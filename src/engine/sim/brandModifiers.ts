import type { BusGroup, ID, ServiceTier } from '../types'

/**
 * Pure brand rules shared by demand, pricing and the UI. Imports types only, so the demand
 * model can use it without a dependency cycle.
 */

type Groups = Record<ID, BusGroup> | undefined

/** Standards a brand can leave blank and take from the operator that runs it. */
export type InheritableKey =
  | 'farePolicy'
  | 'minDriverSkill'
  | 'maxBusAgeYears'
  | 'cleaningStandard'
  | 'loyaltyPct'

export interface ResolvedStandard<T> {
  value: T | undefined
  /** The operator the value came from; undefined when it is the brand's own (or unset). */
  from?: BusGroup
}

/** Operators above a brand, nearest first. */
export function operatorAncestors(groups: Groups, group: BusGroup | undefined): BusGroup[] {
  const out: BusGroup[] = []
  const seen = new Set<ID>()
  let id = group?.parentGroupId
  while (id && groups?.[id] && !seen.has(id)) {
    seen.add(id)
    const p = groups[id]
    if (p.kind === 'operator') out.push(p)
    id = p.parentGroupId
  }
  return out
}

/** The brand's own setting, else the nearest operator above it that sets one. */
export function resolveStandard<K extends InheritableKey>(
  groups: Groups,
  group: BusGroup | undefined,
  key: K,
): ResolvedStandard<NonNullable<BusGroup[K]>> {
  if (!group) return { value: undefined }
  const own = group[key]
  if (own !== undefined) return { value: own as NonNullable<BusGroup[K]> }
  for (const op of operatorAncestors(groups, group)) {
    const v = op[key]
    if (v !== undefined) return { value: v as NonNullable<BusGroup[K]>, from: op }
  }
  return { value: undefined }
}

/**
 * What each service tier promises. Premium and Deluxe services let the passenger down when the
 * coach is below the quality bar (0 to 5), and earn prestige when it is not. Economy and Standard
 * carry no bar, so existing services are unaffected.
 */
export interface TierStandard {
  label: string
  /** Coaches below this quality let the tier down. 0 = no bar. */
  minQuality: number
  /** Demand gained when the coach lives up to the tier. */
  prestige: number
  /** Demand lost when it does not. */
  shortfall: number
}

export const TIER_STANDARD: Record<ServiceTier, TierStandard> = {
  economy: { label: 'Economy', minQuality: 0, prestige: 0, shortfall: 0 },
  standard: { label: 'Standard', minQuality: 0, prestige: 0, shortfall: 0 },
  premium: { label: 'Premium', minQuality: 3.4, prestige: 0.04, shortfall: 0.1 },
  gold: { label: 'Deluxe', minQuality: 4.0, prestige: 0.07, shortfall: 0.18 },
}

/** Demand change from the service tier: prestige if the coach meets it, a penalty if it does not. */
export function tierLift(tier: ServiceTier | undefined, coachQuality: number): number {
  const spec = TIER_STANDARD[tier ?? 'standard']
  if (spec.minQuality <= 0) return 0
  return coachQuality >= spec.minQuality ? spec.prestige : -spec.shortfall
}

/** Campaign lift for a trip on `routeId` on `day`, from the brand's and its operators' campaigns. */
export function campaignLift(groups: Groups, group: BusGroup | undefined, routeId: string | undefined, day: number): number {
  if (!group) return 0
  let lift = 0
  for (const g of [group, ...operatorAncestors(groups, group)]) {
    for (const c of g.campaigns ?? []) {
      if (day < c.startDay || day > c.endDay) continue
      if (c.kind === 'route' && c.routeId !== routeId) continue
      const span = c.endDay - c.startDay + 1
      lift += c.boost * (1 - (day - c.startDay) / span)
    }
  }
  return Math.min(CAMPAIGN_LIFT_CAP, lift)
}

export const CAMPAIGN_LIFT_CAP = 0.35

/** Each percent of loyalty discount lifts demand by this much. */
export const LOYALTY_LIFT_PER_PCT = 0.012
export const LOYALTY_STEPS = [0, 2, 4, 6]

/** Multiplier on the brand-appeal part of demand for one trip: campaigns and the loyalty scheme. */
export function brandDemandMult(groups: Groups, group: BusGroup | undefined, routeId: string | undefined, day: number): number {
  if (!group) return 1
  const loyalty = resolveStandard(groups, group, 'loyaltyPct').value ?? 0
  return Math.max(0.6, 1 + campaignLift(groups, group, routeId, day) + loyalty * LOYALTY_LIFT_PER_PCT)
}
