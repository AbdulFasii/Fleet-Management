import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { L } from '../src/engine/core/money'
import {
  autoRefillThreshold,
  installDepotFuelTank,
  nextDepotTankUpgrade,
  tankerLoadsThatFit,
  upgradeDepotFuelTank,
} from '../src/engine/sim/depot'

const s = newGame('Tank', 'malik', 'maa-mdu', 5)
s.company.cash = L(500)

assert.match(upgradeDepotFuelTank(s) ?? '', /Install/, 'no upgrade before a tank exists')
assert.equal(installDepotFuelTank(s), null)
assert.equal(s.company.depotFuelTank!.capacityLitres, 10_000)

// The original 10,000 L tank behaves exactly as before.
assert.equal(autoRefillThreshold(10_000), 2_000, '10,000 L tank still refills at 2,000 L')
assert.equal(tankerLoadsThatFit(8_000), 8_000, 'and orders one 8,000 L load')

s.company.depotFuelTank!.litres = 6_000
const cash = s.company.cash
assert.equal(nextDepotTankUpgrade(s)?.capacityLitres, 20_000)
assert.equal(upgradeDepotFuelTank(s), null)
assert.equal(s.company.depotFuelTank!.capacityLitres, 20_000, 'tank grew')
assert.equal(s.company.depotFuelTank!.litres, 6_000, 'fuel already in it stays')
assert(s.company.cash < cash, 'upgrade costs money')

assert.equal(upgradeDepotFuelTank(s), null)
assert.equal(upgradeDepotFuelTank(s), null)
assert.equal(s.company.depotFuelTank!.capacityLitres, 50_000)
assert.equal(nextDepotTankUpgrade(s), undefined)
assert.match(upgradeDepotFuelTank(s) ?? '', /largest/, 'no upgrade past the largest size')

// Bigger tank: refills at 20% and orders as many whole loads as fit.
assert.equal(autoRefillThreshold(50_000), 10_000)
assert.equal(tankerLoadsThatFit(40_000), 40_000)
assert.equal(tankerLoadsThatFit(39_000), 32_000)

s.company.cash = -L(100_000_000)
s.company.depotFuelTank!.capacityLitres = 10_000
assert.match(upgradeDepotFuelTank(s) ?? '', /costs/, 'cannot upgrade without cash')
console.log('Depot tank upgrade checks passed.')
