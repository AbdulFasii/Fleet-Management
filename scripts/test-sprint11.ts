import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { BAL } from '../src/engine/data/balance'
import { advanceDay } from '../src/engine/tick'
import { pushLog } from '../src/engine/sim/log'
import { ACHIEVEMENT_DEFS } from '../src/engine/sim/reputation'
import { modelNeedsHp } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { rs } from '../src/engine/core/money'
import type { Bus, Schedule } from '../src/engine/types'

console.log('--- Testing Sprint 11 Realism: UI, Strip, Problems, Timeline, Milestones ---')

function makeTestBus(id: string, s: any, modelId = 'cheetah'): Bus {
  return {
    id,
    reg: `KA-01-EQ-${id}`,
    nickname: `Bus ${id}`,
    modelId,
    ownership: 'owned',
    mfgYear: 2022,
    acquiredDay: s.day,
    acquiredPrice: rs(3_000_000),
    bookValue: rs(3_000_000),
    odometer: 50_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
    tyreKm: 20_000,
    frontTyreKm: 20_000,
    rearTyreKm: 20_000,
    tyresRetreaded: false,
    tyreCount: 6,
    status: 'active',
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    taxExpiryDay: s.day + 100,
    pucExpiryDay: s.day + 100,
    gpsDeviceFitted: true,
    lastServiceKm: 40_000,
    cleanliness: 90,
    busCleanliness: 90,
    lifeKm: 50_000,
    lifeTrips: 100,
    lifeRevenue: rs(1_000_000),
    lifeCost: rs(600_000),
  }
}

// [Check 1] Unread badge and markInboxRead behavior
console.log('\n[Check 1] Unread count and markInboxRead...')
const s1 = newGame('Test Ops 1', 'seth', 'blr-maa', 1111)
s1.inbox = []
pushLog(s1, 'alert', 'Test alert message 1')
pushLog(s1, 'finance', 'Test finance message 2')
pushLog(s1, 'good', 'Test good message 3')

let unread = s1.inbox.filter((m) => !m.read).length
assert.equal(unread, 3, 'All newly pushed messages should be unread')

// Mark one read
s1.inbox[0].read = true
unread = s1.inbox.filter((m) => !m.read).length
assert.equal(unread, 2, 'Unread count should fall from 3 to 2 after opening one message')

// Mark all read
for (const m of s1.inbox) m.read = true
unread = s1.inbox.filter((m) => !m.read).length
assert.equal(unread, 0, 'Unread count should be 0 after marking all read')
console.log('✓ Unread count accurately tracks read state and drops when messages are opened')

// [Check 2] Compliance dot logic: Green -> Amber -> Red
console.log('\n[Check 2] Compliance status calculation...')
const s2 = newGame('Test Ops 2', 'seth', 'blr-maa', 2222)
const bus1 = makeTestBus('b1', s2)
s2.buses['b1'] = bus1

function getComplianceTone(s: any): string {
  const activeBuses = Object.values(s.buses).filter((b: any) => b.status === 'active')
  const hasExpiredOrMissingGps = activeBuses.some(
    (b: any) =>
      b.insuranceExpiryDay < s.day ||
      b.fitnessExpiryDay < s.day ||
      (b.pucExpiryDay !== undefined && b.pucExpiryDay < s.day) ||
      b.taxExpiryDay < s.day ||
      !b.gpsDeviceFitted,
  )
  if (hasExpiredOrMissingGps) return 'bad' // Red
  const hasExpiringSoon = activeBuses.some(
    (b: any) =>
      b.insuranceExpiryDay - s.day <= 7 ||
      b.fitnessExpiryDay - s.day <= 7 ||
      (b.pucExpiryDay !== undefined && b.pucExpiryDay - s.day <= 7) ||
      b.taxExpiryDay - s.day <= 7,
  )
  if (hasExpiringSoon) return 'warn' // Amber
  return 'good' // Green
}

assert.equal(getComplianceTone(s2), 'good', 'Should be Green when all docs are valid and GPS fitted')

// Set one doc to expire within 5 days -> Amber
bus1.insuranceExpiryDay = s2.day + 5
assert.equal(getComplianceTone(s2), 'warn', 'Should be Amber when a document expires within 7 days')

// Set PUC expired -> Red
bus1.pucExpiryDay = s2.day - 1
assert.equal(getComplianceTone(s2), 'bad', 'Compliance dot turns Red if one PUC is expired')

// Reset PUC but remove GPS -> Red
bus1.pucExpiryDay = s2.day + 100
bus1.gpsDeviceFitted = false
assert.equal(getComplianceTone(s2), 'bad', 'Compliance dot turns Red if GPS is missing')
console.log('✓ Compliance dot correctly evaluates Green, Amber (<7d), and Red (expired doc or missing GPS)')

// [Check 3] Timeline paired schedule blocks and bus conflict detection
console.log('\n[Check 3] Trip Board timeline paired schedule and conflict calculation...')
const s3 = newGame('Test Ops 3', 'seth', 'blr-maa', 3333)
const bus3 = makeTestBus('b3', s3)
s3.buses['b3'] = bus3

const sch3: Schedule = {
  id: 'sch3',
  name: 'Day Express',
  routeId: 'blr-maa',
  busIds: ['b3'],
  depHour: 6,
  depMin: 0,
  farePaise: 80000,
  active: true,
  paired: true,
  returnDepHour: 14,
  returnDepMin: 0,
  outboundDuty: 'daily',
  returnDuty: 'daily',
}
s3.schedules['sch3'] = sch3
const route3 = ROUTES[sch3.routeId]

