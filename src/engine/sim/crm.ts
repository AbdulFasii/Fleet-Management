/**
 * CRM, passenger grievances, compliments and dispute resolutions.
 */
import type { GameState, Grievance, ID, RouteDef, Trip, TripCrew, Bus } from '../types'
import { BAL } from '../data/balance'
import { nextId } from '../core/ids'
import { rs, toRupees, fmtCompact } from '../core/money'
import { rngFor, rInt, rChance, type Rng } from '../core/rng'
import { pushLog } from './log'
import { spend } from './finance'
import { crmOnDuty } from './staffing'
import { deskCapacity } from './span'

/**
 * Roll 0-3 feedback events on completed trips.
 * Compliments boost reputation & awareness directly.
 * Complaints enter the company grievances queue (max 40 open).
 */
export function recordTripGrievanceOrCompliment(
  s: GameState,
  trip: Trip,
  bus: Bus,
  route: RouteDef,
  tripPss: number,
  delay: number,
  cleanScore: number,
  acScore: number,
  driverScore: number,
  condScore: number,
  crew: TripCrew,
  rng: Rng,
): void {
  const numEvents = rInt(rng, 0, 3)
  if (numEvents === 0) return

  const causes: ('delay' | 'ac' | 'clean' | 'driver' | 'ladies' | 'other')[] = [
    'delay',
    'ac',
    'clean',
    'driver',
    'other',
  ]

  for (let i = 0; i < numEvents; i++) {
    const subRng = rngFor(s.seed, 'fb', trip.id, i)
    const cause = causes[rInt(subRng, 0, causes.length - 1)]

    // Determine if this event is a complaint or a compliment based on cause quality
    let isCompliment = false
    if (cause === 'delay') {
      isCompliment = delay <= 10
    } else if (cause === 'ac') {
      isCompliment = bus.condition.ac >= 80
    } else if (cause === 'clean') {
      isCompliment = (bus.busCleanliness ?? 85) >= 80
    } else if (cause === 'driver') {
      const hasAggressive = crew.drivers.some((d) => d.drivingStyle === 'aggressive')
      const hasCautious = crew.drivers.some((d) => d.drivingStyle === 'cautious')
      isCompliment = !hasAggressive && (hasCautious || tripPss >= 7.0)
    } else {
      isCompliment = tripPss >= 7.0
    }

    if (isCompliment) {
      s.company.reputation = Math.min(100, (s.company.reputation ?? 50) + 0.5)
      s.company.brandAwareness = Math.min(1, (s.company.brandAwareness ?? 0.05) + 0.002)
    } else {
      // Complaint
      if (!s.company.grievances) s.company.grievances = []
      const openGrievances = s.company.grievances.filter((g) => g.status === 'open')
      if (openGrievances.length < 40) {
        // Suggested refund ₹100-₹800 from fare
        const rawRs = rInt(subRng, 100, 800)
        const refundAmt = Math.min(trip.fare, rs(rawRs))
        const grv: Grievance = {
          id: nextId(s.ids, 'grv'),
          day: s.day,
          busId: bus.id,
          routeId: route.id,
          cause,
          status: 'open',
          amount: refundAmt,
        }
        s.company.grievances.push(grv)
        s.company.grievanceCount = openGrievances.length + 1
      }
    }
  }
}

export function crmPolicyLabel(policy?: string): string {
  if (policy === 'suggest_refund') return 'Suggest refund (Auto-refund)'
  if (policy === 'refund') return 'Refund small (≤ ₹500)'
  if (policy === 'dispute') return 'Dispute all'
  return 'Ask (Manual decision)'
}

/**
 * Player or manager manual/semi-manual resolution of an open grievance.
 */
