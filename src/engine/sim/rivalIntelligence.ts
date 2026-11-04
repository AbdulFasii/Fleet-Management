import type { CorridorRivalAction, CorridorStance, GameState } from '../types'
import { ROUTE_LIST, RIVALS, canonicalRouteId } from '../data/routes'
import { RIVAL_ALIASES } from '../data/rivals'
import { calculateRoutePlayerShare } from './rivals'
import { rngFor, rInt, rPick } from '../core/rng'

/** Check if player's trip is actively targeted by rival predatory timing (within 20 mins of rival counter-departure) */
export function isTripFrontRun(
  s: GameState,
  routeId: string,
  depHour: number,
  depMin: number,
): { frontRun: boolean; rivalName?: string; rivalClock?: string; action?: CorridorRivalAction } {
  const canon = canonicalRouteId(routeId)
  const action = s.world.rivalActions?.[routeId] ?? s.world.rivalActions?.[canon]
  if (!action || s.day > action.untilDay) {
    return { frontRun: false }
  }

  const tripMinutes = depHour * 60 + depMin

  for (const clockStr of action.targetDepartureClocks) {
    const [hStr, mStr] = clockStr.split(':')
    const rivalMinutes = Number(hStr) * 60 + Number(mStr)
    const diff = tripMinutes - rivalMinutes
    // Rival scheduled 5 to 25 minutes before player's coach
    if (diff >= 5 && diff <= 25) {
      return {
        frontRun: true,
        rivalName: action.rivalName,
        rivalClock: clockStr,
        action,
      }
    }
  }

  return { frontRun: false, action }
}

/** Get active player stance on a corridor */
export function getCorridorStance(s: GameState, routeId: string): CorridorStance {
  const canon = canonicalRouteId(routeId)
  return s.company.corridorStance?.[routeId] ?? s.company.corridorStance?.[canon] ?? 'neutral'
}

/** Set player's strategic corridor counter-stance */
export function setCorridorStance(s: GameState, routeId: string, stance: CorridorStance): void {
  if (!s.company.corridorStance) s.company.corridorStance = {}
  s.company.corridorStance[routeId] = stance
  const canon = canonicalRouteId(routeId)
  if (canon !== routeId) {
    s.company.corridorStance[canon] = stance
  }
}

/**
 * Batched weekly evaluation of rival intelligence and corridor distress.
 * Runs once every 7 days (or when s.day % 7 === 0) for negligible simulation overhead (< 0.15ms).
 * No notifications or alert popups are generated — details viewable in the Routes tab.
 */
