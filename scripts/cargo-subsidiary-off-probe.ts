/**
 * Subsidiary off: no contracts at all, only coach parcel spots that ride in the belly.
 *   npx tsx scripts/cargo-subsidiary-off-probe.ts
 */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { ROUTES } from '../src/engine/data/routes'
import {
  allocateCargoForTrip,
  cargoLegLabel,
  dailyCargoPass,
  getAvailableContracts,
  makeCorridorCargoPool,
  openCargoPermit,
  signCargoContract,
  suspendCargoContracts,
} from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Staff } from '../src/engine/types'

const s = newGame('Subsidiary off', 'seth', 'mdu-maa', 42)
s.company.dedicatedCargoSubsidiary = false

const mgr: Staff = {
  id: 'mgr1', name: 'Biju Sen', role: 'manager', skill: 8, experienceYears: 6,
  salary: 3500000, loyalty: 80, morale: 80, fatigue: 10, safety: 7, hiredDay: s.day,
}
s.staff[mgr.id] = mgr
assert.equal(appointCargoManager(s, mgr.id), null)

for (const routeId of ['mdu-maa', 'maa-mdu', 'maa-pdy']) {
  s.permits[routeId] = {
    routeId, status: 'active', appliedDay: s.day, activeFromDay: s.day, expiryDay: s.day + 400,
  }
}
// The goods licence is what invites contracts; buy it now so the toggle below matters.
// One licence covers both directions, so the mdu-maa / maa-mdu alias needs only one.
for (const routeId of ['mdu-maa', 'maa-pdy']) {
  assert.equal(openCargoPermit(s, routeId), null, `cargo licence on ${routeId}`)
}

assert.equal(getAvailableContracts(s).length, 0, 'subsidiary off should offer no contracts at all')
assert.ok(
  signCargoContract(s, {
    partner: 'Delhivery',
    routeId: 'mdu-maa',
    direction: 'AB',
    laneKey: 'mdu>maa',
    offerKey: 'probe|mdu-maa|AB|0|1',
    lot: 1,
    durationDays: 30,
    ratePerKg100Km: 2.3,
    guaranteedKgPerDay: 200,
  }),
  'signing a contract with the subsidiary off must be refused',
)

for (let i = 0; i < 12; i++) {
  advanceDay(s)
  assert(!s.gameOver, s.gameOver?.reason ?? 'game over')
}

const live = (s.company.cargoContracts ?? []).filter((c) => c.active)
assert.equal(live.length, 0, `subsidiary off should keep no live contracts, found ${live.length}`)

const spots = (s.company.spotOffers ?? []).filter((o) => (o.status ?? 'offered') !== 'expired')
assert(spots.length > 0, 'the parcel desk should still see spot offers')
const heaviest = Math.max(...spots.map((o) => o.weightKg))
assert(heaviest <= 350, `coach spots should stay parcel-sized, heaviest was ${heaviest} kg`)
assert(spots.every((o) => o.direction), 'every spot should name a direction')

// A coach departure draws only parcel spots, never bulk.
const target = spots.find((o) => (o.status ?? 'offered') === 'queued') ?? spots[0]!
target.status = 'queued'
const tRoute = ROUTES[target.routeId]!
const dir = target.direction ?? 'AB'
const pool = makeCorridorCargoPool(s, tRoute, dir, [
  { tripId: 'coach1', routeId: tRoute.id, capKg: 900, depHour: 21, depMin: 0, isCargo: false },
])
const alloc = allocateCargoForTrip(s, pool, tRoute, 'coach1', 900, false)
assert(alloc.kg <= 900, 'a coach belly cannot take more than its bay')
assert(alloc.spotKg + alloc.walkupKg === alloc.kg, 'coach freight is spots and walk-up only')
assert.equal(alloc.contractKg, 0, 'no contract kilograms without a subsidiary')
assert(alloc.spotKg > 0, 'a queued coach spot should load into the belly')

console.log(
  `✓ subsidiary off · 0 contracts · ${spots.length} coach spots (max ${heaviest} kg) · ` +
  `${cargoLegLabel(tRoute, dir)} coach loaded ${alloc.kg} kg ` +
  `(spot ${alloc.spotKg} kg, walk-up ${alloc.walkupKg} kg)`,
)

// Turning the subsidiary off must end whatever the desk had signed.
s.company.dedicatedCargoSubsidiary = true
const proposals = getAvailableContracts(s)
assert(proposals.length > 0, 'subsidiary on should offer contracts')
for (const p of proposals.slice(0, 3)) assert.equal(signCargoContract(s, p), null)
const signed = (s.company.cargoContracts ?? []).filter((c) => c.active)
assert(signed.length > 0, 'contracts should sign while the subsidiary is on')

s.company.dedicatedCargoSubsidiary = false
const ended = suspendCargoContracts(s)
assert.equal(ended, signed.length, `turning the subsidiary off should end all ${signed.length} contracts`)
const penaltyBefore = s.curMonth.expense.penalty ?? 0
dailyCargoPass(s)
advanceDay(s)
assert.equal((s.company.cargoContracts ?? []).filter((c) => c.active).length, 0, 'no contracts come back while off')
assert.equal(getAvailableContracts(s).length, 0, 'no new proposals while off')
assert(
  (s.curMonth.expense.penalty ?? 0) <= penaltyBefore,
  'ended contracts must not bill a shortfall for freight they no longer promised',
)
console.log(`✓ toggle off ends ${ended} live contracts with no shortfall billed`)
