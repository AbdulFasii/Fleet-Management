import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { fromCivil, toCivil, festivalRunEffect, dow } from '../src/engine/core/calendar'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { advanceDay } from '../src/engine/tick'

console.log('--- Testing Festival Advance Booking ---')

// 1. Check Diwali homebound departure at T-5 vs a normal midweek peer
// Diwali is Nov 1, 2025. Pre window is Oct 28 - Oct 31 (delta -4 to -1).
// Oct 31 is delta -1 (Diwali pre).
// Let's test a homebound departure on Oct 31, 2025 (year 2025 fromCivil(2025, 10, 31)).
const g = newGame('Fest Sim Co', 'seth', 'maa-mdu', 4242)
g.company.rating = 4.5
g.company.punctuality = 0.95
g.permits['maa-mdu'] = {
  id: 'pm-fest',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: g.day + 1000,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}

g.buses['bus-ab'] = {
  id: 'bus-ab',
  reg: 'TN 01 AB 7777',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 5000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 36,
  ownership: 'attached',
  acquisitionDay: 1,
  purchasePrice: 6500000,
  parkedCityId: 'maa',
  fitnessExpiryDay: g.day + 1000,
  insuranceExpiryDay: g.day + 1000,
  permitExpiryDay: g.day + 1000,
  taxExpiryDay: g.day + 1000,
  pucExpiryDay: g.day + 1000,
  tyreKm: 5000, engineOilKm: 5000, brakeOilKm: 5000, coolantKm: 5000,
  lastMajorServiceKm: 0, lifeTrips: 0,
} as any

g.buses['bus-ba'] = {
  id: 'bus-ba',
  reg: 'TN 01 BA 8888',
  modelId: 'leyacsleep2',
  status: 'active',
  odometerKm: 5000,
  condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
  qualityScore: 4.5,
  seatCount: 36,
  ownership: 'attached',
  acquisitionDay: 1,
  purchasePrice: 6500000,
  parkedCityId: 'mdu',
  fitnessExpiryDay: g.day + 1000,
  insuranceExpiryDay: g.day + 1000,
  permitExpiryDay: g.day + 1000,
  taxExpiryDay: g.day + 1000,
  pucExpiryDay: g.day + 1000,
  tyreKm: 5000, engineOilKm: 5000, brakeOilKm: 5000, coolantKm: 5000,
  lastMajorServiceKm: 0, lifeTrips: 0,
} as any

