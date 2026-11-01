import { newGame } from '../src/engine/newGame'
import {
  replaceTyres,
  serviceBus,
  axleTyresDue,
  dailyMaintenancePass,
  freeStaffedBays,
} from '../src/engine/sim/maintenance'
import { appointFleetManager, appointBayMechanic, hire, refreshHiringPool } from '../src/engine/sim/staffing'
import { buyUsed, refreshMarkets } from '../src/engine/sim/fleet'
import type { GameState, Bus } from '../src/engine/types'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
  console.log('PASS:', msg)
}

function setupGameWithBus(seed: number): { s: GameState; bus: Bus } {
  const s = newGame('Test Fleet', 'malik', 'maa-blr', seed)
  refreshMarkets(s)
  refreshHiringPool(s)
  const l = s.usedMarket[0]
  if (!l) throw new Error('No listing in usedMarket')
  buyUsed(s, l.id, { loanProductId: 'shriram', months: 36 })
  const bus = Object.values(s.buses)[0]
  if (!bus) throw new Error('Failed to acquire bus')
  bus.status = 'active'
  bus.transferReadyDay = undefined
  return { s, bus }
}

function testSprint3() {
  console.log('--- Testing Sprint 3 Features ---')

  // 1. Front tyre can hit limit while rear is fine
  const { s: s1, bus: bus1 } = setupGameWithBus(201)
  bus1.frontTyreKm = 190_000 // OEM front life is 200k (190k is 95% -> due)
  bus1.rearTyreKm = 100_000  // OEM rear life is 220k (100k is 45% -> ok)
  bus1.frontBrand = 'oem'
  bus1.rearBrand = 'oem'
  const info1 = axleTyresDue(bus1)
  assert(info1.frontDue === true, 'Front tyre alert triggered at 95% wear')
  assert(info1.rearDue === false, 'Rear tyre remains healthy at 45% wear')

  // 2. Retread cannot be applied to the front axle
  const retreadFrontErr = replaceTyres(s1, bus1.id, 'front', 'retread')
  assert(retreadFrontErr !== null && retreadFrontErr.includes('steer (front) axle'), 'Retread on front axle rejected: ' + retreadFrontErr)
  const retreadBothErr = replaceTyres(s1, bus1.id, 'both', 'retread')
  assert(retreadBothErr !== null && retreadBothErr.includes('rear axle only'), 'Retread on both axles rejected: ' + retreadBothErr)

  // 3. Retread CAN be applied to rear axle
  const cashBefore = s1.company.cash
  const retreadRearRes = replaceTyres(s1, bus1.id, 'rear', 'retread', { outside: true })
  assert(retreadRearRes === null, 'Retread on rear axle succeeds')
  assert(bus1.rearBrand === 'retread', 'Rear brand updated to retread')
  assert(bus1.rearTyreKm === 0, 'Rear tyre km reset to 0')
  assert(bus1.frontTyreKm === 190_000, 'Front tyre km untouched by rear change')
  assert(s1.company.cash < cashBefore, 'Cash deducted for rear retreads')

  // 4. Workshop bay discipline & explicit outside confirm
  const { s: s2, bus: bus2 } = setupGameWithBus(202)
  // s2 has 0 bays built/staffed initially
  assert(freeStaffedBays(s2) === 0, '0 free staffed bays initially')
  const inHouseErr = serviceBus(s2, bus2.id, 'a')
  assert(inHouseErr === 'No free staffed bay — send outside?', 'In-house service rejected when 0 free bays: ' + inHouseErr)
  assert(bus2.status === 'active', 'Bus remains active when in-house service cannot start')

  // Confirming outside service succeeds and marks bus outsideGarage
  const outsideRes = serviceBus(s2, bus2.id, 'a', { outside: true })
  assert(outsideRes === null, 'Explicit outside service succeeds')
  assert(bus2.status === 'workshop', 'Bus enters workshop status')
  assert(bus2.outsideGarage === true, 'bus.outsideGarage is true')
  assert(freeStaffedBays(s2) === 0, 'Outside garage job does not consume internal bays')

  // Advance time past turnaround: clears outside garage flag
  s2.day = (bus2.workshopUntilDay ?? s2.day) + 1
  dailyMaintenancePass(s2)
  assert(bus2.status === 'active', 'Bus released back to active')
  assert(bus2.outsideGarage === undefined, 'outsideGarage flag cleared on release')

  // 5. Workshop manager bay discipline: never auto-sends outside
  const { s: s3, bus: bus3 } = setupGameWithBus(203)
  hire(s3, s3.hiringPool[0].id)
  const manager = Object.values(s3.staff)[0]
  manager.role = 'manager'
  appointFleetManager(s3, manager.id)
  assert(freeStaffedBays(s3) === 0, '0 free staffed bays in s3')
  bus3.odometer = bus3.lastServiceOdo + 35_000 // service overdue
  dailyMaintenancePass(s3)
  assert(bus3.status === 'active', 'Manager leaves bus waiting in active instead of auto-sending outside')

  // Build and staff 1 bay in s3
  s3.workshop.level = 1
  s3.workshop.bays = 1
  hire(s3, s3.hiringPool[1].id)
  const mech = Object.values(s3.staff)[1]
  mech.role = 'mechanic'
  const appBayRes = appointBayMechanic(s3, mech.id)
  assert(appBayRes === null, 'appointBayMechanic succeeds: ' + appBayRes)
  assert(freeStaffedBays(s3) === 1, 'Now 1 free staffed bay available')
  dailyMaintenancePass(s3)
  assert(bus3.status === 'workshop', 'Manager books bus into free in-house staffed bay')
  assert(bus3.outsideGarage !== true, 'Manager job is in-house, not outside')

  console.log('--- ALL SPRINT 3 TESTS PASSED ---')
}

testSprint3()
