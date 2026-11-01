import assert from 'node:assert'
import { ROUTES } from '../src/engine/data/routes'
import { getDirectionalOccupancyRange } from '../src/engine/data/balance'
import { calendarFareMult, marketFare } from '../src/engine/sim/pricing'
import { newGame } from '../src/engine/newGame'
import { fromCivil, dow, FESTIVALS, festivalRunEffect } from '../src/engine/core/calendar'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { advanceDay } from '../src/engine/tick'
import type { Bus } from '../src/engine/types'

console.log('--- Testing Directional Occupancy and Pricing ---')

const route = ROUTES['maa-mdu']
assert.ok(route, 'Route maa-mdu should exist')

// Find a regular week in February 2025 (no festivals)
// Feb 2025: 1st is Sat (dow 6)
// Feb 7 is Friday (dow 5)
// Feb 8 is Saturday (dow 6)
// Feb 9 is Sunday (dow 0)
const friDay = fromCivil(2025, 2, 7)
const satDay = fromCivil(2025, 2, 8)
const sunDay = fromCivil(2025, 2, 9)

assert.strictEqual(dow(friDay), 5, 'Feb 7 2025 is Friday')
assert.strictEqual(dow(satDay), 6, 'Feb 8 2025 is Saturday')
assert.strictEqual(dow(sunDay), 0, 'Feb 9 2025 is Sunday')

