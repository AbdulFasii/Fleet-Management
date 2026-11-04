import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { dailyRouteLifePass, routeLifeMult, startRouteLife, routeMaturity } from '../src/engine/sim/routeLife'
import type { Schedule } from '../src/engine/types'

const s = newGame('life', 'malik', 'maa-mdu', 51)
const route = 'maa-mdu'
const sch = (id: string, active: boolean) => ({ id, routeId: route, active } as unknown as Schedule)

// A route nobody serves is untracked and costs nothing
s.schedules = {}
s.routeMaturity = {}
assert.equal(routeLifeMult(s, route), 1)

// A brand-new service starts at 60% of normal demand
startRouteLife(s, route)
assert.equal(routeMaturity(s, route), 0)
assert.ok(Math.abs(routeLifeMult(s, route) - 0.6) < 1e-9)

// 45 days of service: halfway there; 90 days: fully mature
s.schedules = { a: sch('a', true) }
for (let i = 0; i < 45; i++) dailyRouteLifePass(s)
assert.ok(Math.abs(routeMaturity(s, route)! - 50) < 0.001)
assert.ok(Math.abs(routeLifeMult(s, route) - 0.8) < 1e-6)
for (let i = 0; i < 60; i++) dailyRouteLifePass(s)
assert.equal(routeMaturity(s, route), 100)
assert.equal(routeLifeMult(s, route), 1)

// Stop serving it: maturity decays half a point a day
s.schedules = { a: sch('a', false) }
for (let i = 0; i < 20; i++) dailyRouteLifePass(s)
assert.equal(routeMaturity(s, route), 90)

// A second service on a running route does not reset it
s.schedules = { a: sch('a', true) }
startRouteLife(s, route)
assert.equal(routeMaturity(s, route), 90)

// Routes that were already running before the feature existed start fully mature
const old = newGame('old', 'malik', 'maa-mdu', 52)
old.routeMaturity = undefined
old.schedules = { a: sch('a', true) }
dailyRouteLifePass(old)
assert.equal(routeMaturity(old, route), 100)

// The switch turns it all off
s.config.routeLifeCycle = false
assert.equal(routeLifeMult(s, route), 1)

console.log('ALL ROUTE LIFE TESTS PASSED ✓')
