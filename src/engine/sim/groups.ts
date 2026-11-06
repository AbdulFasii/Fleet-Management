import { nextId } from '../core/ids'
import { BAL } from '../data/balance'
import type { BusGroup, GameState, ID, PassengerAmenities, Schedule, Trip } from '../types'
import { canAfford, spend } from './finance'
import { pushLog } from './log'

/** Distinct brand badge hues — spaced so neighbouring pellets read differently. */
export const GROUP_PALETTE = [
  // Blues & Teals (7)
  '#1e3a8a', // Navy
  '#2563eb', // Royal Blue
  '#0ea5e9', // Sky Blue
  '#38bdf8', // Ice Blue
  '#06b6d4', // Cyan
  '#0f766e', // Deep Teal
  '#14b8a6', // Teal

  // Greens (6)
  '#14532d', // Dark Forest Green
  '#15803d', // Racing Green
  '#10b981', // Emerald
  '#22c55e', // Bright Green
  '#84cc16', // Lime
  '#65a30d', // Olive

  // Golds & Light Yellows (7)
  '#fef08a', // Pale Light Yellow
  '#fde047', // Sunshine Light Yellow
  '#facc15', // Canary Yellow
  '#eab308', // Warm Gold
  '#d4af37', // Metallic Gold
  '#ca8a04', // Antique Gold
  '#b45309', // Bronze

  // Oranges, Saffrons & Browns (5)
  '#f97316', // Saffron Orange
  '#ea580c', // Tangerine
  '#fb923c', // Peach
  '#92400e', // Amber Brown
  '#78350f', // Espresso Brown

  // Reds, Maroons & Pinks (7)
  '#ef4444', // Red
  '#dc2626', // Crimson
  '#7f1d1d', // Burgundy
  '#4c0519', // Wine
  '#be123c', // Rose
  '#f43f5e', // Coral
  '#c026d3', // Magenta

  // Purples & Violets (3)
  '#a855f7', // Purple
  '#7c3aed', // Violet
  '#4338ca', // Deep Indigo

  // Silvers & Neutrals (5)
  '#e2e8f0', // Light Silver
  '#cbd5e1', // Silver
  '#94a3b8', // Metallic Silver
  '#111111', // Black
  '#ffffff', // White
]

