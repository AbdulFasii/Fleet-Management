/**
 * Primo qualification, achievements and milestone tracking.
 */
import { BAL } from '../data/balance'
import { Cr, fmtCompact, rs } from '../core/money'
import { isCargoModel } from '../data/busModels'
import type { GameState } from '../types'
import { pushLog, pushDecision } from './log'
import { netWorth } from './finance'

function hasPendingPrimoInvite(s: GameState, groupId?: string): boolean {
  return (s.decisions ?? []).some(
    (d) => d.kind === 'primo' && (groupId ? d.groupId === groupId : !d.groupId),
  )
}

function primoInviteReady(s: GameState, nextEligibleDay: number | undefined, alreadyOffered: boolean): boolean {
  if (alreadyOffered) return false
  if (nextEligibleDay !== undefined && s.day < nextEligibleDay) return false
  return true
}

export function checkPrimo(s: GameState): void {
  // 1. Check brands independently
  for (const g of Object.values(s.groups ?? {})) {
    if (g.status === 'retired') continue
    if (g.cargoBrand) continue

    if (g.primo) {
      if (g.primoSinceDay === undefined) g.primoSinceDay = s.day
    } else {
      g.primoSinceDay = undefined
    }

    const brandBuses = Object.values(s.buses).filter((b) => b.groupId === g.id)
    const brandTrips = brandBuses.reduce((a, b) => a + b.lifeTrips, 0)
    const poorCleanliness = brandBuses.some(
      (b) => b.status === 'active' && (b.busCleanliness ?? 100) < 50,
    )

    if (g.primo && (g.rating < BAL.primoDelistRating || g.cancelRate > 0.08 || poorCleanliness)) {
      g.primo = false
      g.primoOffered = false
      g.primoSinceDay = undefined
      g.primoNextEligibleDay = s.day + BAL.primoReinviteCooldownDays
      pushLog(
        s,
        'alert',
        `RedBus has DELISTED ${g.name} from Primo: ${poorCleanliness ? 'Fleet cleanliness fell below Primo standards. Perform deep cleaning.' : 'Service standards not met.'} Re-invite after ${BAL.primoReinviteCooldownDays} days.`,
      )
    }

    if (
      !g.primo
      && primoInviteReady(s, g.primoNextEligibleDay, g.primoOffered)
      && !hasPendingPrimoInvite(s, g.id)
    ) {
      const effectiveRating = g.ratingCount >= BAL.groupRatingMinReviews ? g.rating : s.company.rating
      if (
        effectiveRating >= BAL.primoRatingReq &&
        s.company.punctuality >= BAL.primoPunctualityReq &&
        brandTrips >= BAL.primoMinTrips &&
        g.cancelRate < 0.05
      ) {
        g.primoOffered = true
        pushDecision(s, {
          kind: 'primo',
          groupId: g.id,
          title: `${g.name}: RedBus Primo invitation`,
          body: `RedBus wants to badge ${g.name} PRIMO: priority ranking and a trust badge (+28% visibility) in exchange for +1% commission and strict service standards. Cancellations or rating drops below ${BAL.primoDelistRating.toFixed(1)} will get you delisted from the program.`,
          options: [
            { id: 'accept', label: `Join Primo (${g.name})` },
            { id: 'decline', label: 'Stay independent' },
          ],
        })
      }
    }
  }

  // 2. Company-level c.primo check (for unassigned coaches & backward compatibility)
  const c = s.company
  if (c.primo) {
    if (c.primoSinceDay === undefined) c.primoSinceDay = s.day
  } else {
    c.primoSinceDay = undefined
  }

  const unassignedBuses = Object.values(s.buses).filter((b) => !b.groupId)
  const poorCleanliness = unassignedBuses.some(
    (b) => b.status === 'active' && (b.busCleanliness ?? 100) < 50,
  )
  if (c.primo && (c.rating < BAL.primoDelistRating || c.cancelRate > 0.08 || poorCleanliness)) {
    c.primo = false
    c.primoOffered = false
    c.primoSinceDay = undefined
    c.primoNextEligibleDay = s.day + BAL.primoReinviteCooldownDays
    pushLog(
      s,
      'alert',
      `RedBus has DELISTED you from Primo: ${poorCleanliness ? 'Fleet cleanliness fell below Primo standards. Perform deep cleaning.' : 'Service standards not met.'} Re-invite after ${BAL.primoReinviteCooldownDays} days.`,
    )
  }

  if (
    !c.primo
    && primoInviteReady(s, c.primoNextEligibleDay, c.primoOffered)
    && !hasPendingPrimoInvite(s)
    && (!s.groups || Object.keys(s.groups).length === 0)
  ) {
    const totalTrips = Object.values(s.buses).reduce((a, b) => a + b.lifeTrips, 0)
    if (
      c.rating >= BAL.primoRatingReq &&
      c.punctuality >= BAL.primoPunctualityReq &&
      totalTrips >= BAL.primoMinTrips &&
      c.cancelRate < 0.05
    ) {
      c.primoOffered = true
      pushDecision(s, {
        kind: 'primo',
        title: 'RedBus Primo invitation',
        body: `RedBus wants to badge you PRIMO: priority ranking and a trust badge (+28% visibility) in exchange for +1% commission and strict service standards. Cancellations or rating drops below ${BAL.primoDelistRating.toFixed(1)} will get you delisted from the program.`,
        options: [
          { id: 'accept', label: 'Join Primo' },
          { id: 'decline', label: 'Stay independent' },
        ],
      })
    }
  }
}

