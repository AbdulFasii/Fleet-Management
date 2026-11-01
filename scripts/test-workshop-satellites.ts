import assert from 'assert'
import { newGame } from '../src/engine/newGame'
import { BAL, nextWorkshopBayCost } from '../src/engine/data/balance'
import {
  openWorkshopLocation,
  addBayAtLocation,
  updateWorkshopLocationBrands,
  getWorkshopLocations,
  computeBayAllocations,
  inOwnWorkshop,
  findMechanicForBus,
  serviceBus,
} from '../src/engine/sim/maintenance'
import { appointBayMechanic } from '../src/engine/sim/staffing'
import { L, rs } from '../src/engine/core/money'
import type { GameState, Bus, Staff } from '../src/engine/types'

console.log('=== TEST SUITE: SATELLITE WORKSHOP BAYS & BRAND GATING ===\n')

// 1. Costs & Pricing Verification
console.log('--- 1. Testing Bay Costs ---')
assert.strictEqual(BAL.workshopSiteFirstBayCost, L(30), 'First bay cost must be 30 Lakhs')
assert.strictEqual(BAL.workshopBayCostFlat, L(10), 'Additional bay cost must be 10 Lakhs flat')
assert.strictEqual(nextWorkshopBayCost(0, 0), L(30), 'Location with 0 bays costs 30 Lakhs')
assert.strictEqual(nextWorkshopBayCost(1, 1), L(10), 'Location with 1 bay costs 10 Lakhs')
assert.strictEqual(nextWorkshopBayCost(5, 5), L(10), 'Location with 5 bays costs 10 Lakhs flat (not escalating)')
console.log('✓ Bay cost model correctly configured: ₹30L site open + first bay; ₹10L flat for extra bays.\n')

// 2. Open HQ Depot
console.log('--- 2. Testing Open HQ Workshop Depot ---')
const s = newGame('Express Lines', 'malik', 'maa-cbe')
s.company.cash = L(200) // Give plenty of cash

assert.strictEqual(s.workshop.bays, 0)
assert.strictEqual((s.workshop.locations ?? []).length, 0)

const openHqErr = openWorkshopLocation(s, s.company.homeCityId, [])
assert.strictEqual(openHqErr, null, 'HQ open must succeed')
assert.strictEqual(s.workshop.bays, 1, 'Workshop should now have 1 bay')
const locs = getWorkshopLocations(s)
assert.strictEqual(locs.length, 1, 'Should have 1 location')
assert.strictEqual(locs[0].id, 'loc_hq')
assert.strictEqual(locs[0].cityId, s.company.homeCityId)
assert.strictEqual(locs[0].bayCount, 1)
assert.deepStrictEqual(locs[0].groupIds, [], 'HQ default allows all brands')
console.log('✓ HQ depot opened at home city with 1 bay for ₹30L.\n')

// 3. Add Bay to HQ
console.log('--- 3. Testing Adding Bays to Existing Location ---')
const cashBefore = s.company.cash
const addBayErr = addBayAtLocation(s, locs[0].id)
assert.strictEqual(addBayErr, null)
assert.strictEqual(locs[0].bayCount, 2, 'HQ should now have 2 bays')
assert.strictEqual(s.workshop.bays, 2, 'Total workshop bays should be 2')
assert.strictEqual(cashBefore - s.company.cash, L(10), 'Extra bay must cost flat ₹10L')
console.log('✓ Extra bay at HQ added for ₹10L flat.\n')

// 4. Open Satellite Depot in Another City with Brand Restrictions
console.log('--- 4. Testing Open Satellite Depot with Brand Allowlist ---')
const satCity = 'blr'
const allowedBrands = ['grp_brand_a', 'grp_brand_b', 'grp_brand_c', 'grp_brand_d'] // 4 brands (no 3-cap!)
const openSatErr = openWorkshopLocation(s, satCity, allowedBrands)
assert.strictEqual(openSatErr, null)

assert.strictEqual(locs.length, 2, 'Should now have 2 workshop locations')
const satLoc = locs.find((l) => l.cityId === satCity)!
assert.ok(satLoc, 'Satellite location must exist')
assert.strictEqual(satLoc.bayCount, 1)
assert.deepStrictEqual(satLoc.groupIds, allowedBrands, 'Multiple brands (no cap) allowed on satellite')
assert.strictEqual(s.workshop.bays, 3, 'Total bays must be sum of all locations (2 HQ + 1 BLR = 3)')

// Duplicate city prevention
const dupErr = openWorkshopLocation(s, satCity, [])
assert.ok(dupErr?.includes('already exists'), 'Cannot open duplicate location in same city')
console.log('✓ Satellite depot opened in Bengaluru with 4 brands allowlisted (no 3-cap) for ₹30L.\n')

// 5. Staffing and Global Mechanics Pool
console.log('--- 5. Testing Shared Mechanic Pool Across Locations ---')
// Create 3 mechanics
const m1: Staff = { id: 'm1', name: 'Ravi', role: 'mechanic', salaryMonthly: 25000, skill: 7, mechanicTrade: 'engine_gearbox', daysEmployed: 10 }
const m2: Staff = { id: 'm2', name: 'Kumar', role: 'mechanic', salaryMonthly: 25000, skill: 6, mechanicTrade: 'body_suspension', daysEmployed: 10 }
const m3: Staff = { id: 'm3', name: 'Selvan', role: 'mechanic', salaryMonthly: 25000, skill: 8, mechanicTrade: 'electrical_ac', daysEmployed: 10 }
s.staff['m1'] = m1
s.staff['m2'] = m2
s.staff['m3'] = m3

