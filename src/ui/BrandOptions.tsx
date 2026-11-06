import { Fragment, useMemo } from 'react'
import type { BusGroup, GameState, ID } from '../engine/types'
import { compareGroupsPassengerFirst, fleetGroups } from '../engine/sim/groups'

/**
 * Shared <option>/<optgroup> list for every brand dropdown.
 *
 * mode 'fleet' (default): fleet brands only, grouped under the operator that runs them
 *   ("Royal Travels Group · operator"), sub-brands indented under their parent brand,
 *   cargo brands marked. Without operators the groups are Passenger / Cargo.
 * mode 'tree': every brand passed in, operators included, as one indented tree
 *   (for choosing a parent brand).
 *
 * Render it inside a <select>; put any "All" / "Unassigned" options around it.
 */
interface BrandOptionsProps {
  s: GameState
  /** Brands that may be chosen. Default: active fleet brands. */
  brands?: BusGroup[]
  mode?: 'fleet' | 'tree'
  /** 'code' for narrow inline pickers. */
  label?: 'full' | 'code'
}

const NBSP = ' '

export function BrandOptions({ s, brands, mode = 'fleet', label = 'full' }: BrandOptionsProps) {
  const groups = s.groups ?? {}
  const candidates = brands ?? fleetGroups(s)

  // Whole tree in display order (parents before children, passenger before cargo).
  const ordered = useMemo(() => {
    const kids = new Map<string, BusGroup[]>()
    for (const g of Object.values(groups)) {
      const parent = g.parentGroupId && groups[g.parentGroupId] ? g.parentGroupId : ''
      if (!kids.has(parent)) kids.set(parent, [])
      kids.get(parent)!.push(g)
    }
    const out: { g: BusGroup; depth: number; operatorId?: ID; fleetDepth: number }[] = []
    const seen = new Set<ID>()
    const walk = (parent: string, depth: number, operatorId: ID | undefined, fleetDepth: number) => {
      for (const g of (kids.get(parent) ?? []).sort(compareGroupsPassengerFirst)) {
        if (seen.has(g.id)) continue
        seen.add(g.id)
        const isOp = g.kind === 'operator'
        out.push({ g, depth, operatorId, fleetDepth })
        walk(g.id, depth + 1, isOp ? g.id : operatorId, isOp ? 0 : fleetDepth + 1)
      }
    }
    walk('', 0, undefined, 0)
    return out
  }, [groups])

  const allowed = new Set(candidates.map((g) => g.id))

  const text = (g: BusGroup, indent: number) => {
    const pad = indent > 0 ? `${NBSP.repeat(indent * 3)}↳ ` : ''
    const base = label === 'code' ? g.code : `${g.code} · ${g.name}`
    const extras: string[] = []
    if (g.kind === 'operator') extras.push('operator')
    if (g.cargoBrand) extras.push('cargo')
    if (g.status === 'retired') extras.push('retired')
    return `${pad}${base}${extras.length ? `  (${extras.join(' · ')})` : ''}`
  }

  const opt = (g: BusGroup, indent: number) => (
    <option key={g.id} value={g.id} title={g.name}>
      {text(g, indent)}
    </option>
  )

  if (mode === 'tree') {
    return <>{ordered.filter((r) => allowed.has(r.g.id)).map((r) => opt(r.g, r.depth))}</>
  }

  // Fleet mode: only fleet brands; nested depth counts fleet parents shown in the same group.
  const rows = ordered.filter((r) => r.g.kind !== 'operator' && allowed.has(r.g.id))
  const hasOperators = rows.some((r) => r.operatorId)

  if (!hasOperators) {
    const passenger = rows.filter((r) => !r.g.cargoBrand)
    const cargo = rows.filter((r) => r.g.cargoBrand)
    if (cargo.length === 0 || passenger.length === 0) {
      return <>{rows.map((r) => opt(r.g, r.fleetDepth))}</>
    }
    return (
      <>
        <optgroup label="Passenger brands">{passenger.map((r) => opt(r.g, r.fleetDepth))}</optgroup>
        <optgroup label="Cargo brands">{cargo.map((r) => opt(r.g, 0))}</optgroup>
      </>
    )
  }

  // Group by the operator that runs each brand; brands with none go first.
  const buckets = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.operatorId ?? ''
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(r)
  }
  const operatorLabel = (opId: ID) => {
    const op = groups[opId]
    if (!op) return 'Operator'
    const outer = op.parentGroupId ? nearestOperator(groups, op.parentGroupId) : undefined
    return `${op.name} (${op.code}) · operator${outer ? ` under ${outer.name}` : ''}`
  }

  return (
    <>
      {[...buckets.entries()].map(([key, list]) => (
        <Fragment key={key || 'direct'}>
          <optgroup label={key ? operatorLabel(key) : 'Direct brands (no operator)'}>
            {list.map((r) => opt(r.g, r.fleetDepth))}
          </optgroup>
        </Fragment>
      ))}
    </>
  )
}

function nearestOperator(groups: Record<ID, BusGroup>, startId: ID): BusGroup | undefined {
  let id: ID | undefined = startId
  const seen = new Set<ID>()
  while (id && groups[id] && !seen.has(id)) {
    seen.add(id)
    if (groups[id].kind === 'operator') return groups[id]
    id = groups[id].parentGroupId
  }
  return undefined
}