/** Check operator quality badges and OTA certifications (Primo, Women-Friendly, Clean-Certified). */
export function checkCertifications(s: GameState): void {
  const c = s.company
  if (!c.certifications) c.certifications = {}

  // 1. Sync Primo badge
  c.certifications.primo = Boolean(c.primo)

  // 2. Women-Friendly & Safe Coach Certification
  const activePassengerBuses = Object.values(s.buses).filter((b) => b.status === 'active' && !isCargoModel(b.modelId))
  const cctvCount = activePassengerBuses.filter((b) => b.cctvFitted).length
  const cctvShare = activePassengerBuses.length > 0 ? cctvCount / activePassengerBuses.length : 0
  const qualifiesWomenFriendly = c.rating >= 4.0 && (c.cmvrOffenceCount ?? 0) === 0 && (activePassengerBuses.length > 0 && cctvShare >= 0.5)

  if (qualifiesWomenFriendly && !c.certifications.womenFriendly) {
    c.certifications.womenFriendly = true
    pushLog(s, 'good', 'SAFETY BADGE AWARDED: RedBus certified your fleet as "Women-Friendly & Safe Coach" (+12% female passenger booking appeal)!')
  } else if (!qualifiesWomenFriendly && c.certifications.womenFriendly) {
    c.certifications.womenFriendly = false
    pushLog(s, 'alert', 'SAFETY BADGE REVOKED: "Women-Friendly" badge lost due to rating drop, CMVR violation, or lack of CCTV coverage.')
  }

  // 3. Clean Coach Certified
  const cleanSum = activePassengerBuses.reduce((acc, b) => acc + (b.busCleanliness ?? 85), 0)
  const avgClean = activePassengerBuses.length > 0 ? cleanSum / activePassengerBuses.length : 85
  const qualifiesClean = c.rating >= 4.2 && avgClean >= 75

  if (qualifiesClean && !c.certifications.cleanCertified) {
    c.certifications.cleanCertified = true
    pushLog(s, 'good', 'HYGIENE BADGE AWARDED: Fleet certified as "Clean Coach Certified" on OTAs (+8% organic demand boost)!')
  } else if (!qualifiesClean && c.certifications.cleanCertified) {
    c.certifications.cleanCertified = false
    pushLog(s, 'alert', 'HYGIENE BADGE REVOKED: "Clean Coach Certified" badge lost due to fleet cleanliness falling below 75 pts.')
  }
}

export interface AchievementDef {
  id: string
  label: string
  test: (s: GameState) => boolean
  progress?: (s: GameState) => { current: number; target: number; fmt?: (v: number) => string }
}

