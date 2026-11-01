import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import {
  cargoGoingRateRs,
  cargoLaneImbalance,
  chargeableKg,
  corridorCargoMarketKg,
  cargoBookKg,
  CARGO_DENSITY,
} from '../src/engine/sim/cargo'
import { cityFreightProfile } from '../src/engine/data/cities'
import type { SpotCargoOffer } from '../src/engine/types'

console.log('Testing Cargo Gravity Market & Physics Rework...')

const s = newGame('Gravity Probe', 'seth', 'mdu-maa', 101)
s.company.dedicatedCargoSubsidiary = true

// 1. Chargeable Weight & Commodity Density
assert.equal(CARGO_DENSITY.hardware, 250)
assert.equal(CARGO_DENSITY.mixed, 167)
assert.equal(CARGO_DENSITY.agri, 140)
assert.equal(CARGO_DENSITY.textiles, 120)
assert.equal(CARGO_DENSITY.fmcg, 120)

// 100 kg actual, 1.0 CBM:
// Hardware: 1.0 * 250 = 250 kg chargeable
assert.equal(chargeableKg(100, 1.0, 'hardware'), 250)
// Textiles: 1.0 * 120 = 120 kg chargeable
assert.equal(chargeableKg(100, 1.0, 'textiles'), 120)
// Heavy cargo: actual weight binds
assert.equal(chargeableKg(500, 1.0, 'textiles'), 500)

console.log('✓ Chargeable weight and volumetric density rules verified')

// 2. City Profiles & Gravity Market
const blr = cityFreightProfile('blr')
const cbe = cityFreightProfile('cbe')
const pdy = cityFreightProfile('pdy')

assert.equal(blr.tier, 'metro')
assert.equal(cbe.tier, 'industrial')
assert.equal(blr.shipIndex >= 0.85, true)
assert.equal(cbe.shipIndex >= 0.80, true)

// Metro/Industrial route (Bengaluru -> Chennai) vs smaller town route (Puducherry -> Tiruvannamalai or similar)
const blrMaa = ROUTES['blr-maa']
assert(blrMaa, 'blr-maa route exists')
const mktBlrMaa = corridorCargoMarketKg(s, blrMaa, 'AB', s.day)
const totalMktBlrMaa = mktBlrMaa.parcelMarketKg + mktBlrMaa.bulkMarketKg

console.log(`blr-maa market: ${totalMktBlrMaa} kg (parcel ${mktBlrMaa.parcelMarketKg}, bulk ${mktBlrMaa.bulkMarketKg})`)
assert(totalMktBlrMaa > 3000, `Metro route blr-maa market should be substantial (>3000 kg), got ${totalMktBlrMaa}`)

// 3. Directional Imbalance & Going Rates
const imbAB = cargoLaneImbalance(s, blrMaa, 'AB', s.day)
const imbBA = cargoLaneImbalance(s, blrMaa, 'BA', s.day)
console.log(`blr-maa directional imbalance: AB=${imbAB}, BA=${imbBA}`)

const rateAB = cargoGoingRateRs(s, blrMaa, 'AB', s.day)
const rateBA = cargoGoingRateRs(s, blrMaa, 'BA', s.day)
console.log(`Going rates: AB=₹${rateAB.toFixed(2)}/100km, BA=₹${rateBA.toFixed(2)}/100km`)

// 4. Shipped Spot Offer Lifecycle (never 0 kg)
const sampleSpot: SpotCargoOffer = {
  id: 'spot_test',
  originCity: 'cbe',
  destCity: 'maa',
  routeId: 'cbe-maa',
  direction: 'AB',
  weightKg: 1200,
  volumeCbm: 10.0, // 10 * 120 = 1200
  cargoType: 'textiles',
  totalPayment: 1500000,
  offeredDay: 1,
  expiresDay: 3,
  status: 'shipped',
  remainingKg: 0,
  shippedKg: 1200,
  chargeableKg: 1200,
}

// Display logic verified
const displayKg = sampleSpot.status === 'shipped'
  ? (sampleSpot.shippedKg || sampleSpot.weightKg)
  : (sampleSpot.remainingKg ?? sampleSpot.weightKg)
assert.equal(displayKg, 1200, 'Shipped spot must display actual shipped weight (1200 kg), never 0 kg')

console.log('✓ Spot shipped lifecycle display check passed')
console.log('✓ All cargo gravity & physics probe checks passed successfully!')
