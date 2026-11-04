import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import {
  quoteRebody,
  rebodyBus,
  quotePowertrainOverhaul,
  overhaulPowertrain,
  quoteLuxuryRetrofit,
  retrofitLuxuryAmenities,
} from '../src/engine/sim/maintenance'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { busComfort } from '../src/engine/data/bodyBuilders'

console.log('Testing Mid-Life Refurbishment & Major Overhauls...')

const s = newGame('Overhaul Test Fleet', 'malik', 'blr-maa', 99999)

// 1. Create a 4-year-old Semi-Sleeper coach with worn powertrain and body
const busId = 'bus_midlife_test'
s.buses[busId] = {
  id: busId,
  reg: 'TN-01-AB-4001',
  nickname: 'Old Reliable',
  modelId: 'cheetah',
  ownership: 'owned',
  odometer: 380000,
  condition: { engine: 52, gearbox: 55, electrical: 60, body: 58, brakes: 80, suspension: 62, tyres: 75, ac: 58 },
  mfgYear: 2022,
  frontTyreKm: 15000,
  rearTyreKm: 15000,
  frontBrand: 'oem',
  rearBrand: 'oem',
  tyreCount: 6,
  lastServiceOdo: 370000,
  lastMajorServiceOdo: 360000,
  lastOverhaulDay: 0,
  lastOverhaulOdo: 0,
  insuranceExpiryDay: s.day + 300,
  fitnessExpiryDay: s.day + 300,
  pucExpiryDay: s.day + 180,
  gpsDeviceFitted: true,
  roadTaxPayableDay: s.day + 300,
  aitpPaidUntilDay: s.day + 90,
  parkedCityId: 'blr',
  cargoVolumeCbm: 8,
  status: 'active',
  duty: 'spare',
  bookValue: 25_000_000,
  acquiredDay: s.day - 365 * 4,
  depreciationMethod: 'SLM',
  accidentHistory: false,
  busCleanliness: 75,
  lifeRevenue: 0,
  lifeCost: 0,
  lifeTrips: 0,
  qualityScore: 3.8,
}

// Ensure sufficient cash (₹1 Crore in paise)
s.company.cash = 1_000_000_000

// TEST 1: Powertrain Overhaul (Engine & Gearbox)
console.log('1. Testing Powertrain Precision Overhaul...')
const pQuote = quotePowertrainOverhaul(s, s.buses[busId])
console.log(`   Quote: cost=${pQuote.cost / 100_000}L, days=${pQuote.days}`)
assert(pQuote.cost > 0, 'Powertrain quote should have positive cost')
assert.strictEqual(pQuote.days, 14, 'Powertrain overhaul should take 14 days')

const pErr = overhaulPowertrain(s, busId)
assert.strictEqual(pErr, null, 'Powertrain overhaul should succeed')
assert.strictEqual(s.buses[busId].status, 'workshop', 'Bus should be in workshop')
assert.strictEqual(s.buses[busId].condition.engine, 98, 'Engine condition should be reset to 98%')
assert.strictEqual(s.buses[busId].condition.gearbox, 98, 'Gearbox condition should be reset to 98%')
assert.strictEqual(s.buses[busId].powertrainOverhaulDay, s.day, 'Powertrain overhaul day recorded')
assert.strictEqual(s.buses[busId].powertrainKmplBonus, 0.10, '+10% fuel efficiency bonus active')
console.log('   ✓ Powertrain overhaul succeeded (Engine=98%, Gearbox=98%, +10% fuel economy)')

// Fast forward 14 days to let the powertrain job complete
const startDay = s.day
for (let d = 0; d < 14; d++) {
  advanceDay(s)
}
assert.strictEqual(s.buses[busId].status, 'active', 'Bus should return to active after 14 days')
console.log(`   ✓ Bus returned to active service after 14 days (day ${startDay} -> ${s.day})`)

// TEST 2: Luxury Amenities & Air Suspension Retrofit
console.log('2. Testing Luxury Amenities & Air Suspension Retrofit...')
const initialComfort = busComfort(s, s.buses[busId])
const lQuote = quoteLuxuryRetrofit(s, s.buses[busId])
console.log(`   Quote: cost=${lQuote.cost / 100_000}L, days=${lQuote.days}`)
assert(lQuote.cost > 0, 'Luxury quote should have positive cost')
assert.strictEqual(lQuote.days, 10, 'Luxury retrofit should take 10 days')

const lErr = retrofitLuxuryAmenities(s, busId)
assert.strictEqual(lErr, null, 'Luxury retrofit should succeed')
assert.strictEqual(s.buses[busId].status, 'workshop', 'Bus should enter workshop')
assert.strictEqual(s.buses[busId].airSuspensionFitted, true, 'Air suspension fitted')
assert.strictEqual(s.buses[busId].condition.suspension, 95, 'Suspension reset to 95%')
assert(busComfort(s, s.buses[busId]) >= initialComfort + 1.9, 'Comfort should be lifted by +2.0')
console.log(`   ✓ Luxury retrofit succeeded: Comfort ${initialComfort} -> ${busComfort(s, s.buses[busId])}, Air Suspension fitted`)

// Fast forward 10 days
for (let d = 0; d < 10; d++) {
  advanceDay(s)
}
assert.strictEqual(s.buses[busId].status, 'active', 'Bus should return to active service')
console.log('   ✓ Bus returned to active after luxury retrofit')

// TEST 3: Re-body & Layout Conversion (Semi-Sleeper -> Executive Sleeper)
console.log('3. Testing Re-bodying & Layout Conversion (Semi-Sleeper -> Executive Sleeper)...')
const oldModelId = s.buses[busId].modelId
const oldModel = BUS_MODELS[oldModelId]
assert.strictEqual(oldModel.sleeper, false, 'Initial bus is semi-sleeper')

const rQuote = quoteRebody(s, s.buses[busId])
console.log(`   Rebody Quote: cost=${rQuote.cost / 100_000}L, days=${rQuote.days}`)

// Convert layout to 'sleeper'
const rErr = rebodyBus(s, busId, undefined, 'sleeper')
assert.strictEqual(rErr, null, 'Re-body and layout conversion should succeed')
assert.strictEqual(s.buses[busId].status, 'workshop', 'Bus in workshop')
assert.strictEqual(s.buses[busId].refurbishedDay, s.day, 'Refurbished day recorded')
assert.strictEqual(s.buses[busId].lifeExtensionYears, 5, '+5 years life extension granted')
assert(s.buses[busId].condition.body >= 90, 'Body condition reset to 90+')
assert(s.buses[busId].condition.ac >= 90, 'AC condition reset to 90+')

const newModel = BUS_MODELS[s.buses[busId].modelId]
console.log(`   Converted model: ${oldModelId} (${oldModel.name}, ${oldModel.seats} seats) -> ${s.buses[busId].modelId} (${newModel.name}, ${newModel.seats} berths)`)
assert.strictEqual(newModel.sleeper, true, 'New model should be an Executive Sleeper!')
assert.strictEqual(newModel.layout?.kind, 'sleeper', 'New layout kind is sleeper')
console.log('   ✓ Re-body and layout conversion to Executive Sleeper succeeded!')

console.log('ALL MID-LIFE REFURBISHMENT & OVERHAUL TESTS PASSED SUCCESSFULLY! ✓')