export function resolveGrievance(s: GameState, grievanceId: ID, action: 'refund' | 'dispute'): string | null {
  if (!s.company.grievances) return 'No grievances.'
  const g = s.company.grievances.find((x) => x.id === grievanceId)
  if (!g) return 'Grievance not found.'
  if (g.status !== 'open') return 'Grievance is already resolved.'

  if (action === 'refund') {
    spend(s, 'refund', g.amount, { busId: g.busId, routeId: g.routeId, note: `passenger grievance refund (${g.cause})`, refundCategory: 'crm' })
    s.company.crmRefundTotal = (s.company.crmRefundTotal ?? 0) + g.amount
    s.company.crmRefundCount = (s.company.crmRefundCount ?? 0) + 1
    g.status = 'refunded'
    s.company.reputation = Math.min(100, (s.company.reputation ?? 50) + 0.2)
    s.company.grievanceCount = s.company.grievances.filter((x) => x.status === 'open').length
    pushLog(s, 'good', `Refunded ₹${toRupees(g.amount)} for passenger grievance (${g.cause}). Reputation +0.2.`)
    return null
  }

  // Dispute: 60% dismissed, 40% escalated with ₹2,000 penalty
  const rng = rngFor(s.seed, 'disp', g.id, s.day)
  const escalated = rChance(rng, 0.40)
  if (escalated) {
    g.status = 'escalated'
    spend(s, 'fine', rs(2_000), { busId: g.busId, routeId: g.routeId, note: `dispute escalation penalty (${g.cause})` })
    pushLog(s, 'alert', `Grievance (${g.cause}) escalated by consumer forum: ₹2,000 fine. Will auto-refund tomorrow.`)
  } else {
    g.status = 'dismissed'
    pushLog(s, 'info', `Disputed grievance (${g.cause}) dismissed without refund.`)
  }
  s.company.grievanceCount = s.company.grievances.filter((x) => x.status === 'open').length
  return null
}

/**
 * Daily CRM processing:
 * 1. Auto-refund escalated grievances older than 1 day.
 * 2. If CRM manager on duty, run policy auto-actions.
 * 3. Update grievanceCount.
 * 4. Check warning thresholds (10 open -> RedBus warning, 25 open -> RTO inspection).
 */
