/**
 * A cargo manager on the desk answers spot offers themselves — the player must
 * never be asked to approve a load they already pay someone to book.
 *
 *   - offers generated while a manager is appointed are queued with no decision
 *   - a decision left over from before the appointment is withdrawn on the next
 *     daily pass, and the offer is queued
 *   - appointing a manager absorbs a waiting offer immediately
 *   - expired loads are withdrawn without being queued
 *
 *   npx tsx scripts/test-cargo-manager-automation.ts
 */
import { newGame } from '../src/engine/newGame'
import { appointCargoManager, cargoManagerOnDuty } from '../src/engine/sim/staffing'
import { acceptSpotCargoOffer, cargoAutoQueuePendingOffers, dailyCargoPass } from '../src/engine/sim/cargo'
import { pushDecision } from '../src/engine/sim/log'
import { rs } from '../src/engine/core/money'
import type { GameState, SpotCargoOffer } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

function setup(): GameState {
  const s = newGame('Cargo Desk', 'seth', 'mdu-maa', 5150)
  s.company.dedicatedCargoSubsidiary = true
  s.company.spotOffers = []
  s.decisions = []
  s.staff['cargo_mgr'] = {
    id: 'cargo_mgr',
    name: 'Ravi Desk',
    role: 'manager',
    salary: rs(35000 * 12),
    hiredDay: s.day,
    morale: 90,
    stamina: 100,
    skill: 8,
    loyalty: 90,
    experienceYears: 6,
    daysWithoutOff: 0,
    safety: 8,
  } as never
  return s
}

function offer(s: GameState, id: string, expiresDay: number, status: SpotCargoOffer['status'] = 'offered'): SpotCargoOffer {
  const o: SpotCargoOffer = {
    id,
    originCity: 'mdu',
    destCity: 'maa',
    routeId: 'mdu-maa',
    direction: 'AB',
    weightKg: 500,
    volumeCbm: 5.4,
    cargoType: 'mixed',
    fragile: false,
    totalPayment: rs(2875),
    offeredDay: s.day,
    expiresDay,
    status,
  }
  s.company.spotOffers!.push(o)
  return o
}

function decisionFor(s: GameState, offerId: string): void {
  pushDecision(s, {
    kind: 'spot_cargo',
    title: `Spot Cargo Offer: ${offerId}`,
    body: 'Shipper offering freight. Accept to queue it on the next departure that has room.',
    options: [
      { id: `accept_${offerId}`, label: 'Queue' },
      { id: 'decline', label: 'Decline' },
    ],
    data: { offerId },
  })
}

const spotDecisions = (s: GameState) => s.decisions.filter((d) => d.kind === 'spot_cargo')

console.log('--- Cargo manager answers spot offers, not the player ---')

// 1. Appointment absorbs a waiting offer immediately.
{
  const s = setup()
  const o = offer(s, 'o1', s.day + 2)
  decisionFor(s, o.id)
  check(spotDecisions(s).length === 1, 'offer is waiting on the player before the appointment')

  const err = appointCargoManager(s, 'cargo_mgr')
  check(err === null, 'cargo manager appointed')
  const mgr = cargoManagerOnDuty(s)
  if (!mgr) throw new Error('expected a manager on the desk')
  const taken = cargoAutoQueuePendingOffers(s, mgr.name)
  check(taken === 1, 'the waiting offer is taken over on appointment')
  check(spotDecisions(s).length === 0, 'the spot-cargo decision is withdrawn from the inbox')
  check(s.company.spotOffers!.find((x) => x.id === 'o1')!.status === 'queued', 'the offer is queued for dispatch')
  check(s.company.spotOffers!.find((x) => x.id === 'o1')!.remainingKg === 500, 'queued load keeps its full weight')
}

// 2. A leftover decision is cleared on the next daily pass, even without
//    re-appointing (manager already on the desk, e.g. loaded from a save).
{
  const s = setup()
  appointCargoManager(s, 'cargo_mgr')
  const o = offer(s, 'o2', s.day + 2)
  decisionFor(s, o.id)
  dailyCargoPass(s)
  check(spotDecisions(s).length === 0, 'daily pass clears the stale spot-cargo decision')
  check(s.company.spotOffers!.find((x) => x.id === 'o2')!.status !== 'offered', 'the waiting load is no longer "offered"')
}

// 3. With a manager on the desk, the daily pass never posts a new decision.
{
  const s = setup()
  appointCargoManager(s, 'cargo_mgr')
  for (let i = 0; i < 12; i++) {
    s.day++
    dailyCargoPass(s)
  }
  check(spotDecisions(s).length === 0, '12 daily passes with a manager post no spot-cargo decision')
  const offers = s.company.spotOffers ?? []
  check(
    offers.every((x) => x.status !== 'offered'),
    `every offer the manager generated was queued (${offers.length} offers)`,
  )
}

// 4. Expired loads are withdrawn, not queued.
{
  const s = setup()
  appointCargoManager(s, 'cargo_mgr')
  const o = offer(s, 'o4', s.day - 1)
  decisionFor(s, o.id)
  const mgr = cargoManagerOnDuty(s)!
  const taken = cargoAutoQueuePendingOffers(s, mgr.name)
  check(taken === 0, 'an expired offer is not queued')
  check(spotDecisions(s).length === 0, 'its decision is still cleared')
  check(s.company.spotOffers!.find((x) => x.id === 'o4')!.status === 'offered', 'expired load keeps its own status')
}

// 5. Without a manager the player is still asked (no regression).
{
  const s = setup()
  const o = offer(s, 'o5', s.day + 2)
  pushDecision(s, {
    kind: 'spot_cargo',
    title: 'Spot Cargo Offer',
    body: 'Shipper offering freight.',
    options: [
      { id: `accept_${o.id}`, label: 'Queue' },
      { id: 'decline', label: 'Decline' },
    ],
    data: { offerId: o.id },
  })
  check(cargoManagerOnDuty(s) === undefined, 'no manager on the desk')
  dailyCargoPass(s)
  check(spotDecisions(s).length === 0, 'without a manager, lingering spot cargo decision popups are cleared')
  for (let i = 0; i < 10; i++) {
    s.day++
    dailyCargoPass(s)
  }
  check(spotDecisions(s).length === 0, 'no spot cargo popups generated over 10 days without a manager')
}

console.log(failures === 0 ? '\n--- ALL CARGO DESK AUTOMATION CHECKS PASSED ---' : `\n--- ${failures} CARGO DESK CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
