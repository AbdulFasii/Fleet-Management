import type { CorridorRivalAction, CorridorStance, GameState, RivalMemory } from '../types'
import { ROUTE_LIST, RIVALS, canonicalRouteId } from '../data/routes'
import { RIVAL_ALIASES, RIVALS_DATA } from '../data/rivals'
import { calculateRoutePlayerShare } from './rivals'
import { rngFor } from '../core/rng'


/* ============================ rival personalities ============================ */

export type RivalStyle = 'price' | 'timing' | 'capacity'

export interface RivalPersonality {
  id: string
  name: string
  /** 0-1. Cheap, low-comfort operators fight hardest; premium ones are calmer. */
  aggression: number
  /** The tactic this rival reaches for first. */
  style: RivalStyle
  /** Weeks it waits between attacks. */
  cooldownWeeks: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function rivalIdOf(name: string): string {
  return RIVAL_ALIASES[name] ?? name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function rivalMemory(s: GameState, rivalId: string): RivalMemory {
  if (!s.world.rivalMemory) s.world.rivalMemory = {}
  return (s.world.rivalMemory[rivalId] ??= { grudge: 0, actions: 0, defeats: 0, victories: 0, lastActionDay: -999 })
}

/** A rival's character, fixed by its market profile and a little seeded variation, then shifted by what it has learned. */
export function personalityOf(s: GameState, rivalName: string): RivalPersonality {
  const id = rivalIdOf(rivalName)
  const data = RIVALS_DATA[id]
  const jitter = (rngFor(s.seed, 'rival-personality', id)() - 0.5) * 0.2
  const fare = data?.fareIndex ?? 1
  const comfort = data?.comfort ?? 6
  const punctuality = data?.punctuality ?? 0.85
  const memory = s.world.rivalMemory?.[id]
  const learned = memory ? memory.victories * 0.06 - memory.defeats * 0.05 : 0
  const aggression = clamp01(0.55 + (1 - fare) * 1.6 + (0.85 - punctuality) * 0.5 + jitter + Math.max(-0.2, Math.min(0.2, learned)))
  const style: RivalStyle = fare < 0.97 ? 'price' : comfort >= 7.5 ? 'timing' : 'capacity'
  return { id, name: data?.name ?? rivalName, aggression, style, cooldownWeeks: Math.max(1, Math.round(6 - aggression * 5)) }
}

/** Chance per week that a rival that feels threatened actually strikes. */
export function attackChance(p: RivalPersonality, m: RivalMemory): number {
  return Math.max(0.5, Math.min(1, 0.45 + p.aggression * 0.45 + m.grudge * 0.4))
}

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
  // Grudges fade a little every week
  for (const mem of Object.values(s.world.rivalMemory ?? {})) mem.grudge = Math.max(0, mem.grudge - 0.02)

  // 1. Clean up expired rival counter-waves & reward premium hold
  for (const [routeId, action] of Object.entries(s.world.rivalActions)) {
    if (s.day >= action.untilDay) {
        // Judge the attack: did you keep your ground?
        const mem = rivalMemory(s, action.rivalId)
        const { playerShare } = calculateRoutePlayerShare(s, routeId)
        if (playerShare >= 35) mem.defeats += 1
        else if (playerShare < 25) mem.victories += 1
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

    // Every rival on the corridor sees a dominant player and holds it against them.
    const profiles = candidateRivals.map((name) => personalityOf(s, name))
    for (const p of profiles) {
      const mem = rivalMemory(s, p.id)
      mem.grudge = Math.min(1, mem.grudge + 0.05)
    }
    // The angriest rival that is not still cooling off steps up.
    const ready = profiles
      .filter((p) => s.day - rivalMemory(s, p.id).lastActionDay >= p.cooldownWeeks * 7)
      .sort((a, b) => b.aggression + rivalMemory(s, b.id).grudge - (a.aggression + rivalMemory(s, a.id).grudge))
    const chosen = ready[0]
    if (!chosen) continue
    const mem = rivalMemory(s, chosen.id)
    if (rng() > attackChance(chosen, mem)) continue // it is watching, not striking yet

    const rivalName = chosen.name
    const rivalId = chosen.id

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

    // The rival's character sets the weapon, its force and how long it lasts.
    const tactic: 'predatory_timing' | 'price_war' | 'capacity_dump' =
      chosen.style === 'price' ? 'price_war' : chosen.style === 'timing' ? 'predatory_timing' : 'capacity_dump'
    const duration = Math.round(14 + chosen.aggression * 14 + mem.grudge * 4) // 2 to 4 weeks
    const discountPct = Math.round(12 + chosen.aggression * 16 + (tactic === 'price_war' ? 4 : 0))
    const addedDailySeats = tactic === 'capacity_dump' ? Math.round(100 + chosen.aggression * 100) : depCount * 40

    const intensity = discountPct >= 25 ? 'aggressive' : 'moderate'
    mem.actions += 1
    mem.lastActionDay = s.day
    mem.grudge = Math.max(0, mem.grudge - 0.25) // it vented
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
