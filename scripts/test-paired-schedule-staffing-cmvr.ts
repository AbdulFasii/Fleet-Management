import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { estimateCrewRequirements, assignStaff, isDriverEligibleForTrip, cmvrResetPass } from '../src/engine/sim/staffing'
import { crewLimit } from '../src/ui/crew'
import { dispatchPass } from '../src/engine/sim/dispatch'
import type { GameState, Trip } from '../src/engine/types'
import { BAL } from '../src/engine/data/balance'

function checkTripCmvr(s: GameState, trip?: Trip): { isBlocked: boolean; needsHp: boolean } {
  if (!trip) return { isBlocked: false, needsHp: false }
  const bus = s.buses[trip.busId]
  const route = ROUTES[trip.routeId]
  if (!bus || !route) return { isBlocked: false, needsHp: false }

  const assignedDrivers = Object.values(s.staff).filter(
    (st) => st.busId === bus.id && (st.role === 'driver' || st.role === 'co_driver'),
  )
  const conductor = Object.values(s.staff).find((st) => st.busId === bus.id && st.role === 'conductor')

  const needsSecond = route.hours > BAL.maxDrivingHoursSingleDriver
  const hasSecondQualified = assignedDrivers.length >= 2 || (conductor && conductor.skill >= 5)
  const driversNeeded = needsSecond && !hasSecondQualified ? 2 : 1
  const isHpBus = false

  const eligibleAssigned = assignedDrivers.filter((d) => {
    const ok = isDriverEligibleForTrip(s, d, trip.day, trip.depHour, route.hours, driversNeeded)
    console.log(`  Driver ${d.id}: eligible=${ok}, lastTripDay=${d.lastTripDay}, consecutiveDutyDays=${d.consecutiveDutyDays}, cmvrHoursToday=${d.cmvrHoursToday}, nightRestUntilDay=${d.nightRestUntilDay}`)
    return ok
  })

  const eligibleSpares = Object.values(s.staff)
    .filter((st) => !st.busId && (st.role === 'driver' || st.role === 'co_driver'))
    .filter((d) => isDriverEligibleForTrip(s, d, trip.day, trip.depHour, route.hours, driversNeeded))

  const totalEligible = eligibleAssigned.length + eligibleSpares.length
  const isBlocked = totalEligible < driversNeeded

  return { isBlocked: isBlocked || Boolean(trip.cmvrBlocked), needsHp: false }
}

