import type { GameState } from '../types'
import { Cr, fmtCompact, rs, type Money } from '../core/money'
import { earn, netWorth } from './finance'
import { pushLog } from './log'

export interface ObjectiveDef {
  id: string
  label: string
  /** Why it matters and where to work on it — shown under the goal. */
  hint: string
  /** Page that moves this goal forward. */
  to: string
  progress: (s: GameState) => { current: number; target: number; fmt?: (v: number) => string }
  /** Paid out once, on completion. */
  reward: { cash?: Money; reputation?: number }
}

const liveBuses = (s: GameState) => Object.values(s.buses).filter((b) => (b.status as string) !== 'sold').length
const activeRoutes = (s: GameState) => Object.values(s.permits).filter((p) => p.status === 'active').length
/** Net worth that wins the game. Ironman asks for more. */
export function empireTarget(s: GameState): Money {
  return Cr(s.scenario === 'ironman' ? 150 : 100)
}
const crore = (v: number) => `₹${(v / Cr(1)).toFixed(1)} Cr`

/**
 * An ordered chain: each goal pulls the player into another module, so the company
 * has to grow as one system (fleet -> reliability -> charters/cargo/lounges -> scale).
 */
export const OBJECTIVES: ObjectiveDef[] = [
  { id: 'g_fleet5', label: 'Run a 5-bus fleet', hint: 'Buy, lease or attach coaches.', to: '/market',
    progress: (s) => ({ current: Math.min(5, liveBuses(s)), target: 5, fmt: (v) => `${v} buses` }), reward: { cash: rs(150_000) } },
  { id: 'g_routes3', label: 'Hold permits on 3 routes', hint: 'Spread across corridors so one bandh cannot stop you.', to: '/routes',
    progress: (s) => ({ current: Math.min(3, activeRoutes(s)), target: 3, fmt: (v) => `${v} routes` }), reward: { cash: rs(100_000) } },
  { id: 'g_profit', label: 'Close a profitable month', hint: 'Fill seats, control costs, service on time.', to: '/money',
    progress: (s) => ({ current: s.monthly.some((m) => m.profit > 0 && m.revenueTotal > 0) ? 1 : 0, target: 1 }), reward: { reputation: 2 } },
  { id: 'g_rating40', label: 'Reach a 4.0★ rating', hint: 'Condition, clean coaches, happy crews and lounges all feed it.', to: '/workshop',
    progress: (s) => ({ current: Math.min(4, s.company.rating), target: 4, fmt: (v) => `${v.toFixed(2)}★` }), reward: { cash: rs(200_000), reputation: 3 } },
  { id: 'g_charter', label: 'Complete your first charter', hint: 'Put a coach on charter duty and accept an inquiry.', to: '/charters',
    progress: (s) => ({ current: Math.min(1, s.charterStats?.totalContracts ?? 0), target: 1 }), reward: { cash: rs(100_000) } },
  { id: 'g_cargo', label: 'Sign a cargo contract', hint: 'Needs a cargo licence on the corridor.', to: '/cargo',
    progress: (s) => ({ current: Math.min(1, (s.company.cargoContracts ?? []).length), target: 1 }), reward: { cash: rs(100_000) } },
  { id: 'g_lounge', label: 'Open a passenger lounge', hint: 'Lifts satisfaction and demand at the boarding city.', to: '/lounges',
    progress: (s) => ({ current: Math.min(1, (s.company.lounges ?? []).length), target: 1 }), reward: { reputation: 2 } },
  { id: 'g_fleet10', label: 'Grow to 10 buses', hint: 'Scale only as fast as crews and the workshop can keep up.', to: '/market',
    progress: (s) => ({ current: Math.min(10, liveBuses(s)), target: 10, fmt: (v) => `${v} buses` }), reward: { cash: rs(500_000) } },
  { id: 'g_punctual', label: 'Hit 90% punctuality', hint: 'Service on schedule, rested drivers, no breakdowns.', to: '/workshop',
    progress: (s) => ({ current: Math.min(0.9, s.company.punctuality), target: 0.9, fmt: (v) => `${Math.round(v * 100)}%` }), reward: { reputation: 4 } },
  { id: 'g_nw5', label: 'Net worth of ₹5 Cr', hint: 'Cash, fleet and receivables, less loans and tax.', to: '/money',
    progress: (s) => ({ current: Math.min(Cr(5), Math.max(0, netWorth(s))), target: Cr(5), fmt: crore }), reward: { cash: rs(1_000_000), reputation: 3 } },
  { id: 'g_fleet25', label: '25 buses at 4.5★', hint: 'Size and quality together.', to: '/fleet',
    progress: (s) => ({ current: Math.min(25, liveBuses(s)) * (s.company.rating >= 4.5 ? 1 : 0), target: 25, fmt: (v) => `${v} buses` }), reward: { cash: rs(2_500_000) } },
  { id: 'g_empire', label: 'Build the empire', hint: 'The finish line: net worth of ₹100 Cr (₹150 Cr in an ironman game).', to: '/money',
    progress: (s) => ({ current: Math.min(empireTarget(s), Math.max(0, netWorth(s))), target: empireTarget(s), fmt: crore }), reward: { reputation: 5 } },
]

export function objectiveDone(s: GameState, id: string): boolean {
  return s.objectives?.[id] !== undefined
}

/** The next few unfinished goals, in order. */
export function activeObjectives(s: GameState, n = 3): ObjectiveDef[] {
  return OBJECTIVES.filter((o) => !objectiveDone(s, o.id)).slice(0, n)
}

/** Daily check: pay out finished goals, and declare victory on the final one. */
export function checkObjectives(s: GameState): void {
  if (!s.objectives) s.objectives = {}
  for (const o of activeObjectives(s, OBJECTIVES.length)) {
    // The finish line only counts once every other goal is behind you.
    if (o.id === 'g_empire' && OBJECTIVES.some((x) => x.id !== o.id && !objectiveDone(s, x.id))) continue
    const p = o.progress(s)
    if (p.current < p.target) continue
    s.objectives[o.id] = s.day
    const bits: string[] = []
    if (o.reward.cash) {
      earn(s, 'subsidy', o.reward.cash, { note: `Company goal reward: ${o.label}` })
      bits.push(fmtCompact(o.reward.cash))
    }
    if (o.reward.reputation) {
      s.company.reputation = Math.min(100, s.company.reputation + o.reward.reputation)
      bits.push(`+${o.reward.reputation} reputation`)
    }
    pushLog(s, 'good', `GOAL REACHED: ${o.label}${bits.length ? ` — reward ${bits.join(', ')}` : ''}.`, o.to)
  }
  if (!s.victory && s.scenario !== 'sandbox' && objectiveDone(s, 'g_empire')) {
    const routes = activeRoutes(s)
    s.victory = {
      day: s.day,
      score: {
        daysSurvived: s.day - s.startDay,
        peakFleet: s.peakFleet,
        lifetimeProfit: s.lifetimeProfit,
        bestRating: Math.round(s.company.rating * 10) / 10,
        routesServed: routes,
      },
      netWorth: netWorth(s),
    }
    pushLog(s, 'good', `VICTORY: your company is a ${fmtCompact(empireTarget(s))} transport empire. Retire with honours or keep building.`)
  }
}
