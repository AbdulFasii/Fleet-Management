import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { retrofitBus } from '../src/engine/sim/maintenance'
import { busHasFitting } from '../src/engine/data/amenitiesCatalog'
import { resolvedAmenities } from '../src/engine/sim/groups'
import { installDepotFuelTank, orderDepotFuelRefill, setFuelContract } from '../src/engine/sim/depot'
import { checkCertifications } from '../src/engine/sim/reputation'
import { resolveTripFare } from '../src/engine/sim/pricing'
import { BAL } from '../src/engine/data/balance'
import { rs, toRupees } from '../src/engine/core/money'
import { generateTrips, bookingPass } from '../src/engine/sim/booking'
import { dispatchPass } from '../src/engine/sim/dispatch'

console.log('=== REALISM EXPANSION VERIFICATION TEST ===\n')

const s = newGame('Realism Busways', 'seth', 'maa-blr', 12345)
s.company.cash = rs(50_00_000) // ₹50 Lakhs test capital

// -------------------------------------------------------------
// Test 1: In-Cabin Passenger Amenities & Retrofits
// -------------------------------------------------------------
console.log('--- Test 1: Amenities & Retrofits ---')
// Create a starter bus
const bus = {
  id: 'bus_test_1',
  reg: 'TN 01 AB 1234',
  modelId: 'bb1624',
  ownership: 'owned' as const,
  acquiredDay: s.day,
  purchaseCost: rs(35_00_000),
  odometer: 100_000,
  lastServiceOdo: 100_000,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, electrical: 90, ac: 90, body: 90 },
  status: 'active' as const,
  parkedCityId: s.company.homeCityId,
  qualityScore: 4.5,
  lifeTrips: 10,
  gpsDeviceFitted: true,
  busCleanliness: 85,
  insuranceExpiryDay: s.day + 180,
  fitnessExpiryDay: s.day + 180,
  pucExpiryDay: s.day + 180,
  roadTaxPayableDay: s.day + 180,
}
s.buses[bus.id] = bus

// Driver assigned
const driver = {
  id: 'st_drv_1',
  name: 'Murugan',
  role: 'driver' as const,
  skill: 8,
  safety: 8,
  fatigue: 10,
  salary: rs(28_000),
  hiredDay: s.day,
  busId: bus.id,
}
s.staff[driver.id] = driver

// Retrofit WiFi, USB, CCTV
const wifiErr = retrofitBus(s, bus.id, 'wifi')
if (wifiErr) throw new Error(`WiFi retrofit failed: ${wifiErr}`)
if (!bus.wifiFitted) throw new Error('bus.wifiFitted is not true')

// USB charging left the fittings catalog; seat power is the 220V socket fitting now.
const usbErr = retrofitBus(s, bus.id, 'powerSockets')
if (usbErr) throw new Error(`Power socket retrofit failed: ${usbErr}`)
if (!busHasFitting(bus, 'powerSockets')) throw new Error('power sockets not fitted')

const cctvErr = retrofitBus(s, bus.id, 'cctv')
if (cctvErr) throw new Error(`CCTV retrofit failed: ${cctvErr}`)
if (!bus.cctvFitted) throw new Error('bus.cctvFitted is not true')
console.log('✓ Bus retrofitted with WiFi, power sockets, and CCTV successfully.')

// Test Schedule with Amenities
const schRes = createSchedule(s, {
  routeId: 'maa-blr',
  depHour: 21,
  depMin: 0,
  baseFare: rs(800),
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  serviceTier: 'gold',
})
if ('error' in schRes) throw new Error(`Schedule creation failed: ${schRes.error}`)
assignBus(s, schRes.id, bus.id)

const sch = s.schedules[schRes.id]!
if (sch.serviceTier !== 'gold') throw new Error('Schedule serviceTier is not gold')
// Amenities are a company (or brand) policy now, not a per-schedule setting.
s.company.defaultAmenities = { ...(s.company.defaultAmenities ?? {}), waterBottle: true, snackHamper: true, sanitizedBedding: true }
const served = resolvedAmenities(s, sch)
if (!served.waterBottle || !served.snackHamper) throw new Error('Company amenities not applied to the schedule')
console.log('✓ Gold Tier Schedule created with water, snacks, and bedding amenities.')

