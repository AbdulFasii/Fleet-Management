import { ROUTES, ROUTE_LIST, RIVALS, canonicalRouteId } from '../data/routes'
import { RIVALS_DATA, seedRouteShare } from '../data/rivals'
import { BUS_MODELS } from '../data/busModels'
import { AVG_PRIVATE_SEATS, corridorSupply } from '../data/corridorSupply'
import type { GameState } from '../types'
import type { Rng } from '../core/rng'
import { marketFare } from './pricing'

/**
 * Calculate player's live market share on a route based on assigned bus seat capacity.
 * If player has no active permit or no assigned buses on active schedules: returns 0%.
 */
export function calculateRoutePlayerShare(
  s: GameState,
  routeId: string,
): { playerShare: number; dailySeats: number } {
  const canon = canonicalRouteId(routeId)
  const permit = s.permits[routeId] ?? s.permits[canon] ?? Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
  if (!permit || permit.status !== 'active') {
    return { playerShare: 0, dailySeats: 0 }
  }

  const route = ROUTES[routeId] ?? ROUTES[canon]
  if (!route) return { playerShare: 0, dailySeats: 0 }

  const activeSchs = Object.values(s.schedules).filter((sc) => sc.active && (sc.routeId === routeId || canonicalRouteId(sc.routeId) === canon))
  let dailySeats = 0
  for (const sch of activeSchs) {
    if (!sch.busIds || sch.busIds.length === 0) continue
    const tripsPerDay = sch.paired ? 2 : 1
    for (const busId of sch.busIds) {
      const bus = s.buses[busId]
      if (bus && bus.status !== 'delivery') {
        const model = BUS_MODELS[bus.modelId]
        const seats = model?.seats ?? 40
        dailySeats += seats * tripsPerDay
      }
    }
  }

  if (dailySeats === 0) {
    return { playerShare: 0, dailySeats: 0 }
  }

  // Rival private seats per day across both directions, from the corridor's
  // real departure count (our dailySeats also counts both directions).
  const competitorSeats = corridorSupply(route.id).departures * AVG_PRIVATE_SEATS * 2
  // One decimal: on a 350-departure corridor a few coaches are well under 1%.
  const playerShare = Math.max(0.1, Math.min(85, Math.round((dailySeats / Math.max(1, competitorSeats + dailySeats)) * 1000) / 10))

  return { playerShare, dailySeats }
}

export function normalizeRivalShares(
  share: { player: number; byRival: Record<string, number> },
  playerShare: number,
): void {
  share.player = playerShare
  const remaining = 100 - playerShare
  const rivalEntries = Object.entries(share.byRival)
  if (rivalEntries.length === 0) return

  const sumRivals = rivalEntries.reduce((sum, [, val]) => sum + val, 0)
  let allocated = 0
  for (let i = 0; i < rivalEntries.length; i++) {
    const [rid, sVal] = rivalEntries[i]!
    if (i === rivalEntries.length - 1) {
      share.byRival[rid] = Math.max(1, remaining - allocated)
    } else {
      const sharePortion = sumRivals > 0
        ? Math.round((sVal / sumRivals) * remaining)
        : Math.floor(remaining / rivalEntries.length)
      const clamped = Math.max(1, sharePortion)
      share.byRival[rid] = clamped
      allocated += clamped
    }
  }
}

export function syncRouteShare(s: GameState, routeId: string): void {
  if (!s.world.share) s.world.share = {}
  let curShare = s.world.share[routeId]
  if (!curShare) {
    const route = ROUTES[routeId]
    if (!route) return
    curShare = seedRouteShare(routeId, route.competition, RIVALS[routeId], 0)
    s.world.share[routeId] = curShare
  }

  const canon = canonicalRouteId(routeId)
  const permit = s.permits[routeId] ?? s.permits[canon] ?? Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
  if (!permit || permit.status !== 'active') {
    curShare.player = 0
    normalizeRivalShares(curShare, 0)
    return
  }

  const { playerShare, dailySeats } = calculateRoutePlayerShare(s, routeId)
  if (dailySeats === 0) {
    if (curShare.player > 0) {
      normalizeRivalShares(curShare, curShare.player)
      return
    }
    curShare.player = 0
    normalizeRivalShares(curShare, 0)
    return
  }

  const finalShare = Math.max(playerShare, curShare.player)
  curShare.player = finalShare
  normalizeRivalShares(curShare, finalShare)
}

/**
 * Daily market share drift per route where player holds an active permit.
 * Compares player fare, comfort, punctuality, and awareness against each rival.
 * Moves 0.2 to 0.8 percentage points. KSRTC moves at 0.4x. Renormalizes to 100%.
 */
