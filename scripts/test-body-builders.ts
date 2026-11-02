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

console.log('ALL BODY BUILDERS & DESIGNS TESTS PASSED!')