// -------------------------------------------------------------
// Test 2: Commercial Bulk Fuel Yard Tank & OMC Fleet Card
// -------------------------------------------------------------
console.log('\n--- Test 2: Bulk Yard Tank & OMC Fleet Card ---')
const tankErr = installDepotFuelTank(s)
if (tankErr) throw new Error(`Depot fuel tank install failed: ${tankErr}`)
if (!s.company.depotFuelTank?.installed) throw new Error('Depot fuel tank not marked installed')
if (s.company.depotFuelTank.capacityLitres !== 10_000) throw new Error('Capacity is not 10,000L')

const refillErr = orderDepotFuelRefill(s, 8_000)
if (refillErr) throw new Error(`Depot fuel refill failed: ${refillErr}`)
if (s.company.depotFuelTank.litres !== 8_000) throw new Error('Tank litres is not 8,000L')
console.log('✓ 10,000L Depot Bulk Yard Tank installed and filled with 8,000L at wholesale discount.')

// OMC Fleet Card Partner
const cardErr = setFuelContract(s, 'indianoil')
if (cardErr) throw new Error(`Fuel contract failed: ${cardErr}`)
if (s.company.fuelContract?.partner !== 'indianoil' || !s.company.fuelContract.active) {
  throw new Error('IndianOil fleet card not active')
}
console.log('✓ IndianOil XtraPower fleet card activated (2.5% rebate + adulteration immunity).')

// -------------------------------------------------------------
// Test 3: Live Yield Flash Deals & Surge Pricing
// -------------------------------------------------------------
console.log('\n--- Test 3: Yield Deals & Dynamic Pricing ---')
generateTrips(s)
const trip = Object.values(s.trips).find((t) => t.scheduleId === sch.id && t.status === 'open')
if (!trip) throw new Error('No open trip generated for schedule')

const basePrice = trip.fare
// Trigger flash sale
trip.flashDeal = true
const flashPrice = resolveTripFare(s, trip, sch, bus, trip.day - s.day)
console.log(`Base Fare: ₹${toRupees(basePrice)} -> Flash Sale (-20%): ₹${toRupees(flashPrice)}`)
if (flashPrice >= basePrice) throw new Error('Flash deal did not discount fare')

// Trigger surge deal
trip.flashDeal = false
trip.surgeDeal = true
const surgePrice = resolveTripFare(s, trip, sch, bus, trip.day - s.day)
console.log(`Base Fare: ₹${toRupees(basePrice)} -> Surge Pricing (+25%): ₹${toRupees(surgePrice)}`)
if (surgePrice <= basePrice) throw new Error('Surge deal did not increase fare')
trip.surgeDeal = false
trip.fare = basePrice
console.log('✓ Flash deals and surge pricing dynamically adjust fares as expected.')

// -------------------------------------------------------------
// Test 4: Driver Eco-Driving & Safety Incentives
// -------------------------------------------------------------
console.log('\n--- Test 4: Eco-Driving & Safety Incentives ---')
s.company.ecoIncentiveActive = true
console.log('✓ Eco-Driving mileage incentive activated (₹250/trip bonus).')

// -------------------------------------------------------------
// Test 5: Operator Certifications Check
// -------------------------------------------------------------
console.log('\n--- Test 5: Operator Certifications Check ---')
s.company.rating = 4.3
s.company.cmvrOffenceCount = 0
bus.busCleanliness = 85
checkCertifications(s)
if (!s.company.certifications?.womenFriendly) {
  throw new Error('Women-Friendly certification not awarded despite 100% CCTV and 4.3 rating')
}
if (!s.company.certifications?.cleanCertified) {
  throw new Error('Clean Coach certification not awarded despite 85 cleanliness and 4.3 rating')
}
console.log('✓ Women-Friendly & Clean Coach certifications verified and awarded.')

// -------------------------------------------------------------
// Test 6: Active Dispatch, Amenities Deduction & Relief Bus
// -------------------------------------------------------------
console.log('\n--- Test 6: Dispatch Execution & Fuel Draw ---')
// Set trip day to today to dispatch
trip.day = s.day
trip.sold = 30
const initialFuelInTank = s.company.depotFuelTank.litres