export function weeklyRivalIntelligencePass(s: GameState): void {
  // Batched once every 7 days
  if (s.world.lastRivalIntelDay === undefined) {
    s.world.lastRivalIntelDay = s.day
    return
  }
  if (s.day - s.world.lastRivalIntelDay < 7) {
    return
  }
  s.world.lastRivalIntelDay = s.day

  if (!s.world.rivalActions) s.world.rivalActions = {}
  if (!s.world.priceWars) s.world.priceWars = {}

  // 1. Clean up expired rival counter-waves & reward premium hold
  for (const [routeId, action] of Object.entries(s.world.rivalActions)) {
    if (s.day >= action.untilDay) {
      delete s.world.rivalActions[routeId]
      const pw = s.world.priceWars[routeId]
      if (pw && pw.untilDay <= s.day) {
        delete s.world.priceWars[routeId]
      }
      continue
    }

    // If player holds premium brand pricing with high rating, rival burns cash faster
    const stance = getCorridorStance(s, routeId)
    if (stance === 'premium_hold') {
      const isHighQuality = (s.company.rating ?? 3.5) >= 4.2 || s.company.primo
      if (isHighQuality) {
        // Shorten the distress wave duration by 2 days each week
        action.untilDay = Math.max(s.day + 1, action.untilDay - 2)
      }
    }
  }

  // 2. Scan corridors for player dominance & rival retaliation triggers
  for (const r of ROUTE_LIST) {
    const canon = canonicalRouteId(r.id)
    if (s.world.rivalActions[r.id] || s.world.rivalActions[canon]) {
      continue // Already has an ongoing action
    }

    const permit = s.permits[r.id] ?? s.permits[canon] ?? Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
    if (permit?.status !== 'active') {
      continue
    }

    const { playerShare, dailySeats } = calculateRoutePlayerShare(s, r.id)
    if (dailySeats === 0) continue

    const activeSchs = Object.values(s.schedules).filter(
      (sc) => sc.active && (sc.routeId === r.id || canonicalRouteId(sc.routeId) === canon),
    )
    const depCount = activeSchs.reduce((acc, sc) => acc + (sc.paired ? 2 : 1), 0)

    // Trigger conditions: Player dominates lucrative corridor (>=35% share or >=4 daily departures)
    const isDominating = playerShare >= 35 || depCount >= 4 || (r.competition >= 0.70 && depCount >= 3)
    if (!isDominating) continue

    // Find rival who feels threatened on this corridor
    const rawRivalNames = RIVALS[r.id] ?? ['SRS Travels', 'KPN Travels', 'VRL Travels']
    const candidateRivals = rawRivalNames.filter(
      (name) => !name.includes('KSRTC') && !name.includes('TNSTC') && !name.includes('SETC'),
    )
    if (candidateRivals.length === 0) continue

    const rng = rngFor(s.seed, 'rival-intel', r.id, Math.floor(s.day / 7))
    const rivalName = rPick(rng, candidateRivals)
    const rivalId = RIVAL_ALIASES[rivalName] ?? rivalName.toLowerCase().replace(/[^a-z0-9]/g, '')

    // Extract player's flagship departure times
    const targetDepartureClocks: string[] = []
    for (const sc of activeSchs) {
      let h = sc.depHour
      let m = (sc.depMin ?? 0) - 15
      if (m < 0) {
        m += 60
        h = (h - 1 + 24) % 24
      }
      const clockStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      if (!targetDepartureClocks.includes(clockStr)) {
        targetDepartureClocks.push(clockStr)
      }
    }

    const duration = rInt(rng, 14, 28) // 2 to 4 weeks
    let tactic: 'predatory_timing' | 'price_war' | 'capacity_dump' = 'predatory_timing'
    let discountPct = 18
    let addedDailySeats = depCount * 40

    if (r.competition >= 0.80) {
      tactic = 'price_war'
      discountPct = 25
    } else if (depCount >= 6) {
      tactic = 'capacity_dump'
      discountPct = 20
      addedDailySeats = 160
    }

    const intensity = discountPct >= 25 ? 'aggressive' : 'moderate'
    const clocksSummary = targetDepartureClocks.slice(0, 3).join(', ')

    const action: CorridorRivalAction = {
      rivalId,
      rivalName,
      routeId: r.id,
      tactic,
      targetDepartureClocks,
      fareDiscountPct: discountPct,
      addedDailySeats,
      startDay: s.day,
      untilDay: s.day + duration,
      intensity,
      headline:
        tactic === 'predatory_timing'
          ? `${rivalName} Predatory Timing Wave`
          : tactic === 'price_war'
          ? `${rivalName} Retaliatory Price War (−${discountPct}%)`
          : `${rivalName} Capacity Flood (+${addedDailySeats} seats/day)`,
      details:
        tactic === 'predatory_timing'
          ? `${rivalName} launched counter-coaches scheduled 15 minutes before your flagship departures (${clocksSummary}) at −${discountPct}% fares to intercept advance & walk-up passengers.`
          : tactic === 'price_war'
          ? `${rivalName} triggered an aggressive corridor price war (−${discountPct}%), attempting to bleed your profit margins.`
          : `${rivalName} flooded the corridor with +${addedDailySeats} seats/day, attempting to dilute your occupancy on peak slots.`,
    }

    s.world.rivalActions[r.id] = action

    // Activate price war entry
    const live = s.world.priceWars[r.id]
    s.world.priceWars[r.id] = {
      untilDay: Math.max(s.day + duration, live && live.untilDay >= s.day ? live.untilDay : 0),
      depth: Math.max(discountPct / 100, live && live.untilDay >= s.day ? live.depth : 0),
    }
  }
}
