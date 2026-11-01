import { BAL } from '../data/balance'
import type { DeskPost, GameState, SpanMeter } from '../types'
import { cargoLanesForPermits, cargoPermitActive } from './cargo'
import { deskHead } from './staffing'
import { pushLog } from './log'

export type SpanDesk = DeskPost

export const ALL_SPAN_DESKS: SpanDesk[] = [
  'hr',
  'ops',
  'workshop',
  'cargo',
  'schedule',
  'documents',
  'crm',
  'accountant',
]

export const DESK_UNIT: Record<SpanDesk, string> = {
  ops: 'Coaches',
  hr: 'Staff',
  workshop: 'Bays',
  cargo: 'Lanes',
  schedule: 'Services',
  documents: 'Files',
  crm: 'Grievances',
  accountant: 'Ledger rows',
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Compute demand for a desk in its native unit. */
export function spanDemand(s: GameState, desk: SpanDesk): number {
  switch (desk) {
    case 'ops': {
      // active owned + leased coaches (exclude attached)
      return Object.values(s.buses ?? {}).filter(
        (b) => (b.ownership === 'owned' || b.ownership === 'leased') && b.status === 'active',
      ).length
    }
    case 'hr': {
      // non-manager staff
      return Object.values(s.staff ?? {}).filter((st) => st.role !== 'manager').length
    }
    case 'workshop': {
      // built bays
      return s.workshop?.bays ?? 0
    }
    case 'cargo': {
      // licensed cargo lanes (AB and BA counted separately)
      return cargoLanesForPermits(s).filter((lane) => cargoPermitActive(s, lane.route.id)).length
    }
    case 'schedule': {
      // active schedules
      return Object.values(s.schedules ?? {}).filter((sch) => sch.active).length
    }
    case 'documents': {
      // active coaches + active route permits
      const coaches = Object.values(s.buses ?? {}).filter(
        (b) => b.ownership !== 'attached' && (b.status as string) !== 'sold' && b.status !== 'delivery',
      ).length
      const permits = Object.values(s.permits ?? {}).filter(
        (p) => !p.status || p.status === 'active',
      ).length
      return coaches + permits
    }
    case 'crm': {
      // open grievances
      return (s.company?.grievances ?? []).filter((g) => g.status === 'open').length
    }
    case 'accountant': {
      // ledger rows in the trailing 30 days from s.txns
      const cut = s.day - 30
      let count = 0
      for (const t of s.txns ?? []) {
        if (t.day >= cut) count++
      }
      return count
    }
  }
}

function skillMult(skill: number): number {
  const delta = skill - 5
  return clamp(
    1 + delta * BAL.span.skillPerPoint,
    BAL.span.skillMin,
    BAL.span.skillMax,
  )
}

/** Total capacity of a desk: head capacity + sum of assistant capacities. 0 if no head appointed. */
export function deskCapacity(s: GameState, desk: SpanDesk): number {
  const head = deskHead(s, desk)
  if (!head) return 0

  const base = BAL.span.base[desk]
  let cap = base * skillMult(head.skill)

  const astIds = s.company?.deskAssistants?.[desk] ?? []
  for (const id of astIds) {
    const ast = s.staff?.[id]
    if (ast && ast.role === 'manager') {
      cap += base * BAL.span.assistantShare * skillMult(ast.skill)
    }
  }

  return cap
}

/** Desk coverage ratio (0..1). Returns 0 when unmanned; clamped between minCoverage and 1.0 when manned. */
export function deskCoverage(s: GameState, desk: SpanDesk): number {
  const head = deskHead(s, desk)
  if (!head) return 0

  const demand = spanDemand(s, desk)
  const capacity = deskCapacity(s, desk)
  return clamp(capacity / Math.max(demand, 1), BAL.span.minCoverage, 1.0)
}

/** Extra managers needed to reach 1.0 coverage. 0 if unmanned or already covered. */
export function assistantsToCover(s: GameState, desk: SpanDesk): number {
  const head = deskHead(s, desk)
  if (!head) return 0

  const demand = spanDemand(s, desk)
  const capacity = deskCapacity(s, desk)
  const deficit = demand - capacity
  if (deficit <= 0) return 0

  const perAst = BAL.span.base[desk] * BAL.span.assistantShare
  return Math.max(0, Math.ceil(deficit / perAst))
}

export function assistantsToCoverTotal(s: GameState): number {
  let total = 0
  for (const desk of ALL_SPAN_DESKS) {
    total += assistantsToCover(s, desk)
  }
  return total
}

export function spanMeters(s: GameState): Record<SpanDesk, SpanMeter> {
  const out = {} as Record<SpanDesk, SpanMeter>
  for (const desk of ALL_SPAN_DESKS) {
    const head = deskHead(s, desk)
    const demand = spanDemand(s, desk)
    const capacity = deskCapacity(s, desk)
    const coverage = deskCoverage(s, desk)
    const needed = assistantsToCover(s, desk)
    const astCount = (s.company?.deskAssistants?.[desk] ?? []).length

    out[desk] = {
      desk,
      demand,
      capacity,
      coverage,
      assistantsToCover: needed,
      headSkill: head?.skill,
      assistantCount: astCount,
    }
  }
  return out
}

export interface OfficeStaffingStats {
  headsFilled: number
  headsTotal: number
  totalFilled: number
  totalRequired: number
  tone: 'good' | 'warn' | 'bad'
}

export function officeStaffingStats(s: GameState): OfficeStaffingStats {
  let headsFilled = 0
  let totalFilled = 0
  let totalRequired = 0
  let anyDeskShort = false

  for (const desk of ALL_SPAN_DESKS) {
    const head = deskHead(s, desk)
    const hasHead = !!head
    if (hasHead) headsFilled++

    const astCount = (s.company?.deskAssistants?.[desk] ?? []).length
    totalFilled += (hasHead ? 1 : 0) + astCount

    const base = BAL.span.base[desk]
    const demand = spanDemand(s, desk)
    const headCap = hasHead ? base * skillMult(head.skill) : base
    const deficit = demand - headCap
    const astNeeded = deficit > 0 ? Math.ceil(deficit / (base * BAL.span.assistantShare)) : 0

    totalRequired += 1 + astNeeded

    if (!hasHead || astCount < astNeeded) {
      anyDeskShort = true
    }
  }

  const tone: 'good' | 'warn' | 'bad' =
    headsFilled < ALL_SPAN_DESKS.length
      ? 'bad'
      : anyDeskShort || totalFilled < totalRequired
      ? 'warn'
      : 'good'

  return {
    headsFilled,
    headsTotal: ALL_SPAN_DESKS.length,
    totalFilled,
    totalRequired,
    tone,
  }
}

const DESK_NAMES: Record<SpanDesk, string> = {
  hr: 'HR Manager',
  ops: 'Ops Manager',
  workshop: 'Workshop Manager',
  cargo: 'Cargo Manager',
  schedule: 'Schedule Manager',
  documents: 'Documents Manager',
  crm: 'CRM Manager',
  accountant: 'Accounts Manager',
}

/** Check and emit throttled 30-day span warnings to company inbox. */
export function checkSpanWarnings(s: GameState): void {
  if (!s.company.lastSpanWarnDay) s.company.lastSpanWarnDay = {}
  const meters = spanMeters(s)
  for (const desk of ALL_SPAN_DESKS) {
    const m = meters[desk]
    const unattended = Math.max(0, Number((m.demand - m.capacity).toFixed(2)))
    if (unattended > 0 && deskHead(s, desk)) {
      const last = s.company.lastSpanWarnDay[desk] ?? -999
      if (s.day - last >= 30) {
        s.company.lastSpanWarnDay[desk] = s.day
        pushLog(
          s,
          'alert',
          `${DESK_NAMES[desk]} span exceeded: ${Number(m.demand.toFixed(2))} / ${Number(m.capacity.toFixed(2))} ${DESK_UNIT[desk]} (${Math.round(m.coverage * 100)}% coverage · ${unattended} unattended). Appoint ${m.assistantsToCover} assistant manager(s).`,
        )
      }
    }
  }
}