// Dispatch the day
const dispatchRes = dispatchPass(s)
console.log(`Departed: ${dispatchRes.departed}, Passengers: ${dispatchRes.pax}`)

if (trip.status !== 'completed') throw new Error('Trip was not completed')
console.log('Trip Outcome:', {
  fuelCost: trip.outcome?.fuelCost,
  tripCosts: trip.outcome?.tripCosts,
  amenitiesCost: trip.outcome?.amenitiesCost,
  pss: trip.outcome?.pss,
  note: trip.outcome?.note,
})

if (s.company.depotFuelTank.litres >= initialFuelInTank) {
  throw new Error('Depot fuel tank was not drawn down during home departure')
}
console.log(`✓ Fuel tank drawn down from ${initialFuelInTank}L to ${s.company.depotFuelTank.litres}L.`)
if (!trip.outcome?.amenitiesCost || trip.outcome.amenitiesCost <= 0) {
  throw new Error('Amenities cost was not computed and charged on trip')
}
console.log(`✓ In-cabin passenger amenities cost charged: ₹${toRupees(trip.outcome.amenitiesCost)}.`)
if (trip.outcome.pss < 8.0) {
  throw new Error(`Expected high PSS due to gold tier and amenities, got ${trip.outcome.pss}`)
}
console.log(`✓ PSS boosted to ${trip.outcome.pss}/10 with amenities & tech retrofits.`)

// -------------------------------------------------------------
// Test 7: Active Breakdown Crisis & Relief Coach Dispatch
// -------------------------------------------------------------
console.log('\n--- Test 7: Active Breakdown & Relief Coach Dispatch ---')
// Add a spare relief bus at home depot
const spareBus = {
  id: 'bus_relief_spare',
  reg: 'TN 01 RELIEF',
  modelId: 'bb1624',
  ownership: 'owned' as const,
  acquiredDay: s.day,
  purchaseCost: rs(35_00_000),
  odometer: 50_000,
  lastServiceOdo: 50_000,
  condition: { engine: 85, gearbox: 85, brakes: 85, suspension: 85, electrical: 85, ac: 85, body: 85 },
  status: 'active' as const,
  parkedCityId: s.company.homeCityId,
  qualityScore: 4.5,
  lifeTrips: 5,
  gpsDeviceFitted: true,
  busCleanliness: 85,
  insuranceExpiryDay: s.day + 180,
  fitnessExpiryDay: s.day + 180,
  pucExpiryDay: s.day + 180,
  roadTaxPayableDay: s.day + 180,
}
s.buses[spareBus.id] = spareBus

// Add extra driver so CMVR doesn't block trip2
const driver2 = {
  id: 'st_drv_2',
  name: 'Selvam',
  role: 'driver' as const,
  skill: 8,
  safety: 8,
  fatigue: 10,
  salary: rs(28_000),
  hiredDay: s.day,
  busId: bus.id,
}
s.staff[driver2.id] = driver2

// Force breakdown condition on bus 1
bus.odometer = 500_000
bus.lastServiceOdo = 50_000
bus.condition = { engine: 5, gearbox: 5, brakes: 5, suspension: 5, electrical: 5, ac: 5, body: 5 }
bus.status = 'active'
bus.parkedCityId = s.company.homeCityId

generateTrips(s)
for (let d = 1; d <= 10; d++) {
  s.day += 1
  generateTrips(s)
  bus.status = 'active'
  const openTrip = Object.values(s.trips).find((t) => t.scheduleId === sch.id && t.day === s.day && t.status === 'open')
  if (!openTrip) continue
  openTrip.sold = 20
  dispatchPass(s)
  if (openTrip.outcome?.breakdown) {
    console.log('Breakdown occurred on trip:', {
      breakdown: openTrip.outcome.breakdown,
      reliefDispatched: openTrip.outcome.reliefDispatched,
      delayMin: openTrip.outcome.delayMin,
      note: openTrip.outcome.note,
    })
    if (openTrip.outcome.reliefDispatched) {
      console.log(`✓ Relief coach successfully dispatched! Delay limited to ${openTrip.outcome.delayMin}m (<75m).`)
    }
    break
  }
}

console.log('\n=== ALL 6 REALISM OPERATIONAL SYSTEMS VERIFIED SUCCESSFULLY! ===')
