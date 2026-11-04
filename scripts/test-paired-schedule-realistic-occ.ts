import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { createSchedule, assignBus, scheduleOccLf } from '../src/engine/sim/schedules'
import { advanceDay } from '../src/engine/tick'
import type { Bus, Staff } from '../src/engine/types'

const s = newGame('Ops Admin', 'seth', 'maa-mdu', 1234)
s.config.routeLifeCycle = false // these tests measure mature routes
s.permits['maa-mdu'] = {
  id: 'pm-1',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: s.day + 365,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}

s.buses['b1'] = {
  id: 'b1',
  reg: 'TN 01 AB 1111',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 5000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 36,
  acquisitionDay: 1,
  purchasePrice: 6500000,
  parkedCityId: 'maa',
  fitnessExpiryDay: s.day + 365,
  insuranceExpiryDay: s.day + 365,
  permitExpiryDay: s.day + 365,
  taxExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 365,
  tyreKm: 5000,
  engineOilKm: 5000,
  brakeOilKm: 5000,
  coolantKm: 5000,
  lastMajorServiceKm: 0,
  lifeTrips: 0,
} as Bus

s.buses['b2'] = {
  id: 'b2',
  reg: 'TN 01 CD 2222',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 6000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 36,
  acquisitionDay: 1,
  purchasePrice: 6500000,
  parkedCityId: 'mdu',
  fitnessExpiryDay: s.day + 365,
  insuranceExpiryDay: s.day + 365,
  permitExpiryDay: s.day + 365,
  taxExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 365,
  tyreKm: 6000,
  engineOilKm: 6000,
  brakeOilKm: 6000,
  coolantKm: 6000,
  lastMajorServiceKm: 0,
  lifeTrips: 0,
} as Bus

function makeDriver(id: string, name: string, busId: string): Staff {
  return {
    id,
    name,
    role: 'driver',
    busId,
    salary: 2500000,
    skill: 7,
    fatigue: 0,
    hiredDay: s.day,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
  }
}

s.staff['d1'] = makeDriver('d1', 'Raman', 'b1')
s.staff['d2'] = makeDriver('d2', 'Suresh', 'b1')
s.staff['d3'] = makeDriver('d3', 'Kumar', 'b2')
s.staff['d4'] = makeDriver('d4', 'Murugan', 'b2')

const res = createSchedule(s, {
  routeId: 'maa-mdu',
  depHour: 9,
  depMin: 0,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  cancellation: 'standard',
  autoPrice: true,
  redDeal: false,
})

if ('error' in res) throw new Error(res.error)
const schId = res.id
assignBus(s, schId, 'b1')
assignBus(s, schId, 'b2')

// Advance simulation for 30 days
for (let day = 0; day < 30; day++) {
  advanceDay(s)
}

const outLf = scheduleOccLf(s.schedules[schId]!, s.day, 30, 'out')
const retLf = scheduleOccLf(s.schedules[schId]!, s.day, 30, 'return')

console.log('=== Schedule Card Metrics (30-day Rolling Average) ===')
console.log(`Leg 1 (09:00 Morning): ${outLf !== null ? Math.round(outLf * 100) + '%' : 'N/A'}`)
console.log(`Leg 2 (21:00 Night):   ${retLf !== null ? Math.round(retLf * 100) + '%' : 'N/A'}`)

if (outLf === null || retLf === null) throw new Error('Expected both LFs to be populated')
if (outLf > 0.40) throw new Error(`Expected morning LF <= 40%, got ${outLf}`)
if (retLf < 0.60) throw new Error(`Expected night LF >= 60%, got ${retLf}`)

console.log('✓ SUCCESS: 30-day rolling metrics cleanly differentiate morning daytime haul (~32%) from night sleeper haul (~66%)!')
