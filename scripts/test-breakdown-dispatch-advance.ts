import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { hireDriver, hireConductor } from '../src/engine/sim/staffing'
import { getMonthlyRefundBreakdown } from '../src/engine/sim/finance'

console.log('=== TEST: Breakdown Dispatch & Advance (No Temporal Dead Zone) ===')

const s = newGame('Breakdown Test Co', 'malik', 'mdu-maa', 999)
s.company.cash = 10_000_000 // ₹10L

// Create schedule
const res = createSchedule(s, {
  name: 'Madurai Night',
  routeId: 'mdu-maa',
  depHour: 21,
  depMin: 0,
  farePaise: 80000,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  active: true,
  busIds: [],
})
const schId = typeof res === 'string' ? res : (res as any).id

// Add a heavily worn bus (condition 10 on engine, high breakdown chance)
s.buses['b1'] = {
  id: 'b1',
  reg: 'TN 58 AB 9999',
  modelId: 'leyacsleep2',
  ownership: 'owned',
  status: 'active',
  odometerKm: 350000,
  chassisKm: 350000,
  condition: { engine: 10, gearbox: 20, suspension: 30, brakes: 25, body: 40, electrical: 30, ac: 20, tyres: 30 },
  wear: { body: 40, ac: 20, electrical: 30, chassis: 30 },
  qualityScore: 2.5,
  seatCount: 36,
  acquisitionDay: s.day,
  purchasePrice: 6500000,
  parkedCityId: 'mdu',
  fitnessExpiryDay: s.day + 100,
  insuranceExpiryDay: s.day + 100,
  permitExpiryDay: s.day + 100,
  taxExpiryDay: s.day + 100,
  pucExpiryDay: s.day + 100,
  breakdownHistory: [],
  rebodyCount: 0,
  seatRefurbCount: 0,
  comfortScore: 40,
  cleanliness: 50,
  gpsDeviceFitted: true,
}

assignBus(s, schId, 'b1')

// Add driver & conductor
s.staff['d1'] = {
  id: 'd1',
  name: 'Driver 1',
  role: 'driver',
  salary: 2500000,
  skill: 4,
  hiredDay: s.day,
  driverLicense: 'HMV_PSV',
  fatigue: 0,
  tripsDriven: 0,
  status: 'active',
  busId: 'b1',
}
s.staff['c1'] = {
  id: 'c1',
  name: 'Conductor 1',
  role: 'conductor',
  salary: 1800000,
  skill: 4,
  hiredDay: s.day,
  fatigue: 0,
  status: 'active',
  busId: 'b1',
}

console.log('Advancing days until breakdown occurs...')
let sawBreakdown = false

for (let d = 1; d <= 30; d++) {
  // Ensure open trips have passengers booked so breakdown generates refund
  for (const t of Object.values(s.trips)) {
    if (t.status === 'open' && t.sold === 0) {
      t.sold = 25
      t.revenue = 2000000
    }
  }

  try {
    advanceDay(s)
  } catch (err: any) {
    console.error(`💥 ADVANCE FAILED ON DAY ${d}:`, err)
    throw err
  }

  const breakdownLog = (s.inbox ?? []).find((l) => l.text.includes('BREAKDOWN'))
  if (breakdownLog) {
    sawBreakdown = true
    console.log(`✓ Breakdown occurred cleanly on day ${d}!`)
    console.log(`  Inbox: ${breakdownLog.text}`)
    console.log(`  Bus status: ${s.buses['b1']?.status}, workshopJob: ${s.buses['b1']?.workshopJob}`)
    break
  }
}

assert.ok(sawBreakdown, 'Should have encountered a breakdown on worn bus')
const refunds = getMonthlyRefundBreakdown(s, s.curMonth)
console.log('Refund breakdown after breakdown:', refunds)
assert.ok(refunds.busCancel > 0, 'Breakdown refund should be recorded under busCancel category')

console.log('✓ SUCCESS: Breakdowns execute without ReferenceError and day advance works cleanly!')
