import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { BUS_MODELS, isCharterModel } from '../src/engine/data/busModels'
import {
  calculateCharterQuote,
  getCharterConfig,
  canBusTakeContract,
  acceptCharterInquiry,
  rejectCharterInquiry,
  autoAssignBestCharters,
  sanitizeCharterData,
} from '../src/engine/sim/charter'
import { CHARTER_ROUTES } from '../src/engine/data/charterRoutes'
import { appointCharterManager } from '../src/engine/sim/staffing'
import { setBusDuty } from '../src/engine/sim/cover'

console.log('Testing Charter Operations System...')

const s = newGame('Test Transports', 'malik', 'maa_cbe_day', 12345)
console.log('1. New game created. Base charter config:', getCharterConfig(s))

// Test 5 new models
const modelsToCheck = [
  'urbania10', 'urbania13', 'urbania17',
  'winger9', 'winger12', 'winger15',
  'traveller12', 'traveller17', 'traveller26',
  'eicher24', 'eicher32',
  'bb1017_33', 'bb1017_39', 'bb1017_24slp',
]

for (const id of modelsToCheck) {
  const m = BUS_MODELS[id]
  if (!m) throw new Error(`Missing model: ${id}`)
  if (!isCharterModel(m)) throw new Error(`Model ${id} should be charter-only`)
  console.log(`  ✓ Model ${m.name} (${m.maker}): ${m.seats} seats, cls=${m.cls}, price=${m.priceNew}`)
}

// Test pricing algorithm
const sampleRoute = CHARTER_ROUTES[0]
const discountQuote = calculateCharterQuote(s, sampleRoute, 'discount')
const marketQuote = calculateCharterQuote(s, sampleRoute, 'market')
const premiumQuote = calculateCharterQuote(s, sampleRoute, 'premium')

console.log('2. Pricing Quote verification:')
console.log('   Discount Payout:', discountQuote.payout)
console.log('   Market Payout:', marketQuote.payout)
console.log('   Premium Payout:', premiumQuote.payout)

// Premium can only add fee until the 50% profit cap binds, so market and
// premium may land on the same capped price for a short tour.
if (!(discountQuote.payout < marketQuote.payout && marketQuote.payout <= premiumQuote.payout)) {
  throw new Error('Pricing strategy ordering failed!')
}

// Advance 3 days to test inquiry generation
advanceDay(s)
advanceDay(s)
advanceDay(s)

console.log(`3. After 3 days, charter inquiries count: ${s.charterInquiries?.length}`)
if (!s.charterInquiries || s.charterInquiries.length === 0) {
  throw new Error('Inquiries should be generated!')
}

const firstInquiry = s.charterInquiries[0]
console.log('   First Inquiry:', firstInquiry.title, 'for', firstInquiry.clientName, 'payout:', firstInquiry.payout)

// Create a bus in s.buses
const busId = 'bus_test_1'
s.buses[busId] = {
  id: busId,
  reg: 'TN-01-CH-9999',
  nickname: 'Pilgrim Star',
  modelId: 'traveller17',
  ownership: 'owned',
  odometer: 12000,
  condition: { engine: 90, gearbox: 90, electrical: 90, body: 90, brakes: 90, suspension: 90, tyres: 90, ac: 90 },
  mfgYear: 2024,
  frontTyreKm: 2000,
  rearTyreKm: 2000,
  frontBrand: 'oem',
  rearBrand: 'oem',
  tyreCount: 6,
  lastServiceOdo: 10000,
  lastMajorServiceOdo: 10000,
  lastOverhaulDay: 0,
  lastOverhaulOdo: 0,
  insuranceExpiryDay: s.day + 300,
  fitnessExpiryDay: s.day + 300,
  pucExpiryDay: s.day + 180,
  gpsDeviceFitted: true,
  roadTaxPayableDay: s.day + 300,
  aitpPaidUntilDay: s.day + 90,
  parkedCityId: 'maa',
  cargoVolumeCbm: 4.5,
  status: 'active',
  duty: 'line',
  accidentHistory: false,
  busCleanliness: 95,
  lifeRevenue: 0,
  lifeCost: 0,
  lifeTrips: 0,
  qualityScore: 4.8,
}
const bus = s.buses[busId]
console.log('4. Assigning bus to charter duty:', bus.reg)
const dutyErr = setBusDuty(s, busId, 'charter')
console.log('   Duty assignment result:', dutyErr ?? 'Success', 'Bus duty:', bus.duty)

// A tour needs a driver: with none free the booking is refused
firstInquiry.minSeats = 10
// Clients book 7-45 days ahead now; pin this one to start in two days so the tour runs in this test.
firstInquiry.startDay = s.day + 2
firstInquiry.endDay = firstInquiry.startDay + firstInquiry.durationDays - 1
firstInquiry.respondByDay = s.day + 1
const noCrewErr = acceptCharterInquiry(s, firstInquiry.id, busId)
if (!noCrewErr || !/driver/i.test(noCrewErr)) throw new Error('Booking should be refused when no driver is free, got: ' + noCrewErr)
console.log('   No driver -> refused:', noCrewErr)
s.staff['drv_test_1'] = { id: 'drv_test_1', name: 'Test Driver', role: 'driver', salary: 20000, skill: 6, fatigue: 10, morale: 80, loyalty: 50, lastPaidDay: s.day, safety: 6 } as never