function runTests() {
  console.log('=== TEST: Paired Schedule Staffing & CMVR Block Resolution ===')

  const s = newGame('test-staff-cmvr', 'malik', 'maa-mdu', 12345)
  s.day = 1

  // Use a route with <= 10h duration so 1 driver is needed per trip
  const routeId = 'maa-mdu' // ~8.5h
  const bus = {
    id: 'b1',
    reg: 'TN 01 AB 1234',
    modelId: 'cheetah',
    ownership: 'owned' as const,
    status: 'active' as const,
    condition: { body: 90, ac: 90, electrical: 90, engine: 90, tyres: 90, gearbox: 90 },
    odoKm: 10000,
    purchasedDay: 1,
    insuranceExpiryDay: 100,
    fitnessExpiryDay: 100,
    fitnessFailed: false,
    pucExpiryDay: 100,
  }
  s.buses['b1'] = bus

  // Clean slate for staff: remove all staff
  s.staff = {}

  // Add 1 driver and 1 conductor
  s.staff['d1'] = {
    id: 'd1',
    name: 'Driver 1',
    role: 'driver',
    wage: 25000,
    skill: 7,
    fatigue: 0,
    licenceClass: 'HMV_PSV',
    hiredDay: 1,
    happiness: 90,
  }
  s.staff['c1'] = {
    id: 'c1',
    name: 'Conductor 1',
    role: 'conductor',
    wage: 18000,
    skill: 6,
    fatigue: 0,
    hiredDay: 1,
    happiness: 90,
  }

  // Create a paired schedule: 21:00 outbound, 06:00 return
  const res = createSchedule(s, {
    routeId,
    depHour: 21,
    depMin: 0,
    baseFare: 650,
    paired: true,
    returnDepHour: 6,
    returnDepMin: 0,
  })
  if ('error' in res) throw new Error(`createSchedule failed: ${res.error}`)
  const schId = res.id
  assignBus(s, schId, bus.id)

  // 1. Verify crewLimit
  const drvLimit = crewLimit(s, bus, 'driver')
  const condLimit = crewLimit(s, bus, 'conductor')
  console.log(`Check 1: crewLimit for 2-trip paired schedule -> drv: ${drvLimit}, cond: ${condLimit}`)
  if (drvLimit !== 2) throw new Error(`Expected drvLimit == 2, got ${drvLimit}`)
  if (condLimit !== 2) throw new Error(`Expected condLimit == 2, got ${condLimit}`)

  // 2. Verify estimateCrewRequirements
  const est1 = estimateCrewRequirements(s)
  console.log(`Check 2: estimateCrewRequirements with 1 driver on payroll:`)
  console.log(`  Driver Total Line: ${est1.drivers.total.line}, Req: ${est1.drivers.total.required}, Current: ${est1.drivers.total.current}`)
  console.log(`  Conductor Line: ${est1.conductors.line}, Req: ${est1.conductors.required}, Current: ${est1.conductors.current}`)
  if (est1.drivers.total.line !== 2) throw new Error(`Expected 2 driver line duties, got ${est1.drivers.total.line}`)
  if (est1.conductors.line !== 2) throw new Error(`Expected 2 conductor line duties, got ${est1.conductors.line}`)
  if (est1.drivers.total.current >= est1.drivers.total.required) throw new Error(`Should NOT be OK with only 1 driver on payroll!`)

  // 3. Test CMVR block with 1 driver assigned and NO spare on payroll
  assignStaff(s, 'd1', bus.id)
  assignStaff(s, 'c1', bus.id)
  generateTrips(s)

  // Outbound trip (day 1, 21:00)
  const tripOut = Object.values(s.trips).find((t) => t.scheduleId === schId && t.day === 1 && t.depHour === 21)!
  // Return trip (day 2, 06:00)
  const tripRet = Object.values(s.trips).find((t) => t.scheduleId === schId && t.day === 2 && t.depHour === 6)!

  // Outbound is not blocked before running
  const cmvrOutPre = checkTripCmvr(s, tripOut)
  console.log(`Check 3a: Outbound trip CMVR blocked before departure: ${cmvrOutPre.isBlocked}`)
  if (cmvrOutPre.isBlocked) throw new Error('Outbound trip should not be blocked')

  // Run outbound trip
  dispatchPass(s)

  // Now d1 is in night rest until day 2 08:00
  console.log(`d1 after outbound: nightRestUntilDay=${s.staff['d1'].nightRestUntilDay}, nightRestUntilHour=${s.staff['d1'].nightRestUntilHour}`)
  if (!s.staff['d1'].nightRestUntilDay) throw new Error('d1 should be in night rest after 21:00 trip')

  // Advance to Day 2
  s.day = 2
  cmvrResetPass(s)
  const cmvrRetBlocked = checkTripCmvr(s, tripRet)
  console.log(`Check 3b: Return trip at 06:00 with d1 resting and NO spare -> isBlocked: ${cmvrRetBlocked.isBlocked}`)
  if (!cmvrRetBlocked.isBlocked) throw new Error('Return trip should be blocked when driver is resting and no spare')

  // 4. Test CMVR block resolution when a spare driver is added to payroll
  s.staff['d_spare'] = {
    id: 'd_spare',
    name: 'Driver Spare',
    role: 'driver',
    wage: 25000,
    skill: 6,
    fatigue: 0,
    licenceClass: 'HMV_PSV',
    hiredDay: 2,
    happiness: 90,
  }
  const cmvrRetCoveredBySpare = checkTripCmvr(s, tripRet)
  console.log(`Check 4a: Return trip at 06:00 with spare on bench -> isBlocked: ${cmvrRetCoveredBySpare.isBlocked}`)
  if (cmvrRetCoveredBySpare.isBlocked) throw new Error('Return trip should NOT be blocked when spare driver is available on payroll')

  // Dispatch Day 2 return trip: spare driver should be picked automatically
  dispatchPass(s)
  console.log(`Check 4b: Return trip status: ${tripRet.status}, cmvrBlocked: ${tripRet.cmvrBlocked}`)
  if (tripRet.cmvrBlocked) throw new Error('Return trip should not have been cmvrBlocked by dispatch')
  if (s.staff['d_spare'].tripsDriven !== 1) throw new Error('Spare driver should have driven the trip')

  // 5. Test 2 drivers assigned directly to the bus
  s.day = 3
  cmvrResetPass(s)
  s.staff['d1'].nightRestUntilDay = undefined
  s.staff['d_spare'].nightRestUntilDay = undefined
  assignStaff(s, 'd_spare', bus.id) // Now both d1 and d_spare are assigned to bus
  generateTrips(s)

  const tripOut3 = Object.values(s.trips).find((t) => t.scheduleId === schId && t.day === 3 && t.depHour === 21)!
  const tripRet4 = Object.values(s.trips).find((t) => t.scheduleId === schId && t.day === 4 && t.depHour === 6)!

  // Dispatch Day 3 outbound (one driver drives, goes into night rest)
  dispatchPass(s)
  console.log(`d1 after Day 3: nightRestUntilDay=${s.staff['d1'].nightRestUntilDay}, tripsDriven=${s.staff['d1'].tripsDriven}`)
  console.log(`d_spare after Day 3: nightRestUntilDay=${s.staff['d_spare'].nightRestUntilDay}, tripsDriven=${s.staff['d_spare'].tripsDriven}`)
  s.day = 4
  cmvrResetPass(s)
  const cmvrRet4 = checkTripCmvr(s, tripRet4)
  console.log(`Check 5: Return trip on Day 4 with 2 drivers assigned (one resting, one fresh) -> isBlocked: ${cmvrRet4.isBlocked}`)
  if (cmvrRet4.isBlocked) throw new Error('Return trip should NOT be blocked when 2nd assigned driver is fresh')

  dispatchPass(s)
  if (tripRet4.cmvrBlocked) throw new Error('Day 4 return trip should not be cmvrBlocked')
  console.log('ALL CHECKS PASSED!')
}

runTests()
