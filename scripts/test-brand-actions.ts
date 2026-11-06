import { newGame } from '../src/engine/newGame'
import { createGroup, updateGroup, assignBusToGroup } from '../src/engine/sim/groups'
import { resolveStandard, brandDemandMult, tierLift } from '../src/engine/sim/brandModifiers'
import { clampBrandFare, crewStandardPenalty, monthlyBrandPass, belowStandardBuses } from '../src/engine/sim/brandPolicy'
import {
  launchCampaign, stopCampaign, transferCoaches, mergeBrands, quoteMerge, spinOffBrand, quoteBrandSale, sellBrand,
} from '../src/engine/sim/brandActions'
import { L } from '../src/engine/core/money'
import { orderNewBus, deliverOrdersPass } from '../src/engine/sim/fleet'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
  console.log(`  ok  ${msg}`)
}
const id = (r: { id: string } | { error: string }) => {
  if ('error' in r) throw new Error(r.error)
  return r.id
}

const s = newGame('Brand Actions', 'seth', 'blr_che', 7)
s.groups = {}
s.company.cash = L(5000)
const op = id(createGroup(s, { name: 'Group', code: 'GRP', kind: 'operator' }))
const a = id(createGroup(s, { name: 'Alpha', code: 'ALP', parentGroupId: op }))
const b = id(createGroup(s, { name: 'Beta', code: 'BET', parentGroupId: op }))

// 1. inheritance
updateGroup(s, op, { minDriverSkill: 7, maxBusAgeYears: 5, farePolicy: { floorPct: 100, ceilingPct: 120 } })
assert(resolveStandard(s.groups, s.groups[a], 'minDriverSkill').value === 7, 'brand inherits operator driver standard')
assert(resolveStandard(s.groups, s.groups[a], 'minDriverSkill').from?.id === op, '...and knows it came from the operator')
updateGroup(s, a, { minDriverSkill: 3 })
assert(resolveStandard(s.groups, s.groups[a], 'minDriverSkill').value === 3, 'own value beats the operator')
updateGroup(s, a, { minDriverSkill: undefined })
assert(
  s.groups[a].minDriverSkill === undefined && resolveStandard(s.groups, s.groups[a], 'minDriverSkill').value === 7,
  'patching undefined clears back to inherit',
)
assert(crewStandardPenalty(s, a, 4) > 0, 'inherited driver standard applies to trips')
assert(clampBrandFare(s, a, 90, 100) === 100, 'inherited fare floor applies')
assert(clampBrandFare(s, a, 200, 100) === 120, 'inherited fare ceiling applies')

// 2. campaigns
s.buses['b1'] = {
  id: 'b1', reg: 'T1', acquiredDay: 0, ownership: 'leased', qualityScore: 3, modelId: 'x', status: 'active',
  lifeTrips: 0, lifeRevenue: 0, lifeCost: 0,
} as any
assert(assignBusToGroup(s, 'b1', a) === null, 'coach placed in Alpha')
s.schedules['s1'] = { id: 's1', routeId: 'blr_che', groupId: a, busIds: ['b1'] } as any
s.buses['b1'].scheduleId = 's1'
const before = brandDemandMult(s.groups, s.groups[a], 'blr_che', s.day)
const cash0 = s.company.cash
assert(launchCampaign(s, a, { kind: 'launch', tier: 'regional' }) === null, 'launch campaign starts')
assert(s.company.cash < cash0, 'campaign costs cash')
assert(launchCampaign(s, a, { kind: 'launch', tier: 'local' }) !== null, 'only one launch campaign at a time')
const after = brandDemandMult(s.groups, s.groups[a], 'blr_che', s.day)
assert(after > before, 'campaign lifts demand')
assert(brandDemandMult(s.groups, s.groups[a], 'blr_che', s.day + 40) === before, 'lift is gone after the campaign ends')
assert(brandDemandMult(s.groups, s.groups[a], 'blr_che', s.day + 15) < after, 'lift fades over time')
assert(launchCampaign(s, a, { kind: 'route', routeId: 'blr_che' }) === null, 'corridor push starts on a served route')
assert(launchCampaign(s, a, { kind: 'route', routeId: 'nope' }) !== null, 'push refused on a route the brand does not run')
const opMult = brandDemandMult(s.groups, s.groups[b], 'blr_che', s.day)
assert(launchCampaign(s, op, { kind: 'launch', tier: 'local' }) === null, 'operator launch campaign starts')
assert(brandDemandMult(s.groups, s.groups[b], 'blr_che', s.day) > opMult, 'operator campaign lifts its other brands')
const cid = s.groups[a].campaigns![0].id
assert(stopCampaign(s, a, cid) === null, 'campaign can be stopped')
s.company.cash = -L(100_000_000)
assert(launchCampaign(s, b, { kind: 'launch', tier: 'statewide' }) !== null, 'cannot launch without cash')
s.company.cash = L(5000)

