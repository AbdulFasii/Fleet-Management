import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { computeFleetHealth, computeCrewWelfare, healthBreakdownMult, welfareDelayMult, welfarePssPenalty, dailyHealthPass } from '../src/engine/sim/health'
import { mechanicSkillMult } from '../src/engine/sim/maintenance'
import type { Bus, Staff } from '../src/engine/types'

const s = newGame('health', 'malik', 'maa-cbe', 11)

// No fleet and no crew: nothing is wrong
assert.equal(computeFleetHealth(s), 100)
assert.equal(computeCrewWelfare(s), 100)
assert.equal(healthBreakdownMult(s), 1)

// A worn-out coach drags fleet health down and raises breakdown risk
const bus = {
  id: 'b1', reg: 'X', status: 'active', ownership: 'owned', modelId: 'urbania10',
  condition: { engine: 30, gearbox: 30, suspension: 80, brakes: 80, body: 80, electrical: 80, ac: 80 },
  odometer: 0, lastServiceOdo: 0, insuranceExpiryDay: s.day + 100, fitnessExpiryDay: s.day + 100,
} as unknown as Bus
s.buses['b1'] = bus
dailyHealthPass(s)
assert.ok((s.company.fleetHealth ?? 100) < 60, 'worn engine and gearbox lower the score')
assert.ok(healthBreakdownMult(s) > 1 && healthBreakdownMult(s) <= 1.25, 'poor health raises breakdown risk, capped')

// Lapsed papers cost more
const before = computeFleetHealth(s)
bus.insuranceExpiryDay = s.day - 1
assert.ok(computeFleetHealth(s) < before, 'expired insurance lowers health')

// Unhappy, tired crew lowers welfare, adds delay and costs passenger satisfaction
const crew = { id: 'd1', role: 'driver', morale: 20, fatigue: 90 } as unknown as Staff
s.staff['d1'] = crew
dailyHealthPass(s)
assert.ok((s.company.crewWelfare ?? 100) < 40)
assert.ok(welfareDelayMult(s) > 1.1 && welfarePssPenalty(s) > 0.1)
crew.morale = 90
crew.fatigue = 10
dailyHealthPass(s)
assert.equal(welfareDelayMult(s), 1)
assert.equal(welfarePssPenalty(s), 0)

// Mechanic skill: better mechanics are faster and cheaper, bounded
assert.ok(mechanicSkillMult({ skill: 10 } as Staff).daysMult < mechanicSkillMult({ skill: 5 } as Staff).daysMult)
assert.ok(mechanicSkillMult({ skill: 10 } as Staff).costMult < 1)
assert.ok(mechanicSkillMult({ skill: 1 } as Staff).costMult > 1)
assert.equal(mechanicSkillMult(undefined).costMult, 1)

// The daily tick keeps the numbers fresh
delete s.buses['b1']
delete s.staff['d1']
advanceDay(s)
assert.equal(s.company.fleetHealth, 100)
console.log('ALL HEALTH TESTS PASSED ✓')
