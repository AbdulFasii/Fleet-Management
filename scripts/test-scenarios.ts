import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { bankruptcyCheck } from '../src/engine/sim/bankruptcy'
import { checkObjectives, empireTarget, OBJECTIVES } from '../src/engine/sim/objectives'
import { Cr } from '../src/engine/core/money'

const std = newGame('a', 'malik', 'maa-cbe', 5)
const box = newGame('b', 'malik', 'maa-cbe', 5, undefined, 'sandbox')
const iron = newGame('c', 'malik', 'maa-cbe', 5, undefined, 'ironman')
assert.equal(std.scenario, 'standard')
assert.equal(box.company.cash - std.company.cash, Cr(10))
assert.equal(empireTarget(std), Cr(100))
assert.equal(empireTarget(iron), Cr(150))

// sandbox never ends
box.company.cash = -Cr(50)
bankruptcyCheck(box)
assert.ok(!box.gameOver)

// sandbox gets no victory even with every goal done
for (const o of OBJECTIVES) box.objectives = { ...(box.objectives ?? {}), [o.id]: 1 }
checkObjectives(box)
assert.ok(!box.victory)
for (const o of OBJECTIVES) std.objectives = { ...(std.objectives ?? {}), [o.id]: 1 }
checkObjectives(std)
assert.ok(std.victory)
console.log('scenarios ok')
