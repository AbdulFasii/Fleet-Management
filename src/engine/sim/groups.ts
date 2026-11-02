import { nextId } from '../core/ids'
import type { BusGroup, GameState, ID, PassengerAmenities, Schedule, Trip } from '../types'
import { pushLog } from './log'

/** Distinct brand badge hues — spaced so neighbouring pellets read differently. */
export const GROUP_PALETTE = [
  '#1e3a8a', // Navy
  '#2563eb', // Royal Blue
  '#0ea5e9', // Sky
  '#06b6d4', // Cyan
  '#0f766e', // Deep Teal
  '#10b981', // Emerald
  '#22c55e', // Bright Green
  '#14532d', // Dark Green
  '#65a30d', // Lime Olive
  '#ca8a04', // Gold
  '#ea580c', // Orange
  '#b45309', // Bronze
  '#dc2626', // Crimson
  '#be123c', // Rose
  '#c026d3', // Magenta
  '#7c3aed', // Violet
  '#4338ca', // Indigo
  '#475569', // Slate
  '#78716c', // Stone
]

/** Passenger brands first, then cargo; stable name/code within each band. */
export function compareGroupsPassengerFirst(a: BusGroup, b: BusGroup): number {
  const ac = a.cargoBrand ? 1 : 0
  const bc = b.cargoBrand ? 1 : 0
  if (ac !== bc) return ac - bc
  const byName = a.name.localeCompare(b.name)
  if (byName !== 0) return byName
  return a.code.localeCompare(b.code)
}

export function sortedGroups(groups: Iterable<BusGroup>): BusGroup[] {
  return [...groups].sort(compareGroupsPassengerFirst)
}

export function activeGroups(s: GameState): BusGroup[] {
  return sortedGroups(Object.values(s.groups ?? {}).filter((g) => g.status === 'active'))
}

export function createGroup(
  s: GameState,
  input: { name: string; code: string; color?: string; cargoBrand?: boolean; brandingPic?: string },
): { id: ID } | { error: string } {
  const name = input.name?.trim()
  if (!name) return { error: 'Brand name cannot be empty.' }

  const code = input.code?.trim().toUpperCase()
  if (!code || code.length < 2 || code.length > 5) {
    return { error: 'Brand code must be 2 to 5 characters.' }
  }

  if (s.groups && Object.values(s.groups).some((g) => g.code.toUpperCase() === code)) {
    return { error: 'Brand code is already in use.' }
  }

  if (!s.groups) s.groups = {}
  const id = nextId(s.ids, 'grp')
  const color = input.color ?? GROUP_PALETTE[Object.keys(s.groups).length % GROUP_PALETTE.length]
  const cargoBrand = Boolean(input.cargoBrand)
  const brandingPic =
    input.brandingPic && input.brandingPic.startsWith('data:image/') ? input.brandingPic : undefined

  const newGroup: BusGroup = {
    id,
    name,
    code,
    color,
    ...(brandingPic ? { brandingPic } : {}),
    foundedDay: s.day,
    status: 'active',
    cargoBrand: cargoBrand || undefined,
    rating: s.company.rating,
    ratingCount: 0,
    cancelRate: 0,
    primo: false,
    primoOffered: false,
    ...(cargoBrand
      ? {}
      : {
          defaultAmenities: { waterBottle: false, snackHamper: false, sanitizedBedding: false },
          defaultFittings: {},
          defaultServiceTier: 'standard' as const,
          defaultCancellation: s.config?.scheduleDefaults?.cancellation ?? 'standard',
        }),
  }
  s.groups[id] = newGroup
  return { id }
}

export function updateGroup(
  s: GameState,
  id: ID,
  patch: Partial<Omit<BusGroup, 'id'>>,
): string | null {
  const g = s.groups?.[id]
  if (!g) return 'Brand not found.'

  if (patch.code !== undefined) {
    const code = patch.code.trim().toUpperCase()
    if (!code || code.length < 2 || code.length > 5) {
      return 'Brand code must be 2 to 5 characters.'
    }
    if (Object.values(s.groups ?? {}).some((other) => other.id !== id && other.code.toUpperCase() === code)) {
      return 'Brand code is already in use.'
    }
    patch.code = code
  }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return 'Brand name cannot be empty.'
    patch.name = name
  }

  if (patch.brandingPic !== undefined && patch.brandingPic !== '') {
    if (!patch.brandingPic.startsWith('data:image/')) return 'Invalid branding picture.'
  }

  Object.assign(g, patch)
  if (!g.brandingPic) delete g.brandingPic
  return null
}

