import { newGame } from '../src/engine/newGame'
import { assignBus, unassignBus, createSchedule } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import type { Schedule } from '../src/engine/types'

console.log('--- Testing Paired 2-Bus Simultaneous Up/Down for Seasonal + Daily Schedules ---')

const s = newGame('Ops Admin', 'seth', 'maa-mdu', 1234)

// Activate seasonal permit
s.permits['maa-mdu'] = {
  id: 'pm-1',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  seasonal: {
    status: 'active',
    appliedDay: 1,
    approvedDay: 1,
    expiryDay: s.day + 365,
  },
}

// 1. Create a paired schedule with 1st leg Seasonal, 2nd leg Daily
console.log('\n[Check 1] Creating paired Seasonal + daily schedule...')
const res = createSchedule(s, {
  name: 'Festival Express',
  routeId: 'maa-mdu',
  depHour: 9,
  depMin: 0,
  farePaise: 80000,
  paired: true,
  returnDepHour: 22,
  returnDepMin: 0,
  outboundDuty: 'festival',
  returnDuty: 'daily',
  active: true,
  busIds: [],
})
const schId = typeof res === 'string' ? res : (res as any).id
console.log('✓ Created paired Seasonal + daily schedule:', schId)

// Add buses
s.buses['b1'] = {
  id: 'b1',
  reg: 'TN 01 AB 1111',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 5000,
  assignedScheduleId: undefined,
  wear: { body: 90, ac: 90, electrical: 90, chassis: 90 },
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  comfortScore: 80,
  cleanliness: 90,
  breakdownHistory: [],
  chassisKm: 5000,
  rebodyCount: 0,
  seatRefurbCount: 0,
}

s.buses['b2'] = {
  id: 'b2',
  reg: 'TN 01 CD 2222',
  modelId: 'volvo9400semi',
  status: 'active',
  odometerKm: 6000,
  assignedScheduleId: undefined,
  wear: { body: 90, ac: 90, electrical: 90, chassis: 90 },
  insuranceExpiryDay: s.day + 100,
  fitnessExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  gpsDeviceFitted: true,
  comfortScore: 80,
  cleanliness: 90,
  breakdownHistory: [],
  chassisKm: 6000,
  rebodyCount: 0,
  seatRefurbCount: 0,
}

// 2. Assign Bus 1
console.log('\n[Check 2] Assigning Bus 1...')
const err1 = assignBus(s, schId, 'b1')
if (err1) throw new Error(`Assign Bus 1 failed: ${err1}`)
console.log('✓ Bus 1 assigned successfully')

// 3. Assign Bus 2
console.log('\n[Check 3] Assigning Bus 2 (Second coach for Seasonal + daily)...')
const err2 = assignBus(s, schId, 'b2')
if (err2) throw new Error(`Assign Bus 2 failed: ${err2}`)
if (s.buses['b2']?.parkedCityId !== 'mdu') {
  throw new Error(`Expected Bus 2 to be stationed at destination (mdu), got ${s.buses['b2']?.parkedCityId}`)
}
console.log('✓ Bus 2 successfully assigned and stationed at', s.buses['b2']!.parkedCityId)

// 4. Verify departures on non-season day: only daily slot (22:00) runs both ways
console.log('\n[Check 4] Verifying departures on non-season day: only daily slot (22:00) runs both ways...')
const testDay = s.day + 2
const dayTrips = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === testDay)
const slot1Up = dayTrips.find((t) => t.direction === 'AB' && t.depHour === 9)
const slot1Down = dayTrips.find((t) => t.direction === 'BA' && t.depHour === 9)
const slot2Up = dayTrips.find((t) => t.direction === 'AB' && t.depHour >= 22)
const slot2Down = dayTrips.find((t) => t.direction === 'BA' && t.depHour >= 22)

if (slot1Up || slot1Down) {
  throw new Error('09:00 seasonal slot must NOT run on non-festival day!')
}
if (!slot2Up || !slot2Down) {
  throw new Error(`Missing simultaneous departures at 22:00: Up=${Boolean(slot2Up)}, Down=${Boolean(slot2Down)}`)
}
console.log('✓ On non-season day: 09:00 seasonal slot is absent, 22:00 daily runs on both ways')

// 5. Verify festival day seasonal tracking flags
console.log('\n[Check 5] Verifying festival day runs both slots in both directions...')
const festDay = 20187 // Ugadi festival
s.day = festDay - 2 // Within 3-day booking window for festival
generateTrips(s)
const festTrips = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === festDay)
const festSlot1Up = festTrips.find((t) => t.direction === 'AB' && t.depHour === 9)
const festSlot1Down = festTrips.find((t) => t.direction === 'BA' && t.depHour === 9)

if (!festSlot1Up?.isSeasonal || !festSlot1Down?.isSeasonal) {
  throw new Error('Expected festival slot 1 trips to be marked isSeasonal: true')
}
console.log('✓ Both Up and Down festival departures at 09:00 correctly flagged with isSeasonal: true')

// 6. Test unassign and reassign
console.log('\n[Check 6] Testing unassigning and reassigning Bus 2...')
unassignBus(s, schId, 'b2')
const schObj = s.schedules[schId] as Schedule
if (schObj.busIds.length !== 1 || schObj.busIds[0] !== 'b1') {
  throw new Error('Unassign failed')
}

const err3 = assignBus(s, schId, 'b2')
if (err3) throw new Error(`Reassign failed: ${err3}`)
console.log('✓ Unassign and reassign working cleanly')

console.log('\n======================================================')
console.log('🎉 ALL SEASONAL + DAILY SIMULTANEOUS UP/DOWN CHECKS PASSED!')
console.log('======================================================')
