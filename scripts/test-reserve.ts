import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { buyUsed } from '../src/engine/sim/fleet'
import { rs } from '../src/engine/core/money'

const s = newGame('reserve', 'malik', 'maa-cbe', 21)
s.config.emergencyReserveBuffer = rs(10_000_000)
s.company.cash = rs(12_000_000)
s.usedMarket = [{ id: 'u1', reg: 'TN01 AA 0001', modelId: 'urbania10', ageYears: 3, odometer: 1000, askPrice: rs(3_000_000), condition: { engine: 80, gearbox: 80, suspension: 80, brakes: 80, body: 80, electrical: 80, ac: 80 }, accidentHistory: 0, inspected: false } as never]
const err = buyUsed(s, 'u1', {})
assert.match(err ?? '', /cash reserve/, 'a cash purchase that dips below the reserve is refused')
assert.equal(s.usedMarket.length, 1, 'listing stays on the market')
s.config.emergencyReserveBuffer = rs(100_000)
assert.equal(buyUsed(s, 'u1', {}), null, 'allowed once the purchase leaves the reserve intact')
console.log('ALL RESERVE TESTS PASSED ✓')