const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_bus',
    label: 'First bus in the fleet',
    test: (s) => Object.keys(s.buses).length >= 1,
    progress: (s) => ({ current: Math.min(1, Object.keys(s.buses).length), target: 1 }),
  },
  {
    id: 'first_profit_month',
    label: 'First profitable month',
    test: (s) => s.monthly.some((m) => m.profit > 0 && m.revenueTotal > 0),
    progress: (s) => ({ current: s.monthly.some((m) => m.profit > 0 && m.revenueTotal > 0) ? 1 : 0, target: 1 }),
  },
  {
    id: 'fleet10',
    label: '10-bus operator',
    test: (s) => Object.keys(s.buses).length >= 10,
    progress: (s) => ({ current: Math.min(10, Object.keys(s.buses).length), target: 10, fmt: (v) => `${v} buses` }),
  },
  {
    id: 'rating45',
    label: '4.5★ operator',
    test: (s) => s.company.rating >= 4.5 && s.company.ratingCount > 500,
    progress: (s) => ({ current: Math.min(500, s.company.ratingCount), target: 500, fmt: (v) => `${v} reviews` }),
  },
  {
    id: 'primo',
    label: 'RedBus Primo',
    test: (s) => s.company.primo,
    progress: (s) => ({ current: s.company.primo ? 1 : 0, target: 1 }),
  },
  {
    id: 'app_launched',
    label: 'Own app live',
    test: (s) => s.company.app.tier >= 1,
    progress: (s) => ({ current: s.company.app.tier, target: 1 }),
  },
  {
    id: 'crorepati',
    label: 'Crorepati (net cash ₹1 Cr+)',
    test: (s) => s.company.cash >= Cr(1),
    progress: (s) => ({ current: Math.max(0, Math.min(Cr(1), s.company.cash)), target: Cr(1), fmt: (v) => fmtCompact(v) }),
  },
  {
    id: 'survivor',
    label: 'Survived 1 year',
    test: (s) => s.day - s.startDay >= 365,
    progress: (s) => ({ current: Math.min(365, s.day - s.startDay), target: 365, fmt: (v) => `${v}d` }),
  },
  {
    id: 'fleet25',
    label: 'Fleet Titan (25 buses owned)',
    test: (s) => Object.values(s.buses).filter((b) => b.ownership === 'owned').length >= 25,
    progress: (s) => {
      const n = Object.values(s.buses).filter((b) => b.ownership === 'owned').length
      return { current: Math.min(25, n), target: 25, fmt: (v) => `${v} buses` }
    },
  },
  {
    id: 'all_corridors',
    label: 'Network Master (10 active permits)',
    test: (s) => Object.values(s.permits).filter((p) => p.status === 'active').length >= 10,
    progress: (s) => {
      const n = Object.values(s.permits).filter((p) => p.status === 'active').length
      return { current: Math.min(10, n), target: 10, fmt: (v) => `${v} permits` }
    },
  },
  {
    id: 'primo_6months',
    label: 'Primo Legend (180 days Primo)',
    test: (s) => !!(s.company.primo && s.company.primoSinceDay !== undefined && s.day - s.company.primoSinceDay >= 180),
    progress: (s) => {
      const d = s.company.primo && s.company.primoSinceDay !== undefined ? s.day - s.company.primoSinceDay : 0
      return { current: Math.min(180, d), target: 180, fmt: (v) => `${v}d` }
    },
  },
  {
    id: 'cargo_king',
    label: 'Cargo King (₹10L cargo revenue)',
    test: (s) => (s.company.cargoLifeRevenue ?? 0) >= rs(1_000_000),
    progress: (s) => ({
      current: Math.min(rs(1_000_000), s.company.cargoLifeRevenue ?? 0),
      target: rs(1_000_000),
      fmt: (v) => fmtCompact(v),
    }),
  },
  {
    id: 'zero_accidents_100',
    label: 'Zero-Accident Streak (100 trips)',
    test: (s) => (s.company.safeTripStreak ?? 0) >= 100,
    progress: (s) => ({
      current: Math.min(100, s.company.safeTripStreak ?? 0),
      target: 100,
      fmt: (v) => `${v} trips`,
    }),
  },
  {
    id: 'five_star',
    label: '5-Star Operator (7d streak)',
    test: (s) => s.company.rating >= 5 && s.company.fiveStarSinceDay !== undefined && s.day - s.company.fiveStarSinceDay >= 7,
    progress: (s) => {
      const d = s.company.rating >= 5 && s.company.fiveStarSinceDay !== undefined
        ? s.day - s.company.fiveStarSinceDay
        : 0
      return { current: Math.min(7, d), target: 7, fmt: (v) => `${v}d` }
    },
  },
  {
    id: 'crore_profit',
    label: 'Crorepati Profit (₹1 Cr net profit)',
    test: (s) => (s.lifetimeProfit ?? 0) >= Cr(1),
    progress: (s) => ({
      current: Math.max(0, Math.min(Cr(1), s.lifetimeProfit ?? 0)),
      target: Cr(1),
      fmt: (v) => fmtCompact(v),
    }),
  },
  {
    id: '10years',
    label: 'Decade Veteran (10 years)',
    test: (s) => s.day - s.startDay >= 3650,
    progress: (s) => ({ current: Math.min(3650, s.day - s.startDay), target: 3650, fmt: (v) => `${v}d` }),
  },
  {
    id: 'rebel_operator',
    label: 'Rebel Operator (Attached only)',
    test: (s) => Object.values(s.schedules).some((sch) => {
      if (!sch.active || sch.busIds.length === 0) return false
      const buses = sch.busIds.map((id) => s.buses[id]).filter(Boolean)
      if (buses.length !== sch.busIds.length || !buses.every((b) => b!.ownership === 'attached')) return false
      const hasConductor = buses.every((b) => Object.values(s.staff).some((st) => st.busId === b!.id && st.role === 'conductor'))
      const noDriver = buses.every((b) => !Object.values(s.staff).some((st) => st.busId === b!.id && st.role === 'driver'))
      return hasConductor && noDriver
    }),
    progress: (s) => ({
      current: Object.values(s.schedules).some((sch) => {
        if (!sch.active || sch.busIds.length === 0) return false
        const buses = sch.busIds.map((id) => s.buses[id]).filter(Boolean)
        if (buses.length !== sch.busIds.length || !buses.every((b) => b!.ownership === 'attached')) return false
        const hasConductor = buses.every((b) => Object.values(s.staff).some((st) => st.busId === b!.id && st.role === 'conductor'))
        const noDriver = buses.every((b) => !Object.values(s.staff).some((st) => st.busId === b!.id && st.role === 'driver'))
        return hasConductor && noDriver
      }) ? 1 : 0,
      target: 1,
    }),
  },
  {
    id: 'green_fleet',
    label: 'Green Fleet (50%+ Electric)',
    test: (s) => {
      const owned = Object.values(s.buses).filter((b) => b.ownership === 'owned')
      if (owned.length < 2) return false
      return owned.filter((b) => b.modelId === 'evolectra').length >= owned.length / 2
    },
    progress: (s) => {
      const owned = Object.values(s.buses).filter((b) => b.ownership === 'owned')
      return {
        current: owned.filter((b) => b.modelId === 'evolectra').length,
        target: Math.max(1, Math.ceil(owned.length / 2)),
        fmt: (v) => `${v} EVs`,
      }
    },
  },
  {
    id: 'debt_free',
    label: 'Debt-Free Sovereign (No Debt, ₹25L+ NW)',
    test: (s) =>
      Object.values(s.loans).reduce((a, l) => a + l.balance, 0) === 0
      && s.od.drawn === 0
      && netWorth(s) > rs(2_500_000),
    progress: (s) => ({
      current:
        Object.values(s.loans).reduce((a, l) => a + l.balance, 0) + s.od.drawn === 0
        && netWorth(s) > rs(2_500_000)
          ? 1
          : 0,
      target: 1,
    }),
  },
  {
    id: 'own_app_dominant',
    label: 'Direct Digital Power (60%+ App)',
    test: (s) => {
      const m = s.monthly[s.monthly.length - 1]
      if (!m || m.ticketSales <= 0) return false
      return (m.channelRevenue?.ownapp ?? 0) / m.ticketSales > 0.6
    },
    progress: (s) => {
      const m = s.monthly[s.monthly.length - 1]
      const share = m && m.ticketSales > 0 ? (m.channelRevenue?.ownapp ?? 0) / m.ticketSales : 0
      return { current: Math.round(share * 100), target: 60, fmt: (v) => `${v}%` }
    },
  },
]

export function checkAchievements(s: GameState): void {
  if (s.company.rating >= 5) {
    if (s.company.fiveStarSinceDay === undefined) s.company.fiveStarSinceDay = s.day
  } else {
    s.company.fiveStarSinceDay = undefined
  }
  if (s.company.primo) {
    if (s.company.primoSinceDay === undefined) s.company.primoSinceDay = s.day
  } else {
    s.company.primoSinceDay = undefined
  }
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] === undefined && a.test(s)) {
      s.achievements[a.id] = s.day
      pushLog(s, 'good', `ACHIEVEMENT: ${a.label}`)
    }
  }
}

export const ACHIEVEMENT_DEFS = ACHIEVEMENTS
