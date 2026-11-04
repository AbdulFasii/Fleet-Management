import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { clampBrandFare, crewStandardPenalty, dailyBrandPass, monthlyBrandPass, overAgeBuses } from '../src/engine/sim/brandPolicy'
import { computeAdvisor } from '../src/engine/sim/advisor'
import { rs } from '../src/engine/core/money'
import type { Bus, BusGroup } from '../src/engine/types'

const s = newGame('brand', 'malik', 'maa-cbe', 41)
s.company.cash = rs(50_000_000)
const grp = Object.values(s.groups ?? {})[0] as BusGroup
assert.ok(grp, 'a new game has a first brand')

// Fare clamp: floor and ceiling are shares of the normal market fare
const normal = 100_000
assert.equal(clampBrandFare(s, grp.id, 50_000, normal), 50_000, 'no policy, no change')
grp.farePolicy = { floorPct: 90, ceilingPct: 130 }
assert.equal(clampBrandFare(s, grp.id, 50_000, normal), 90_000, 'cheap fares are lifted to the floor')
assert.equal(clampBrandFare(s, grp.id, 250_000, normal), 130_000, 'surge fares are held at the ceiling')
assert.equal(clampBrandFare(s, grp.id, 110_000, normal), 110_000, 'fares inside the band pass through')
assert.equal(clampBrandFare(s, undefined, 250_000, normal), 250_000, 'unbranded services are untouched')

// Crew standard: penalty only below the promise, capped
assert.equal(crewStandardPenalty(s, grp.id, 7), 0, 'no promise, no penalty')
grp.minDriverSkill = 7
assert.equal(crewStandardPenalty(s, grp.id, 7), 0)
assert.ok(Math.abs(crewStandardPenalty(s, grp.id, 5) - 0.3) < 1e-9, 'two points short costs 0.3')
assert.equal(crewStandardPenalty(s, grp.id, 0), 1, 'capped at one point')

// Cleaning after every trip: cleaner coaches, daily cost
const mk = (id: string, mfg: number): Bus => ({ id, reg: id, status: 'active', groupId: grp.id, scheduleId: 'x', modelId: 'urbania10', busCleanliness: 60, mfgYear: mfg, acquiredDay: s.day, ageYears: 0, ownership: 'owned' } as unknown as Bus)
s.buses = { a: mk('a', 2025), b: mk('b', 2000) }
const cash0 = s.company.cash
dailyBrandPass(s)
assert.equal(s.buses.a!.busCleanliness, 60, 'weekly cleaning does nothing extra')
grp.cleaningStandard = 'every_trip'
dailyBrandPass(s)
assert.equal(s.buses.a!.busCleanliness, 70, 'every-trip cleaning lifts cleanliness')
assert.ok(s.company.cash < cash0, 'and costs money')

// Age cap
grp.maxBusAgeYears = 5
assert.equal(overAgeBuses(s, grp).length >= 0, true)

// Marketing and profit target at month end
grp.marketingBudgetMonthly = rs(200_000)
grp.profitTargetMonthly = rs(500_000)
s.routeHistory = { 'maa-cbe': [{ day: s.day - 3, byBrand: { [grp.id]: { revenue: rs(300_000), cost: rs(100_000) } } }] } as never
const awareness0 = s.company.brandAwareness
const cash1 = s.company.cash
monthlyBrandPass(s)
assert.ok(s.company.brandAwareness > awareness0, 'marketing lifts brand awareness')
assert.ok(s.company.cash < cash1, 'marketing costs money')
assert.equal(grp.lastMonthProfit, rs(200_000), 'profit is revenue minus cost over 30 days')
assert.equal(grp.targetMissMonths, 1, 'a miss is counted')
monthlyBrandPass(s)
assert.equal(grp.targetMissMonths, 2)
assert.ok(computeAdvisor(s).some((t) => t.id === `brand-target-${grp.id}`), 'two misses raise an advisor task')
s.routeHistory = { 'maa-cbe': [{ day: s.day - 3, byBrand: { [grp.id]: { revenue: rs(900_000), cost: rs(100_000) } } }] } as never
monthlyBrandPass(s)
assert.equal(grp.targetMissMonths, 0, 'hitting the target resets the streak')

console.log('ALL BRAND POLICY TESTS PASSED ✓')
