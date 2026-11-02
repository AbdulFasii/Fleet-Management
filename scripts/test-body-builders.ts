import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import {
  modelSupportsBodyDesigns,
  designsForMaker,
  designsForModel,
  designFitsChassis,
  getDesign,
  coachTitle,
  busComfort,
  busMaintCostIndex,
  composeNewPrice,
} from '../src/engine/data/bodyBuilders'
import { orderNewBus, deliverOrdersPass, refreshMarkets } from '../src/engine/sim/fleet'
import { quoteRebody, rebodyBus } from '../src/engine/sim/maintenance'

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

console.log('Testing Body Builders & Chassis Designs...')

assert(modelSupportsBodyDesigns('leyacsleep'), 'Ashok Leyland 12M (leyacsleep) should support body designs')
assert(modelSupportsBodyDesigns('bb1624'), 'BharatBenz 1624 (bb1624) should support body designs')
assert(!modelSupportsBodyDesigns('volvo9600'), 'Volvo 9600 should NOT support custom body designs')
assert(!modelSupportsBodyDesigns('bb_5528t'), 'BharatBenz Cargo models should NOT support custom body designs')

const alDesigns = designsForMaker(undefined, 'Ashok Leyland')
const bbDesigns = designsForMaker(undefined, 'BharatBenz')

assert(alDesigns.length > 0, 'AL should have designs available')
assert(bbDesigns.length > 0, 'BB should have designs available')
assert(!alDesigns.some((d) => d.builder.id === 'mg_group'), 'AL should NOT have MG Group (BB-exclusive)')
assert(bbDesigns.some((d) => d.builder.id === 'mg_group'), 'BB should have MG Group')
assert(!alDesigns.some((d) => d.builder.id === 'veera'), 'Veera should be removed')
assert(!bbDesigns.some((d) => d.builder.id === 'veera'), 'Veera should be removed from BB')
assert(!alDesigns.some((d) => d.builder.id === 'maruthi'), 'Maruthi should be removed')
assert(!bbDesigns.some((d) => d.builder.id === 'maruthi'), 'Maruthi should be removed from BB')
for (const id of ['prakesh', 'rec', 'arvex']) {
  assert(alDesigns.some((d) => d.builder.id === id), `AL should have ${id}`)
  assert(bbDesigns.some((d) => d.builder.id === id), `BB should have ${id}`)
}

console.log(`✓ Maker filtering passed: AL has ${alDesigns.length} designs, BB has ${bbDesigns.length} designs`)

const al12 = BUS_MODELS['leyacsleep']!
const al15 = BUS_MODELS['leyacsleep15']!
assert(designFitsChassis(getDesign(undefined, 'arvex_elite')!, '15M'), 'ARVEX Elite fits 15M')
assert(!designFitsChassis(getDesign(undefined, 'arvex_elite')!, '12M'), 'ARVEX Elite does not fit 12M')
assert(designsForModel(undefined, al12).every((o) => designFitsChassis(o.design, '12M')), 'AL 12M only gets fitting designs')
assert(designsForModel(undefined, al15).some((o) => o.design.id === 'arvex_elite'), 'AL 15M can pick ARVEX Elite')
assert(!designsForModel(undefined, al12).some((o) => o.design.id === 'arvex_elite'), 'AL 12M cannot pick ARVEX Elite')
console.log('✓ Chassis length filtering passed')

const s = newGame('Test Operators', 'seth', 'blr_che')
s.company.cash = 10_000_000_000

const arvexElite = getDesign(s, 'arvex_elite')!
assert(arvexElite, 'ARVEX Elite design exists')
const alModel = BUS_MODELS['leyacsleep15']!
const expectedPrice = composeNewPrice(alModel, arvexElite, 'arvex')
const expectedLead = alModel.leadTimeDays + arvexElite.leadDaysAdd

assert(!!orderNewBus(s, 'leyacsleep', {}, undefined, 'arvex_elite'), '12M cannot order ARVEX Elite')
const orderErr = orderNewBus(s, 'leyacsleep15', {}, undefined, 'arvex_elite')
assert(!orderErr, `Order failed: ${orderErr}`)
assert(s.busOrders.length === 1, 'Bus order was placed')
const order = s.busOrders[0]
assert(order.bodyDesignId === 'arvex_elite', 'Order stamped with bodyDesignId')
assert(order.bodyDesignName === 'ARVEX Elite', 'Order stamped with bodyDesignName')
assert(order.bodyBuilderId === 'arvex', 'Order stamped with bodyBuilderId')
assert(order.price === expectedPrice, `Order price matches chassis + auto body (${order.price} vs ${expectedPrice})`)
assert(order.deliveryDay === s.day + expectedLead, `Order lead time matches`)