g.staff['drv-1'] = { id: 'drv-1', name: 'D1', role: 'driver', busId: 'bus-ab', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' } as any
g.staff['drv-2'] = { id: 'drv-2', name: 'D2', role: 'driver', busId: 'bus-ab', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' } as any
g.staff['drv-3'] = { id: 'drv-3', name: 'D3', role: 'driver', busId: 'bus-ba', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' } as any
g.staff['drv-4'] = { id: 'drv-4', name: 'D4', role: 'driver', busId: 'bus-ba', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' } as any
g.staff['c-1'] = { id: 'c-1', name: 'C1', role: 'conductor', busId: 'bus-ab', salary: 1500000, skill: 8, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious' } as any
g.staff['c-2'] = { id: 'c-2', name: 'C2', role: 'conductor', busId: 'bus-ba', salary: 1500000, skill: 8, safety: 8, fatigue: 0, hiredDay: g.day, drivingStyle: 'cautious' } as any

const sch = createSchedule(g, {
  routeId: 'maa-mdu',
  depHour: 21,
  depMin: 0,
  paired: true,
  returnDepHour: 21,
  returnDepMin: 0,
  cancellation: 'standard',
  autoPrice: false,
  baseFare: 110000,
  returnBaseFare: 110000,
  redDeal: false,
})
if ('error' in sch) throw new Error(sch.error)
assignBus(g, sch.id, 'bus-ab')
assignBus(g, sch.id, 'bus-ba')

// Advance game to just before Diwali
// Start date of g is ~April 2025. Diwali 2025 is fromCivil(2025, 11, 1).
const diwaliDay = fromCivil(2025, 11, 1)
const diwaliPreDay = diwaliDay - 1 // Oct 31, 2025 (pre)
const diwaliFestDay = diwaliDay    // Nov 1, 2025 (festival_day)

// Also test Independence Day 2025
const indepDay = fromCivil(2025, 8, 15)
const indepPreDay = indepDay - 1   // Aug 14, 2025 (pre)

console.log(`Advancing to test windows...`)
let diwaliT5Sold = 0
let midweekT5Sold = 0
let indepT5Sold = 0
let festDayFinalSold = 0

while (g.day <= diwaliDay + 1) {
  g.company.rating = 4.5
  g.company.punctuality = 0.95
  g.company.cash = 100000000
  g.world.closures = {}
  for (const b of Object.values(g.buses)) {
    b.condition = { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 }
    b.tyreKm = 5000
    b.engineOilKm = 5000
    b.brakeOilKm = 5000
    b.coolantKm = 5000
  }
  for (const st of Object.values(g.staff)) {
    st.fatigue = 0
    st.morale = 100
  }

  advanceDay(g)

  // Measure T-5 sold on Diwali pre-day departure (departs on diwaliPreDay, so at g.day === diwaliPreDay - 5)
  if (g.day === diwaliPreDay - 5) {
    const t = Object.values(g.trips).find(tr => tr.scheduleId === sch.id && tr.day === diwaliPreDay && tr.direction === 'AB')
    if (t) {
      diwaliT5Sold = t.sold
      console.log(`[Diwali Pre-day T-5 Check] day=${g.day}, dep=${diwaliPreDay}: sold=${t.sold}/${t.seatCount} (${Math.round((t.sold / t.seatCount!) * 100)}%)`)
    }
  }

  // Measure T-5 sold on Independence Day pre-day departure (departs on indepPreDay, at g.day === indepPreDay - 5)
  if (g.day === indepPreDay - 5) {
    const t = Object.values(g.trips).find(tr => tr.scheduleId === sch.id && tr.day === indepPreDay && tr.direction === 'AB')
    if (t) {
      indepT5Sold = t.sold
      console.log(`[Independence Pre-day T-5 Check] day=${g.day}, dep=${indepPreDay}: sold=${t.sold}/${t.seatCount} (${Math.round((t.sold / t.seatCount!) * 100)}%)`)
    }
  }

  // Measure a normal midweek departure T-5 in September (e.g. Wednesday Sept 17, 2025)
  const normWed = fromCivil(2025, 9, 17)
  if (g.day === normWed - 5) {
    const t = Object.values(g.trips).find(tr => tr.scheduleId === sch.id && tr.day === normWed && tr.direction === 'AB')
    if (t) {
      midweekT5Sold = t.sold
      console.log(`[Normal Midweek T-5 Check] day=${g.day}, dep=${normWed}: sold=${t.sold}/${t.seatCount} (${Math.round((t.sold / t.seatCount!) * 100)}%)`)
    }
  }

  // Measure festival day itself final occupancy (Nov 1)
  if (g.day === diwaliFestDay) {
    const t = Object.values(g.trips).find(tr => tr.scheduleId === sch.id && tr.day === diwaliFestDay && tr.direction === 'AB')
    if (t) {
      festDayFinalSold = t.sold
      console.log(`[Diwali Festival Day Final Check] day=${g.day}: sold=${t.sold}/${t.seatCount} (${Math.round((t.sold / t.seatCount!) * 100)}%)`)
    }
  }
}

const diwaliT5Lf = Math.round((diwaliT5Sold / 36) * 100)
const midweekT5Lf = Math.round((midweekT5Sold / 36) * 100)
const indepT5Lf = Math.round((indepT5Sold / 36) * 100)
const festDayFinalLf = Math.round((festDayFinalSold / 36) * 100)

console.log('\n--- Results ---')
console.log(`Diwali Pre-day T-5 LF: ${diwaliT5Lf}% (sold ${diwaliT5Sold}/36)`)
console.log(`Independence Pre-day T-5 LF: ${indepT5Lf}% (sold ${indepT5Sold}/36)`)
console.log(`Normal Midweek T-5 LF: ${midweekT5Lf}% (sold ${midweekT5Sold}/36)`)
console.log(`Festival Day Final LF: ${festDayFinalLf}% (sold ${festDayFinalSold}/36)`)

// Assertions:
// 1. Diwali-week homebound departure at T-5 sold/cap is at least midweek peer +15 pts
const diwaliMidweekGap = diwaliT5Lf - midweekT5Lf
console.log(`Diwali vs Midweek T-5 Gap: +${diwaliMidweekGap} percentage points`)
assert.ok(diwaliMidweekGap >= 15, `Diwali T-5 LF (${diwaliT5Lf}%) must be at least 15 pts higher than midweek peer (${midweekT5Lf}%)`)

// 2. Independence pre-day clearly hotter than random midweek
const indepMidweekGap = indepT5Lf - midweekT5Lf
console.log(`Independence vs Midweek T-5 Gap: +${indepMidweekGap} percentage points`)
assert.ok(indepMidweekGap >= 5, `Independence pre-day T-5 LF (${indepT5Lf}%) must be hotter than midweek peer (${midweekT5Lf}%)`)

// 3. Festival day itself stays softer (40-75% band)
assert.ok(festDayFinalLf >= 40 && festDayFinalLf <= 75, `Festival day final LF (${festDayFinalLf}%) must be in the soft 40-75% band`)

console.log('\n======================================================')
console.log('✓ ALL FESTIVAL ADVANCE BOOKING TESTS PASSED!')
console.log('======================================================')