/** Light badge fills need dark text / a visible edge on the dark UI. */
export function isLightBadgeColor(color: string): boolean {
  const hex = color.trim().replace('#', '')
  if (hex.length !== 6) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // Relative luminance (sRGB-ish)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

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

export function isOperatorGroup(g: BusGroup | undefined): boolean {
  return g?.kind === 'operator'
}

/** Active brands that can own coaches and services (everything except operators). */
export function fleetGroups(s: GameState): BusGroup[] {
  return activeGroups(s).filter((g) => !isOperatorGroup(g))
}

/** Active operator brands. */
export function operatorGroups(s: GameState): BusGroup[] {
  return activeGroups(s).filter(isOperatorGroup)
}

/** Fleet brands at any depth below a brand (the brand itself when it is a fleet brand). */
export function fleetDescendantIds(s: GameState, groupId: ID): Set<ID> {
  const groups = s.groups ?? {}
  const out = new Set<ID>()
  const self = groups[groupId]
  if (self && !isOperatorGroup(self)) out.add(groupId)
  for (const id of getDescendantGroupIds(groups, groupId)) {
    if (!isOperatorGroup(groups[id])) out.add(id)
  }
  return out
}

function brandOwnsAnything(s: GameState, id: ID): { buses: number; schedules: number } {
  return {
    buses: Object.values(s.buses ?? {}).filter((b) => b.groupId === id).length,
    schedules: Object.values(s.schedules ?? {}).filter((sch) => sch.groupId === id).length,
  }
}

export function createGroup(
  s: GameState,
  input: {
    name: string
    code: string
    color?: string
    cargoBrand?: boolean
    brandingPic?: string
    parentGroupId?: ID
    kind?: 'fleet' | 'operator'
  },
): { id: ID } | { error: string } {
  const isOperator = input.kind === 'operator'
  if (isOperator && input.cargoBrand) {
    return { error: 'An operator owns no coaches, so it cannot be a cargo brand.' }
  }
  const name = input.name?.trim()
  if (!name) return { error: 'Brand name cannot be empty.' }

  const code = input.code?.trim().toUpperCase()
  if (!code || code.length < 2 || code.length > 5) {
    return { error: 'Brand code must be 2 to 5 characters.' }
  }

  if (s.groups && Object.values(s.groups).some((g) => g.code.toUpperCase() === code)) {
    return { error: 'Brand code is already in use.' }
  }

  const parentGroupId =
    input.parentGroupId && s.groups?.[input.parentGroupId] ? input.parentGroupId : undefined

  if (!s.groups) s.groups = {}
  const id = nextId(s.ids, 'grp')
  const color = input.color ?? GROUP_PALETTE[Object.keys(s.groups).length % GROUP_PALETTE.length]
  const cargoBrand = !isOperator && Boolean(input.cargoBrand)
  const brandingPic =
    input.brandingPic && (input.brandingPic.startsWith('data:image/') || /^https?:\/\//i.test(input.brandingPic))
      ? input.brandingPic
      : undefined

  const newGroup: BusGroup = {
    id,
    name,
    code,
    color,
    ...(brandingPic ? { brandingPic } : {}),
    ...(parentGroupId ? { parentGroupId } : {}),
    ...(isOperator ? { kind: 'operator' as const } : {}),
    foundedDay: s.day,
    status: 'active',
    cargoBrand: cargoBrand || undefined,
    rating: s.company.rating,
    ratingCount: 0,
    cancelRate: 0,
    primo: false,
    primoOffered: false,
    ...(cargoBrand || isOperator
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

/** Find all child/grandchild descendant IDs for a brand group to prevent circular hierarchy loops. */
export function getDescendantGroupIds(groups: Record<ID, BusGroup>, groupId: ID): Set<ID> {
  const descendants = new Set<ID>()
  const queue = [groupId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const g of Object.values(groups)) {
      if (g.parentGroupId === curr && !descendants.has(g.id)) {
        descendants.add(g.id)
        queue.push(g.id)
      }
    }
  }
  return descendants
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

  if (patch.parentGroupId !== undefined) {
    if (patch.parentGroupId === id) {
      return 'A brand cannot be its own parent.'
    }
    if (patch.parentGroupId) {
      const descendants = getDescendantGroupIds(s.groups ?? {}, id)
      if (descendants.has(patch.parentGroupId)) {
        return 'Cannot set a sub-brand as the parent (circular hierarchy).'
      }
    }
  }

  if (patch.kind !== undefined && (patch.kind ?? 'fleet') !== (g.kind ?? 'fleet')) {
    if (patch.kind === 'operator') {
      const owned = brandOwnsAnything(s, id)
      if (owned.buses > 0 || owned.schedules > 0) {
        return `Move its ${owned.buses} coaches and ${owned.schedules} services to another brand before making it an operator.`
      }
      if (g.cargoBrand || patch.cargoBrand) return 'A cargo brand cannot become an operator.'
    } else {
      const hasChildren = Object.values(s.groups ?? {}).some((o) => o.parentGroupId === id && o.status === 'active')
      if (hasChildren) return 'Move its brands to another parent before making it a fleet brand.'
    }
  }
  if (patch.cargoBrand && (patch.kind ?? g.kind) === 'operator') {
    return 'An operator cannot be a cargo brand.'
  }

  if (patch.brandingPic !== undefined && patch.brandingPic !== '') {
    if (!patch.brandingPic.startsWith('data:image/') && !/^https?:\/\//i.test(patch.brandingPic)) {
      return 'Invalid branding picture.'
    }
  }

  Object.assign(g, patch)
  // A field patched to undefined is cleared (e.g. "inherit from operator").
  for (const k of Object.keys(patch) as (keyof BusGroup)[]) {
    if ((patch as Record<string, unknown>)[k] === undefined) delete g[k]
  }
  if (!g.brandingPic) delete g.brandingPic
  if (!g.parentGroupId) delete g.parentGroupId
  if (g.kind !== 'operator') delete g.kind
  if (g.gallery && g.gallery.length === 0) delete g.gallery
  if (patch.odoHighlightKm === undefined && 'odoHighlightKm' in patch) delete g.odoHighlightKm
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
    if (isOperatorGroup(dest)) return 'Coaches cannot move to an operator brand; pick a fleet brand.'
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

  // Brands under it move up to its own parent so nothing is left orphaned.
  let brandsMoved = 0
  for (const child of Object.values(s.groups ?? {})) {
    if (child.parentGroupId === id) {
      if (g.parentGroupId) child.parentGroupId = g.parentGroupId
      else delete child.parentGroupId
      brandsMoved++
    }
  }

  g.status = 'retired'
  g.retiredDay = s.day

  const destName = moveTo && s.groups?.[moveTo] ? s.groups[moveTo].name : 'Unassigned'
  pushLog(
    s,
    'info',
    `Brand ${g.name} (${g.code}) retired. Moved ${busesMoved} coaches and ${schedulesMoved} schedules to ${destName}` +
      (brandsMoved > 0 ? `; ${brandsMoved} brands moved up a level.` : '.'),
  )

  return null
}

export function restoreGroup(s: GameState, id: ID): string | null {
  const g = s.groups?.[id]
  if (!g) return 'Brand not found.'
  if (g.status !== 'retired') return 'Brand is not retired.'
  if (g.soldDay !== undefined) return 'A sold brand cannot be restored.'

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

  for (const child of Object.values(s.groups ?? {})) {
    if (child.parentGroupId === id) {
      if (g.parentGroupId) child.parentGroupId = g.parentGroupId
      else delete child.parentGroupId
    }
  }

  if (s.groups) delete s.groups[id]
  return null
}

export function assignBusToGroup(
  s: GameState,
  busId: ID,
  groupId: ID | undefined,
  opts?: { chargeRebrand?: boolean },
): string | null {
  const bus = s.buses?.[busId]
  if (!bus) return 'Bus not found.'

  if (groupId !== undefined) {
    const g = s.groups?.[groupId]
    if (!g || g.status === 'retired') return 'Invalid or retired brand.'
    if (isOperatorGroup(g)) return `${g.name} is an operator and owns no coaches. Pick one of its brands.`
  }

  if (bus.groupId === groupId) return null

  // Applying a brand identity needs fresh livery; stripping to Unassigned does not.
  if (opts?.chargeRebrand && groupId !== undefined) {
    const cost = BAL.rebrandCost
    if (!canAfford(s, cost)) return 'Cannot afford rebranding.'
    const toName = s.groups?.[groupId]?.name ?? 'brand'
    spend(s, 'rebranding', cost, { busId, note: `Rebrand to ${toName}` })
  }

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
    if (isOperatorGroup(g)) return `${g.name} is an operator and runs no services. Pick one of its brands.`
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