console.log('✓ orderNewBus with design package passed')

s.day = order.deliveryDay
deliverOrdersPass(s)
const deliveredBus = Object.values(s.buses).find((b) => b.modelId === 'leyacsleep15')!
assert(deliveredBus?.bodyDesignId === 'arvex_elite', 'Bus has bodyDesignId')
assert(coachTitle(alModel, deliveredBus.bodyDesignName).includes('ARVEX Elite'), 'coachTitle contains design name')

const comfort = busComfort(s, deliveredBus)
const maintIndex = busMaintCostIndex(s, deliveredBus)
assert(comfort === alModel.comfort + arvexElite.comfortDelta, `Comfort includes delta`)
assert(maintIndex === alModel.maintCostIndex + arvexElite.maintDelta, `Maint index includes delta`)
console.log('✓ Delivery / comfort / upkeep passed')

deliveredBus.condition.body = 40
deliveredBus.condition.ac = 40
deliveredBus.condition.electrical = 40
deliveredBus.condition.engine = 80
deliveredBus.condition.gearbox = 80
deliveredBus.condition.suspension = 80

const arvexGlide = getDesign(s, 'arvex_glide')!
assert(quoteRebody(s, deliveredBus, 'arvex_glide').cost > 0, 'Rebody quote generated')
assert(!rebodyBus(s, deliveredBus.id, 'arvex_glide'), 'Re-body ok')
assert(deliveredBus.bodyDesignId === 'arvex_glide', 'Bus updated with ARVEX Glide')
assert(deliveredBus.bodyDesignName === 'ARVEX Glide', 'Name updated')
console.log('✓ Re-body with ARVEX Glide design passed')

const mg = getDesign(s, 'mg_luxe')!
assert(mg, 'MG Luxe exists')
assert(!orderNewBus(s, 'bb1824', {}, undefined, 'mg_luxe'), 'BB can order MG Luxe')
assert(!!orderNewBus(s, 'leyacsleep', {}, undefined, 'mg_luxe'), 'AL cannot order MG Luxe')
console.log('✓ MG Group exclusivity passed')

s.usedMarket = []
refreshMarkets(s)
const alOrBbListings = s.usedMarket.filter((l) => {
  const m = BUS_MODELS[l.modelId]
  return m && (m.maker === 'Ashok Leyland' || m.maker === 'BharatBenz') && !m.isCargoOnly
})
if (alOrBbListings.length > 0) {
  assert(
    alOrBbListings.some((l) => Boolean(l.bodyDesignId && l.bodyDesignName)),
    'Used market listings rolled body designs for AL/BB coaches',
  )
  console.log(`✓ Used market rolls body designs on AL/BB listings (${alOrBbListings.length} found)`)
}

// ---- Secondary market tests ----
console.log('Testing Secondary Markets (eligibility, body stamps, pricing, cargo)...')
const { usedPrice, leaseMonthlyRent } = await import('../src/engine/sim/fleet')
const { VOLVO_9600_IDS } = await import('../src/engine/data/busModels')

// 1. Pricing with body package
const basePrice = usedPrice('bb1824', 3)
const customPrice = usedPrice('bb1824', 3, 'mg_luxe', s)
assert(customPrice > basePrice, `Used price with premium MG Luxe body is higher (${customPrice} > ${basePrice})`)

const baseRent = leaseMonthlyRent('bb1824', 3, 120_000)
const customRent = leaseMonthlyRent('bb1824', 3, 120_000, 'mg_luxe', s)
assert(customRent > baseRent, `Lease rent with premium body is higher (${customRent} > ${baseRent})`)
console.log('✓ Body-aware used pricing and lease rent passed')

// 2. Secondary market separate flags (used vs lease & attach)
const bbModel = BUS_MODELS['bb1824']!
const allDesigns = designsForModel(s, bbModel)
assert(allDesigns.some((d) => d.design.id === 'mg_luxe'), 'MG Luxe included by default')

const mgDesign = s.bodyBuilders.mg_group.designs.find((d) => d.id === 'mg_luxe')!

