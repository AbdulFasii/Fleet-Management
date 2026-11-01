import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { BAL } from '../src/engine/data/balance'
import {
  cargoPermitActive,
  openCargoPermit,
  corporateOfferCapacityMult,
  corporateYearInfo,
  contractDailyCapKg,
  calcAnnualCorporateGrowthRate,
  getContractTier,
  pickContractPartner,
} from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import { ROUTES } from '../src/engine/data/routes'
import { rngFor } from '../src/engine/core/rng'
import type { Staff } from '../src/engine/types'

console.log('=== TEST: Dynamic -10% to +20% Corporate Growth & Tiered Client Naming ===')

const s = newGame('Test Corporate Growth', 'seth', 'maa-cbe', 42)
s.company.cash = 100_000_000_00
s.company.dedicatedCargoSubsidiary = true

// Staff manager
const mgr: Staff = {
  id: 'mgr1', name: 'Ravi', role: 'manager', skill: 9, experienceYears: 7,
  salary: 4000000, loyalty: 80, morale: 80, fatigue: 0, safety: 8, hiredDay: s.day,
}
s.staff[mgr.id] = mgr
appointCargoManager(s, mgr.id)

// 1. Both ways licence check
assert.equal(openCargoPermit(s, 'maa-cbe'), null)
assert.equal(cargoPermitActive(s, 'maa-cbe'), true, 'active direct')
assert.equal(cargoPermitActive(s, 'cbe-maa'), true, 'active both ways / reverse')
console.log('✓ Both-ways corridor cargo licence active on both directions (maa-cbe and cbe-maa)')

// 2. Year 1 Base Capacity
assert.equal(corporateOfferCapacityMult(s), 1.0, 'Year 1 = 1.00x')
assert.equal(contractDailyCapKg(s, 'parcel'), BAL.cargoContractDailyCapParcelKg)
assert.equal(contractDailyCapKg(s, 'bulk'), BAL.cargoContractDailyCapBulkKg)
console.log(`✓ Year 1 Base Cap: Parcel=${contractDailyCapKg(s, 'parcel')} kg, Bulk=${contractDailyCapKg(s, 'bulk')} kg`)

// 3. Dynamic Annual Growth Rate: Profit vs Loss
// A) In a profitable year (e.g. ₹10L profit)
s.company.fyProfit = 10_00_000_00
const rateProfit = calcAnnualCorporateGrowthRate(s, 1)
assert.ok(rateProfit >= 0.01 && rateProfit <= 0.20, `Rate with profit (${rateProfit}) must be between +1% and +20%`)
console.log(`✓ Profitable year growth rate: +${(rateProfit * 100).toFixed(1)}% (within [0%, +20%])`)

// B) In a loss year (e.g. -₹8L loss)
s.company.fyProfit = -8_00_000_00
const rateLoss = calcAnnualCorporateGrowthRate(s, 2)
assert.ok(rateLoss >= -0.10 && rateLoss <= 0.05, `Rate with loss (${rateLoss}) must be between -10% and +5%`)
console.log(`✓ Loss year growth rate: ${(rateLoss * 100).toFixed(1)}% (within [-10%, +5%])`)

// C) Advancing year in game state
s.company.fyProfit = 15_00_000_00
s.day += 365
const infoY2 = corporateYearInfo(s)
assert.equal(infoY2.yearIndex, 2)
assert.ok(infoY2.mult >= 0.90 && infoY2.mult <= 1.20, `Year 2 mult (${infoY2.mult}) must reflect -10% to +20% range`)
console.log(`✓ Year 2 Capacity: Mult=${infoY2.mult.toFixed(3)}x (${infoY2.pctBonus >= 0 ? '+' : ''}${infoY2.pctBonus}%), Parcel=${contractDailyCapKg(s, 'parcel')} kg`)

// 4. Client Tiered Naming by Order Quantity
const testRoute = ROUTES['maa-cbe']

// A) Small quantity: Local Players
assert.equal(getContractTier('parcel', 120), 'local')
const localPartner = pickContractPartner(rngFor(42, 'test-local'), 'local', 'parcel', testRoute, new Set())
console.log(`✓ Small quantity (120 kg): Tier='local', Partner='${localPartner}'`)
assert.ok(
  localPartner.includes('Textile') || localPartner.includes('Knitwear') || localPartner.includes('Regional') || localPartner.includes('Hardware'),
  'Must be a local business',
)

// B) Mid-level quantity: National Express Couriers (DTDC, Blue Dart, Delhivery/DTH)
assert.equal(getContractTier('parcel', 450), 'mid')
const midPartner = pickContractPartner(rngFor(42, 'test-mid'), 'mid', 'parcel', testRoute, new Set())
console.log(`✓ Mid-level quantity (450 kg): Tier='mid', Partner='${midPartner}'`)
assert.ok(
  midPartner.includes('DTDC') || midPartner.includes('Blue Dart') || midPartner.includes('Delhivery') || midPartner.includes('Professional') || midPartner.includes('Trackon'),
  'Must be a national courier (DTDC, Blue Dart, Delhivery / DTH)',
)

// C) Huge quantity orders: E-Commerce Mega Giants (Amazon, Flipkart, Meesho)
assert.equal(getContractTier('parcel', 950), 'enterprise')
const megaPartner = pickContractPartner(rngFor(42, 'test-mega'), 'enterprise', 'parcel', testRoute, new Set())
console.log(`✓ Huge quantity (950 kg): Tier='enterprise', Partner='${megaPartner}'`)
assert.ok(
  megaPartner.includes('Amazon') || megaPartner.includes('Flipkart') || megaPartner.includes('Meesho') || megaPartner.includes('Reliance') || megaPartner.includes('Tata 1mg'),
  'Must be an enterprise mega giant (Amazon, Flipkart, Meesho, Reliance)',
)

console.log('=== ALL CHECKS PASSED SUCCESSFULLY ===')