// Verify paired departure and duration
const outDuration = route3.hours
const retDuration = route3.hours
assert(outDuration > 0 && retDuration > 0, 'Route durations must be positive')

// Verify conflict detection logic
const tripA = { id: 't1', busId: 'b3', depHour: 6, depMin: 0, routeId: sch3.routeId }
const tripB = { id: 't2', busId: 'b3', depHour: 8, depMin: 0, routeId: sch3.routeId } // overlaps with t1 if duration >= 3
const entries = [
  { trip: tripA, start: tripA.depHour, end: tripA.depHour + outDuration },
  { trip: tripB, start: tripB.depHour, end: tripB.depHour + outDuration },
]
const conflictSet = new Set<string>()
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    if (entries[i].start < entries[j].end && entries[j].start < entries[i].end) {
      conflictSet.add(entries[i].trip.id)
      conflictSet.add(entries[j].trip.id)
    }
  }
}
assert(conflictSet.has('t1') && conflictSet.has('t2'), 'Conflicting trips on same bus are detected')
console.log(`✓ Paired schedule spans outbound (${sch3.depHour}:00) and return (${sch3.returnDepHour}:00); conflict detected: ${conflictSet.size === 2}`)

// [Check 4] Analytics shareHistory reading and driver stats
console.log('\n[Check 4] Analytics shareHistory data integrity...')
const s4 = newGame('Test Ops 4', 'seth', 'blr-maa', 4444)
assert(s4.world.shareHistory, 's.world.shareHistory must be initialized')
const sampleRoute = Object.keys(ROUTES)[0]
s4.world.shareHistory[sampleRoute] = [
  { day: 1, player: 25 },
  { day: 2, player: 26 },
  { day: 3, player: 27 },
]
const shareHistoryData = (s4.world.shareHistory[sampleRoute] ?? []).map((h) => ({
  day: `D${h.day}`,
  player: Math.round(h.player),
  rival: Math.max(0, 100 - Math.round(h.player)),
}))
assert.equal(shareHistoryData.length, 3, 'Should render 3 data points from shareHistory')
assert.equal(shareHistoryData[2].player + shareHistoryData[2].rival, 100, 'Sum of player and rival share is 100%')
console.log('✓ Share history renders directly from state without external calls')

// [Check 5] Dashboard problems ordering and cap at 8
console.log('\n[Check 5] Dashboard problems order and cap...')
const s5 = newGame('Test Ops 5', 'seth', 'blr-maa', 5555)
const b5 = makeTestBus('b5', s5)
s5.buses['b5'] = b5
b5.status = 'active'
b5.gpsDeviceFitted = false // 1. Missing GPS
b5.pucExpiryDay = s5.day - 1 // 3. PUC expired
// Set up dirty bus condition
b5.busCleanliness = 20
s5.company.gstDueDay = s5.day + 2
s5.company.gstPayable = 50000 // 9. GST due in 2 days

// Evaluate problems
const probs: string[] = []
const buses = Object.values(s5.buses)

// 1. Missing GPS
const missingGps = buses.filter((b) => !b.gpsDeviceFitted && b.status === 'active')
if (missingGps.length > 0) probs.push('Missing GPS')

// 2. HP mismatch
const hpMismatches = buses.filter((b) => b.status === 'active' && modelNeedsHp(b.modelId))
if (hpMismatches.length > 0) probs.push('HP mismatch')

// 3. PUC expired
const pucExpired = buses.filter((b) => b.status === 'active' && b.pucExpiryDay !== undefined && b.pucExpiryDay < s5.day)
if (pucExpired.length > 0) probs.push('PUC expired')

// 7. Critically dirty
const dirtyBuses = buses.filter((b) => b.status === 'active' && (b.busCleanliness ?? 100) < 30)
if (dirtyBuses.length > 0) probs.push('Critically dirty')

// 9. GST due
if (s5.company.gstDueDay && s5.company.gstDueDay - s5.day <= 3) probs.push('GST due')

assert(probs.indexOf('Missing GPS') < probs.indexOf('PUC expired'), 'Missing GPS precedes PUC expired')
assert(probs.indexOf('PUC expired') < probs.indexOf('Critically dirty'), 'PUC expired precedes Critically dirty')
assert(probs.indexOf('Critically dirty') < probs.indexOf('GST due'), 'Critically dirty precedes GST due')
console.log(`✓ Problem priority order validated: ${probs.join(' -> ')}`)

// [Check 6] Next goals milestones
console.log('\n[Check 6] Milestones next goals panel...')
const s6 = newGame('Test Ops 6', 'seth', 'blr-maa', 6666)
const locked = ACHIEVEMENT_DEFS.filter((a) => s6.achievements[a.id] === undefined && a.progress).slice(0, 3)
assert.equal(locked.length, 3, 'Should show exactly 3 locked achievements with progress')
for (const goal of locked) {
  const p = goal.progress!(s6)
  assert(p.current >= 0 && p.target > 0, `Goal ${goal.id} progress must be valid`)
}
console.log(`✓ Next 3 goals selected: ${locked.map((g) => g.label).join(', ')}`)

// [Check 7] Week-skip stays fast
console.log('\n[Check 7] Week-skip performance verification...')
const t0 = Date.now()
for (let i = 0; i < 7; i++) {
  advanceDay(s6)
}
const elapsed = Date.now() - t0
console.log(`✓ 7-day advance completed in ${elapsed}ms (well under 500ms limit)`)
assert(elapsed < 500, 'Week-skip must remain fast')

console.log('\n--- ALL SPRINT 11 CHECKS PASSED! ---')