export function dailyCrmPass(s: GameState): void {
  if (!s.company.grievances) s.company.grievances = []

  // 1. Process escalated grievances (older than today)
  for (const g of s.company.grievances) {
    if (g.status === 'escalated' && s.day > g.day) {
      spend(s, 'refund', g.amount, { busId: g.busId, routeId: g.routeId, note: 'escalated grievance refund', refundCategory: 'crm' })
      s.company.crmRefundTotal = (s.company.crmRefundTotal ?? 0) + g.amount
      s.company.crmRefundCount = (s.company.crmRefundCount ?? 0) + 1
      g.status = 'refunded'
    }
  }

  // 2. CRM Manager policy execution
  const crm = crmOnDuty(s)
  if (crm) {
    const policy = s.company.crmPolicy ?? 'ask'
    if (policy !== 'ask') {
      const cap = Math.floor(deskCapacity(s, 'crm'))
      const openGrievances = s.company.grievances
        .filter((g) => g.status === 'open')
        .sort((a, b) => a.day - b.day)
      const toProcess = new Set(openGrievances.slice(0, cap).map((g) => g.id))

      if (policy === 'refund') {
        let count = 0
        let total = 0
        for (const g of s.company.grievances) {
          if (g.status === 'open' && toProcess.has(g.id) && g.amount <= rs(500)) {
            spend(s, 'refund', g.amount, { busId: g.busId, routeId: g.routeId, note: 'CRM auto-refund (≤ ₹500)', refundCategory: 'crm' })
            s.company.crmRefundTotal = (s.company.crmRefundTotal ?? 0) + g.amount
            s.company.crmRefundCount = (s.company.crmRefundCount ?? 0) + 1
            g.status = 'refunded'
            s.company.reputation = Math.min(100, (s.company.reputation ?? 50) + 0.2)
            count++
            total += g.amount
          }
        }
        if (count > 0) {
          pushLog(s, 'good', `CRM manager ${crm.name} auto-refunded ${count} small grievance(s) (total ${fmtCompact(total)}).`)
        }
      } else if (policy === 'suggest_refund') {
        let count = 0
        let total = 0
        for (const g of s.company.grievances) {
          if (g.status === 'open' && toProcess.has(g.id)) {
            spend(s, 'refund', g.amount, { busId: g.busId, routeId: g.routeId, note: `CRM auto-refund suggested (${g.cause})`, refundCategory: 'crm' })
            s.company.crmRefundTotal = (s.company.crmRefundTotal ?? 0) + g.amount
            s.company.crmRefundCount = (s.company.crmRefundCount ?? 0) + 1
            g.status = 'refunded'
            s.company.reputation = Math.min(100, (s.company.reputation ?? 50) + 0.2)
            count++
            total += g.amount
          }
        }
        if (count > 0) {
          pushLog(s, 'good', `CRM manager ${crm.name} auto-refunded ${count} grievance(s) for suggested amount (total ${fmtCompact(total)}).`)
        }
      } else if (policy === 'dispute') {
        let dismissed = 0
        let escalated = 0
        for (const g of s.company.grievances) {
          if (g.status === 'open' && toProcess.has(g.id)) {
            const rng = rngFor(s.seed, 'crm_disp', g.id, s.day)
            if (rChance(rng, 0.40)) {
              g.status = 'escalated'
              spend(s, 'fine', rs(2_000), { busId: g.busId, routeId: g.routeId, note: `dispute escalation penalty (${g.cause})` })
              escalated++
            } else {
              g.status = 'dismissed'
              dismissed++
            }
          }
        }
        if (dismissed + escalated > 0) {
          pushLog(s, 'info', `CRM manager ${crm.name} auto-disputed ${dismissed + escalated} grievance(s) (${dismissed} dismissed, ${escalated} escalated).`)
        }
      }
    }
  }

  // 3. Recount open
  s.company.grievanceCount = s.company.grievances.filter((g) => g.status === 'open').length

  // 4. Threshold warnings (cooldown 30 days)
  const warnedRecently = s.company.grievanceWarnedDay && (s.day - s.company.grievanceWarnedDay < 30)
  if (!warnedRecently) {
    if (s.company.grievanceCount >= 25) {
      s.company.grievanceWarnedDay = s.day
      s.decisions.push({
        id: nextId(s.ids, 'dec'),
        day: s.day,
        kind: 'rto_inspection',
        title: `RTO Quality Inspection: ${s.company.grievanceCount} Open Complaints`,
        body: `RTO consumer cell received ${s.company.grievanceCount} unresolved passenger grievances. A ₹12,000 challan has been issued and one dirty coach must be grounded for inspection.`,
        options: [
          {
            id: 'pay_challan',
            label: 'Pay ₹12,000 fine & accept inspection',
            cost: BAL.challanFine,
            effectHint: 'Grounds dirtiest active bus for 2 days; satisfies RTO.',
          },
        ],
      })
      pushLog(s, 'alert', `CRITICAL: RTO Quality Crackdown triggered by ${s.company.grievanceCount} unresolved complaints!`)
    } else if (s.company.grievanceCount >= 10) {
      s.company.grievanceWarnedDay = s.day
      s.decisions.push({
        id: nextId(s.ids, 'dec'),
        day: s.day,
        kind: 'redbus_warning',
        title: `RedBus Quality Warning: ${s.company.grievanceCount} Open Complaints`,
        body: `RedBus operator desk flagged high complaint volumes (${s.company.grievanceCount} unresolved). Unchecked complaints lead to Primo delisting and lower search ranks.`,
        options: [
          {
            id: 'ack',
            label: 'Acknowledge warning',
            effectHint: 'Review and resolve open passenger grievances on Dashboard.',
          },
        ],
      })
      pushLog(s, 'alert', `WARNING: RedBus flagged ${s.company.grievanceCount} open passenger complaints. Review on Dashboard.`)
    }
  }
}