// Disable Used only
mgDesign.availableUsed = false
mgDesign.availableLeaseAttach = true
assert(!designsForModel(s, bbModel, { market: 'used' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe excluded from used')
assert(designsForModel(s, bbModel, { market: 'lease' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe included in lease')
assert(designsForModel(s, bbModel, { market: 'attach' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe included in attach')

// Disable Lease & Attach only
mgDesign.availableUsed = true
mgDesign.availableLeaseAttach = false
assert(designsForModel(s, bbModel, { market: 'used' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe included in used')
assert(!designsForModel(s, bbModel, { market: 'lease' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe excluded from lease')
assert(!designsForModel(s, bbModel, { market: 'attach' }).some((d) => d.design.id === 'mg_luxe'), 'MG Luxe excluded from attach')

// Reset
mgDesign.availableUsed = true
mgDesign.availableLeaseAttach = true
console.log('✓ Separate availableUsed & availableLeaseAttach flag filtering passed')

// 3. Multi-refresh eligibility check
let foundVolvoInLeaseOrAttach = false
for (let dayOffset = 0; dayOffset < 100; dayOffset += 7) {
  s.day = 100 + dayOffset
  refreshMarkets(s)

  // Olectra must never appear on used, lease, or attach
  assert(!s.usedMarket.some((l) => BUS_MODELS[l.modelId]?.maker === 'Olectra'), 'No Olectra in usedMarket')
  assert(!s.leaseOffers.some((l) => BUS_MODELS[l.modelId]?.maker === 'Olectra'), 'No Olectra in leaseOffers')
  assert(!s.attachOffers.some((l) => BUS_MODELS[l.modelId]?.maker === 'Olectra'), 'No Olectra in attachOffers')

  // Volvo 9600 family must never appear on used
  assert(!s.usedMarket.some((l) => VOLVO_9600_IDS.has(l.modelId)), 'No Volvo 9600 in usedMarket')

  if (s.leaseOffers.some((l) => VOLVO_9600_IDS.has(l.modelId)) || s.attachOffers.some((l) => VOLVO_9600_IDS.has(l.modelId))) {
    foundVolvoInLeaseOrAttach = true
  }

  // AL/BB in lease and attach should roll body designs
  const bbLease = s.leaseOffers.filter((o) => BUS_MODELS[o.modelId]?.maker === 'BharatBenz')
  for (const o of bbLease) {
    if (o.bodyDesignId) {
      assert(o.bodyBuilderId && o.bodyDesignName, 'Lease offer stamped with full body info')
    }
  }
}
assert(foundVolvoInLeaseOrAttach, 'Volvo 9600 rolled at least once in lease or attach offers')
console.log('✓ Eligibility (Olectra excluded, Volvo 9600 in lease/attach but not used) passed')

// 4. Scania Metrolink Sleeper
const scaniaSleep = BUS_MODELS['metrolink_sleep']
assert(scaniaSleep, 'metrolink_sleep exists in catalog')
assert(scaniaSleep.sleeper, 'metrolink_sleep is sleeper')
assert(scaniaSleep.seats === 36, 'metrolink_sleep has 36 seats')

// 5. Layout generation weightage (sleeper > hybrid > semi, no seater class in secondary)
const layoutCounts = { sleeper: 0, hybrid: 0, semi: 0, seater: 0 }
for (let dayOffset = 0; dayOffset < 150; dayOffset += 7) {
  s.day = 500 + dayOffset
  refreshMarkets(s)
  for (const l of s.usedMarket) {
    const m = BUS_MODELS[l.modelId]
    if (m && !m.isCargoOnly) {
      const k = m.layout.kind as keyof typeof layoutCounts
      if (layoutCounts[k] !== undefined) layoutCounts[k]++
    }
  }
}
assert(layoutCounts.sleeper > layoutCounts.hybrid, `Sleeper should be > hybrid (${layoutCounts.sleeper} vs ${layoutCounts.hybrid})`)
assert(layoutCounts.hybrid > layoutCounts.semi, `Hybrid should be > semi (${layoutCounts.hybrid} vs ${layoutCounts.semi})`)
assert(layoutCounts.seater === 0, `No seaters should roll in secondary market (${layoutCounts.seater})`)
console.log(`✓ Layout weight distribution (sleeper ${layoutCounts.sleeper} > hybrid ${layoutCounts.hybrid} > semi ${layoutCounts.semi}, seater ${layoutCounts.seater}) passed`)

// 6. Cargo independent rolls
s.company.dedicatedCargoSubsidiary = true
refreshMarkets(s)
const usedCargo = s.usedMarket.filter((l) => BUS_MODELS[l.modelId]?.cls === 'CARGO')
const leaseCargo = s.leaseOffers.filter((l) => BUS_MODELS[l.modelId]?.cls === 'CARGO')
const attachCargo = s.attachOffers.filter((l) => BUS_MODELS[l.modelId]?.cls === 'CARGO')
assert(usedCargo.length === 1, 'Exactly 1 used cargo truck')
assert(leaseCargo.length === 1, 'Exactly 1 lease cargo truck')
assert(attachCargo.length === 1, 'Exactly 1 attach cargo truck')
console.log('✓ Cargo independent board offers passed')

console.log('ALL BODY BUILDERS & DESIGNS TESTS PASSED!')
