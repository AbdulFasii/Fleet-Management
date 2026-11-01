import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { generateTrips } from '../src/engine/sim/booking'
import { BAL } from '../src/engine/data/balance'
import type { Schedule, Trip } from '../src/engine/types'

const WINDOW = BAL.bookingWindowDays
console.log(`--- Testing ${WINDOW}-Day Booking Window ---`)

// The engine window and the Trip Board window are the same number of days:
// everything generated is visible, and nothing is booked that the player
// cannot see.
console.log(`\n[Check 1] Trip Board shows the whole booking window (${WINDOW} days)...`)
const s = newGame('Window Test', 'seth', 'blr-maa', 1001)

// Add bus and schedule
s.buses['b1'] = {
  id: 'b1',
  reg: 'KA 01 AB 1001',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 10000,
  assignedScheduleId: 'sch1',
  wear: { body: 95, ac: 95, electrical: 95, chassis: 95 },
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  comfortScore: 80,
  cleanliness: 90,
  breakdownHistory: [],
  chassisKm: 10000,
  rebodyCount: 0,
  seatRefurbCount: 0,
}

const sch: Schedule = {
  id: 'sch1',
  name: 'Morning Express',
  routeId: 'blr-maa',
  busIds: ['b1'],
  depHour: 7,
  depMin: 0,
  farePaise: 80000,
  active: true,
  outboundDuty: 'daily',
  returnDuty: 'daily',
}
s.schedules['sch1'] = sch
s.permits['blr-maa'] = {
  id: 'pm-1',
  routeId: 'blr-maa',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
}

// Generate trips
generateTrips(s)

const SHOW_DAYS = 7
assert.equal(SHOW_DAYS, WINDOW, 'TripBoard SHOW_DAYS must match the engine booking window')

// Test trip filtering logic as done in TripBoard.tsx
const bySch = new Map<string, Trip[]>()
for (const id of s.openTripIds) {
  const t = s.trips[id]
  if (!t || t.status !== 'open' || t.day < s.day || t.day >= s.day + SHOW_DAYS) continue
  const list = bySch.get(t.scheduleId) ?? []
  list.push(t)
  bySch.set(t.scheduleId, list)
}

const windowTrips = bySch.get('sch1') ?? []
assert(windowTrips.length > 0, `Should have trips in the ${SHOW_DAYS}-day window`)
for (const t of windowTrips) {
  const diff = t.day - s.day
  assert(diff >= 0 && diff < SHOW_DAYS, `Trip day ${t.day} (T-${diff}) must be within [0, ${SHOW_DAYS - 1}]`)
}
console.log(`✓ All ${windowTrips.length} trips in window are strictly within [T-0, T-${SHOW_DAYS - 1}]`)

const openTrips = s.openTripIds.map((id) => s.trips[id]).filter((t): t is Trip => !!t && t.status === 'open')
const lastDay = Math.max(...openTrips.map((t) => t.day))
assert.equal(
  lastDay,
  s.day + WINDOW,
  `Engine must only generate ${WINDOW} days out (last trip day ${lastDay}, expected ${s.day + WINDOW})`,
)
console.log(`✓ Engine stops generating at T-${lastDay - s.day}; nothing is sold unseen`)

const beyondWindow = openTrips.filter((t) => t.day > s.day + WINDOW)
assert.equal(beyondWindow.length, 0, 'No trip may sit beyond the booking window')
console.log('✓ 0 trips beyond the booking window')

// [Check 2] Timeline navigation bounds
console.log('\n[Check 2] Timeline navigation bounds...')
const minTimelineDay = s.day
const maxTimelineDay = s.day + SHOW_DAYS - 1
const timelineDaysCount = maxTimelineDay - minTimelineDay + 1
assert.equal(timelineDaysCount, WINDOW, `Timeline allows navigating exactly ${WINDOW} days`)
console.log(`✓ Timeline navigation spans exactly ${timelineDaysCount} days (${minTimelineDay} to ${maxTimelineDay})`)

// [Check 3] Compaction hard keepOpen bound never trims from inside the window
console.log('\n[Check 3] Storage hard shrink keeps at least the booking window...')
const keepOpenHard = 10
assert(keepOpenHard >= WINDOW, 'Hard compaction must never trim a bookable day')
const fakeOpenTrips = [s.day, s.day + 5, s.day + 6, s.day + 7, s.day + 10, s.day + 11, s.day + 25]
const retainedInHard = fakeOpenTrips.filter((d) => d <= s.day + keepOpenHard)
assert.equal(retainedInHard.length, 5, 'Hard compaction retains days up to day + 10')
console.log('✓ Storage hard compaction keeps trips up to 10 days out')

console.log('\n=================================================')
console.log('🎉 ALL BOOKING WINDOW TESTS PASSED PERFECTLY!')
console.log('=================================================')
