import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { buyFuelHedge, dailyHedgePass, monthlyHedgePass, quoteFuelHedge } from '../src/engine/sim/hedge'
import { rs } from '../src/engine/core/money'

const s = newGame('hedge', 'malik', 'maa-cbe', 61)
s.company.cash = rs(50_000_000)
s.world.dieselPaise = rs(90)

// Quote: strike is 3% over the pump price, premium 1% of the notional
const q = quoteFuelHedge(s, 6, 25_000)
assert.equal(q.strikePaise, Math.round(rs(90) * 1.03))
assert.equal(q.premium, Math.round(q.notional / 100))

// Buy: premium leaves cash, contract is stored, a second hedge is refused
const cash0 = s.company.cash
assert.equal(buyFuelHedge(s, 6, 25_000), null)
assert.equal(cash0 - s.company.cash, q.premium)
assert.equal(s.company.fuelHedge?.strikePaise, q.strikePaise)
assert.match(buyFuelHedge(s, 3, 10_000) ?? '', /already running/)
assert.match(buyFuelHedge(newGame('x', 'malik', 'maa-cbe', 1), 5, 10_000) ?? '', /3, 6 or 12/)

// Diesel spikes: the month pays out
s.world.dieselPaise = rs(110)
for (let i = 0; i < 30; i++) dailyHedgePass(s)
const cash1 = s.company.cash
monthlyHedgePass(s)
const gain = Math.round((rs(110) - q.strikePaise) * 25_000)
assert.equal(s.company.cash - cash1, gain, 'payout = (average - locked) x litres')
assert.equal(s.company.fuelHedge?.days, 0, 'month counters reset')

// Diesel falls: the month costs money
s.world.dieselPaise = rs(80)
for (let i = 0; i < 30; i++) dailyHedgePass(s)
const cash2 = s.company.cash
monthlyHedgePass(s)
assert.equal(cash2 - s.company.cash, Math.round((q.strikePaise - rs(80)) * 25_000), 'a loss is paid out of cash')

// The contract closes when its term ends
s.day = s.company.fuelHedge!.untilDay
for (let i = 0; i < 30; i++) dailyHedgePass(s)
monthlyHedgePass(s)
assert.equal(s.company.fuelHedge, undefined, 'finished contracts are removed')

console.log('ALL HEDGE TESTS PASSED ✓')