// 1. Check Normal Friday Night
console.log('\n[Check 1] Normal Friday Night Occupancy & Pricing...')
const [friOutMin, friOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', friDay)
const [friRetMin, friRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', friDay)

console.log(`  Friday Chennai → Madurai (Outbound): ${Math.round(friOutMin * 100)}% - ${Math.round(friOutMax * 100)}%`)
console.log(`  Friday Madurai → Chennai (Return):   ${Math.round(friRetMin * 100)}% - ${Math.round(friRetMax * 100)}%`)

assert.strictEqual(Math.round(friOutMin * 100), 80, 'Friday outbound min should be 80%')
assert.strictEqual(Math.round(friOutMax * 100), 95, 'Friday outbound max should be 95%')
assert.strictEqual(Math.round(friRetMin * 100), 55, 'Friday return min should be 55%')
assert.strictEqual(Math.round(friRetMax * 100), 75, 'Friday return max should be 75%')

const friOutPrice = calendarFareMult(route, 'AB', friDay)
const friRetPrice = calendarFareMult(route, 'BA', friDay)
console.log(`  Friday Price: Outbound ${friOutPrice}x | Return ${friRetPrice}x`)
assert.ok(friOutPrice > friRetPrice, 'Friday Chennai departures should be priced higher than Madurai departures')
assert.strictEqual(friOutPrice, 1.30, 'Friday Chennai departures should be priced at 1.30')
assert.strictEqual(friRetPrice, 1.00, 'Friday Madurai departures should be priced at 1.00')

// 2. Check Normal Saturday Night
console.log('\n[Check 2] Normal Saturday Night Occupancy & Pricing...')
const [satOutMin, satOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', satDay)
const [satRetMin, satRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', satDay)

console.log(`  Saturday Chennai → Madurai: ${Math.round(satOutMin * 100)}% - ${Math.round(satOutMax * 100)}%`)
console.log(`  Saturday Madurai → Chennai: ${Math.round(satRetMin * 100)}% - ${Math.round(satRetMax * 100)}%`)

assert.strictEqual(Math.round(satOutMin * 100), 65, 'Saturday outbound min should be 65%')
assert.strictEqual(Math.round(satOutMax * 100), 85, 'Saturday outbound max should be 85%')
assert.strictEqual(Math.round(satRetMin * 100), 65, 'Saturday return min should be 65%')
assert.strictEqual(Math.round(satRetMax * 100), 85, 'Saturday return max should be 85%')

const satOutPrice = calendarFareMult(route, 'AB', satDay)
const satRetPrice = calendarFareMult(route, 'BA', satDay)
assert.strictEqual(satOutPrice, 1.25, 'Saturday outbound price should be 1.25')
assert.strictEqual(satRetPrice, 1.25, 'Saturday return price should be 1.25')

// 3. Check Normal Sunday Night
console.log('\n[Check 3] Normal Sunday Night Occupancy & Pricing...')
const [sunOutMin, sunOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', sunDay)
const [sunRetMin, sunRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', sunDay)

console.log(`  Sunday Chennai → Madurai (Outbound): ${Math.round(sunOutMin * 100)}% - ${Math.round(sunOutMax * 100)}%`)
console.log(`  Sunday Madurai → Chennai (Return):   ${Math.round(sunRetMin * 100)}% - ${Math.round(sunRetMax * 100)}%`)

assert.strictEqual(Math.round(sunOutMin * 100), 50, 'Sunday outbound min should be 50%')
assert.strictEqual(Math.round(sunOutMax * 100), 70, 'Sunday outbound max should be 70%')
assert.strictEqual(Math.round(sunRetMin * 100), 80, 'Sunday return min should be 80%')
assert.strictEqual(Math.round(sunRetMax * 100), 95, 'Sunday return max should be 95%')

const sunOutPrice = calendarFareMult(route, 'AB', sunDay)
const sunRetPrice = calendarFareMult(route, 'BA', sunDay)
console.log(`  Sunday Price: Outbound ${sunOutPrice}x | Return ${sunRetPrice}x`)
assert.ok(sunRetPrice > sunOutPrice, 'Sunday Madurai departures should be priced higher than Chennai departures')
assert.strictEqual(sunRetPrice, 1.30, 'Sunday Madurai departures should be priced at 1.30')
assert.strictEqual(sunOutPrice, 1.05, 'Sunday Chennai departures should be priced at 1.05')

// 4. Festival Window Checks (e.g. Diwali: Nov 1, pre: 4, post: 5)
console.log('\n[Check 4] Major Festival Window (Diwali)...')
const diwali = FESTIVALS.find((f) => f.id === 'diwali')!
const diwaliDay = fromCivil(2025, diwali.month, diwali.day)

// A. 1-3 days before major festival
const preDay = diwaliDay - 2
const [preOutMin, preOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', preDay)
const [preRetMin, preRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', preDay)
console.log(`  1-3d Before Festival: Chennai → Madurai ${Math.round(preOutMin * 100)}% - ${Math.round(preOutMax * 100)}%`)
console.log(`  1-3d Before Festival: Madurai → Chennai ${Math.round(preRetMin * 100)}% - ${Math.round(preRetMax * 100)}%`)
assert.strictEqual(Math.round(preOutMin * 100), 90)
assert.strictEqual(Math.round(preOutMax * 100), 100)
assert.strictEqual(Math.round(preRetMin * 100), 60)
assert.strictEqual(Math.round(preRetMax * 100), 85)

const preOutPrice = calendarFareMult(route, 'AB', preDay)
const preRetPrice = calendarFareMult(route, 'BA', preDay)
console.log(`  Pre-Festival Price: Outbound ${preOutPrice}x | Return ${preRetPrice}x`)
assert.ok(preOutPrice >= 1.50, 'Pre-festival outbound should surge >= 1.50')
assert.ok(preRetPrice <= 1.15, 'Pre-festival return should not surge')

// B. Festival day itself
const [festOutMin, festOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', diwaliDay)
const [festRetMin, festRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', diwaliDay)
console.log(`  Festival Day: Chennai → Madurai ${Math.round(festOutMin * 100)}% - ${Math.round(festOutMax * 100)}%`)
console.log(`  Festival Day: Madurai → Chennai ${Math.round(festRetMin * 100)}% - ${Math.round(festRetMax * 100)}%`)
assert.strictEqual(Math.round(festOutMin * 100), 40)
assert.strictEqual(Math.round(festOutMax * 100), 75)
assert.strictEqual(Math.round(festRetMin * 100), 40)
assert.strictEqual(Math.round(festRetMax * 100), 75)

const festOutPrice = calendarFareMult(route, 'AB', diwaliDay)
const festRetPrice = calendarFareMult(route, 'BA', diwaliDay)
console.log(`  Festival Day Price: Outbound ${festOutPrice}x | Return ${festRetPrice}x`)
assert.strictEqual(festOutPrice, 1.00, 'Festival day price should be normal (1.00)')
assert.strictEqual(festRetPrice, 1.00, 'Festival day price should be normal (1.00)')

// C. First return day after festival
const post1Day = diwaliDay + 1
const [post1OutMin, post1OutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', post1Day)
const [post1RetMin, post1RetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', post1Day)
console.log(`  First Return Day: Chennai → Madurai ${Math.round(post1OutMin * 100)}% - ${Math.round(post1OutMax * 100)}%`)
console.log(`  First Return Day: Madurai → Chennai ${Math.round(post1RetMin * 100)}% - ${Math.round(post1RetMax * 100)}%`)
assert.strictEqual(Math.round(post1OutMin * 100), 60)
assert.strictEqual(Math.round(post1OutMax * 100), 85)
assert.strictEqual(Math.round(post1RetMin * 100), 90)
assert.strictEqual(Math.round(post1RetMax * 100), 100)

const post1OutPrice = calendarFareMult(route, 'AB', post1Day)
const post1RetPrice = calendarFareMult(route, 'BA', post1Day)
console.log(`  First Return Day Price: Outbound ${post1OutPrice}x | Return ${post1RetPrice}x`)
assert.ok(post1RetPrice >= 1.50, 'First return day return trip should surge')
assert.ok(post1OutPrice <= 1.15, 'First return day outbound should remain moderate')

// D. Final holiday return rush
const postLateDay = diwaliDay + 4
const [postLateOutMin, postLateOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', postLateDay)
const [postLateRetMin, postLateRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', postLateDay)
console.log(`  Final Return Rush: Chennai → Madurai ${Math.round(postLateOutMin * 100)}% - ${Math.round(postLateOutMax * 100)}%`)
console.log(`  Final Return Rush: Madurai → Chennai ${Math.round(postLateRetMin * 100)}% - ${Math.round(postLateRetMax * 100)}%`)
assert.strictEqual(Math.round(postLateOutMin * 100), 50)
assert.strictEqual(Math.round(postLateOutMax * 100), 75)
assert.strictEqual(Math.round(postLateRetMin * 100), 90)
assert.strictEqual(Math.round(postLateRetMax * 100), 100)

const postLateOutPrice = calendarFareMult(route, 'AB', postLateDay)
const postLateRetPrice = calendarFareMult(route, 'BA', postLateDay)
console.log(`  Final Return Rush Price: Outbound ${postLateOutPrice}x | Return ${postLateRetPrice}x`)
assert.ok(postLateRetPrice >= 1.50, 'Final return rush return trip should surge')
assert.ok(postLateOutPrice <= 1.15, 'Final return rush outbound should remain moderate')

// 5. Test Market Fare calculation in the simulation
console.log('\n[Check 5] Dynamic Market Fare calculation...')
const s = newGame('Test Co', 'seth', 'maa-mdu', 100)
const friOutFare = marketFare(s, route, 'leyacsleep2', friDay, 'AB', undefined, 21, 0)
const friRetFare = marketFare(s, route, 'leyacsleep2', friDay, 'BA', undefined, 21, 0)
const sunOutFare = marketFare(s, route, 'leyacsleep2', sunDay, 'AB', undefined, 21, 0)
const sunRetFare = marketFare(s, route, 'leyacsleep2', sunDay, 'BA', undefined, 21, 0)

console.log(`  Friday Night Market Fare: Chennai → Madurai ₹${friOutFare / 100} | Madurai → Chennai ₹${friRetFare / 100}`)
console.log(`  Sunday Night Market Fare: Chennai → Madurai ₹${sunOutFare / 100} | Madurai → Chennai ₹${sunRetFare / 100}`)

assert.ok(friOutFare > friRetFare, 'Friday Chennai departure fare should be higher than Madurai departure fare')
assert.ok(sunRetFare > sunOutFare, 'Sunday Madurai departure fare should be higher than Chennai departure fare')

// 6. Test that E_AC_SEMI (EV vehicle) is included in AC_SEMI_PREM
console.log('\n[Check 6] Verifying E_AC_SEMI (EV vehicle) includes in AC_SEMI_PREM...')
const premSemiRange = getDirectionalOccupancyRange('AC_SEMI_PREM', 4.5, route, 'AB', friDay)
const evSemiRange = getDirectionalOccupancyRange('E_AC_SEMI', 4.5, route, 'AB', friDay)
console.log(`  AC_SEMI_PREM range: ${Math.round(premSemiRange[0] * 100)}% - ${Math.round(premSemiRange[1] * 100)}%`)
console.log(`  E_AC_SEMI (EV) range: ${Math.round(evSemiRange[0] * 100)}% - ${Math.round(evSemiRange[1] * 100)}%`)
assert.deepStrictEqual(evSemiRange, premSemiRange, 'E_AC_SEMI must have identical occupancy range to AC_SEMI_PREM')

// 7. Midweek lean verification (Mon-Thu: homebound 55-78%, return 45-68%)
console.log('\n[Check 7] Midweek Lean Verification (Mon-Thu)...')
const monDay = fromCivil(2025, 2, 3) // Monday
const [monOutMin, monOutMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'AB', monDay)
const [monRetMin, monRetMax] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, route, 'BA', monDay)
console.log(`  Monday Chennai → Madurai (Homebound): ${Math.round(monOutMin * 100)}% - ${Math.round(monOutMax * 100)}%`)
console.log(`  Monday Madurai → Chennai (Return):    ${Math.round(monRetMin * 100)}% - ${Math.round(monRetMax * 100)}%`)
assert.strictEqual(Math.round(monOutMin * 100), 55)
assert.strictEqual(Math.round(monOutMax * 100), 78)
assert.strictEqual(Math.round(monRetMin * 100), 45)
assert.strictEqual(Math.round(monRetMax * 100), 68)

// 8. 14 Simulated Friday nights: outbound vs return LF gap >= 15 pts
console.log('\n[Check 8] 14 Simulated Friday Nights Outbound vs Return LF Gap...')
const simGame = newGame('Paired Sim Co', 'seth', 'maa-mdu', 9999)
simGame.permits['maa-mdu'] = {
  id: 'pm-sim',
  routeId: 'maa-mdu',
  status: 'active',
  appliedDay: 1,
  approvedDay: 1,
  expiresDay: simGame.day + 500,
  depositPaid: 0,
  dailyFee: 0,
  tripsRun: 0,
}
simGame.buses['bus-ab'] = {
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
  fitnessExpiryDay: simGame.day + 500,
  insuranceExpiryDay: simGame.day + 500,
  permitExpiryDay: simGame.day + 500,
  taxExpiryDay: simGame.day + 500,
  pucExpiryDay: simGame.day + 500,
  tyreKm: 5000, engineOilKm: 5000, brakeOilKm: 5000, coolantKm: 5000,
  lastMajorServiceKm: 0, lifeTrips: 0,
} as Bus
simGame.buses['bus-ba'] = {
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
  fitnessExpiryDay: simGame.day + 500,
  insuranceExpiryDay: simGame.day + 500,
  permitExpiryDay: simGame.day + 500,
  taxExpiryDay: simGame.day + 500,
  pucExpiryDay: simGame.day + 500,
  tyreKm: 5000, engineOilKm: 5000, brakeOilKm: 5000, coolantKm: 5000,
  lastMajorServiceKm: 0, lifeTrips: 0,
} as Bus

simGame.staff['drv-1'] = { id: 'drv-1', name: 'D1', role: 'driver', busId: 'bus-ab', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' }
simGame.staff['drv-2'] = { id: 'drv-2', name: 'D2', role: 'driver', busId: 'bus-ab', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' }
simGame.staff['drv-3'] = { id: 'drv-3', name: 'D3', role: 'driver', busId: 'bus-ba', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' }
simGame.staff['drv-4'] = { id: 'drv-4', name: 'D4', role: 'driver', busId: 'bus-ba', salary: 2500000, skill: 7, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious', licenceClass: 'HMV_PSV' }
simGame.staff['c-1'] = { id: 'c-1', name: 'C1', role: 'conductor', busId: 'bus-ab', salary: 1500000, skill: 8, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious' } as any
simGame.staff['c-2'] = { id: 'c-2', name: 'C2', role: 'conductor', busId: 'bus-ba', salary: 1500000, skill: 8, safety: 8, fatigue: 0, hiredDay: simGame.day, drivingStyle: 'cautious' } as any

const pairedSch = createSchedule(simGame, {
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
if ('error' in pairedSch) throw new Error(pairedSch.error)
assignBus(simGame, pairedSch.id, 'bus-ab')
assignBus(simGame, pairedSch.id, 'bus-ba')

const fridayOutLfs: number[] = []
const fridayRetLfs: number[] = []

while (fridayOutLfs.length < 14) {
  simGame.company.rating = 4.5
  simGame.company.punctuality = 0.95
  simGame.company.cash = 100000000
  simGame.world.closures = {}
  for (const b of Object.values(simGame.buses)) {
    b.condition = { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 }
    b.tyreKm = 5000
    b.engineOilKm = 5000
    b.brakeOilKm = 5000
    b.coolantKm = 5000
  }
  for (const st of Object.values(simGame.staff)) {
    st.fatigue = 0
    st.morale = 100
  }
  advanceDay(simGame)
  if (dow(simGame.day) === 5) {
    const fest = festivalRunEffect(simGame.day)
    // Exclude festival return rush days where direction is inverted by design
    if (fest.phase === 'post_first' || fest.phase === 'post_late' || fest.phase === 'festival_day') {
      continue
    }
    const todayTrips = Object.values(simGame.trips).filter((t) => t.scheduleId === pairedSch.id && t.day === simGame.day)
    const outTrip = todayTrips.find((t) => t.direction === 'AB')
    const retTrip = todayTrips.find((t) => t.direction === 'BA')
    if (outTrip && retTrip) {
      const outCap = outTrip.seatCount || 36
      const retCap = retTrip.seatCount || 36
      const outLf = outTrip.sold / outCap
      const retLf = retTrip.sold / retCap
      console.log(`    Fri ${simGame.day}: Out LF ${Math.round(outLf * 100)}% (sold ${outTrip.sold}/${outCap}, fare ₹${outTrip.fare / 100}) vs Ret LF ${Math.round(retLf * 100)}% (sold ${retTrip.sold}/${retCap}, fare ₹${retTrip.fare / 100})`)
      fridayOutLfs.push(outLf)
      fridayRetLfs.push(retLf)
    }
  }
}

const avgOut = fridayOutLfs.reduce((a, b) => a + b, 0) / fridayOutLfs.length
const avgRet = fridayRetLfs.reduce((a, b) => a + b, 0) / fridayRetLfs.length
const gapPts = Math.round((avgOut - avgRet) * 100)

console.log(`  Friday Night Average LF over 14 nights: Outbound (MAA->MDU) ${Math.round(avgOut * 100)}% vs Return (MDU->MAA) ${Math.round(avgRet * 100)}%`)
console.log(`  Directional Gap: ${gapPts} percentage points`)
assert.ok(gapPts >= 15, `Friday night directional gap (${gapPts} pts) must be at least 15 percentage points`)

console.log('\n======================================================')
console.log('✓ ALL DIRECTIONAL OCCUPANCY & PRICING TESTS PASSED!')
console.log('======================================================')
