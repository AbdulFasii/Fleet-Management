/**
 * Staff: hiring pool, assignment, fatigue/leave/morale, payroll,
 * attrition, poaching and strikes.
 */
import { BAL } from '../data/balance'
import { ROUTES } from '../data/routes'
import { modelNeedsHp, isCargoModel } from '../data/busModels'
import { FIRST_NAMES, LAST_NAMES } from '../data/names'
import { nextId } from '../core/ids'
import { fmtCompact, rs, type Money } from '../core/money'
import { fromCivil, toCivil, FESTIVALS } from '../core/calendar'
import { rngFor, rInt, rPick, rChance, rJitter } from '../core/rng'
import type { GameState, HrAutoHire, HrAutoFire, Staff, StaffRole, ID, DeskPost } from '../types'
import { spend, canAfford } from './finance'
import { pushLog, pushDecision } from './log'
import { ALL_SPAN_DESKS, assistantsToCover, deskCapacity, deskCoverage, officeStaffingStats } from './span'

export const POOL_ROLES: StaffRole[] = ['driver', 'driver', 'driver', 'driver', 'conductor', 'conductor', 'conductor', 'mechanic', 'manager']

export const STAFF_ROLES: StaffRole[] = ['driver', 'co_driver', 'conductor', 'mechanic', 'manager']

export const ROLE_LABEL: Record<StaffRole, string> = {
  driver: 'Driver',
  co_driver: 'Co-driver',
  conductor: 'Conductor',
  mechanic: 'Mechanic',
  manager: 'Manager',
}

export type { DeskPost } from '../types'

export const DESK_LABEL: Record<DeskPost, string> = {
  hr: 'HR',
  ops: 'Ops',
  workshop: 'Workshop',
  cargo: 'Cargo',
  schedule: 'Schedule',
  documents: 'Documents',
  crm: 'CRM',
  accountant: 'Accounts Manager',
}

/** Desks take any manager. */
export const FLEET_MANAGER_ROLES: StaffRole[] = ['manager']

const LEGACY_TO_MANAGER = new Set(['office', 'hr', 'ops', 'cargo'])

export function migrateStaffRoles(s: GameState): void {
  const remap = (st: Staff): void => {
    const r = st.role as string
    if (r === 'co_driver') st.role = 'driver'
    else if (LEGACY_TO_MANAGER.has(r)) st.role = 'manager'
    else if (r === 'cleaner') st.role = 'conductor'
    const range = BAL.salaryRange[st.role]
    if (range && (st.salary == null || st.salary < range[0])) {
      st.salary = marketSalary(st.role, st.skill ?? 5)
    }
  }
  for (const st of Object.values(s.staff ?? {})) remap(st)
  for (const c of s.hiringPool ?? []) remap(c)
  if (s.company?.hrAutoHire?.byRole && (s.company.hrAutoHire.byRole as Record<string, unknown>)['co_driver'] !== undefined) {
    delete (s.company.hrAutoHire.byRole as Record<string, unknown>)['co_driver']
  }

  const wm = s.workshop.managerId ? s.staff[s.workshop.managerId] : undefined
  if (wm && wm.role === 'mechanic') {
    wm.role = 'manager'
    if (s.workshop.mechanicIds) {
      s.workshop.mechanicIds = s.workshop.mechanicIds.filter((id) => id !== wm.id)
    }
  }
  for (const key of ['hrId', 'opsId', 'cargoManagerId', 'scheduleManagerId', 'docsManagerId', 'crmId', 'accountantId'] as const) {
    const id = s.company[key]
    if (id && !s.staff[id]) s.company[key] = undefined
  }
  if (s.workshop.managerId && !s.staff[s.workshop.managerId]) s.workshop.managerId = undefined
  if (s.company?.deskAssistants) {
    for (const [desk, list] of Object.entries(s.company.deskAssistants)) {
      if (Array.isArray(list)) {
        s.company.deskAssistants[desk as DeskPost] = list.filter((id) => {
          const st = s.staff[id]
          return st && st.role === 'manager'
        })
      }
    }
  }
}

export function managersOnPayroll(s: GameState): Staff[] {
  return Object.values(s.staff).filter((st) => st.role === 'manager')
}

export function deskHead(s: GameState, desk: DeskPost): Staff | undefined {
  let id: ID | undefined
  switch (desk) {
    case 'hr': id = s.company.hrId; break
    case 'ops': id = s.company.opsId; break
    case 'workshop': id = s.workshop.managerId; break
    case 'cargo': id = s.company.cargoManagerId; break
    case 'schedule': id = s.company.scheduleManagerId; break
    case 'documents': id = s.company.docsManagerId; break
    case 'crm': id = s.company.crmId; break
    case 'accountant': id = s.company.accountantId; break
  }
  return id ? s.staff[id] : undefined
}

export function deskManagers(s: GameState, desk: DeskPost): Staff[] {
  const head = deskHead(s, desk)
  const list: Staff[] = head ? [head] : []
  const astIds = s.company.deskAssistants?.[desk] ?? []
  for (const id of astIds) {
    const st = s.staff[id]
    if (st && st.role === 'manager') list.push(st)
  }
  return list
}

export function deskOf(s: GameState, staffId: ID): DeskPost | undefined {
  if (s.company.hrId === staffId) return 'hr'
  if (s.company.opsId === staffId) return 'ops'
  if (s.workshop.managerId === staffId) return 'workshop'
  if (s.company.cargoManagerId === staffId) return 'cargo'
  if (s.company.scheduleManagerId === staffId) return 'schedule'
  if (s.company.docsManagerId === staffId) return 'documents'
  if (s.company.crmId === staffId) return 'crm'
  if (s.company.accountantId === staffId) return 'accountant'
  if (s.company.deskAssistants) {
    for (const [desk, list] of Object.entries(s.company.deskAssistants)) {
      if (list && list.includes(staffId)) return desk as DeskPost
    }
  }
  return undefined
}

export function appointDeskAssistant(s: GameState, desk: DeskPost, staffId: ID | undefined): string | null {
  const head = deskHead(s, desk)
  if (!head) return `Appoint a head ${DESK_LABEL[desk]} manager first.`
  if (!staffId) return 'Pick a manager.'
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (st.role !== 'manager') return 'Appoint an administrative manager as assistant.'
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return `${st.name} is on leave.`

  for (const d of ALL_SPAN_DESKS) {
    if (deskHead(s, d)?.id === staffId) {
      return `${st.name} is already appointed to ${DESK_LABEL[d]}.`
    }
  }

  if (s.workshop.mechanicIds?.includes(staffId)) return `${st.name} is on a workshop bay.`
  st.busId = undefined

  clearDesk(s, staffId, desk)

  if (!s.company.deskAssistants) s.company.deskAssistants = {}
  const currentList = s.company.deskAssistants[desk] ?? []
  if (!currentList.includes(staffId)) {
    s.company.deskAssistants[desk] = [...currentList, staffId]
  }
  const cap = Math.floor(deskCapacity(s, desk))
  pushLog(s, 'info', `Appointed ${st.name} as assistant ${DESK_LABEL[desk]} manager (Capacity expanded to ${cap}).`)
  return null
}

export function unappointDeskAssistant(s: GameState, desk: DeskPost, staffId: ID): string | null {
  const list = s.company.deskAssistants?.[desk]
  if (!list || !list.includes(staffId)) return 'Not an assistant on this desk.'
  s.company.deskAssistants[desk] = list.filter((id: ID) => id !== staffId)
  const st = s.staff[staffId]
  if (st) pushLog(s, 'info', `${st.name} is no longer an assistant on ${DESK_LABEL[desk]}.`)
  return null
}

/** Managers on payroll who are appointed to a department desk. */
export function assignedManagers(s: GameState): Staff[] {
  return Object.values(s.staff ?? {}).filter(
    (st) => st.role === 'manager' && deskOf(s, st.id) !== undefined,
  )
}

/**
 * Head office & admin monthly cost:
 * Base overhead (₹10,000/mo) + ₹5,000/mo office rent per manager hired and assigned to a desk.
 */
export function monthlyOfficeAdminCost(s: GameState): {
  total: number
  base: number
  managerRent: number
  assignedManagers: number
} {
  const assigned = assignedManagers(s).length
  const base = BAL.officeAdminMonthly
  const managerRent = assigned * BAL.officeAdminPerManager
  return {
    total: base + managerRent,
    base,
    managerRent,
    assignedManagers: assigned,
  }
}

function clearDesk(s: GameState, staffId: ID, keep?: DeskPost): void {
  if (keep !== 'hr' && s.company.hrId === staffId) s.company.hrId = undefined
  if (keep !== 'ops' && s.company.opsId === staffId) s.company.opsId = undefined
  if (keep !== 'workshop' && s.workshop.managerId === staffId) s.workshop.managerId = undefined
  if (keep !== 'cargo' && s.company.cargoManagerId === staffId) s.company.cargoManagerId = undefined
  if (keep !== 'schedule' && s.company.scheduleManagerId === staffId) s.company.scheduleManagerId = undefined
  if (keep !== 'documents' && s.company.docsManagerId === staffId) s.company.docsManagerId = undefined
  if (keep !== 'crm' && s.company.crmId === staffId) s.company.crmId = undefined
  if (keep !== 'accountant' && s.company.accountantId === staffId) s.company.accountantId = undefined
  if (s.company.deskAssistants) {
    for (const [desk, list] of Object.entries(s.company.deskAssistants)) {
      if (desk !== keep && list && list.includes(staffId)) {
        (s.company.deskAssistants as Record<string, ID[]>)[desk] = list.filter((id: ID) => id !== staffId)
      }
    }
  }
}

function setDeskHeadId(s: GameState, desk: DeskPost, staffId: ID | undefined): void {
  switch (desk) {
    case 'hr': s.company.hrId = staffId; break
    case 'ops': s.company.opsId = staffId; break
    case 'workshop': s.workshop.managerId = staffId; break
    case 'cargo': s.company.cargoManagerId = staffId; break
    case 'schedule': s.company.scheduleManagerId = staffId; break
    case 'documents': s.company.docsManagerId = staffId; break
    case 'crm': s.company.crmId = staffId; break
    case 'accountant': s.company.accountantId = staffId; break
  }
}

function nextEligibleAssistant(s: GameState, desk: DeskPost): Staff | undefined {
  const list = s.company.deskAssistants?.[desk] ?? []
  for (const id of list) {
    const st = s.staff[id]
    if (!st || st.role !== 'manager') continue
    if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) continue
    return st
  }
  return undefined
}

