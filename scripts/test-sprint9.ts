import { newGame } from '../src/engine/newGame'
import { RIVALS_DATA } from '../src/engine/data/rivals'
import { DISTRESS_EVENTS } from '../src/engine/sim/eventsDistress'
import { dailyRivalPass } from '../src/engine/sim/rivals'
import { tripLoadFactor } from '../src/engine/sim/demand'
import { retainDay } from '../src/engine/sim/retain'
import { rs } from '../src/engine/core/money'
import type { Decision, Trip, Bus, Schedule } from '../src/engine/types'

console.log('--- Testing Sprint 9 Realism: Named Rivals, Market Share Drift & Rival Exit ---')

// Check 1: 8 Named Rivals and route share initialization
console.log('\n[Check 1] 8 Named rivals & route share initialization...')
const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)

const expectedRivalIds = ['vrl', 'srs', 'kallada', 'ksrtc', 'intrabus', 'shree', 'kpn', 'orange']
for (const id of expectedRivalIds) {
  if (!s.world.rivals?.[id]) {
    console.error(`FAIL: Missing rival ${id} in world.rivals`)
    process.exit(1)
  }
}
console.log(`✓ All 8 named rivals initialized with live stats (e.g. VRL comfort: ${s.world.rivals['vrl'].comfort}, KSRTC: ${s.world.rivals['ksrtc'].name})`)

const blrMaaShare = s.world.share?.['blr-maa']
if (blrMaaShare && blrMaaShare.player > 0 && Object.keys(blrMaaShare.byRival).length >= 3) {
  const sum = blrMaaShare.player + Object.values(blrMaaShare.byRival).reduce((a, b) => a + b, 0)
  console.log(`✓ blr-maa corridor shares initialized: Player: ${blrMaaShare.player}%, Rivals: ${JSON.stringify(blrMaaShare.byRival)} (Sum: ${sum}%)`)
  if (sum !== 100) {
    console.error(`FAIL: Initial corridor shares do not sum to 100% (got ${sum}%)`)
    process.exit(1)
  }
} else {
  console.error('FAIL: blr-maa route share not properly initialized')
  process.exit(1)
}

// Check 2: Distress lot event disabled
console.log('\n[Check 2] Distress lot multi-bus buyout disabled...')
const distressLotDef = DISTRESS_EVENTS.find((e) => e.id === 'distress_lot')
if (distressLotDef && !distressLotDef.canFire(s)) {
  console.log('✓ distress_lot.canFire returns false (new game will never roll multi-bus distress lot buyouts)')
} else {
  console.error('FAIL: distress_lot is still able to fire!')
  process.exit(1)
}

// Check 3: Daily rival drift on active corridor
console.log('\n[Check 3] Daily rival share drift & history...')
const initialPlayerShare = s.world.share['blr-maa'].player

// Run 5 daily rival passes
for (let d = 1; d <= 5; d++) {
  s.day += 1
  dailyRivalPass(s, () => 0.5)
}

const driftedShare = s.world.share['blr-maa'].player
const sumAfterDrift = driftedShare + Object.values(s.world.share['blr-maa'].byRival).reduce((a, b) => a + b, 0)
console.log(`✓ After 5 days drift, player share moved from ${initialPlayerShare}% to ${driftedShare}% (corridor total: ${sumAfterDrift}%)`)
if (sumAfterDrift !== 100) {
  console.error('FAIL: Shares did not renormalize to 100 after drift!')
  process.exit(1)
}

const historyLen = s.world.shareHistory?.['blr-maa']?.length ?? 0
console.log(`✓ Recorded ${historyLen} history entries in world.shareHistory['blr-maa']`)
if (historyLen !== 5) {
  console.error(`FAIL: Expected 5 history entries, got: ${historyLen}`)
  process.exit(1)
}