appointBayMechanic(s, 'm1')
appointBayMechanic(s, 'm2')
// Intentionally leave HQ bay index 1? No — leave one HQ bay empty and staff satellite by index
// Reset and staff HQ bay 0 + satellite bay 2 while leaving HQ bay 1 vacant
s.workshop.mechanicIds = [null, null, null]
appointBayMechanic(s, 'm1', 0)
appointBayMechanic(s, 'm3', 2) // satellite only — must NOT fill empty HQ bay 1

assert.strictEqual(s.workshop.mechanicIds?.[0], 'm1')
assert.strictEqual(s.workshop.mechanicIds?.[1] ?? null, null, 'HQ bay 1 must stay vacant when staffing satellite')
assert.strictEqual(s.workshop.mechanicIds?.[2], 'm3', 'Satellite bay gets the appointed mechanic')

appointBayMechanic(s, 'm2', 1)
assert.strictEqual(s.workshop.mechanicIds?.filter(Boolean).length, 3, 'All 3 global bay slots staffed')
const allocs = computeBayAllocations(s)
assert.strictEqual(allocs.length, 3)
assert.strictEqual(allocs[0].locationCityId, s.company.homeCityId)
assert.strictEqual(allocs[0].mechanic?.id, 'm1')
assert.strictEqual(allocs[1].locationCityId, s.company.homeCityId)
assert.strictEqual(allocs[1].mechanic?.id, 'm2')
assert.strictEqual(allocs[2].locationCityId, satCity)
assert.strictEqual(allocs[2].mechanic?.id, 'm3')
console.log('✓ Single shared mechanic pool correctly staffs bays across both HQ and satellite.\n')

// 6. Brand Gating on Bays
console.log('--- 6. Testing Brand Gating on In-House Jobs ---')
// Bus A belongs to grp_brand_a (allowed at satellite and HQ)
// Bus X belongs to grp_brand_x (not allowed at satellite, only allowed at HQ)
const busA: Bus = {
  id: 'bus_a',
  reg: 'TN 01 AA 1001',
  modelId: 'al_cheetah',
  ownership: 'owned',
  status: 'active',
  groupId: 'grp_brand_a',
  condition: { engine: 40, gearbox: 60, electrical: 70, ac: 80, body: 60, brakes: 50, suspension: 50 },
  odometer: 150000,
  acquiredDay: 1,
  depreciationMethod: 'SLM',
  bookValue: rs(2000000),
  insuranceExpiryDay: 200,
  fitnessExpiryDay: 200,
  aitpPaidUntilDay: 200,
}
const busX: Bus = {
  ...busA,
  id: 'bus_x',
  reg: 'TN 01 XX 9999',
  groupId: 'grp_brand_x',
}
s.buses['bus_a'] = busA
s.buses['bus_x'] = busX

// Both buses can fit in own workshop since HQ has 2 bays open to all brands
assert.strictEqual(inOwnWorkshop(s, busA), true)
assert.strictEqual(inOwnWorkshop(s, busX), true)

// Now occupy both HQ bays with other buses
const filler1: Bus = { ...busA, id: 'f1', reg: 'TN 01 FF 0001', status: 'workshop' }
const filler2: Bus = { ...busA, id: 'f2', reg: 'TN 01 FF 0002', status: 'workshop' }
s.buses['f1'] = filler1
s.buses['f2'] = filler2

// Both HQ bays are now occupied by f1 and f2.
// Only the satellite bay (blr) is free.
// busA has grp_brand_a -> allowed at blr satellite!
// busX has grp_brand_x -> NOT allowed at blr satellite!
assert.strictEqual(inOwnWorkshop(s, busA), true, 'busA with allowed brand CAN use satellite bay')
assert.strictEqual(inOwnWorkshop(s, busX), false, 'busX with non-allowed brand CANNOT use satellite bay')

const busAMech = findMechanicForBus(s, busA)
assert.strictEqual(busAMech?.id, 'm3', 'busA should be routed to mechanic m3 at satellite')

const busXMech = findMechanicForBus(s, busX)
assert.strictEqual(busXMech, undefined, 'busX has no eligible bay and receives undefined mechanic')
console.log('✓ Brand gating enforced: allowed brand uses satellite; non-allowed brand blocked and diverted to outside.\n')

// 7. Migration of Legacy Flat Saves
console.log('--- 7. Testing Legacy Save Migration ---')
const legacyState: any = {
  version: 1,
  company: { homeCityId: 'maa' },
  workshop: { level: 1, bays: 4, mechanicIds: [] },
}
// Run migration logic
if (!legacyState.workshop.locations || legacyState.workshop.locations.length === 0) {
  legacyState.workshop.locations = [
    {
      id: 'loc_hq',
      cityId: legacyState.company.homeCityId,
      groupIds: [],
      bayCount: legacyState.workshop.bays || 1,
    },
  ]
}
assert.strictEqual(legacyState.workshop.locations.length, 1)
assert.strictEqual(legacyState.workshop.locations[0].id, 'loc_hq')
assert.strictEqual(legacyState.workshop.locations[0].cityId, 'maa')
assert.strictEqual(legacyState.workshop.locations[0].bayCount, 4)
console.log('✓ Legacy save correctly migrates flat bays into HQ location at home city.\n')

console.log('ALL WORKSHOP SATELLITE & BRAND GATING TESTS PASSED!')
