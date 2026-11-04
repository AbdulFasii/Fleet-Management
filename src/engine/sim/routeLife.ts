import type { GameState } from '../types'
import { canonicalRouteId } from '../data/routes'

/**
 * Route life cycle. A new route has to earn its passengers: demand starts at 60% of normal and
 * reaches 100% after 90 days of continuous service. A route nobody serves loses 0.5 points a day.
 * Routes already running when this was introduced start fully mature.
 */

const RAMP_DAYS = 90
const START_MULT = 0.6
const DECAY_PER_DAY = 0.5

const enabled = (s: GameState) => s.config?.routeLifeCycle !== false

/** Demand multiplier for a route today (1 when the feature is off or the route is untracked). */
export function routeLifeMult(s: GameState, routeId: string): number {
  if (!enabled(s)) return 1
  const m = s.routeMaturity?.[canonicalRouteId(routeId)]
  if (m === undefined) return 1
  return START_MULT + (1 - START_MULT) * Math.max(0, Math.min(1, m / 100))
}

/** Maturity 0-100 for display, or undefined when untracked. */
export function routeMaturity(s: GameState, routeId: string): number | undefined {
  return enabled(s) ? s.routeMaturity?.[canonicalRouteId(routeId)] : undefined
}

const activeOn = (s: GameState, canon: string) =>
  Object.values(s.schedules).some((sch) => sch.active && canonicalRouteId(sch.routeId) === canon)

/** Call when a schedule is created: a route nobody was serving starts again from zero. */
export function startRouteLife(s: GameState, routeId: string): void {
  if (!enabled(s)) return
  const canon = canonicalRouteId(routeId)
  if (!s.routeMaturity) s.routeMaturity = {}
  if (s.routeMaturity[canon] !== undefined) return
  if (activeOn(s, canon)) return // already running before the life cycle existed: handled by the daily pass
  s.routeMaturity[canon] = 0
}

export function dailyRouteLifePass(s: GameState): void {
  if (!enabled(s)) return
  if (!s.routeMaturity) s.routeMaturity = {}
  const served = new Set<string>()
  for (const sch of Object.values(s.schedules)) {
    if (sch.active) served.add(canonicalRouteId(sch.routeId))
  }
  for (const canon of served) {
    const m = s.routeMaturity[canon]
    s.routeMaturity[canon] = m === undefined ? 100 : Math.min(100, m + 100 / RAMP_DAYS)
  }
  for (const [canon, m] of Object.entries(s.routeMaturity)) {
    if (!served.has(canon)) s.routeMaturity[canon] = Math.max(0, m - DECAY_PER_DAY)
  }
}
