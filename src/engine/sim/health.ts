import type { GameState, Staff } from '../types'
import { SUBSYSTEMS } from '../types'
import { isCargoModel } from '../data/busModels'
import { serviceDueKm } from './maintenance'

/**
 * Two company-wide numbers (0-100) that tie the workshop and the crew room to the road.
 * They are recomputed daily and read by dispatch and charters, so neglect shows up as delays,
 * breakdowns and unhappy passengers, not just as numbers on the Workshop page.
 */

/** Clamp, treating a missing or NaN value as the low end so bad data can never poison the sim. */
const clamp = (v: number, lo = 0, hi = 100) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Average of the worst two subsystems, penalised for overdue service and lapsed papers. */
export function computeFleetHealth(s: GameState): number {
  const buses = Object.values(s.buses).filter((b) => b.status === 'active' || b.status === 'workshop' || b.status === 'grounded')
  if (buses.length === 0) return 100
  let total = 0
  let counted = 0
  for (const b of buses) {
    if (!b.condition) continue
    counted++
    const subs = SUBSYSTEMS.map((k) => num(b.condition[k], 80)).sort((x, y) => x - y)
    let score = (subs[0]! + subs[1]!) / 2
    if (b.ownership !== 'attached' && serviceDueKm(b) > 0) score -= 12
    if (b.insuranceExpiryDay < s.day || b.fitnessExpiryDay < s.day || b.fitnessFailed) score -= 20
    if (isCargoModel(b.modelId)) score = score * 0.95 + 5 // trucks wear differently; keep them from skewing the score
    total += clamp(score)
  }
  return counted > 0 ? Math.round(total / counted) : 100
}

const isCrew = (st: Staff) => st.role === 'driver' || st.role === 'co_driver' || st.role === 'conductor'

/** Morale carries most of it; fatigue drags it down. */
export function computeCrewWelfare(s: GameState): number {
  const crew = Object.values(s.staff).filter(isCrew)
  if (crew.length === 0) return 100
  const morale = crew.reduce((a, c) => a + num(c.morale, 70), 0) / crew.length
  const fatigue = crew.reduce((a, c) => a + num(c.fatigue, 0), 0) / crew.length
  return Math.round(clamp(morale * 0.7 + (100 - fatigue) * 0.3))
}

export function dailyHealthPass(s: GameState): void {
  s.company.fleetHealth = computeFleetHealth(s)
  s.company.crewWelfare = computeCrewWelfare(s)
}

/** Breakdown chance multiplier from fleet health: neutral at 60 and above, up to +25% when it is poor. */
export function healthBreakdownMult(s: GameState): number {
  const h = num(s.company.fleetHealth, 100)
  return 1 + clamp((60 - h) / 100, 0, 0.25)
}

/** Extra delay share from a tired, unhappy crew: none at 50 and above, up to +25%. */
export function welfareDelayMult(s: GameState): number {
  const w = num(s.company.crewWelfare, 100)
  return 1 + clamp((50 - w) / 100, 0, 0.25)
}

/** Passenger satisfaction points lost to a tired, unhappy crew: none at 50 and above, up to 0.4. */
export function welfarePssPenalty(s: GameState): number {
  const w = num(s.company.crewWelfare, 100)
  return clamp((50 - w) / 100, 0, 0.4)
}