export function dailyRivalPass(s: GameState, _rng: Rng): void {
  const w = s.world
  if (!w.rivals) w.rivals = { ...RIVALS_DATA }
  if (!w.share) w.share = {}
  if (!w.shareHistory) w.shareHistory = {}

  for (const r of ROUTE_LIST) {
    const canon = canonicalRouteId(r.id)
    const permit = s.permits[r.id] ?? s.permits[canon] ?? Object.values(s.permits).find((p) => canonicalRouteId(p.routeId) === canon)
    const curShare = w.share[r.id]
    if (!curShare) continue

    if (permit?.status !== 'active') {
      if (curShare.player !== 0) {
        curShare.player = 0
        normalizeRivalShares(curShare, 0)
      }
      continue
    }

    const { playerShare: capShare, dailySeats } = calculateRoutePlayerShare(s, r.id)
    if (dailySeats === 0 && curShare.player === 0) {
      continue
    }

    // Baseline player share tracks assigned seat capacity
    if (dailySeats > 0 && Math.abs(curShare.player - capShare) > 10) {
      curShare.player = Math.round(0.6 * capShare + 0.4 * curShare.player)
    }

    // 1. Compute player corridor competitiveness
    const activeSchs = Object.values(s.schedules).filter((sc) => sc.active && sc.routeId === r.id)
    const baseFareAC = marketFare(s, r, 'cheetah', s.day)
    const avgFare = activeSchs.length > 0
      ? activeSchs.reduce((sum, sc) => sum + sc.baseFare, 0) / activeSchs.length
      : baseFareAC
    const playerFareIndex = Math.max(0.7, Math.min(1.4, avgFare / Math.max(1, baseFareAC)))

    const busIds = activeSchs.flatMap((sc) => sc.busIds)
    const avgBusScore = busIds.length > 0
      ? busIds.reduce((sum, bid) => sum + (s.buses[bid]?.qualityScore ?? 3.5), 0) / busIds.length
      : 3.5
    const playerComfort = avgBusScore * 2 // 1-5 scale -> 2-10 scale
    const playerPunctuality = s.company.punctuality ?? 0.85
    const playerAwareness = Math.min(1, (s.company.brandAwareness ?? 0.05) * 1.5)

    const playerScore =
      (playerComfort * 0.30) +
      (playerPunctuality * 10 * 0.25) +
      ((1.30 - playerFareIndex) * 10 * 0.25) +
      (playerAwareness * 10 * 0.20)

    // 2. Drift against each rival on the corridor
    let pShare = curShare.player
    const rivalsMap = { ...curShare.byRival }

    for (const [rivalId, rShare] of Object.entries(rivalsMap)) {
      const rival = w.rivals[rivalId] ?? RIVALS_DATA[rivalId]
      if (!rival) continue

      const rivalScore =
        (rival.comfort * 0.30) +
        (rival.punctuality * 10 * 0.25) +
        ((1.30 - rival.fareIndex) * 10 * 0.25) +
        (rival.awareness * 10 * 0.20)

      const diff = playerScore - rivalScore
      const ksrtcMult = rivalId === 'ksrtc' ? 0.4 : 1.0
      const drift = (0.2 + 0.6 * Math.min(1, Math.abs(diff) / 4.0)) * ksrtcMult

      if (diff > 0) {
        // Player wins share
        const delta = Math.min(drift, Math.max(0, rShare - 1))
        pShare += delta
        rivalsMap[rivalId] = Math.max(1, rShare - delta)
      } else if (diff < 0) {
        // Rival wins share
        const delta = Math.min(drift, Math.max(0, pShare - 1))
        pShare = Math.max(1, pShare - delta)
        rivalsMap[rivalId] = rShare + delta
      }
    }

    // Renormalize to sum to 100
    const total = pShare + Object.values(rivalsMap).reduce((a, b) => a + b, 0)
    curShare.player = Math.max(1, Math.round((pShare / total) * 100))
    let remaining = 100 - curShare.player
    const rivalEntries = Object.entries(rivalsMap)
    const sumRivals = Object.values(rivalsMap).reduce((a, b) => a + b, 0)

    for (let i = 0; i < rivalEntries.length; i++) {
      const [rid, sVal] = rivalEntries[i]!
      if (i === rivalEntries.length - 1) {
        curShare.byRival[rid] = Math.max(1, remaining)
      } else {
        const alloc = Math.max(1, Math.round((sVal / sumRivals) * (100 - curShare.player)))
        curShare.byRival[rid] = alloc
        remaining -= alloc
      }
    }

    // Record player share history (capped at 180 entries)
    if (!w.shareHistory[r.id]) w.shareHistory[r.id] = []
    w.shareHistory[r.id].push({ day: s.day, player: curShare.player })
    if (w.shareHistory[r.id].length > 180) {
      w.shareHistory[r.id].shift()
    }
  }
}
