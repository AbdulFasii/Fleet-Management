import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { applyDecision } from '../src/engine/sim/events'
import { careerInfo, careerRank, monthlyCareerPass, poachChanceMult, rankSafetyBonus } from '../src/engine/sim/careers'
import type { Staff } from '../src/engine/types'

const s = newGame('careers', 'malik', 'maa-cbe', 71)
const drv = (over: Partial<Staff> = {}): Staff => ({ id: 'd1', name: 'Raju', role: 'driver', skill: 5, salary: 30_000, loyalty: 70, morale: 70, fatigue: 0, safety: 6, hiredDay: s.day, tripsDriven: 0, safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 }, ...over } as unknown as Staff)

// Rank thresholds
assert.equal(careerRank(drv({ tripsDriven: 149 })), 0)
assert.equal(careerRank(drv({ tripsDriven: 150 })), 1)
assert.equal(careerRank(drv({ tripsDriven: 1000, skill: 5 })), 1, 'Senior needs skill 6')
assert.equal(careerRank(drv({ tripsDriven: 1000, skill: 6 })), 2)
assert.equal(careerRank(drv({ tripsDriven: 3000, skill: 8 })), 3)
assert.equal(careerRank(drv({ tripsDriven: 3000, skill: 8, safetyRecord: { accidents: 1, hardBrakes: 0, violations: 0 } })), 2, 'an accident keeps a driver from Master')
assert.equal(careerRank({ ...drv({ tripsDriven: 5000, skill: 9 }), role: 'mechanic' } as Staff), 0, 'only drivers have a career')
assert.match(careerInfo(drv({ tripsDriven: 40 })).next ?? '', /110 more trips/)
assert.equal(careerInfo(drv({ tripsDriven: 3000, skill: 8 })).next, undefined)

// Higher ranks drive safer
assert.equal(rankSafetyBonus(drv()), 0)
assert.equal(rankSafetyBonus(drv({ tripsDriven: 1000, skill: 6 })), 0.5)
assert.equal(rankSafetyBonus(drv({ tripsDriven: 3000, skill: 8 })), 1)

// Rival offers: unhappy drivers and Masters draw more
assert.equal(poachChanceMult(drv({ loyalty: 80 })), 1)
assert.ok(poachChanceMult(drv({ loyalty: 0 })) > 2.9)
assert.equal(poachChanceMult(drv({ loyalty: 80, tripsDriven: 3000, skill: 8 })), 1.5)

// Existing drivers start at their earned rank without any fuss
const vet = drv({ tripsDriven: 1200, skill: 7 })
s.staff = { d1: vet }
monthlyCareerPass(s)
assert.equal(vet.careerRank, 2)
assert.equal(s.decisions.length, 0, 'no promotion offer for a rank already held')

// Earn Master: the player is asked
vet.tripsDriven = 3100
vet.skill = 8
monthlyCareerPass(s)
const dec = s.decisions.find((d) => d.kind === 'promotion')
assert.ok(dec, 'a promotion decision is raised')
const pay0 = vet.salary
assert.equal(applyDecision(s, dec!.id, 'promote'), null)
assert.equal(vet.salary, Math.round(pay0 * 1.1), 'promotion carries a 10% raise')
assert.equal(vet.careerRank, 3)

// Declining stings
const other = drv({ id: 'd2', name: 'Mani', tripsDriven: 160 })
other.careerRank = 0
s.staff.d2 = other
monthlyCareerPass(s)
const dec2 = s.decisions.find((d) => d.kind === 'promotion')!
const loyal0 = other.loyalty
applyDecision(s, dec2.id, 'later')
assert.equal(other.loyalty, loyal0 - 6)

// With HR auto-raise on, promotions simply happen
const auto = newGame('auto', 'malik', 'maa-cbe', 72)
const hr = { id: 'hr1', name: 'HR', role: 'manager', skill: 6, salary: 40_000, loyalty: 80, morale: 80, fatigue: 0 } as unknown as Staff
const d3 = drv({ id: 'd3', tripsDriven: 200 })
d3.careerRank = 0
auto.staff = { hr1: hr, d3 }
auto.company.hrId = 'hr1'
auto.company.hrAutoRaise = true
monthlyCareerPass(auto)
assert.equal(auto.decisions.length, 0, 'no question when HR handles it')
assert.equal(d3.careerRank, 1)
assert.ok(d3.salary > 30_000, 'and the raise is paid')

console.log('ALL CAREER TESTS PASSED ✓')
