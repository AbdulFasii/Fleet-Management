import { newGame } from '../src/engine/newGame'
import { rs, toRupees } from '../src/engine/core/money'
import { applyDepreciation, spend, spendNetted, earn, settleReceivables } from '../src/engine/sim/finance'
import { calcGstDue, remitGst, fileTds, dailyTaxPass, monthlyTaxPass } from '../src/engine/sim/tax'
import { appointAccountant } from '../src/engine/sim/staffing'
import { dispatchPass } from '../src/engine/sim/dispatch'
import { dailyBankingPass, createLoan } from '../src/engine/sim/banking'
import { LOAN_PRODUCTS, CASH_LOAN_SLABS, MSME_LENDERS } from '../src/engine/data/loanProducts'
import type { Bus, Staff, Trip, Schedule } from '../src/engine/types'

console.log('--- Testing Sprint 8 Realism: Tax, Cash Timing, Accountant, Loan Desk ---')

// Check 1: WDV vs SLM depreciation speed in Year 1
console.log('\n[Check 1] WDV vs SLM depreciation in Year 1...')
const s = newGame('Test Operator', 'seth', 'blr-maa', 12345)
const price = rs(3_000_000) // ₹30L

const busSlm: Bus = {
  id: 'b_slm',
  reg: 'KA-01-EQ-1111',
  nickname: 'SLM Bus',
  modelId: 'cheetah',
  ownership: 'owned',
  depreciationMethod: 'SLM',
  mfgYear: 2022,
  acquiredDay: s.day,
  acquiredPrice: price,
  bookValue: price,
  odometer: 0,
  condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, ac: 90, electrical: 90, body: 90 },
  tyreKm: 0,
  tyresRetreaded: false,
  frontTyreKm: 0,
  rearTyreKm: 0,
  frontBrand: 'oem',
  rearBrand: 'oem',
  tyreCount: 6,
  lastServiceOdo: 0,
  insuranceExpiryDay: s.day + 365,
  fitnessExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 180,
  gpsDeviceFitted: true,
  roadTaxPayableDay: s.day + 365,
  aitpPaidUntilDay: s.day + 365,
  status: 'active',
  duty: 'line',
  accidentHistory: false,
  busCleanliness: 90,
  lifeRevenue: 0,
  lifeCost: 0,
  lifeTrips: 0,
  qualityScore: 4.5,
}

const busWdv: Bus = {
  ...busSlm,
  id: 'b_wdv',
  reg: 'KA-01-EQ-2222',
  nickname: 'WDV Bus',
  depreciationMethod: 'WDV',
}

s.buses = { b_slm: busSlm, b_wdv: busWdv }

// Run 12 monthly depreciation passes (1 Year)
for (let m = 1; m <= 12; m++) {
  applyDepreciation(s)
}

const slmDrop = price - busSlm.bookValue
const wdvDrop = price - busWdv.bookValue
console.log(`Initial price: ₹${toRupees(price)}`)
console.log(`SLM Book Value after 1 yr: ₹${toRupees(busSlm.bookValue)} (Drop: ₹${toRupees(slmDrop)})`)
console.log(`WDV Book Value after 1 yr: ₹${toRupees(busWdv.bookValue)} (Drop: ₹${toRupees(wdvDrop)})`)

if (wdvDrop > slmDrop * 3) {
  console.log('✓ WDV bus book value drops significantly faster in year 1 than SLM bus of same price')
} else {
  console.error(`FAIL: Expected WDV drop (${wdvDrop}) to be much greater than SLM drop (${slmDrop})`)
  process.exit(1)
}

// Check 2: Counter tickets cash timing (T+1 via receivables)
console.log('\n[Check 2] Counter tickets cash timing (T+1)...')
const cashBeforeTicket = s.company.cash
const ticketGross = rs(10_000)
const refs = { busId: 'b_slm', routeId: 'blr-maa' }
earn(s, 'ticket', ticketGross, refs, 1, 'counter')

