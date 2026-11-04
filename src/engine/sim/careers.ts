import type { GameState, Staff } from '../types'
import { fmtCompact } from '../core/money'
import { pushDecision, pushLog } from './log'
import { hrOnDuty } from './staffing'

/**
 * Driver careers. Experience, skill and a clean record move a driver up a four-step ladder.
 * Higher ranks drive safer and are worth more to a rival, so keeping them happy matters.
 */

export const RANK_NAMES = ['Trainee', 'Driver', 'Senior', 'Master'] as const

export interface CareerInfo {
  rank: number
  name: string
  /** What the next step needs, or undefined at the top. */
  next?: string
}

const isDriver = (st: Staff) => st.role === 'driver' || st.role === 'co_driver'

export function careerRank(st: Staff): number {
  if (!isDriver(st)) return 0
  const trips = st.tripsDriven ?? 0
  const clean = (st.safetyRecord?.accidents ?? 0) === 0
  if (trips >= 3000 && st.skill >= 8 && clean) return 3
  if (trips >= 1000 && st.skill >= 6) return 2
  if (trips >= 150) return 1
  return 0
}

export function careerInfo(st: Staff): CareerInfo {
  const rank = careerRank(st)
  const trips = st.tripsDriven ?? 0
  const next =
    rank === 0 ? `${Math.max(0, 150 - trips)} more trips`
    : rank === 1 ? `1,000 trips (${trips.toLocaleString('en-IN')}) and skill 6+`
    : rank === 2 ? `3,000 trips (${trips.toLocaleString('en-IN')}), skill 8+ and no accidents`
    : undefined
  return { rank, name: RANK_NAMES[rank]!, next }
}

/** Safety points a driver's rank adds on the road. */
export function rankSafetyBonus(st: Staff): number {
  const r = careerRank(st)
  return r === 3 ? 1 : r === 2 ? 0.5 : 0
}

/** Rival offers come more often to unhappy drivers and to Masters. */
export function poachChanceMult(st: Staff): number {
  const unhappy = Math.max(0, 60 - st.loyalty) / 60 // 0 when loyal, 1 at zero loyalty
  return (1 + unhappy * 2) * (careerRank(st) >= 3 ? 1.5 : 1)
}

export const PROMOTION_RAISE = 0.1

export function applyPromotion(s: GameState, st: Staff, rank: number): void {
  st.salary = Math.round(st.salary * (1 + PROMOTION_RAISE))
  st.loyalty = Math.min(100, st.loyalty + 10)
  st.morale = Math.min(100, st.morale + 5)
  st.careerRank = rank
  pushLog(s, 'good', `${st.name} promoted to ${RANK_NAMES[rank]}: salary now ${fmtCompact(st.salary)}/month.`, '/staff')
}

/** Month end: promote drivers who earned the next rank. With HR auto-raise on, it just happens. */
export function monthlyCareerPass(s: GameState): void {
  const hrAuto = s.company.hrAutoRaise && hrOnDuty(s)
  for (const st of Object.values(s.staff)) {
    if (!isDriver(st)) continue
    const rank = careerRank(st)
    if (st.careerRank === undefined) {
      st.careerRank = rank // existing drivers start at the rank they already earned
      continue
    }
    if (rank <= st.careerRank) {
      if (rank < st.careerRank) st.careerRank = rank // lost the rank (for example after an accident)
      continue
    }
    if (hrAuto) {
      applyPromotion(s, st, rank)
    } else {
      pushDecision(s, {
        kind: 'promotion',
        title: `${st.name} has earned a promotion`,
        body: `${st.name} is now a ${RANK_NAMES[rank]} driver (${(st.tripsDriven ?? 0).toLocaleString('en-IN')} trips, skill ${st.skill}). A ${Math.round(PROMOTION_RAISE * 100)}% raise to ${fmtCompact(Math.round(st.salary * (1 + PROMOTION_RAISE)))}/month keeps them loyal. Senior drivers drive safer, and rivals notice them.`,
        options: [
          { id: 'promote', label: `Promote, ${fmtCompact(Math.round(st.salary * (1 + PROMOTION_RAISE)))}/month` },
          { id: 'later', label: 'Not now' },
        ],
        data: { staffId: st.id, rank },
      })
      st.careerRank = rank // ask once per step
    }
  }
}
