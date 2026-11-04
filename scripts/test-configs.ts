import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { quoteInsurance } from '../src/engine/sim/maintenance'
import { monthlyStaffPass } from '../src/engine/sim/staffing'
import { rs } from '../src/engine/core/money'
import type { Bus, Staff } from '../src/engine/types'

const s = newGame('configs', 'malik', 'maa-cbe', 31)
s.company.cash = rs(50_000_000)

// Insurance tier moves the premium
const bus = { id: 'b1', modelId: 'urbania10', bookValue: rs(2_500_000), insurancePremiumMult: 1 } as unknown as Bus
s.config.insuranceTier = 'basic'
const basic = quoteInsurance(s, bus)
s.config.insuranceTier = 'standard'
const standard = quoteInsurance(s, bus)
s.config.insuranceTier = 'comprehensive'
const comprehensive = quoteInsurance(s, bus)
assert.ok(basic < standard && standard < comprehensive, `premiums should rise with cover: ${basic} < ${standard} < ${comprehensive}`)

// Training budget buys courses for the least skilled crew, and costs money
const mk = (id: string, skill: number): Staff => ({ id, name: id, role: 'driver', skill, salary: 20_000, morale: 60, fatigue: 0, loyalty: 50, hiredDay: s.day } as unknown as Staff)
s.staff = { a: mk('a', 3), b: mk('b', 4), c: mk('c', 8) }
s.config.trainingBudgetPerMonth = rs(50_000)
const cash0 = s.company.cash
monthlyStaffPass(s)
assert.equal(s.staff.a!.skill, 4, 'lowest-skilled crew trained first')
assert.equal(s.staff.b!.skill, 5, 'second course goes to the next one')
assert.equal(s.staff.c!.skill, 8, 'no budget left for the third')
assert.ok(s.company.cash < cash0, 'training is a real cost')

// No budget, no training
s.config.trainingBudgetPerMonth = 0
const before = s.staff.a!.skill
monthlyStaffPass(s)
assert.equal(s.staff.a!.skill, before)

console.log('ALL CONFIG TESTS PASSED ✓')