if (s.company.cash === cashBeforeTicket && s.receivables.length > 0) {
  const rcv = s.receivables[s.receivables.length - 1]
  if (rcv.settleDay === s.day + 1 && rcv.amount === ticketGross && rcv.channel === 'counter') {
    console.log(`✓ Counter ticket gross of ₹${toRupees(ticketGross)} queued into receivables with settleDay = Day ${rcv.settleDay} (T+1)`)
  } else {
    console.error('FAIL: Receivable incorrect:', rcv)
    process.exit(1)
  }
} else {
  console.error('FAIL: Cash increased immediately instead of waiting for T+1')
  process.exit(1)
}

// Next morning: advance day by 1 and settle receivables
s.day += 1
settleReceivables(s)
if (s.company.cash === cashBeforeTicket + ticketGross) {
  console.log(`✓ Next morning (Day ${s.day}), counter cash arrived in treasury: +₹${toRupees(ticketGross)}`)
} else {
  console.error('FAIL: Counter cash did not arrive next morning')
  process.exit(1)
}

// Check 3: GST input credit from fuel & remittance
console.log('\n[Check 3] GST input credit from fuel (5%) & remittance...')
s.company.gstInputCredit = 0
s.company.gstPayable = rs(5_000)
const fuelSpendAmt = rs(40_000)

spend(s, 'fuel', fuelSpendAmt)
const expectedItc = Math.round(fuelSpendAmt * 0.05) // ₹2,000
if (s.company.gstInputCredit === expectedItc) {
  console.log(`✓ Fuel spend ₹${toRupees(fuelSpendAmt)} correctly generated 5% GST input credit: ₹${toRupees(expectedItc)}`)
} else {
  console.error(`FAIL: Expected GST input credit ₹${toRupees(expectedItc)}, got: ₹${toRupees(s.company.gstInputCredit)}`)
  process.exit(1)
}

const { netDue, creditUsed } = calcGstDue(s)
if (netDue === rs(3_000) && creditUsed === expectedItc) {
  console.log(`✓ Net GST due: ₹${toRupees(netDue)} after utilizing ₹${toRupees(creditUsed)} ITC`)
} else {
  console.error('FAIL: GST due calculation incorrect:', { netDue, creditUsed })
  process.exit(1)
}

// Remit GST manually
const cashBeforeGst = s.company.cash
remitGst(s)
if (s.company.cash === cashBeforeGst - netDue && s.company.gstPayable === 0 && s.company.gstInputCredit === 0) {
  console.log(`✓ GST remitted successfully: ₹${toRupees(netDue)} paid, balances cleared`)
} else {
  console.error('FAIL: GST remittance failed')
  process.exit(1)
}

// Check 4: Accountant desk auto-remitting GST on gstDueDay
console.log('\n[Check 4] Accountant auto-remits GST on due day...')
const acctStaff: Staff = {
  id: 'st_acct',
  name: 'Suresh Accountant',
  role: 'manager',
  skill: 8,
  salary: rs(35_000),
  loyalty: 90,
  morale: 90,
  experienceYears: 7,
  hiredDay: 1,
  fatigue: 0,
  safety: 8,
}
s.staff['st_acct'] = acctStaff
appointAccountant(s, 'st_acct')

// Simulate new month-end GST payable
s.company.gstPayable = rs(8_000)
s.company.gstInputCredit = rs(2_000)
monthlyTaxPass(s)

if (s.company.gstDueDay === s.day + 7) {
  console.log(`✓ monthlyTaxPass stopped auto-paying GST; set gstDueDay to Day ${s.company.gstDueDay}`)
} else {
  console.error('FAIL: gstDueDay not set properly:', s.company.gstDueDay)
  process.exit(1)
}

// Advance to due day
s.day = s.company.gstDueDay
const cashBeforeAutoGst = s.company.cash
dailyTaxPass(s)

if (s.company.gstPayable === 0 && s.company.gstDueDay === undefined) {
  const autoPaid = cashBeforeAutoGst - s.company.cash
  console.log(`✓ Accountant on duty auto-remitted GST on due day: ₹${toRupees(autoPaid)} paid net of ITC`)
} else {
  console.error('FAIL: Accountant did not auto-remit GST on due day')
  process.exit(1)
}

// Check 5: Attach owner payment withholds 1% TDS
console.log('\n[Check 5] Attached bus payout withholds 1% TDS...')
const busAttach: Bus = {
  ...busSlm,
  id: 'b_attach',
  reg: 'KA-01-EQ-9999',
  ownership: 'attached',
  attach: { ownerShare: 0.70, careLevel: 0.8 },
}
s.buses['b_attach'] = busAttach