/**
 * When a desk head seat is empty and HR is on duty (or the vacant desk is HR itself),
 * elevate the first eligible assistant manager into the head role.
 */
export function promoteDeskAssistantToHead(s: GameState, desk: DeskPost): Staff | null {
  if (deskHead(s, desk)) return null
  // Filling HR may proceed without an incumbent; every other desk needs HR on duty.
  if (desk !== 'hr' && !hrOnDuty(s)) return null

  const next = nextEligibleAssistant(s, desk)
  if (!next) return null

  const list = s.company.deskAssistants?.[desk] ?? []
  if (s.company.deskAssistants) {
    s.company.deskAssistants[desk] = list.filter((id) => id !== next.id)
  }

  clearDesk(s, next.id, desk)
  next.busId = undefined
  setDeskHeadId(s, desk, next.id)

  if (desk === 'ops' && s.company.opsAutoStaff === undefined) s.company.opsAutoStaff = true

  const hr = desk === 'hr' ? undefined : hrOnDuty(s)
  pushLog(
    s,
    'good',
    hr
      ? `HR ${hr.name} promoted assistant ${next.name} to ${DESK_LABEL[desk]} head.`
      : `Assistant ${next.name} stepped up as ${DESK_LABEL[desk]} head.`,
  )

  if (desk === 'hr') {
    hrAutoHireFromPool(s)
    hrAutoFirePass(s)
  } else if (desk === 'ops' && s.company.opsAutoStaff) {
    opsAutoStaffPass(s)
  }

  return next
}

/** Fill every vacant desk head from that desk's assistant queue while HR is available. */
export function fillVacantDesksFromAssistants(s: GameState): number {
  let n = 0
  if (!deskHead(s, 'hr') && promoteDeskAssistantToHead(s, 'hr')) n += 1
  if (!hrOnDuty(s)) return n
  for (const desk of ALL_SPAN_DESKS) {
    if (desk === 'hr') continue
    if (promoteDeskAssistantToHead(s, desk)) n += 1
  }
  return n
}

function afterDeskHeadRelieved(s: GameState, desk: DeskPost): void {
  promoteDeskAssistantToHead(s, desk)
}

function requireManager(s: GameState, st: Staff | undefined): string | null {
  if (!st) return 'No such employee.'
  if (st.role !== 'manager') return 'Hire a manager and appoint them to this desk.'
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return `${st.name} is on leave.`
  return null
}

function managerOnDesk(s: GameState, id: ID | undefined): Staff | undefined {
  if (!id) return undefined
  const st = s.staff[id]
  if (!st || st.role !== 'manager') return undefined
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return undefined
  return st
}

export function fleetManagerOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.workshop.managerId)
}

export function appointFleetManager(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.workshop.managerId ? s.staff[s.workshop.managerId] : undefined
    s.workshop.managerId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer workshop manager.`)
    afterDeskHeadRelieved(s, 'workshop')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  if ((s.workshop.mechanicIds ?? []).includes(staffId)) return 'This person is on a workshop bay — unappoint them first.'
  clearDesk(s, staffId, 'workshop')
  st!.busId = undefined
  s.workshop.managerId = st!.id
  pushLog(s, 'good', `${st!.name} appointed workshop manager — they will run services, repairs and pull idle same-class buses for cover.`)
  return null
}

export function hrOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.hrId)
}

export function appointHr(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.hrId ? s.staff[s.company.hrId] : undefined
    s.company.hrId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer HR.`)
    afterDeskHeadRelieved(s, 'hr')
    fillVacantDesksFromAssistants(s)
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'hr')
  st!.busId = undefined
  s.company.hrId = st!.id
  pushLog(s, 'good', `${st!.name} appointed HR — they rest tired drivers, coach skill, and can auto-hire / auto-raise when you enable it.`)
  hrAutoHireFromPool(s)
  hrAutoFirePass(s)
  fillVacantDesksFromAssistants(s)
  return null
}

export function opsOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.opsId)
}

export function appointOps(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.opsId ? s.staff[s.company.opsId] : undefined
    s.company.opsId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer ops.`)
    afterDeskHeadRelieved(s, 'ops')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'ops')
  st!.busId = undefined
  s.company.opsId = st!.id
  if (s.company.opsAutoStaff === undefined) s.company.opsAutoStaff = true
  pushLog(s, 'good', `${st!.name} appointed ops — they crew scheduled buses from payroll only (never hire from the pool).`)
  if (s.company.opsAutoStaff) opsAutoStaffPass(s)
  return null
}

export function cargoManagerOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.cargoManagerId)
}

export function appointCargoManager(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.cargoManagerId ? s.staff[s.company.cargoManagerId] : undefined
    s.company.cargoManagerId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer cargo manager.`)
    afterDeskHeadRelieved(s, 'cargo')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'cargo')
  st!.busId = undefined
  s.company.cargoManagerId = st!.id
  pushLog(s, 'good', `${st!.name} appointed cargo — they book parcels and push bay fill rates.`)
  return null
}

export function setOpsAutoStaff(s: GameState, enabled: boolean): string | null {
  s.company.opsAutoStaff = enabled
  if (enabled) {
    if (!opsOnDuty(s)) return 'Appoint an ops manager before enabling auto-staff.'
    opsAutoStaffPass(s)
  }
  return null
}

export function scheduleManagerOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.scheduleManagerId)
}

export function appointScheduleManager(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.scheduleManagerId ? s.staff[s.company.scheduleManagerId] : undefined
    s.company.scheduleManagerId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer Schedule manager.`)
    afterDeskHeadRelieved(s, 'schedule')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'schedule')
  st!.busId = undefined
  s.company.scheduleManagerId = st!.id
  pushLog(
    s,
    'good',
    `${st!.name} appointed Schedule manager — they auto-park idle coaches on festival services when a festival window opens.`,
  )
  return null
}

export function docsManagerOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.docsManagerId)
}

export function appointDocsManager(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.docsManagerId ? s.staff[s.company.docsManagerId] : undefined
    s.company.docsManagerId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer Document manager.`)
    afterDeskHeadRelieved(s, 'documents')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'documents')
  st!.busId = undefined
  s.company.docsManagerId = st!.id
  pushLog(
    s,
    'good',
    `${st!.name} appointed Document manager — they renew PUC, fitness, insurance, road tax, and route permits.`,
  )
  return null
}

export function crmOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.crmId)
}

