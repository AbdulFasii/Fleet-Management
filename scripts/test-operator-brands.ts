import { newGame } from '../src/engine/newGame'
import {
  createGroup,
  updateGroup,
  assignBusToGroup,
  assignScheduleToGroup,
  retireGroup,
  fleetGroups,
  fleetDescendantIds,
} from '../src/engine/sim/groups'
import { brandRouteProfit30d } from '../src/engine/sim/brandPolicy'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
  console.log(`  ok  ${msg}`)
}

const s = newGame('Operator Test', 'seth', 'blr_che', 42)
s.groups = {}
const id = (r: { id: string } | { error: string }) => {
  if ('error' in r) throw new Error(r.error)
  return r.id
}

const op = id(createGroup(s, { name: 'Royal Travels Group', code: 'RTG', kind: 'operator' }))
const a = id(createGroup(s, { name: 'Alpha', code: 'ALP', parentGroupId: op }))
const b = id(createGroup(s, { name: 'Beta', code: 'BET', parentGroupId: op }))
const subOp = id(createGroup(s, { name: 'South Ops', code: 'SOP', kind: 'operator', parentGroupId: op }))
const c = id(createGroup(s, { name: 'Gamma', code: 'GAM', parentGroupId: subOp }))

assert(s.groups[op].kind === 'operator', 'operator created with kind')
assert(!s.groups[op].defaultAmenities, 'operator gets no passenger defaults')
assert('error' in createGroup(s, { name: 'X', code: 'XX', kind: 'operator', cargoBrand: true }), 'operator cannot be cargo')
assert(!fleetGroups(s).some((g) => g.kind === 'operator'), 'fleetGroups excludes operators')

const desc = fleetDescendantIds(s, op)
assert(desc.size === 3 && desc.has(a) && desc.has(b) && desc.has(c), 'operator descendants = 3 fleet brands incl. nested')

// Minimal stand-ins: only the brand fields are touched by these calls.
s.buses['tb1'] = { id: 'tb1', acquiredDay: s.day } as any
s.schedules['ts1'] = { id: 'ts1', busIds: [] } as any
const busId = 'tb1'
{
  assert(assignBusToGroup(s, busId, op) !== null, 'bus cannot be assigned to operator')
  assert(assignBusToGroup(s, busId, a) === null, 'bus can be assigned to fleet brand')
  assert(updateGroup(s, a, { kind: 'operator' }) !== null, 'brand with coaches cannot become operator')
}
const schId = 'ts1'
assert(assignScheduleToGroup(s, schId, op) !== null, 'service cannot be assigned to operator')

assert(updateGroup(s, op, { kind: 'fleet' }) !== null, 'operator with children cannot become fleet')
assert(updateGroup(s, b, { kind: 'operator' }) === null, 'empty fleet brand can become operator')
assert(updateGroup(s, b, { kind: 'fleet' }) === null && s.groups[b].kind === undefined, 'and back to fleet (kind cleared)')

assert(retireGroup(s, a, op) !== null, 'cannot retire into an operator')
delete s.buses['tb1']
delete s.schedules['ts1']
assert(retireGroup(s, subOp, undefined) === null, 'retire nested operator')
assert(s.groups[c].parentGroupId === op, 'its child moved up to the outer operator')

// profit roll-up
s.routeHistory = { r1: [{ day: s.day, byBrand: { [a]: { revenue: 1000, cost: 400 }, [c]: { revenue: 500, cost: 100 } } }] } as any
assert(brandRouteProfit30d(s, op) === 1000, 'operator 30d profit = sum of its brands (600 + 400)')
assert(brandRouteProfit30d(s, a) === 600, 'fleet brand profit unchanged')

console.log('Operator brand checks passed.')
