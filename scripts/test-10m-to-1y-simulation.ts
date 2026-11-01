import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { toCivil, fmtDate } from '../src/engine/core/calendar'
import { assignBus, createSchedule } from '../src/engine/sim/schedules'
import { hireDriver, hireConductor, hireMechanic } from '../src/engine/sim/staffing'
import { applyDecision } from '../src/engine/sim/events'

console.log('=== Testing 10-Month to 1-Year Playthrough Simulation ===')

const s = newGame('KPN Royal', 'malik', 'mdu-maa', 123456)
s.company.cash = 80_000_000 // ₹80L starting cash

// Setup 2 routes
s.permits['maa-blr'] = {
  id: 'pm-blr',
  routeId: 'maa-blr',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: s.day + 365,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}

// Create 2 schedules
const sch1Res = createSchedule(s, {
  name: 'Madurai Night',
  routeId: 'mdu-maa',
  depHour: 21,
  depMin: 0,
  farePaise: 90000,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  active: true,
  busIds: [],
})
const sch1Id = typeof sch1Res === 'string' ? sch1Res : (sch1Res as any).id

const sch2Res = createSchedule(s, {
  name: 'Bengaluru Express',
  routeId: 'maa-blr',
  depHour: 22,
  depMin: 0,
  farePaise: 80000,
  paired: true,
  returnDepHour: 22,
  returnDepMin: 0,
  active: true,
  busIds: [],
})
const sch2Id = typeof sch2Res === 'string' ? sch2Res : (sch2Res as any).id

// Add 4 buses
for (let i = 1; i <= 4; i++) {
  const bId = `bus_${i}`
  s.buses[bId] = {
    id: bId,
    reg: `TN 01 AB 200${i}`,
    modelId: i <= 2 ? 'leyacsleep2' : 'volvo9400semi',
    ownership: 'owned',
    status: 'active',
    odometerKm: 20000,
    chassisKm: 20000,
    condition: { engine: 75, gearbox: 75, suspension: 75, brakes: 75, body: 80, electrical: 75, ac: 75, tyres: 75 },
    wear: { body: 80, ac: 75, electrical: 75, chassis: 75 },
    qualityScore: 4.2,
    seatCount: 36,
    acquisitionDay: s.day,
    purchasePrice: 6500000,
    parkedCityId: i % 2 === 1 ? 'mdu' : 'maa',
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    breakdownHistory: [],
    rebodyCount: 0,
    seatRefurbCount: 0,
    comfortScore: 80,
    cleanliness: 85,
    gpsDeviceFitted: true,
  }
}

assignBus(s, sch1Id, 'bus_1')
assignBus(s, sch1Id, 'bus_2')
assignBus(s, sch2Id, 'bus_3')
assignBus(s, sch2Id, 'bus_4')

// Staff
for (let i = 1; i <= 8; i++) {
  const dId = `drv_${i}`
  s.staff[dId] = {
    id: dId,
    name: `Driver ${i}`,
    role: 'driver',
    wagePaise: 2500000,
    salary: 2500000,
    skill: 6,
    hiredDay: s.day,
    driverLicense: 'HMV_PSV',
    fatigue: 0,
    tripsDriven: 0,
    status: 'active',
  }
}
for (let i = 1; i <= 4; i++) {
  const cId = `cnd_${i}`
  s.staff[cId] = {
    id: cId,
    name: `Conductor ${i}`,
    role: 'conductor',
    wagePaise: 1800000,
    salary: 1800000,
    skill: 6,
    hiredDay: s.day,
    fatigue: 0,
    status: 'active',
  }
}
for (let i = 1; i <= 2; i++) {
  const mId = `mech_${i}`
  s.staff[mId] = {
    id: mId,
    name: `Mechanic ${i}`,
    role: 'mechanic',
    wagePaise: 2200000,
    salary: 2200000,
    skill: 6,
    hiredDay: s.day,
    fatigue: 0,
    status: 'active',
  }
}

console.log(`Starting run from ${fmtDate(s.day)} (Day ${s.day})`)

let breakdownsEncountered = 0
let decisionsEncountered = 0

// Run 370 days (covering 10 months through 1 full year and into year 2)
for (let d = 1; d <= 370; d++) {
  // If decisions arrive, auto-resolve them like a player would
  while (s.decisions.length > 0) {
    const dec = s.decisions[0]
    decisionsEncountered++
    const optId = dec.options[0]?.id ?? (dec.options[0] as any)?.key ?? 'pass'
    const cashBeforeDec = s.company.cash
    const err = applyDecision(s, dec.id, optId)
    if (isNaN(s.company.cash)) {
      console.error(`🚨 DECISION CAUSED NaN! Decision was: [${dec.kind}] "${dec.title}", option: "${optId}". Cash before: ${cashBeforeDec}`)
      process.exit(1)
    }
    if (err) {
      // If error (e.g. not enough cash for fleet lot), pass
      s.decisions.shift()
    }
  }

  const prevBreakdowns = s.buses['bus_1']!.breakdownHistory.length +
    s.buses['bus_2']!.breakdownHistory.length +
    s.buses['bus_3']!.breakdownHistory.length +
    s.buses['bus_4']!.breakdownHistory.length

  try {
    const cashBefore = s.company.cash
    advanceDay(s)
    if (isNaN(s.company.cash)) {
      console.error(`🚨 CASH BECAME NaN on Day ${d} (${fmtDate(s.day)})! Cash before was: ${cashBefore}`)
      process.exit(1)
    }
  } catch (err: any) {
    console.error(`CRASH on day ${d} (${fmtDate(s.day)}):`, err)
    throw err
  }

  const curBreakdowns = s.buses['bus_1']!.breakdownHistory.length +
    s.buses['bus_2']!.breakdownHistory.length +
    s.buses['bus_3']!.breakdownHistory.length +
    s.buses['bus_4']!.breakdownHistory.length

  if (curBreakdowns > prevBreakdowns) {
    breakdownsEncountered += (curBreakdowns - prevBreakdowns)
  }

  const c = toCivil(s.day)
  if (d === 300 || d === 330 || d === 365) {
    console.log(`Milestone Day ${d} (${fmtDate(s.day)} - Month ${c.m}/${c.y}): Cash ₹${Math.round(s.company.cash / 100)}, Breakdowns: ${breakdownsEncountered}, Decisions: ${decisionsEncountered}`)
  }
}

console.log(`✓ Successfully completed 370 days!`)
console.log(`Total breakdowns survived: ${breakdownsEncountered}`)
console.log(`Total decisions resolved: ${decisionsEncountered}`)
console.log('Final date:', fmtDate(s.day))