export function appointCrm(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.crmId ? s.staff[s.company.crmId] : undefined
    s.company.crmId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer CRM manager.`)
    afterDeskHeadRelieved(s, 'crm')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'crm')
  st!.busId = undefined
  s.company.crmId = st!.id
  pushLog(
    s,
    'good',
    `${st!.name} appointed CRM manager — handles passenger grievances and disputes according to policy.`,
  )
  return null
}

export function setCrmPolicy(s: GameState, policy: 'ask' | 'refund' | 'dispute' | 'suggest_refund'): string | null {
  s.company.crmPolicy = policy
  return null
}

export function accountantOnDuty(s: GameState): Staff | undefined {
  return managerOnDesk(s, s.company.accountantId)
}

export function appointAccountant(s: GameState, staffId: ID | undefined): string | null {
  if (!staffId) {
    const prev = s.company.accountantId ? s.staff[s.company.accountantId] : undefined
    s.company.accountantId = undefined
    if (prev) pushLog(s, 'info', `${prev.name} is no longer Accountant.`)
    afterDeskHeadRelieved(s, 'accountant')
    return null
  }
  const st = s.staff[staffId]
  const err = requireManager(s, st)
  if (err) return err
  clearDesk(s, staffId, 'accountant')
  st!.busId = undefined
  s.company.accountantId = st!.id
  pushLog(
    s,
    'good',
    `${st!.name} appointed Accounts Manager — files statutory GST/TDS returns, handles insurance claims and clears bounced receivables automatically.`,
  )
  return null
}

export function setHrAutoRaise(s: GameState, enabled: boolean): string | null {
  if (enabled && !hrOnDuty(s)) {
    return 'Appoint HR first — auto-raise only runs while HR is on duty.'
  }
  s.company.hrAutoRaise = enabled
  if (enabled) hrAutoResolvePoaches(s)
  return null
}

function applyPoachMatch(s: GameState, st: Staff, offer: number, hr?: Staff): void {
  st.salary = offer
  st.morale = Math.min(100, st.morale + 10)
  st.loyalty = Math.min(100, st.loyalty + 12)
  pushLog(
    s,
    'good',
    hr
      ? `HR ${hr.name} matched rival offer for ${st.name} at ${fmtCompact(offer)}/month.`
      : `${st.name} stays - salary matched at ${fmtCompact(offer)}/month.`,
  )
}

/** Match pending rival offers when HR auto-raise is on. */
export function hrAutoResolvePoaches(s: GameState): number {
  if (!s.company.hrAutoRaise) return 0
  const hr = hrOnDuty(s)
  if (!hr) return 0
  let n = 0
  for (const d of [...s.decisions]) {
    if (d.kind !== 'poach') continue
    const staffId = d.data?.staffId as ID | undefined
    const offer = d.data?.offer as number | undefined
    const st = staffId ? s.staff[staffId] : undefined
    s.decisions = s.decisions.filter((x) => x.id !== d.id)
    if (!st || !offer) continue
    applyPoachMatch(s, st, offer, hr)
    n++
  }
  return n
}

/**
 * HR brings anyone paid under 90% of market up to market rate.
 * Runs at month end before payroll when enabled and HR is on duty.
 */
export function hrAutoRaisePass(s: GameState): number {
  if (!s.company.hrAutoRaise) return 0
  const hr = hrOnDuty(s)
  if (!hr) return 0
  hrAutoResolvePoaches(s)
  let n = 0
  let added = 0
  const underpaid = Object.values(s.staff).filter((st) => {
    const mkt = marketSalary(st.role, st.skill)
    return st.salary < mkt * 0.9
  })
  underpaid.sort((a, b) => {
    const mktA = marketSalary(a.role, a.skill)
    const mktB = marketSalary(b.role, b.skill)
    return (a.salary / mktA) - (b.salary / mktB)
  })
  const cap = Math.round(deskCapacity(s, 'hr'))
  const candidates = underpaid.slice(0, cap)

  for (const st of candidates) {
    const mkt = marketSalary(st.role, st.skill)
    const next = Math.max(st.salary + 1, mkt)
    if (next <= st.salary) continue
    added += next - st.salary
    st.salary = next
    st.morale = Math.min(100, st.morale + 12)
    st.loyalty = Math.min(100, st.loyalty + 15)
    n++
  }
  if (n > 0) {
    pushLog(
      s,
      'good',
      `HR ${hr.name} auto-raised ${n} staff to market (+${fmtCompact(added)}/month payroll).`,
    )
  }
  return n
}

export function isStaffResting(s: GameState, st: Staff, depHour?: number): boolean {
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return true
  if (st.nightRestUntilDay) {
    if (s.day < st.nightRestUntilDay) return true
    if (s.day === st.nightRestUntilDay) {
      const restUntil = st.nightRestUntilHour ?? BAL.cmvrNightRestUntilHour
      if (depHour !== undefined) {
        if (depHour < restUntil) return true
      } else {
        if (restUntil > 0) return true
      }
    }
  }
  return false
}

export function driverRestIllegal(d: Staff, day: number): boolean {
  const max = BAL.restLaw.maxConsecutiveDays
  const streak = d.consecutiveDutyDays ?? 0
  if (streak < max) return false
  // Worked yesterday at the cap — needs a rest day today.
  return (d.lastTripDay ?? -1) === day - 1
}

/**
 * Hours counted against a driver's CMVR daily cap for one trip.
 * Multi-day hauls (e.g. 32–36h) are shared across the crew and spread over the
 * calendar days the coach is on the road — otherwise half of 36h (18) always
 * exceeds the 13h daily limit and every marathon cancels forever.
 */
export function cmvrDutyHoursForTrip(routeHours: number, numQualified = 1): number {
  const h = Math.max(0, routeHours)
  const share = h / Math.max(1, numQualified)
  const calendarDays = Math.max(1, Math.ceil(h / 24))
  return share / calendarDays
}

export function isDriverEligibleForTrip(
  s: GameState,
  d: Staff,
  tripDay: number,
  depHour: number,
  routeHours: number,
  numDriversNeeded = 1,
): boolean {
  if (d.onLeaveUntilDay && d.onLeaveUntilDay >= tripDay) return false
  if (tripDay === s.day && (Number(d.fatigue) || 0) >= BAL.fatigueAccidentThreshold) return false

  // Mandatory night rest
  if (d.nightRestUntilDay) {
    if (tripDay < d.nightRestUntilDay) return false
    if (tripDay === d.nightRestUntilDay) {
      const restUntil = d.nightRestUntilHour ?? BAL.cmvrNightRestUntilHour
      if (depHour < restUntil) return false
    }
  }

  // Duty turnaround wait (same-day restriction)
  if (tripDay === s.day && d.nextDutyNotBeforeHour !== undefined && depHour < d.nextDutyNotBeforeHour) {
    return false
  }

  // CMVR weekly rest law
  if (driverRestIllegal(d, tripDay)) return false

  // CMVR daily driving hours limit (13h)
  const hoursThisTrip = cmvrDutyHoursForTrip(routeHours, numDriversNeeded)
  if (tripDay === s.day && (d.cmvrHoursToday ?? 0) + hoursThisTrip > BAL.cmvrDailyHours) {
    return false
  }

  return true
}

export function hasUnfilledHpDuty(s: GameState): boolean {
  for (const b of Object.values(s.buses ?? {})) {
    if (b.status !== 'active' || b.ownership === 'attached') continue
    if (!modelNeedsHp(b.modelId)) continue
    const sch = b.scheduleId ? s.schedules[b.scheduleId] : undefined
    if (!sch || !sch.active) continue
    const drvs = Object.values(s.staff ?? {}).filter(
      (st) => st.busId === b.id && (st.role === 'driver' || (st.role as string) === 'co_driver'),
    )
    const hasHp = drvs.some((st) => st.licenceClass === 'HMV_HP')
    if (!hasHp) return true
  }
  return false
}

function busCrewDriverNeed(s: GameState, busId: string): number {
  const bus = s.buses[busId]
  if (!bus) return 1
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (!sch) return 1
  const route = ROUTES[sch.routeId]
  if (!route) return 1
  const tripsPerDay = sch.paired && sch.returnDepHour !== undefined ? 2 : 1
  const perTrip = route.hours > BAL.maxDrivingHoursSingleDriver ? 2 : 1
  return perTrip * tripsPerDay
}

function staffAvailable(st: Staff, s: GameState): boolean {
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return false
  if (s.company.hrId === st.id || s.company.opsId === st.id) return false
  if (s.workshop.managerId === st.id) return false
  if ((s.workshop.mechanicIds ?? []).includes(st.id)) return false
  return true
}

function pickPayrollCrew(
  s: GameState,
  role: 'driver' | 'co_driver' | 'conductor',
  used: Set<string>,
  licence?: 'HMV_PSV' | 'HMV_HP',
  nonRestingOnly = false,
): Staff | undefined {
  const pool = Object.values(s.staff)
    .filter((st) => {
      const isRoleMatch = st.role === role || (role === 'driver' && st.role === 'co_driver')
      if (!isRoleMatch || st.busId || !staffAvailable(st, s) || used.has(st.id)) return false
      if (licence && (st.licenceClass ?? 'HMV_PSV') !== licence) return false
      if (nonRestingOnly && isStaffResting(s, st)) return false
      return true
    })
    .sort((a, b) => {
      const fatA = Number(a.fatigue) || 0
      const fatB = Number(b.fatigue) || 0
      if (fatA !== fatB) return fatA - fatB
      return b.skill - a.skill
    })
  return pool[0]
}

/**
 * Ops manager: crew only scheduled owned/leased buses from payroll.
 * Idle (unscheduled) buses are stripped — drivers go to spare bench.
 * Never touches the hiring pool.
 */
export function opsAutoStaffPass(s: GameState): void {
  const ops = opsOnDuty(s)
  if (!ops || !s.company.opsAutoStaff) return

  const shorts: string[] = []

  const buses = Object.values(s.buses).filter(
    (b) => (b.ownership === 'owned' || b.ownership === 'leased') && b.status === 'active',
  )
  const cap = Math.floor(deskCapacity(s, 'ops'))
  const coverage = deskCoverage(s, 'ops')

  // Cache pseudo-hashes for tie-breaking
  const hashCache = new Map<string, number>()
  for (const b of buses) {
    hashCache.set(b.id, rngFor(s.seed, BAL.span.opsRotationSalt, s.day, b.id)())
  }

  // Sort: HP coaches first, then scheduled coaches, tie-broken by pseudo-hash
  buses.sort((a, b) => {
    const aHp = modelNeedsHp(a.modelId) ? 1 : 0
    const bHp = modelNeedsHp(b.modelId) ? 1 : 0
    if (aHp !== bHp) return bHp - aHp

    const aSch = a.scheduleId && s.schedules[a.scheduleId]?.active ? 1 : 0
    const bSch = b.scheduleId && s.schedules[b.scheduleId]?.active ? 1 : 0
    if (aSch !== bSch) return bSch - aSch

    return (hashCache.get(a.id) ?? 0) - (hashCache.get(b.id) ?? 0)
  })

  if (buses.length > cap) {
    pushLog(
      s,
      'info',
      `Ops manager span exceeded (${Math.round(coverage * 100)}% coverage · ${buses.length - cap} coaches unsupervised). Appoint ${assistantsToCover(s, 'ops')} assistant manager(s) to supervise the full fleet.`,
    )
  }

  const supervisedBuses = buses.slice(0, cap)

  // Index crew by bus once — the hot path used to scan all staff per bus.
  const byBus = new Map<string, Staff[]>()
  const used = new Set<string>()
  for (const st of Object.values(s.staff)) {
    if (!st.busId) continue
    if (st.role !== 'driver' && st.role !== 'co_driver' && st.role !== 'conductor') continue
    used.add(st.id)
    let list = byBus.get(st.busId)
    if (!list) { list = []; byBus.set(st.busId, list) }
    list.push(st)
  }

  // 1) Idle / unscheduled — release all crew to spare bench
  for (const bus of supervisedBuses) {
    const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
    if (sch && sch.active) continue
    for (const st of byBus.get(bus.id) ?? []) {
      used.delete(st.id)
      assignStaff(s, st.id, undefined)
    }
    byBus.delete(bus.id)
  }

  // 2) Scheduled buses — fill to required drivers + one conductor.
  for (const bus of supervisedBuses) {
    const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
    if (!sch || !sch.active) continue

    const tripsPerDay = sch.paired && sch.returnDepHour !== undefined ? 2 : 1
    const needDrv = busCrewDriverNeed(s, bus.id)
    const needCond = isCargoModel(bus.modelId) ? 0 : tripsPerDay
    const isHpBus = modelNeedsHp(bus.modelId)

    const allOnBus = byBus.get(bus.id) ?? []
    for (const st of [...allOnBus]) {
      if (!staffAvailable(st, s)) {
        used.delete(st.id)
        assignStaff(s, st.id, undefined)
        allOnBus.splice(allOnBus.indexOf(st), 1)
      }
    }

    const onBus = allOnBus.filter((st) => staffAvailable(st, s))
    const drivers = onBus.filter((st) => st.role === 'driver' || st.role === 'co_driver')
    const conductors = onBus.filter((st) => st.role === 'conductor')

    // Release excess crew
    while (drivers.length > needDrv) {
      const extra = drivers.pop()!
      used.delete(extra.id)
      assignStaff(s, extra.id, undefined)
    }
    while (conductors.length > needCond) {
      const extra = conductors.pop()!
      used.delete(extra.id)
      assignStaff(s, extra.id, undefined)
    }

    // Fill missing drivers
    while (drivers.length < needDrv) {
      let pick: Staff | undefined
      if (isHpBus && drivers.length < tripsPerDay) {
        // Heavy coach primary driver for each daily trip needs HMV_HP
        pick = pickPayrollCrew(s, 'driver', used, 'HMV_HP') ?? pickPayrollCrew(s, 'driver', used)
      } else if (!isHpBus) {
        // Normal bus: prefer HMV_PSV
        // An HMV_HP driver can ONLY drive normal bus if no HP bus duty is waiting for an HP driver, and they are on bench & not resting
        pick = pickPayrollCrew(s, 'driver', used, 'HMV_PSV')
        if (!pick && !hasUnfilledHpDuty(s)) {
          pick = pickPayrollCrew(s, 'driver', used, 'HMV_HP', true /* nonRestingOnly */)
        }
      } else {
        // 2nd driver / co-driver: can be PSV or HP
        pick = pickPayrollCrew(s, 'driver', used)
      }
      if (!pick) {
        shorts.push(`${bus.reg}: need ${needDrv - drivers.length} more driver(s)`)
        break
      }
      if (assignStaff(s, pick.id, bus.id) === null) {
        drivers.push(pick)
        used.add(pick.id)
      } else break
    }

    // Volvo / Scania HMV_HP compliance check: swap ordinary driver if HMV_HP driver is idle
    if (isHpBus && drivers.length > 0) {
      const primary = drivers[0]
      if (primary && primary.licenceClass !== 'HMV_HP') {
        const hpSpare = Object.values(s.staff).find(
          (st) => (st.role === 'driver' || st.role === 'co_driver') &&
                  st.licenceClass === 'HMV_HP' &&
                  !st.busId &&
                  staffAvailable(st, s) &&
                  !used.has(st.id),
        )
        if (hpSpare) {
          assignStaff(s, primary.id, undefined)
          used.delete(primary.id)
          assignStaff(s, hpSpare.id, bus.id)
          used.add(hpSpare.id)
          drivers[0] = hpSpare
          pushLog(s, 'info', `Ops auto-swapped ${hpSpare.name} (HMV_HP) onto ${bus.reg} for heavy coach compliance.`)
        }
      }
    }

    // Night-rest swap: replace resting driver with an idle driver on morning departures (<10:00)
    if (sch.depHour < 10) {
      for (let dIdx = 0; dIdx < drivers.length; dIdx++) {
        const drv = drivers[dIdx]
        const inNightRest = isStaffResting(s, drv, sch.depHour)
        if (inNightRest) {
          const replacement = Object.values(s.staff).find(
            (st) =>
              (st.role === 'driver' || (dIdx > 0 && st.role === 'co_driver')) &&
              !st.busId &&
              !used.has(st.id) &&
              staffAvailable(st, s) &&
              !isStaffResting(s, st, sch.depHour) &&
              (!isHpBus || dIdx > 0 || st.licenceClass === 'HMV_HP'),
          )
          if (replacement) {
            assignStaff(s, drv.id, undefined)
            used.delete(drv.id)
            assignStaff(s, replacement.id, bus.id)
            used.add(replacement.id)
            drivers[dIdx] = replacement
            pushLog(s, 'info', `Ops swapped ${replacement.name} onto ${bus.reg} for resting ${drv.name} (CMVR night rest).`)
          }
        }
      }
    }

    // Conductor night-rest swap: replace resting conductor with an idle conductor on morning departures (<10:00)
    if (sch.depHour < 10 && conductors.length > 0) {
      const cond = conductors[0]
      if (isStaffResting(s, cond, sch.depHour)) {
        const replacement = Object.values(s.staff).find(
          (st) =>
            st.role === 'conductor' &&
            !st.busId &&
            !used.has(st.id) &&
            staffAvailable(st, s) &&
            !isStaffResting(s, st, sch.depHour),
        )
        if (replacement) {
          assignStaff(s, cond.id, undefined)
          used.delete(cond.id)
          assignStaff(s, replacement.id, bus.id)
          used.add(replacement.id)
          conductors[0] = replacement
          pushLog(s, 'info', `Ops swapped conductor ${replacement.name} onto ${bus.reg} for resting ${cond.name} (conductor rest).`)
        }
      }
    }

    // Fill missing conductor(s)
    while (conductors.length < needCond) {
      const pick = pickPayrollCrew(s, 'conductor', used)
      if (!pick) {
        shorts.push(`${bus.reg}: need ${needCond - conductors.length} more conductor(s)`)
        break
      } else if (assignStaff(s, pick.id, bus.id) === null) {
        conductors.push(pick)
        used.add(pick.id)
      } else break
    }
  }

  if (shorts.length > 0) {
    pushLog(
      s,
      'alert',
      `Ops ${ops.name}: payroll short — ${shorts.slice(0, 4).join('; ')}${shorts.length > 4 ? ` (+${shorts.length - 4} more)` : ''}. Hire on Staff (ops cannot hire from the pool).`,
    )
  }
}

export const AUTO_HIRE_ROLES: StaffRole[] = ['driver', 'conductor', 'mechanic', 'manager']

const DEFAULT_SKILLS = [4, 5, 6, 7, 8, 9, 10]

export function defaultHrAutoHire(): HrAutoHire {
  return { enabled: false, mode: 'unlimited', byRole: { driver: [...DEFAULT_SKILLS] } }
}

/** Normalize prefs; migrate old roles+skills saves into per-role skill maps. */
export function ensureHrAutoHire(s: GameState): HrAutoHire {
  if (!s.company.hrAutoHire) s.company.hrAutoHire = defaultHrAutoHire()
  const raw = s.company.hrAutoHire as HrAutoHire & { roles?: StaffRole[]; skills?: number[] }
  if (!raw.byRole || typeof raw.byRole !== 'object') {
    const roles = Array.isArray(raw.roles) && raw.roles.length ? raw.roles : (['driver'] as StaffRole[])
    const skills = Array.isArray(raw.skills) && raw.skills.length ? raw.skills : [...DEFAULT_SKILLS]
    raw.byRole = {}
    for (const r of roles) {
      if (AUTO_HIRE_ROLES.includes(r)) raw.byRole[r] = [...skills]
    }
  }
  delete raw.roles
  delete raw.skills
  for (const role of Object.keys(raw.byRole) as StaffRole[]) {
    if (!AUTO_HIRE_ROLES.includes(role)) {
      delete raw.byRole[role]
      continue
    }
    const sk = raw.byRole[role]
    raw.byRole[role] = [...new Set((sk ?? []).filter((n) => n >= 1 && n <= 10))].sort((a, b) => a - b)
  }
  s.company.hrAutoHire = {
    enabled: !!raw.enabled,
    mode: raw.mode === 'match' ? 'match' : 'unlimited',
    byRole: raw.byRole,
    drivingStyle: raw.drivingStyle ? [...raw.drivingStyle] : undefined,
    licenceClass: raw.licenceClass ? [...raw.licenceClass] : undefined,
    mechanicTrade: raw.mechanicTrade ? [...raw.mechanicTrade] : undefined,
  }
  return s.company.hrAutoHire
}

export type HrAutoHirePatch = {
  enabled?: boolean
  /** `unlimited` = hire every match; `match` = top up to the Ops crew requirement only. */
  mode?: 'unlimited' | 'match'
  byRole?: Partial<Record<StaffRole, number[]>>
  /** Add/remove a role (defaults skills when adding). */
  toggleRole?: StaffRole
  /** Flip one skill chip for a role. */
  toggleSkill?: { role: StaffRole; skill: number }
  toggleDrivingStyle?: 'aggressive' | 'cautious'
  toggleLicenceClass?: 'HMV_PSV' | 'HMV_HP'
  toggleMechanicTrade?: 'engine_gearbox' | 'electrical_ac' | 'body_suspension' | 'general'
}

/** Update auto-hire prefs; if enabled and HR is on duty, hire matching pool candidates now. */
export function setHrAutoHire(s: GameState, patch: HrAutoHirePatch): string | null {
  const cfg = ensureHrAutoHire(s)
  const turningOn = patch.enabled === true && !cfg.enabled
  if (turningOn && !hrOnDuty(s)) {
    return 'Appoint HR first — auto-hire only runs while HR is on duty.'
  }
  if (patch.enabled !== undefined) cfg.enabled = patch.enabled
  if (patch.mode !== undefined) cfg.mode = patch.mode
  if (patch.byRole) {
    cfg.byRole = {}
    for (const role of AUTO_HIRE_ROLES) {
      const sk = patch.byRole[role]
      if (!sk) continue
      cfg.byRole[role] = [...new Set(sk.filter((n) => n >= 1 && n <= 10))].sort((a, b) => a - b)
    }
  }
  if (patch.toggleRole) {
    const role = patch.toggleRole
    if (!AUTO_HIRE_ROLES.includes(role)) return 'Unknown role.'
    if (cfg.byRole[role]) delete cfg.byRole[role]
    else cfg.byRole[role] = [...DEFAULT_SKILLS]
  }
  if (patch.toggleSkill) {
    const { role, skill } = patch.toggleSkill
    if (!AUTO_HIRE_ROLES.includes(role) || skill < 1 || skill > 10) return 'Invalid skill filter.'
    const cur = cfg.byRole[role] ?? [...DEFAULT_SKILLS]
    cfg.byRole[role] = cur.includes(skill)
      ? cur.filter((n) => n !== skill)
      : [...cur, skill].sort((a, b) => a - b)
  }
  if (patch.toggleDrivingStyle) {
    const cur = cfg.drivingStyle ?? []
    cfg.drivingStyle = cur.includes(patch.toggleDrivingStyle)
      ? cur.filter((x) => x !== patch.toggleDrivingStyle)
      : [...cur, patch.toggleDrivingStyle]
  }
  if (patch.toggleLicenceClass) {
    const cur = cfg.licenceClass ?? []
    cfg.licenceClass = cur.includes(patch.toggleLicenceClass)
      ? cur.filter((x) => x !== patch.toggleLicenceClass)
      : [...cur, patch.toggleLicenceClass]
  }
  if (patch.toggleMechanicTrade) {
    const cur = cfg.mechanicTrade ?? []
    cfg.mechanicTrade = cur.includes(patch.toggleMechanicTrade)
      ? cur.filter((x) => x !== patch.toggleMechanicTrade)
      : [...cur, patch.toggleMechanicTrade]
  }
  if (!cfg.enabled) {
    if (patch.enabled === false) pushLog(s, 'info', 'HR auto-hire turned off.')
    return null
  }
  hrAutoHireFromPool(s)
  return null
}

export const DEFAULT_AUTO_FIRE_SALARY: Record<StaffRole, Money> = {
  driver: rs(35_000),
  co_driver: rs(26_000),
  conductor: rs(22_000),
  mechanic: rs(38_000),
  manager: rs(55_000),
}

export function defaultHrAutoFire(): HrAutoFire {
  return {
    enabled: false,
    maxSalaryByRole: {
      driver: rs(35_000),
      co_driver: rs(26_000),
      conductor: rs(22_000),
      mechanic: rs(38_000),
      manager: rs(55_000),
    },
  }
}

export function ensureHrAutoFire(s: GameState): HrAutoFire {
  if (!s.company.hrAutoFire) s.company.hrAutoFire = defaultHrAutoFire()
  if (!s.company.hrAutoFire.maxSalaryByRole) {
    s.company.hrAutoFire.maxSalaryByRole = { ...defaultHrAutoFire().maxSalaryByRole }
  }
  for (const role of STAFF_ROLES) {
    if (s.company.hrAutoFire.maxSalaryByRole[role] === undefined) {
      s.company.hrAutoFire.maxSalaryByRole[role] = DEFAULT_AUTO_FIRE_SALARY[role]
    }
  }
  return s.company.hrAutoFire
}

export interface HrAutoFirePatch {
  enabled?: boolean
  maxSalaryByRole?: Partial<Record<StaffRole, Money>>
  setSalaryCap?: { role: StaffRole; maxSalary: Money }
}

export function setHrAutoFire(s: GameState, patch: HrAutoFirePatch): string | null {
  const cfg = ensureHrAutoFire(s)
  const turningOn = patch.enabled === true && !cfg.enabled
  if (turningOn && !hrOnDuty(s)) {
    return 'Appoint HR first — auto-fire by salary cap only runs while HR is on duty.'
  }
  if (patch.enabled !== undefined) cfg.enabled = patch.enabled
  if (patch.maxSalaryByRole) {
    cfg.maxSalaryByRole = { ...patch.maxSalaryByRole }
  }
  if (patch.setSalaryCap) {
    const { role, maxSalary } = patch.setSalaryCap
    if (!cfg.maxSalaryByRole) cfg.maxSalaryByRole = {}
    if (maxSalary >= rs(1_000)) {
      cfg.maxSalaryByRole[role] = maxSalary
    }
  }
  if (!cfg.enabled) {
    if (patch.enabled === false) pushLog(s, 'info', 'HR auto-fire by salary cap turned off.')
    return null
  }
  hrAutoFirePass(s)
  return null
}

/**
 * HR auto-fires staff whose monthly salary exceeds the configured role threshold.
 * Runs on daily staff pass, at month-end after auto-raises, and upon setting updates.
 */
export function hrAutoFirePass(s: GameState): number {
  const cfg = s.company.hrAutoFire
  if (!cfg?.enabled) return 0
  const hr = hrOnDuty(s)
  if (!hr) return 0

  let firedCount = 0
  for (const st of Object.values(s.staff)) {
    // Never auto-fire the active HR manager administering the department
    if (st.id === s.company.hrId) continue

    const threshold = cfg.maxSalaryByRole?.[st.role] ?? DEFAULT_AUTO_FIRE_SALARY[st.role]
    if (threshold !== undefined && threshold > 0 && st.salary > threshold) {
      if (!canAfford(s, st.salary)) continue

      const staffName = st.name
      const staffRole = st.role
      const salaryFmt = fmtCompact(st.salary)
      const capFmt = fmtCompact(threshold)
      fire(s, st.id)
      firedCount++
      pushLog(
        s,
        'info',
        `HR ${hr.name} auto-fired ${staffName} (${ROLE_LABEL[staffRole]}): salary ${salaryFmt}/mo exceeded ${ROLE_LABEL[staffRole]} cap of ${capFmt}/mo.`,
      )
    }
  }
  return firedCount
}

/** People on payroll who can fill a role. */
export function staffCountForRole(s: GameState, role: StaffRole): number {
  const staff = Object.values(s.staff ?? {})
  if (role === 'driver') return staff.filter((st) => st.role === 'driver' || (st.role as string) === 'co_driver').length
  return staff.filter((st) => st.role === role).length
}

/**
 * Headcount HR aims for when auto-hire runs in `match` mode:
 * - Driver / conductor → Ops crew roster requirement
 * - Mechanic → workshop bay capacity (one mechanic per bay)
 * - Manager → Head Office required staff (same total as the header KPI)
 */
export function autoHireRoleTarget(s: GameState, role: StaffRole): number {
  if (role === 'driver' || role === 'conductor') {
    const est = estimateCrewRequirements(s)
    return role === 'driver' ? est.drivers.total.required : est.conductors.required
  }
  if (role === 'mechanic') return Math.max(0, s.workshop.bays ?? 0)
  if (role === 'manager') return Math.max(0, officeStaffingStats(s).totalRequired)
  return 0
}

/** Remaining hires per role so `match` mode never overshoots its target. */
function matchModeDeficits(s: GameState, cfg: HrAutoHire): Partial<Record<StaffRole, number>> {
  const out: Partial<Record<StaffRole, number>> = {}
  for (const role of AUTO_HIRE_ROLES) {
    if (cfg.byRole[role] === undefined) continue
    out[role] = Math.max(0, autoHireRoleTarget(s, role) - staffCountForRole(s, role))
  }
  return out
}

/** Hire pool candidates that match the configured per-role skill levels. */
export function hrAutoHireFromPool(s: GameState): number {
  const hr = hrOnDuty(s)
  const cfg = ensureHrAutoHire(s)
  if (!hr || !cfg.enabled) return 0
  const matchMode = cfg.mode === 'match'
  const deficit = matchMode ? matchModeDeficits(s, cfg) : undefined
  const ids = s.hiringPool
    .filter((c) => {
      const sk = cfg.byRole[c.role]
      if (!sk || sk.length === 0 || !sk.includes(c.skill)) return false
      if (cfg.drivingStyle && cfg.drivingStyle.length > 0 && c.drivingStyle && !cfg.drivingStyle.includes(c.drivingStyle)) return false
      if (cfg.licenceClass && cfg.licenceClass.length > 0 && c.licenceClass && !cfg.licenceClass.includes(c.licenceClass)) return false
      if (cfg.mechanicTrade && cfg.mechanicTrade.length > 0 && c.mechanicTrade && !cfg.mechanicTrade.includes(c.mechanicTrade)) return false
      return true
    })
    .map((c) => c.id)
  if (ids.length === 0) return 0
  let n = 0
  const hrCov = deskCoverage(s, 'hr')
  const maxHires = !matchMode && hrCov < 1.0 ? Math.max(1, Math.ceil(3 * hrCov)) : Infinity
  const hired: string[] = []
  for (const id of ids) {
    if (n >= maxHires) break
    const before = s.hiringPool.find((c) => c.id === id)
    if (!before) continue
    if (deficit && (deficit[before.role] ?? 0) <= 0) continue
    const err = hire(s, id, { quiet: true })
    if (!err) {
      if (deficit) deficit[before.role] = (deficit[before.role] ?? 0) - 1
      n++
      hired.push(`${before.name} (${before.role} ${before.skill}/10)`)
    }
  }
  if (n > 0) {
    const filter = AUTO_HIRE_ROLES
      .filter((r) => (cfg.byRole[r]?.length ?? 0) > 0)
      .map((r) => `${r}[${cfg.byRole[r]!.join(',')}]`)
      .join(' · ')
    pushLog(s, 'good', `HR ${hr.name} auto-hired ${n}: ${hired.join('; ')} — ${filter}${matchMode ? ' (to Ops requirement)' : ''}.`)
  }
  return n
}

/** Hire-time years plus years on the rolls. */
export function experienceNow(s: GameState, st: Staff): number {
  const hire = st.hiredDay >= 0 ? st.hiredDay : s.day
  return st.experienceYears + Math.max(0, (s.day - hire) / 365)
}

/**
 * Days HR waits before re-reviewing the same person's skill. The gap widens as
 * skill climbs, so 9→10 takes far longer than 4→5.
 */
export function hrSkillReviewGap(skill: number): number {
  const ramp = 1 + Math.max(0, skill - 5) * BAL.hrSkillReviewRamp
  return Math.round(BAL.hrSkillReviewDays * ramp)
}

function hrDevelopSkills(s: GameState): void {
  if (!hrOnDuty(s)) return
  const cov = deskCoverage(s, 'hr')
  for (const st of Object.values(s.staff)) {
    if (st.skill >= 10) continue
    // Clock starts when they join — no instant upgrade on day one.
    const last = st.lastHrSkillDay ?? st.hiredDay
    const gap = Math.round(hrSkillReviewGap(st.skill) / Math.max(0.1, cov))
    if (last !== undefined && s.day - last < gap) continue
    st.skill = Math.min(10, st.skill + 1)
    if (st.role === 'driver') st.safety = Math.min(10, st.safety + 1)
    st.lastHrSkillDay = s.day
    st.morale = Math.min(100, st.morale + 4)
  }
}

export function workshopMechanicsOnDuty(s: GameState): Staff[] {
  return (s.workshop.mechanicIds ?? [])
    .map((id) => s.staff[id])
    .filter((st): st is Staff => !!st && st.role === 'mechanic' && driverOnDuty(s, st))
}

/** Bays that can actually take a job (physical bay + mechanic present). */
export function staffedWorkshopBays(s: GameState): number {
  if (s.workshop.level === 0) return 0
  return Math.min(s.workshop.bays, workshopMechanicsOnDuty(s).length)
}

export function appointBayMechanic(s: GameState, staffId: ID | undefined): string | null {
  if (!s.workshop.mechanicIds) s.workshop.mechanicIds = []
  if (!staffId) return 'Pick a mechanic.'
  if (s.workshop.level === 0) return 'Build a workshop first.'
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (st.role !== 'mechanic') return 'Appoint a service mechanic to the bay.'
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return `${st.name} is on leave.`
  if (s.workshop.managerId === staffId) return 'Unappoint them as workshop manager first.'
  if (s.workshop.mechanicIds.includes(staffId)) return 'Already appointed to a bay.'
  if (s.workshop.mechanicIds.length >= s.workshop.bays) return 'Every bay already has a mechanic.'
  st.busId = undefined
  s.workshop.mechanicIds.push(staffId)
  return null
}

export function unappointBayMechanic(s: GameState, staffId: ID): string | null {
  const ids = s.workshop.mechanicIds ?? []
  if (!ids.includes(staffId)) return 'Not on a workshop bay.'
  s.workshop.mechanicIds = ids.filter((id) => id !== staffId)
  const st = s.staff[staffId]
  if (st) pushLog(s, 'info', `${st.name} is no longer on a workshop bay.`)
  return null
}

/** Before dispatch: HR parks tired line drivers and posts a spare on their bus. */
export function hrFatiguePass(s: GameState): void {
  const hr = hrOnDuty(s)
  if (!hr) return
  const used = new Set<string>()
  const tired = Object.values(s.staff)
    .filter((st) =>
      st.role === 'driver'
      && !!st.busId
      && st.duty !== 'spare'
      && driverOnDuty(s, st)
      && (Number(st.fatigue) || 0) >= BAL.hrFatigueSwapAt,
    )
    .sort((a, b) => b.fatigue - a.fatigue)

  const maxSwaps = Math.ceil(BAL.span.hrInterventionsPerDay * deskCoverage(s, 'hr'))
  const candidates = tired.slice(0, maxSwaps)

  for (const line of candidates) {
    const bus = line.busId ? s.buses[line.busId] : undefined
    if (!bus || bus.ownership === 'attached') continue
    const spare = pickSpareDriver(s, used, true)
    if (!spare) {
      pushLog(s, 'alert', `HR ${hr.name}: ${line.name} is at ${Math.round(line.fatigue)}% fatigue on ${bus.reg} — no fresh spare on the bench.`)
      continue
    }
    used.add(spare.id)
    const busId = bus.id
    line.busId = undefined
    line.duty = 'spare'
    spare.busId = busId
    spare.duty = 'line'
  }
}

interface CandidateOpts {
  skill?: [number, number]
  loyalty?: [number, number]
}

function makeCandidate(s: GameState, roleHint?: StaffRole, opts?: CandidateOpts): Staff {
  const rng = rngFor(s.seed, 'cand', s.ids.next)
  const role = roleHint ?? rPick(rng, POOL_ROLES)
  const [skillLo, skillHi] = opts?.skill ?? [2, 9]
  const [loyalLo, loyalHi] = opts?.loyalty ?? [30, 75]
  const skill = rInt(rng, skillLo, skillHi)
  const exp = Math.max(0, Math.round(skill * rJitter(rng, 2.2, 0.5)))
  const [lo, hi] = BAL.salaryRange[role]
  let salary = Math.round(lo + ((hi - lo) * (skill - 2)) / 7 + rJitter(rng, (hi - lo) * 0.08, 1))
  let drivingStyle: 'aggressive' | 'cautious' | undefined
  let licenceClass: 'HMV_PSV' | 'HMV_HP' | undefined
  if (role === 'driver' || role === 'co_driver') {
    drivingStyle = rng() < 0.50 ? 'aggressive' : 'cautious'
    licenceClass = rng() < 0.50 ? 'HMV_PSV' : 'HMV_HP'
    if (licenceClass === 'HMV_HP') {
      salary = Math.min(hi, Math.round(salary * 1.12))
    }
  }

  let mechanicTrade: 'engine_gearbox' | 'electrical_ac' | 'body_suspension' | 'general' | undefined
  if (role === 'mechanic') {
    const tradeRoll = rng()
    mechanicTrade = tradeRoll < 0.25 ? 'engine_gearbox' : tradeRoll < 0.5 ? 'electrical_ac' : tradeRoll < 0.75 ? 'body_suspension' : 'general'
  }

  return {
    id: nextId(s.ids, 'st'),
    name: `${rPick(rng, FIRST_NAMES)} ${rPick(rng, LAST_NAMES)}`,
    role,
    skill,
    experienceYears: exp,
    salary,
    loyalty: rInt(rng, loyalLo, loyalHi),
    morale: rInt(rng, 55, 85),
    fatigue: 0,
    safety: (role === 'driver' || role === 'co_driver') ? Math.max(1, Math.min(10, skill + rInt(rng, -2, 2))) : 5,
    drivingStyle: (role === 'driver' || role === 'co_driver') ? drivingStyle : undefined,
    hiredDay: -1,
    duty: (role === 'driver' || role === 'co_driver') ? 'spare' : 'line',
    licenceClass,
    mechanicTrade,
    cmvrHoursToday: 0,
    safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
    tripsDriven: 0,
  }
}

/**
 * A crew member who joins outside the weekly pool — a closing rival's staff,
 * already experienced and used to each other. Straight onto the payroll.
 */
export function recruitVeteran(s: GameState, role: StaffRole, opts?: CandidateOpts): Staff {
  const st = makeCandidate(s, role, opts)
  st.hiredDay = s.day
  s.staff[st.id] = st
  return st
}

export function refreshHiringPool(s: GameState): void {
  const rng = rngFor(s.seed, 'pool', s.day)
  const nDrivers = rInt(rng, 4, 6)
  const nOther = rInt(rng, 3, 5)
  const otherRoles: StaffRole[] = ['conductor', 'conductor', 'mechanic', 'mechanic', 'manager']
  s.hiringPool = []
  for (let i = 0; i < nDrivers; i++) s.hiringPool.push(makeCandidate(s, 'driver'))
  for (let i = 0; i < nOther; i++) s.hiringPool.push(makeCandidate(s, rPick(rng, otherRoles)))
  s.poolRefreshDay = s.day + 7
  hrAutoHireFromPool(s)
}

export function hire(s: GameState, candidateId: ID, opts?: { quiet?: boolean }): string | null {
  const idx = s.hiringPool.findIndex((c) => c.id === candidateId)
  if (idx < 0) return 'Candidate has taken another job.'
  const c = s.hiringPool[idx]
  s.hiringPool.splice(idx, 1)
  c.hiredDay = s.day
  if (c.role === 'driver') c.duty = 'spare'
  s.staff[c.id] = c
  if (!opts?.quiet) {
    pushLog(s, 'info', `Hired ${c.name} (${c.role}, skill ${c.skill}) at ${fmtCompact(c.salary)}/month${c.role === 'driver' ? ' — spare bench' : ''}.`)
  }
  // Immediately assign crew to buses if ops auto-staff is active —
  // without this, newly hired staff sit on spare bench until the next day's tick.
  if ((c.role === 'driver' || c.role === 'conductor') && s.company.opsAutoStaff) {
    opsAutoStaffPass(s)
  }
  return null
}

export function driverOnDuty(s: GameState, st: Staff): boolean {
  return !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day)
}

/** Unposted drivers kept as relief for short crews and high fatigue. */
export function spareDriverBench(s: GameState): Staff[] {
  return Object.values(s.staff).filter((st) =>
    (st.role === 'driver' || st.role === 'co_driver') && !st.busId && st.duty !== 'line' && driverOnDuty(s, st),
  )
}

export function spareConductorBench(s: GameState): Staff[] {
  return Object.values(s.staff).filter((st) =>
    st.role === 'conductor' && !st.busId && driverOnDuty(s, st),
  )
}

export function pickSpareConductor(s: GameState, used: Set<string>, depHour?: number): Staff | undefined {
  return spareConductorBench(s)
    .filter((st) => !used.has(st.id) && !isStaffResting(s, st, depHour))
    .sort((a, b) => (Number(a.fatigue) || 0) - (Number(b.fatigue) || 0) || b.skill - a.skill)[0]
}

export function pickSpareDriver(
  s: GameState,
  used: Set<string>,
  freshOnly = false,
  allowCoDriver = true,
  forBusId?: string,
  depHour?: number,
): Staff | undefined {
  const isTargetHp = forBusId ? modelNeedsHp(s.buses[forBusId]?.modelId ?? '') : false
  const unstaffedHp = hasUnfilledHpDuty(s)

  const bench = spareDriverBench(s).filter((st) => {
    if (used.has(st.id)) return false
    if (!allowCoDriver && st.role !== 'driver') return false
    const isHpDriver = st.licenceClass === 'HMV_HP'
    // If targeted for a normal bus, HP driver can only be picked if:
    // 1) No active HP bus duty is waiting for an HP driver
    // 2) The HP driver is on bench and not resting
    if (!isTargetHp && isHpDriver) {
      if (unstaffedHp) return false
      if (isStaffResting(s, st, depHour)) return false
    }
    if (depHour !== undefined && isStaffResting(s, st, depHour)) return false
    if (depHour !== undefined && st.nextDutyNotBeforeHour !== undefined && depHour < st.nextDutyNotBeforeHour) return false
    if ((st.cmvrHoursToday ?? 0) >= BAL.cmvrDailyHours) return false
    if (driverRestIllegal(st, s.day)) return false
    return true
  })

  // When picking for a normal bus, prefer HMV_PSV before HMV_HP
  const rank = (st: Staff) => {
    let score = Number(st.fatigue) || 0
    if (!isTargetHp && st.licenceClass === 'HMV_HP') score += 1000
    return score
  }

  const fresh = bench
    .filter((st) => (Number(st.fatigue) || 0) < BAL.fatigueAccidentThreshold)
    .sort((a, b) => rank(a) - rank(b) || b.skill - a.skill)
  if (fresh[0]) return fresh[0]
  if (freshOnly) return undefined
  return [...bench].sort((a, b) => rank(a) - rank(b) || b.skill - a.skill)[0]
}

export function appointSpareDriver(s: GameState, staffId: ID): string | null {
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (st.role !== 'driver' && st.role !== 'co_driver') return 'Only drivers and co-drivers can be appointed spare.'
  st.busId = undefined
  st.duty = 'spare'
  pushLog(s, 'info', `${st.name} appointed spare driver — they cover tired or missing line drivers.`)
  return null
}

export function fire(s: GameState, staffId: ID): string | null {
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  clearDesk(s, staffId)
  if (s.workshop.mechanicIds) s.workshop.mechanicIds = s.workshop.mechanicIds.filter((id) => id !== staffId)
  spend(s, 'salary', st.salary, { note: `severance: ${st.name}` })
  delete s.staff[staffId]
  // Firing spooks the rest — HR cushions the blow with professional exit handling
  const hr = hrOnDuty(s)
  const hrCov = hr ? deskCoverage(s, 'hr') : 0
  const baseHit = hr ? Math.max(0, 3 - Math.floor(hr.skill / 3)) : 3
  const fireHit = hr
    ? (hrCov < 1 ? Math.max(1, Math.round(baseHit * (2 - hrCov))) : baseHit)
    : 3
  if (fireHit > 0) {
    for (const other of Object.values(s.staff)) other.morale = Math.max(0, other.morale - fireHit)
  }
  pushLog(s, 'info', `${st.name} let go with one month severance.`)
  fillVacantDesksFromAssistants(s)
  return null
}

export function assignStaff(s: GameState, staffId: ID, busId: ID | undefined): string | null {
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (busId !== undefined && !s.buses[busId]) return 'No such bus.'
  if (busId && s.workshop.managerId === staffId) return 'Workshop manager stays at the depot — unappoint them first.'
  if (busId && s.company.hrId === staffId) return 'HR stays at the depot — unappoint them first.'
  if (busId && s.company.opsId === staffId) return 'Ops stays at the depot — unappoint them first.'
  if (busId && s.company.cargoManagerId === staffId) return 'Cargo manager stays at the depot — unappoint them first.'
  if (busId && s.company.scheduleManagerId === staffId) return 'Schedule manager stays at the depot — unappoint them first.'
  if (busId && (s.workshop.mechanicIds ?? []).includes(staffId)) return 'Bay mechanic stays in the workshop — unappoint them first.'

  if (busId) {
    const bus = s.buses[busId]
    const isHpBus = modelNeedsHp(bus.modelId)
    if (st.role === 'driver' || (st.role as string) === 'co_driver') {
      const isHpDriver = st.licenceClass === 'HMV_HP'
      if (isHpDriver && !isHpBus) {
        if (hasUnfilledHpDuty(s)) {
          return 'HP driver needed on heavy coach (Volvo/Scania) duty — assign to HP buses first.'
        }
        if (isStaffResting(s, st)) {
          return `${st.name} is in mandatory rest and cannot take duty on a normal bus.`
        }
      }
      if (!isHpDriver && isHpBus) {
        const driversOnBus = Object.values(s.staff).filter(
          (x) => x.busId === bus.id && (x.role === 'driver' || (x.role as string) === 'co_driver') && x.id !== staffId,
        )
        if (driversOnBus.length === 0) {
          return 'Primary driver on a heavy coach (Volvo/Scania) requires an HMV_HP licence.'
        }
      }
    }
  }

  st.busId = busId
  if (st.role === 'driver' || st.role === 'co_driver') st.duty = busId ? 'line' : 'spare'
  return null
}

export interface CrewEstimateItem {
  current: number
  line: number
  spare: number
  required: number
}

export interface CrewRequirementsEstimate {
  drivers: {
    total: CrewEstimateItem
    psv: CrewEstimateItem
    hp: CrewEstimateItem
  }
  conductors: CrewEstimateItem
  scheduledBusesCount: number
  activeBusesCount: number
}

export function estimateCrewRequirements(s: GameState): CrewRequirementsEstimate {
  const allStaff = Object.values(s.staff ?? {})
  const drivers = allStaff.filter((st) => st.role === 'driver' || (st.role as string) === 'co_driver')
  const psvDrivers = drivers.filter((st) => st.licenceClass !== 'HMV_HP')
  const hpDrivers = drivers.filter((st) => st.licenceClass === 'HMV_HP')
  const conductors = allStaff.filter((st) => st.role === 'conductor')

  const activeBuses = Object.values(s.buses ?? {}).filter(
    (b) => (b.ownership === 'owned' || b.ownership === 'leased') && b.status === 'active',
  )
  const scheduledBuses = activeBuses.filter((b) => b.scheduleId && s.schedules[b.scheduleId]?.active)

  let lineHp = 0
  let linePsv = 0
  let lineCond = 0

  if (scheduledBuses.length > 0) {
    for (const b of scheduledBuses) {
      const sch = s.schedules[b.scheduleId!]
      const route = sch ? ROUTES[sch.routeId] : undefined
      const isLong = route ? route.hours > BAL.maxDrivingHoursSingleDriver : false
      const tripsPerDay = sch && sch.paired && sch.returnDepHour !== undefined ? 2 : 1
      const needDrvPerTrip = isLong ? 2 : 1
      const needDrv = needDrvPerTrip * tripsPerDay
      const needCond = isCargoModel(b.modelId) ? 0 : tripsPerDay
      const isHp = modelNeedsHp(b.modelId)

      if (isHp) {
        lineHp += tripsPerDay
        linePsv += (needDrv - tripsPerDay)
      } else {
        linePsv += needDrv
      }
      lineCond += needCond
    }
  } else {
    for (const b of activeBuses) {
      if (modelNeedsHp(b.modelId)) {
        lineHp += 1
      } else {
        linePsv += 1
      }
      lineCond += 1
    }
  }

  // Relief buffer: ~15% spare bench to cover CMVR night rest, long trips, and leave
  const spareHp = lineHp > 0 ? Math.max(1, Math.ceil(lineHp * 0.15)) : 0
  const sparePsv = linePsv > 0 ? Math.max(1, Math.ceil(linePsv * 0.15)) : 0
  const spareCond = lineCond > 0 ? Math.max(1, Math.ceil(lineCond * 0.15)) : 0

  const totalLine = lineHp + linePsv
  const totalSpare = spareHp + sparePsv

  return {
    drivers: {
      total: {
        current: drivers.length,
        line: totalLine,
        spare: totalSpare,
        required: totalLine + totalSpare,
      },
      psv: {
        current: psvDrivers.length,
        line: linePsv,
        spare: sparePsv,
        required: linePsv + sparePsv,
      },
      hp: {
        current: hpDrivers.length,
        line: lineHp,
        spare: spareHp,
        required: lineHp + spareHp,
      },
    },
    conductors: {
      current: conductors.length,
      line: lineCond,
      spare: spareCond,
      required: lineCond + spareCond,
    },
    scheduledBusesCount: scheduledBuses.length,
    activeBusesCount: activeBuses.length,
  }
}

export function trainStaff(s: GameState, staffId: ID): string | null {
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (st.skill >= 10) return 'Already at peak skill.'
  spend(s, 'training', BAL.trainingCostPerStaff, { note: `training: ${st.name}` })
  st.skill = Math.min(10, st.skill + BAL.trainingSkillGain)
  if (st.role === 'driver') st.safety = Math.min(10, st.safety + 1)
  st.morale = Math.min(100, st.morale + 8)
  st.loyalty = Math.min(100, st.loyalty + 5)
  return null
}

export function raiseSalary(s: GameState, staffId: ID, newSalary: number): string | null {
  const st = s.staff[staffId]
  if (!st) return 'No such employee.'
  if (newSalary <= st.salary) return 'Only raises, this is not that kind of company.'
  st.salary = Math.round(newSalary)
  st.morale = Math.min(100, st.morale + 12)
  st.loyalty = Math.min(100, st.loyalty + 15)
  return null
}

/** Market-rate salary for a role/skill (for morale comparisons and poaching). */
export function marketSalary(role: StaffRole, skill: number): number {
  const [lo, hi] = BAL.salaryRange[role]
  return Math.round(lo + ((hi - lo) * (skill - 2)) / 7)
}

export function dailyStaffPass(s: GameState): void {
  hrAutoResolvePoaches(s)
  hrAutoFirePass(s)
  fillVacantDesksFromAssistants(s)
  const rng = rngFor(s.seed, 'staffday', s.day)
  const hr = hrOnDuty(s)
  const ops = opsOnDuty(s)

  if (s.pendingMigrationInboxEntry) {
    s.pendingMigrationInboxEntry = false
    pushLog(s, 'finance', 'Game Updated: Driver salary scales have been rebalanced to industry baseline. Review payroll in Staff tab. 7-day attrition immunity is active.')
  }

  for (const st of Object.values(s.staff)) {
    const fat = Number(st.fatigue) || 0
    // Rest only if they did not drive today — otherwise the bar never moves
    // and HR/spare swaps never see high fatigue.
    if (st.role === 'driver' && st.lastTripDay === s.day) {
      st.fatigue = fat
    } else {
      st.fatigue = Math.max(0, fat - BAL.fatigueRestRecovery)
      st.consecutiveDutyDays = 0
    }
    if (st.onLeaveUntilDay && st.onLeaveUntilDay < s.day) st.onLeaveUntilDay = undefined

    // Defensive driving retraining and licence upgrade completions
    if (st.retrainUntilDay && s.day >= st.retrainUntilDay) {
      st.drivingStyle = 'cautious'
      st.retrainUntilDay = undefined
      pushLog(s, 'good', `${st.name} completed defensive driver retraining — driving style updated to Cautious.`)
    }
    if (st.licenceUpgradeUntilDay && s.day >= st.licenceUpgradeUntilDay) {
      st.licenceClass = 'HMV_HP'
      st.licenceUpgradeUntilDay = undefined
      pushLog(s, 'good', `${st.name} upgraded licence to HMV_HP (heavy multi-axle luxury coach certified).`)
    }

    // random leave (family, festivals) — health coverage lowers sick leave frequency by 40%
    const sickChance = s.config?.healthCoverage ? 0.004 * 0.60 : 0.004
    if (!st.onLeaveUntilDay && rChance(rng, sickChance)) {
      st.onLeaveUntilDay = s.day + rInt(rng, 1, 3)
      if (st.busId) pushLog(s, 'info', `${st.name} (${st.role}) is on leave for ${st.onLeaveUntilDay - s.day} day(s).`)
    }
    // Exhausted drivers demand rest — Ops & HR cushion the operational shock
    if (st.role === 'driver' && st.fatigue >= 95) {
      st.onLeaveUntilDay = s.day + 2
      const exhaustHit = ops && hr ? 0 : ops ? 2 : hr ? 4 : 10
      if (exhaustHit > 0) st.morale = Math.max(0, st.morale - exhaustHit)
      pushLog(
        s,
        ops ? 'info' : 'alert',
        `Driver ${st.name} is exhausted and rotated off for 2 days rest${ops ? ` (managed by Ops ${ops.name})` : ''}.`,
      )
    }
    // HR daily morale care: if an employee has critically low morale, HR provides active support
    if (st.morale < 40 && hr && s.day % 2 === 0) {
      st.morale = Math.min(100, st.morale + 1)
    }
  }

  // Meal allowance welfare toggle: replaces per-trip driver/conductor bata
  if (s.config?.mealAllowance) {
    const eligible = Object.values(s.staff).filter(
      (st) => ['driver', 'co_driver', 'conductor', 'mechanic'].includes(st.role) &&
              !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day),
    )
    if (eligible.length > 0) {
      spend(s, 'staff_welfare', rs(eligible.length * 150), {
        note: `crew meal allowance (${eligible.length} crew × ₹150)`,
      })
    }
  }

  // Festival bonus welfare toggle: 7 days before Diwali, Christmas, or Eid
  const civ = toCivil(s.day)
  for (const f of FESTIVALS) {
    if (f.name === 'Diwali' || f.name.includes('Christmas') || f.name.includes('Eid')) {
      const fDay = fromCivil(civ.y, f.month, f.day)
      if (s.day === fDay - 7 && s.config?.festivalBonus !== false) {
        if (s.company.festivalBonusDecidedYear !== civ.y) {
          const totalSal = Object.values(s.staff).reduce((a, st) => a + st.salary, 0)
          if (hr) {
            s.company.festivalBonusDecidedYear = civ.y
            spend(s, 'staff_welfare', totalSal, { note: `festival bonus: ${f.name}` })
            for (const st of Object.values(s.staff)) {
              st.morale = Math.min(100, st.morale + 15)
            }
            pushLog(s, 'good', `HR auto-paid festival bonus for ${f.name} (${fmtCompact(totalSal)} to ${Object.keys(s.staff).length} staff). Morale +15.`)
          } else if (!s.decisions.some((d) => d.title.includes(`Festival Bonus: ${f.name}`))) {
            pushDecision(s, {
              kind: 'crew',
              title: `Festival Bonus: ${f.name}`,
              body: `${f.name} is in 7 days. Pay one month bonus salary (${fmtCompact(totalSal)}) to all staff (+15 morale) or skip (−20 morale)?`,
              options: [
                { id: `pay_fest_bonus:${civ.y}`, label: `Pay Bonus (${fmtCompact(totalSal)})` },
                { id: `skip_fest_bonus:${civ.y}`, label: 'Skip Bonus (−20 morale)' },
              ],
            })
          }
        }
      }
    }
  }

  // Match mode keeps the payroll topped up to the Ops requirement, so a firing
  // or a resignation is refilled on the next tick instead of waiting a week.
  hrAutoHireFromPool(s)
}

export function monthlyStaffPass(s: GameState): void {
  const rng = rngFor(s.seed, 'staffmonth', s.day)
  hrAutoRaisePass(s)
  hrAutoFirePass(s)
  const staff = Object.values(s.staff)
  hrDevelopSkills(s)
  const hr = hrOnDuty(s)
  const ops = opsOnDuty(s)

  // Health coverage policy: ₹250/staff/month
  if (s.config?.healthCoverage && staff.length > 0) {
    spend(s, 'staff_welfare', rs(staff.length * 250), {
      note: `staff health insurance cover (${staff.length} staff × ₹250)`,
    })
  }

  // payroll
  const totalPay = staff.reduce((a, st) => a + st.salary, 0)
  if (totalPay > 0) {
    const liquidity = s.company.cash + (s.od.limit - s.od.drawn)
    if (liquidity >= totalPay) {
      spend(s, 'salary', totalPay, { note: `payroll x${staff.length}` })
      for (const st of staff) st.lastPaidDay = s.day
    } else {
      const payMoraleHit = hr ? Math.max(8, 28 - Math.round(hr.skill * 1.8)) : 28
      const payLoyaltyHit = hr ? Math.max(6, 22 - Math.round(hr.skill * 1.5)) : 22
      for (const st of staff) {
        st.morale = Math.max(0, st.morale - payMoraleHit)
        st.loyalty = Math.max(0, st.loyalty - payLoyaltyHit)
      }
      pushLog(
        s,
        'alert',
        `PAYROLL MISSED (${fmtCompact(totalPay)} needed). ${hr ? `HR ${hr.name} mitigated panic, but morale dropped by ${payMoraleHit}pts.` : 'Morale has collapsed - expect resignations or a strike.'}`,
      )
    }
  }

  const hrCoverage = hr ? deskCoverage(s, 'hr') : 0
  const opsCoverage = ops ? deskCoverage(s, 'ops') : 0

  const hrMoraleBoost = hr ? Math.round((4 + Math.round(hr.skill * 1.2)) * hrCoverage) : 0
  const opsMoraleBoost = ops ? Math.round((2 + Math.round(ops.skill * 0.8)) * opsCoverage) : 0

  for (const st of staff) {
    // morale drift vs market pay — HR cushions underpay discontent
    const mkt = marketSalary(st.role, st.skill)
    if (st.salary < mkt * 0.9) {
      const underpayHit = hr ? Math.max(-1, BAL.moraleDriftBelowMarketPay + 1) : BAL.moraleDriftBelowMarketPay
      st.morale = Math.max(0, st.morale + underpayHit)
    } else if (st.salary > mkt * 1.1) {
      st.morale = Math.min(100, st.morale + 2)
    }

    // Baseline recovery + HR wellbeing program + Ops roster satisfaction
    let recovery = 2 // baseline recovery
    if (hr) {
      recovery += hrMoraleBoost
      // Targeted HR counseling for struggling employees
      if (st.morale < 50) recovery += Math.round(8 * hrCoverage)
    }
    if (ops && (st.role === 'driver' || st.role === 'conductor')) {
      recovery += opsMoraleBoost
    }
    st.morale = Math.min(100, st.morale + recovery)

    // Attrition — HR addresses grievances to reduce resignation rates (bypassed during post-migration immunity)
    const isImmune = s.migrationImmunityUntilDay != null && s.day <= s.migrationImmunityUntilDay
    const baseQuitP = BAL.attritionBase * (1 + (50 - st.loyalty) / 40) * (st.morale < 35 ? 3 : 1)
    const quitP = hr ? baseQuitP / (1 + hr.skill * 0.12 * hrCoverage) : baseQuitP
    if (!isImmune && rChance(rng, Math.max(0.001, quitP))) {
      clearDesk(s, st.id)
      if (s.workshop.mechanicIds) s.workshop.mechanicIds = s.workshop.mechanicIds.filter((id) => id !== st.id)
      delete s.staff[st.id]
      pushLog(s, 'alert', `${st.name} (${st.role}, skill ${st.skill}) RESIGNED${st.morale < 35 ? ' citing working conditions' : ''}.`)
      continue
    }

    // poaching of your best people
    if (st.skill >= 7 && rChance(rng, BAL.poachChance)) {
      const offer = Math.round(st.salary * rJitter(rng, 1.25, 0.1))
      const hrDuty = s.company.hrAutoRaise ? hrOnDuty(s) : undefined
      if (hrDuty) {
        const autoFireCfg = s.company.hrAutoFire
        const cap = autoFireCfg?.enabled
          ? (autoFireCfg.maxSalaryByRole?.[st.role] ?? DEFAULT_AUTO_FIRE_SALARY[st.role])
          : undefined
        if (cap !== undefined && cap > 0 && offer > cap) {
          pushLog(
            s,
            'info',
            `HR ${hrDuty.name} declined rival poach offer of ${fmtCompact(offer)}/mo for ${st.name} (${ROLE_LABEL[st.role]}): exceeds salary cap of ${fmtCompact(cap)}/mo.`,
          )
          fire(s, st.id)
          continue
        }
        applyPoachMatch(s, st, offer, hrDuty)
      } else {
        pushDecision(s, {
          kind: 'poach',
          title: `${st.name} has an offer from a rival`,
          body: `${st.name} (${st.role}, skill ${st.skill}, ${st.experienceYears} yrs) has been offered ${fmtCompact(offer)}/month by a competitor (currently ${fmtCompact(st.salary)}). Match it or lose them at month end.`,
          options: [
            { id: 'match', label: `Match ${fmtCompact(offer)}/month` },
            { id: 'let_go', label: 'Let them go' },
          ],
          data: { staffId: st.id, offer },
        })
      }
    }
  }

  // Strike risk — HR steps in to negotiate settlements
  const drivers = Object.values(s.staff).filter((x) => x.role === 'driver')
  if (drivers.length >= 2) {
    const avgMorale = drivers.reduce((a, d) => a + d.morale, 0) / drivers.length
    if (avgMorale < BAL.strikeMoraleThreshold && s.world.strikeUntilDay < s.day) {
      if (hr && rChance(rng, Math.min(0.85, (0.4 + hr.skill * 0.06) * hrCoverage))) {
        pushLog(
          s,
          'good',
          `STRIKE AVERTED: HR ${hr.name} held emergency talks with drivers and negotiated a settlement before departures were affected.`,
        )
        for (const d of drivers) d.morale = Math.min(100, d.morale + 8)
      } else {
        const days = rInt(rng, 2, 4)
        s.world.strikeUntilDay = s.day + days
        pushLog(s, 'alert', `DRIVERS ON STRIKE for ${days} days over pay and conditions. All departures cancelled until it ends.`)
      }
    }
  }
}

/** Defensive driving course for aggressive drivers: ₹15k, 30 days, converts to Cautious style. */
export function retrainDriver(s: GameState, staffId: string): string | null {
  const st = s.staff[staffId]
  if (!st) return 'Staff member not found.'
  if (st.drivingStyle !== 'aggressive') return 'Only aggressive drivers need retraining.'
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return `${st.name} is already on leave / in training.`
  const cost = rs(15_000)
  if (!canAfford(s, cost)) return `Need ${fmtCompact(cost)} for defensive driving training.`
  spend(s, 'training', cost, { note: `defensive driver retraining: ${st.name}` })
  st.retrainUntilDay = s.day + 30
  st.onLeaveUntilDay = s.day + 30
  if (st.busId) assignStaff(s, st.id, undefined)
  pushLog(s, 'info', `${st.name} sent for 30-day defensive driver retraining (${fmtCompact(cost)}). Style will change to Cautious upon completion.`)
  return null
}

/** Heavy passenger vehicle licence endorsement: ₹20k, 30 days, upgrades to HMV_HP. */
export function upgradeLicence(s: GameState, staffId: string): string | null {
  const st = s.staff[staffId]
  if (!st) return 'Staff member not found.'
  if (st.licenceClass === 'HMV_HP') return `${st.name} already holds an HMV_HP licence.`
  if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) return `${st.name} is already on leave / in training.`
  const cost = rs(20_000)
  if (!canAfford(s, cost)) return `Need ${fmtCompact(cost)} for heavy passenger vehicle endorsement.`
  spend(s, 'training', cost, { note: `licence upgrade to HMV_HP: ${st.name}` })
  st.licenceUpgradeUntilDay = s.day + 30
  st.onLeaveUntilDay = s.day + 30
  if (st.busId) assignStaff(s, st.id, undefined)
  pushLog(s, 'info', `${st.name} enrolled in 30-day HMV_HP licence upgrade course (${fmtCompact(cost)}).`)
  return null
}

/** Daily midnight reset for CMVR daily driving hours and same-day departure restrictions. */
export function cmvrResetPass(s: GameState): void {
  for (const st of Object.values(s.staff)) {
    st.cmvrHoursToday = 0
    st.nextDutyNotBeforeHour = undefined
  }
}