// 3. service tier and loyalty
assert(tierLift('standard', 1) === 0 && tierLift('economy', 1) === 0, 'economy and standard carry no quality bar')
assert(tierLift('gold', 4.5) > 0, 'deluxe service with a good coach earns prestige')
assert(tierLift('gold', 2) < 0 && tierLift('premium', 2) < 0, 'premium and deluxe service with a tired coach is penalised')
assert(tierLift('gold', 2) < tierLift('premium', 2), 'deluxe falls harder than premium')
updateGroup(s, a, { defaultServiceTier: 'gold' })
assert(belowStandardBuses(s, s.groups[a]).length === 1, 'tired coach flagged below the deluxe bar')
updateGroup(s, a, { defaultServiceTier: 'standard' })
assert(belowStandardBuses(s, s.groups[a]).length === 0, 'standard tier flags nothing')
const cashL = s.company.cash
const loyBefore = brandDemandMult(s.groups, s.groups[a], 'x', s.day + 100)
updateGroup(s, a, { loyaltyPct: 4 })
assert(brandDemandMult(s.groups, s.groups[a], 'x', s.day + 100) > loyBefore, 'loyalty scheme lifts demand')
monthlyBrandPass(s)
assert(s.company.cash <= cashL, 'monthly pass charges for loyalty')
updateGroup(s, a, { loyaltyPct: undefined })

// 4. transfer / merge / spin off
const t0 = s.company.cash
assert(transferCoaches(s, ['b1'], b, true) === null, 'coach transfers to Beta')
assert(s.buses['b1'].groupId === b && s.buses['b1'].scheduleId === undefined, 'transferred coach left the Alpha service')
assert(s.company.cash < t0, 'rebrand fee charged')
assert(transferCoaches(s, ['b1'], op, false) !== null, 'cannot transfer to an operator')
assert(transferCoaches(s, ['b1'], a, false) === null, 'transfer without repaint is free')
assert(s.buses['b1'].groupId === a, 'and the coach moved back')

s.schedules['s1'].busIds = []
s.buses['b1'].scheduleId = undefined
s.buses['b2'] = {
  id: 'b2', reg: 'T2', acquiredDay: 0, ownership: 'leased', qualityScore: 3, modelId: 'x', status: 'active',
  lifeTrips: 0, lifeRevenue: 0, lifeCost: 0,
} as any
assignBusToGroup(s, 'b2', a)
s.groups[a].rating = 4
s.groups[a].ratingCount = 100
s.groups[b].rating = 3
s.groups[b].ratingCount = 100
const q = quoteMerge(s, a, b)
assert(!q.error && q.coaches === 2 && q.services === 1, 'merge quote counts coaches and services')
assert(quoteMerge(s, a, op).error !== null, 'fleet brand cannot merge into an operator')
assert(mergeBrands(s, a, b) === null, 'merge succeeds')
assert(
  s.buses['b1'].groupId === b && s.buses['b2'].groupId === b && s.schedules['s1'].groupId === b,
  'coaches and services moved',
)
assert(s.groups[a].status === 'retired', 'merged brand closed')
assert(Math.abs(s.groups[b].rating - 3.5) < 1e-9 && s.groups[b].ratingCount === 200, 'ratings blended by review count')

