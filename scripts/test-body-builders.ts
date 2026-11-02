import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import {
  DEFAULT_BODY_BUILDERS,
  modelSupportsBodyDesigns,
  designsForMaker,
  getDesign,
  getBuilderForDesign,
  composeNewPrice,
  composeLeadTime,
  coachTitle,
  busComfort,
  busMaintCostIndex,
} from '../src/engine/data/bodyBuilders'
import { orderNewBus, deliverOrdersPass, buyUsed, refreshMarkets } from '../src/engine/sim/fleet'
import { quoteRebody, rebodyBus } from '../src/engine/sim/maintenance'

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

console.log('Testing Body Builders & Chassis Designs...')

// 1. Model eligibility
assert(modelSupportsBodyDesigns('leyacsleep'), 'Ashok Leyland 12M (leyacsleep) should support body designs')
assert(modelSupportsBodyDesigns('bb1624'), 'BharatBenz 1624 (bb1624) should support body designs')
assert(!modelSupportsBodyDesigns('volvo9600'), 'Volvo 9600 should NOT support custom body designs')
assert(!modelSupportsBodyDesigns('scania135'), 'Scania should NOT support custom body designs')
assert(!modelSupportsBodyDesigns('bb_5528t'), 'BharatBenz Cargo models should NOT support custom body designs')

// 2. Maker filtering: AL gets third-party only; BB gets OEM Factory + third-party
const alDesigns = designsForMaker(undefined, 'Ashok Leyland')
const bbDesigns = designsForMaker(undefined, 'BharatBenz')

assert(alDesigns.length > 0, 'AL should have designs available')
assert(bbDesigns.length > 0, 'BB should have designs available')
assert(!alDesigns.some(d => d.builder.id === 'bb_factory'), 'AL should NOT have BharatBenz Factory builder')
assert(bbDesigns.some(d => d.builder.id === 'bb_factory'), 'BB should have BharatBenz Factory builder')

console.log(`✓ Maker filtering passed: AL has ${alDesigns.length} designs, BB has ${bbDesigns.length} designs`)

// 3. Game state & Ordering New Bus
const s = newGame('Test Operators', 'seth', 'blr_che')
s.company.cash = 10_000_000_000 // 10 Cr (in paise)

const jcblExec = getDesign(s, 'jcbl_exec')!
assert(jcblExec, 'JCBL Executive design exists')
const alModel = BUS_MODELS['leyacsleep']!
const expectedPrice = alModel.priceNew + jcblExec.bodyPrice
const expectedLead = alModel.leadTimeDays + jcblExec.leadDaysAdd

const orderErr = orderNewBus(s, 'leyacsleep', {}, undefined, 'jcbl_exec')
assert(!orderErr, `Order failed: ${orderErr}`)
assert(s.busOrders.length === 1, 'Bus order was placed')
const order = s.busOrders[0]
assert(order.bodyDesignId === 'jcbl_exec', 'Order stamped with bodyDesignId')
assert(order.bodyDesignName === 'JCBL Executive', 'Order stamped with bodyDesignName')
assert(order.bodyBuilderId === 'jcbl', 'Order stamped with bodyBuilderId')
assert(order.price === expectedPrice, `Order price matches chassis + design (${order.price} vs ${expectedPrice})`)
assert(order.deliveryDay === s.day + expectedLead, `Order lead time matches chassis + design (${order.deliveryDay} vs ${s.day + expectedLead})`)

console.log('✓ orderNewBus with design package passed')

// 4. Delivery
s.day = order.deliveryDay
deliverOrdersPass(s)
assert(s.busOrders.length === 0, 'Order was delivered')
const deliveredBus = Object.values(s.buses).find(b => b.modelId === 'leyacsleep')!
assert(deliveredBus, 'Delivered bus found')
assert(deliveredBus.bodyDesignId === 'jcbl_exec', 'Bus has bodyDesignId')
assert(deliveredBus.bodyDesignName === 'JCBL Executive', 'Bus has bodyDesignName')
assert(deliveredBus.bodyBuilderId === 'jcbl', 'Bus has bodyBuilderId')

const title = coachTitle(alModel, deliveredBus.bodyDesignName)
assert(title.includes('JCBL Executive'), `coachTitle contains design name: ${title}`)
console.log(`✓ Bus delivered and stamped with coachTitle: "${title}"`)

// 5. Comfort and Maintenance deltas
const comfort = busComfort(s, deliveredBus)
const maintIndex = busMaintCostIndex(s, deliveredBus)
assert(comfort === alModel.comfort + jcblExec.comfortDelta, `Comfort includes delta (${comfort} vs ${alModel.comfort + jcblExec.comfortDelta})`)
assert(maintIndex === alModel.maintCostIndex + jcblExec.maintDelta, `Maint index includes delta (${maintIndex} vs ${alModel.maintCostIndex + jcblExec.maintDelta})`)

console.log(`✓ Comfort (${comfort}) and Upkeep (${maintIndex}) delta calculations passed`)

// 6. Re-body with custom design
// Give bus wear
deliveredBus.condition.body = 40
deliveredBus.condition.ac = 40
deliveredBus.condition.electrical = 40
deliveredBus.condition.engine = 80
deliveredBus.condition.gearbox = 80
deliveredBus.condition.suspension = 80

const veeraV7 = getDesign(s, 'veera_v7')!
const qRebody = quoteRebody(s, deliveredBus, 'veera_v7')
assert(qRebody.cost > 0 && qRebody.days > 0, 'Rebody quote generated')

const rebodyErr = rebodyBus(s, deliveredBus.id, 'veera_v7')
assert(!rebodyErr, `Re-body failed: ${rebodyErr}`)
assert(deliveredBus.bodyDesignId === 'veera_v7', 'Bus updated with new body design after re-body')
assert(deliveredBus.bodyDesignName === 'Veera V7', 'Bus updated with Veera V7 name')
assert(deliveredBus.condition.body >= 90, 'Body restored')
assert(deliveredBus.lifeExtensionYears === 5, 'Useful life extended')

console.log('✓ Re-body with Veera V7 design passed')

// 7. Used Market Rolls
s.usedMarket = []
refreshMarkets(s)
const alOrBbListings = s.usedMarket.filter(l => {
  const m = BUS_MODELS[l.modelId]
  return m && (m.maker === 'Ashok Leyland' || m.maker === 'BharatBenz')
})
if (alOrBbListings.length > 0) {
  assert(alOrBbListings.some(l => Boolean(l.bodyDesignId && l.bodyDesignName)), 'Used market listings rolled body designs for AL/BB coaches')
  console.log(`✓ Used market rolls body designs on AL/BB listings (${alOrBbListings.length} found)`)
}

console.log('ALL BODY BUILDERS & DESIGNS TESTS PASSED!')