// Deposit: a share of the fee is collected when the tour is booked
getCharterConfig(s).depositPct = 25
const cashBeforeBooking = s.company.cash
const acceptErr = acceptCharterInquiry(s, firstInquiry.id, busId)
const bookedContract = s.charterContracts?.find((c) => c.id === firstInquiry.id)
if (!acceptErr) {
  const expectedDeposit = Math.round(firstInquiry.payout * 0.25)
  if (bookedContract?.depositPaid !== expectedDeposit) throw new Error('Deposit should be 25% of the fee, got ' + bookedContract?.depositPaid)
  if (s.company.cash - cashBeforeBooking !== expectedDeposit) throw new Error('Deposit should reach cash at booking')
  console.log('   Deposit collected at booking:', expectedDeposit)
}
getCharterConfig(s).depositPct = 0
console.log('5. Accepting inquiry with bus:', acceptErr ?? 'Success')
if (acceptErr) throw new Error(acceptErr)

console.log('   Active/Booked contracts:', s.charterContracts?.length)
if (s.charterContracts?.[0]?.busId !== busId) {
  throw new Error('Contract not booked with busId')
}

// Advance simulation until contract completes
const initialHistoryCount = s.charterHistory?.length ?? 0
for (let i = 0; i < 5; i++) {
  advanceDay(s)
  if ((s.charterHistory?.length ?? 0) > initialHistoryCount) break
}

console.log('6. After 5 days advance:')
console.log('   Charter History count:', s.charterHistory?.length)
console.log('   Charter Stats:', s.charterStats)
console.log('   Company Cash:', s.company.cash)

if (Number.isNaN(s.company.cash)) {
  throw new Error('Cash became NaN!')
}

// The tour ran with the driver, who got tired on the road
const ran = [...(s.charterContracts ?? []), ...(s.charterHistory ?? [])].find((c) => c.id === s.charterContracts?.[0]?.id || c.busId === busId)
if (!ran || ran.driverId !== 'drv_test_1') throw new Error('Tour should have been crewed by the available driver, got ' + ran?.driverId)
if (s.staff['drv_test_1'].fatigue <= 10) throw new Error('Driver should be more tired after the tour days')
console.log('   Tour crewed by', s.staff['drv_test_1'].name, '· fatigue', s.staff['drv_test_1'].fatigue)

// 7. Test Smart Auto-Assign with Charter Manager
console.log('7. Testing Smart Auto-Assign with Manager...')
const staffId = 'staff_mgr_charter'
s.staff[staffId] = {
  id: staffId,
  name: 'V. Ramanathan',
  role: 'manager',
  salary: 4500000,
  skill: 9,
  stress: 20,
  joinedDay: 1,
}
s.company.charterManagerId = staffId

// Ensure we have an available charter bus
const busId2 = 'bus_test_2'
s.buses[busId2] = {
  ...bus,
  id: busId2,
  reg: 'TN-01-CH-8888',
  modelId: 'bb1017_33',
  duty: 'charter',
  status: 'active',
  condition: { engine: 90, gearbox: 90, electrical: 90, body: 90, brakes: 90, suspension: 90, tyres: 90, ac: 90 },
}

// Advance a day to generate fresh inquiries for upcoming days
advanceDay(s)

const assigned = autoAssignBestCharters(s)
console.log(`   Manager auto-assigned: ${assigned} contracts`)
console.log('   Active/Booked contracts:', s.charterContracts?.length)

// A request the 33-seat coach can take: the manager must answer it. Rival
// bids mean the client may still go elsewhere, so it ends signed or lost.
const fitting = { ...firstInquiry, id: 'chtr_fit_test', minSeats: 30, status: 'inquiry' as const, busId: undefined, driverId: undefined,
  startDay: s.day + 3, endDay: s.day + 3 + firstInquiry.durationDays - 1, respondByDay: s.day + 2, currentDayProgress: 0 }
s.charterInquiries = [fitting]
s.staff['drv_test_2'] = { id: 'drv_test_2', name: 'Second Driver', role: 'driver', salary: 20000, skill: 6, fatigue: 10, morale: 80, loyalty: 50, lastPaidDay: s.day, safety: 6 } as never
const assignedFit = autoAssignBestCharters(s)
const signedFit = s.charterContracts?.some((c) => c.id === 'chtr_fit_test')
const lostFit = s.inbox?.some((m) => /CHARTER LOST/.test(m.text))
console.log(`   Fitting request: ${signedFit ? 'signed' : lostFit ? 'lost to a rival' : 'still pending'} (assigned ${assigned + assignedFit})`)
if (s.charterInquiries.some((i) => i.id === 'chtr_fit_test')) {
  throw new Error('Manager should answer an eligible matching request (sign it or lose the bid)')
}

// 8. Test Data Sanitization against NaN
s.company.cash = NaN
sanitizeCharterData(s)
if (Number.isNaN(s.company.cash)) {
  throw new Error('sanitizeCharterData failed to fix NaN cash!')
}
console.log('8. Sanitize test passed, repaired cash:', s.company.cash)

console.log('ALL CHARTER TESTS PASSED SUCCESSFULLY! ✓')