// Check 4: Share history cap 180 entries
console.log('\n[Check 4] Share history cap 180 days in retainDay...')
s.world.shareHistory['blr-maa'] = Array.from({ length: 220 }, (_, i) => ({ day: s.day - 220 + i, player: 25 }))
retainDay(s)
const cappedLen = s.world.shareHistory['blr-maa'].length
if (cappedLen === 180) {
  console.log(`✓ shareHistory correctly capped to 180 entries (was 220, now ${cappedLen})`)
} else {
  console.error(`FAIL: Expected 180 entries after retainDay, got: ${cappedLen}`)
  process.exit(1)
}

// Check 5: Demand scaling with market share
console.log('\n[Check 5] Demand scales with market share (playerShare / 25)...')
const testBus: Bus = {
  id: 'b_demand',
  reg: 'KA-01-EQ-5555',
  nickname: 'Demand Bus',
  modelId: 'cheetah',
  ownership: 'owned',
  mfgYear: 2022,
  acquiredDay: s.day,
  acquiredPrice: rs(3_000_000),
  bookValue: rs(3_000_000),
  odometer: 10_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
  tyreKm: 10_000,
  tyresRetreaded: false,
  frontTyreKm: 10_000,
  rearTyreKm: 10_000,
  frontBrand: 'oem',
  rearBrand: 'oem',
  tyreCount: 6,
  lastServiceOdo: 0,
  insuranceExpiryDay: s.day + 365,
  fitnessExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 180,
  gpsDeviceFitted: true,
  roadTaxPayableDay: s.day + 365,
  aitpPaidUntilDay: s.day + 365,
  status: 'active',
  duty: 'line',
  accidentHistory: false,
  busCleanliness: 90,
  lifeRevenue: 0,
  lifeCost: 0,
  lifeTrips: 0,
  qualityScore: 4.5,
}
s.buses['b_demand'] = testBus

const testSch: Schedule = {
  id: 'sch_dem',
  routeId: 'blr-maa',
  busIds: ['b_demand'],
  depHour: 21,
  baseFare: rs(800),
  autoPrice: false,
  boardingPoints: 3,
  cancellation: 'standard',
  channels: { redbus: true, abhibus: true, ownapp: true, counter: true },
  redDeal: false,
  active: true,
  createdDay: s.day,
  occRecent: [],
}
s.schedules['sch_dem'] = testSch

const testTrip: Trip = {
  id: 'tr_dem',
  scheduleId: 'sch_dem',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: 'b_demand',
  day: s.day,
  depHour: 21,
  fare: rs(800),
  seats: [],
  seatCount: 36,
  sold: 0,
  revenue: 0,
  cancelledRevenue: 0,
  channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
  status: 'open',
}

s.world.share['blr-maa'].player = 10
const lfLowShare = tripLoadFactor(s, testTrip, 0).target

s.world.share['blr-maa'].player = 35
const lfHighShare = tripLoadFactor(s, testTrip, 0).target

console.log(`LF at 10% share: ${(lfLowShare * 100).toFixed(1)}%`)
console.log(`LF at 35% share: ${(lfHighShare * 100).toFixed(1)}%`)

if (lfHighShare > lfLowShare * 1.3) {
  console.log('✓ Demand target load factor scales directly with corridor market share')
} else {
  console.error(`FAIL: Expected high share LF (${lfHighShare}) to be substantially higher than low share LF (${lfLowShare})`)
  process.exit(1)
}

// Check 6: competitor dissolve / exit buyout mechanism removed
console.log('\n[Check 6] rival exit buyout removed verification...')
s.decisions = []
for (let d = 0; d < 30; d++) {
  s.day += 1
  dailyRivalPass(s, () => 0.01) // would have triggered 4% exit previously
}
const hasExitDec = s.decisions.some((d) => (d as any).kind === 'rival_route_exit')
if (!hasExitDec) {
  console.log('✓ Verified: No rival_route_exit decisions generated by dailyRivalPass.')
} else {
  console.error('FAIL: rival_route_exit decision was generated.')
  process.exit(1)
}

console.log('\n--- ALL SPRINT 9 CHECKS PASSED! ---')