s.staff['d_attach'] = {
  id: 'd_attach',
  name: 'Attached Driver',
  role: 'driver',
  busId: 'b_attach',
  skill: 6,
  safety: 7,
  salary: rs(20_000),
  morale: 80,
  loyalty: 80,
  experienceYears: 5,
  hiredDay: 1,
  fatigue: 0,
  licenceClass: 'HMV_PSV',
}

const attachTrip: Trip = {
  id: 'tr_attach_1',
  scheduleId: 'sch_test',
  routeId: 'blr-maa',
  direction: 'AB',
  busId: 'b_attach',
  day: s.day,
  depHour: 20,
  fare: rs(1000),
  seats: [],
  seatCount: 36,
  sold: 30,
  revenue: rs(30_000),
  cancelledRevenue: 0,
  channelSold: { redbus: 10, abhibus: 5, ownapp: 10, counter: 5 },
  status: 'open',
}
s.trips['tr_attach_1'] = attachTrip
s.openTripIds = ['tr_attach_1']

s.company.tdsPayable = 0
const cashBeforeTrip = s.company.cash
dispatchPass(s)
console.log('Attach trip status:', attachTrip.status, 'note:', attachTrip.outcome?.note)

// Total owner share: 30,000 * 0.70 = ₹21,000
// TDS 1%: ₹210
// Cash out: ₹20,790 (99%)
const expectedOwnerShare = rs(21_000)
const expectedTds = rs(210)
const expectedCashOut = expectedOwnerShare - expectedTds

if (s.company.tdsPayable === expectedTds) {
  console.log(`✓ Attached trip revenue ₹30,000 (70% share = ₹${toRupees(expectedOwnerShare)}): correctly withheld 1% TDS = ₹${toRupees(expectedTds)}`)
} else {
  console.error(`FAIL: Expected TDS payable ₹${toRupees(expectedTds)}, got: ₹${toRupees(s.company.tdsPayable)}`)
  process.exit(1)
}

// File TDS
const cashBeforeTds = s.company.cash
fileTds(s)
if (s.company.cash === cashBeforeTds - expectedTds && s.company.tdsPayable === 0) {
  console.log(`✓ Filed TDS return: ₹${toRupees(expectedTds)} cash remitted on filing day`)
} else {
  console.error('FAIL: TDS filing failed')
  process.exit(1)
}

// Check 6: Relationship update on paid / missed EMI
console.log('\n[Check 6] Banking relationship (+1 on paid, -5 on missed, clamp 0-100)...')
s.company.lenderRelations = { 'shriram': 10 }
const testLoan = createLoan(s, 'shriram', rs(1_000_000), 36, 'b_slm')!
testLoan.nextEmiDay = s.day
s.company.cash = rs(500_000)

// Paid EMI
dailyBankingPass(s)
if (s.company.lenderRelations['shriram'] === 11) {
  console.log('✓ On-time EMI payment increased Shriram relationship score from 10 to 11 (+1)')
} else {
  console.error('FAIL: Expected relationship score 11, got:', s.company.lenderRelations['shriram'])
  process.exit(1)
}

// Missed EMI (zero cash and limit)
s.company.cash = 0
s.od.limit = 0
s.od.drawn = 0
testLoan.nextEmiDay = s.day
dailyBankingPass(s)

if (s.company.lenderRelations['shriram'] === 6) {
  console.log('✓ Missed EMI decreased Shriram relationship score from 11 to 6 (-5)')
} else {
  console.error('FAIL: Expected relationship score 6, got:', s.company.lenderRelations['shriram'])
  process.exit(1)
}

// Check 7: 3 Loan Families Present
console.log('\n[Check 7] Unified loan desk catalog...')
console.log(`✓ Hire-purchase loan products count: ${LOAN_PRODUCTS.length}`)
console.log(`✓ Working-capital cash slabs count: ${CASH_LOAN_SLABS.length}`)
console.log(`✓ Government / NBFC MSME lenders count: ${MSME_LENDERS.length}`)

console.log('\n--- ALL SPRINT 8 CHECKS PASSED! ---')