export function retireGroup(s: GameState, id: ID, moveTo: ID | undefined): string | null {
  const g = s.groups?.[id]
  if (!g) return 'Brand not found.'
  if (g.status === 'retired') return 'Brand is already retired.'

  if (moveTo !== undefined) {
    const dest = s.groups?.[moveTo]
    if (!dest || dest.status === 'retired') return 'Invalid destination brand.'
    if (moveTo === id) return 'Destination brand must be different.'
  }

  let busesMoved = 0
  for (const b of Object.values(s.buses ?? {})) {
    if (b.groupId === id) {
      assignBusToGroup(s, b.id, moveTo)
      busesMoved++
    }
  }

  let schedulesMoved = 0
  for (const sch of Object.values(s.schedules ?? {})) {
    if (sch.groupId === id) {
      assignScheduleToGroup(s, sch.id, moveTo)
      schedulesMoved++
    }
  }

  g.status = 'retired'
  g.retiredDay = s.day

  const destName = moveTo && s.groups?.[moveTo] ? s.groups[moveTo].name : 'Unassigned'
  pushLog(
    s,
    'info',
    `Brand ${g.name} (${g.code}) retired. Moved ${busesMoved} coaches and ${schedulesMoved} schedules to ${destName}.`,
  )

  return null
}

export function restoreGroup(s: GameState, id: ID): string | null {
  const g = s.groups?.[id]
  if (!g) return 'Brand not found.'
  if (g.status !== 'retired') return 'Brand is not retired.'

  g.status = 'active'
  delete g.retiredDay
  pushLog(s, 'info', `Brand ${g.name} (${g.code}) restored to active status.`)
  return null
}

export function deleteGroup(s: GameState, id: ID): string | null {
  const g = s.groups?.[id]
  if (!g) return 'Brand not found.'
  if (g.status !== 'retired') return 'Cannot delete an active brand. Retire it first.'

  const hasBuses = Object.values(s.buses ?? {}).some((b) => b.groupId === id)
  if (hasBuses) return 'Cannot delete brand while buses are still assigned to it.'

  const hasSchedules = Object.values(s.schedules ?? {}).some((sch) => sch.groupId === id)
  if (hasSchedules) return 'Cannot delete brand while schedules are still assigned to it.'

  for (const b of Object.values(s.buses ?? {})) {
    if (b.groupHistory) {
      for (const h of b.groupHistory) {
        if (h.groupId === id) {
          h.groupId = undefined
        }
      }
    }
  }

  delete s.groups[id]
  return null
}

export function assignBusToGroup(s: GameState, busId: ID, groupId: ID | undefined): string | null {
  const bus = s.buses?.[busId]
  if (!bus) return 'Bus not found.'

  if (groupId !== undefined) {
    const g = s.groups?.[groupId]
    if (!g || g.status === 'retired') return 'Invalid or retired brand.'
  }

  if (bus.groupId === groupId) return null

  if (!bus.groupHistory) bus.groupHistory = []
  if (bus.groupHistory.length === 0 && bus.groupId) {
    bus.groupHistory.push({ day: bus.acquiredDay || 0, groupId: bus.groupId })
  }
  bus.groupHistory.push({ day: s.day, groupId })
  bus.groupId = groupId
  return null
}

export function assignScheduleToGroup(s: GameState, schId: ID, groupId: ID | undefined): string | null {
  const sch = s.schedules?.[schId]
  if (!sch) return 'Schedule not found.'

  if (groupId !== undefined) {
    const g = s.groups?.[groupId]
    if (!g || g.status === 'retired') return 'Invalid or retired brand.'
  }

  sch.groupId = groupId
  return null
}

export function groupOf(s: GameState, busId: ID | undefined): BusGroup | undefined {
  if (!busId || !s.buses?.[busId]) return undefined
  const gid = s.buses[busId].groupId
  return gid && s.groups ? s.groups[gid] : undefined
}

export function groupOnDay(s: GameState, busId: ID, day: number): ID | undefined {
  const bus = s.buses?.[busId]
  if (!bus) return undefined
  if (!bus.groupHistory || bus.groupHistory.length === 0) {
    return bus.groupId
  }
  let current: ID | undefined = undefined
  for (const h of bus.groupHistory) {
    if (h.day <= day) {
      current = h.groupId
    } else {
      break
    }
  }
  return current
}

export function groupForTrip(s: GameState, trip: Trip): BusGroup | undefined {
  const bus = trip.busId ? s.buses?.[trip.busId] : undefined
  const isCover = !!bus?.coveringBusId
  const gid =
    !isCover && bus?.groupId
      ? bus.groupId
      : trip.scheduleId
        ? s.schedules?.[trip.scheduleId]?.groupId
        : bus?.groupId
  return gid && s.groups ? s.groups[gid] : undefined
}

export function resolvedAmenities(s: GameState, sch: Schedule): PassengerAmenities {
  const gid = sch.groupId
  const fromGroup = gid && s.groups ? s.groups[gid]?.defaultAmenities : undefined
  const raw = fromGroup ?? s.company.defaultAmenities
  return { ...(raw ?? {}) }
}

export function brandStars(s: GameState, groupId: ID): number | null {
  const matching = Object.values(s.buses ?? {}).filter((b) => b.groupId === groupId)
  if (matching.length === 0) return null
  const total = matching.reduce((acc, b) => acc + (b.qualityScore ?? 0), 0)
  return total / matching.length
}