const gam = id(spinOffBrand(s, { fromId: b, name: 'Gamma', code: 'GAM', scheduleIds: [], busIds: ['b2'] }))
assert(s.groups[gam].parentGroupId === op && s.buses['b2'].groupId === gam, 'spin-off sits under the same operator and takes the coach')
assert('error' in spinOffBrand(s, { fromId: b, name: 'Dup', code: 'DUP', scheduleIds: [], busIds: ['b2'] }), 'cannot spin off a coach the brand no longer owns')
assert('error' in spinOffBrand(s, { fromId: b, name: 'Empty', code: 'EMP', scheduleIds: [], busIds: [] }), 'empty spin-off refused')

// 5. sale: routes are never part of it
s.routeHistory = { r1: [{ day: s.day, byBrand: { [b]: { revenue: L(30), cost: L(10) } } }] } as any
s.permits = { blr_che: { status: 'active' } } as any
// A real coach for Beta so the sale also prices and sells a vehicle.
assert(orderNewBus(s, 'bb1624', {}, b) === null, 'ordered a real coach for Beta')
for (let i = 0; i < 400 && Object.values(s.buses).filter((x) => x.groupId === b).length < 2; i++) {
  s.day += 1
  deliverOrdersPass(s)
}
const realId = Object.values(s.buses).find((x) => x.groupId === b && x.id !== 'b1')?.id
assert(!!realId, 'real coach delivered into Beta')
const sq = quoteBrandSale(s, b, true)
assert(!sq.error && sq.goodwill > 0, 'sale quote has a goodwill price')
assert(sq.coaches.length === 1 && sq.coaches[0].busId === realId, 'quote lists the owned coach')
assert(sq.services === 1, 'quote notes the service that stays')
assert(quoteBrandSale(s, op, true).error !== null, 'operator cannot be sold')
const cashS = s.company.cash
assert(sellBrand(s, b, { includeCoaches: false, moveTo: gam }) === null, 'brand sold, coaches kept')
assert(s.company.cash >= cashS + sq.goodwill - 1, 'goodwill paid in cash')
assert(s.schedules['s1'] && s.schedules['s1'].groupId === gam, 'service and route stay, under the chosen brand')
assert(s.permits['blr_che'].status === 'active', 'permit untouched')
assert(s.buses['b1'] && s.buses['b1'].groupId === gam, 'unsold coach moved with the service')
assert(s.groups[b].status === 'retired' && s.groups[b].soldDay !== undefined, 'brand marked sold')
assert(sellBrand(s, b, { includeCoaches: false, moveTo: undefined }) !== null, 'cannot sell twice')
// sale that includes the owned coach
const del = id(createGroup(s, { name: 'Delta', code: 'DLT' }))
assert(orderNewBus(s, 'bb1624', {}, del) === null, 'ordered a coach for Delta')
for (let i = 0; i < 400 && !Object.values(s.buses).some((x) => x.groupId === del); i++) {
  s.day += 1
  deliverOrdersPass(s)
}
const delBus = Object.values(s.buses).find((x) => x.groupId === del)!.id
const dq = quoteBrandSale(s, del, true)
assert(dq.coaches.length === 1 && dq.total === dq.goodwill + dq.coachNet, 'quote totals goodwill plus coach net')
const cashD = s.company.cash
assert(sellBrand(s, del, { includeCoaches: true, moveTo: undefined }) === null, 'brand sold with its coach')
assert(!s.buses[delBus], 'owned coach sold with the brand')
assert(s.company.cash > cashD, 'cash came in from goodwill and the coach')
console.log('Brand action checks passed.')
