import { newGame } from '../src/engine/newGame'
import { ROUTES } from '../src/engine/data/routes'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { rs } from '../src/engine/core/money'
import { calculateCharterQuote, createCharterInquiry, dailyCharterPass, executeCharterContract } from '../src/engine/sim/festival'
import { EVENTS } from '../src/engine/sim/events'
import { appointScheduleManager, hireStaff } from '../src/engine/sim/staffing'
import type { Bus, GameState } from '../src/engine/types'

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

function makeTestBus(id: string, modelId = 'bb1624'): Bus {
  return {
    id,
    reg: 'TN 75 RG 9429',
    modelId,
    purchaseDay: 1,
    purchasePrice: rs(4_500_000),
    odometerKm: 25_000,
    status: 'active',
    ownership: 'owned',
    driverIds: [],
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, tyres: 90, electrical: 90, ac: 90 },
    breakdownHistory: [],
    documents: {
      pucExpiryDay: 100,
      fitnessExpiryDay: 100,
      insuranceExpiryDay: 100,
      roadTaxExpiryDay: 100,
      touristPermitExpiryDay: 100,
    },
    seatCount: 30,
    parkedCityId: 'maa',
  }
}

console.log('--- 1. Testing calculateCharterQuote math and profit ---')
{
  const s = newGame('Charter Test Co', 'malik', 'maa-cbe', 42)
  const route = ROUTES['maa-mdu'] || Object.values(ROUTES).find((r) => r.from === 'maa' && r.km >= 350)!
  const bus = makeTestBus('bus_test_1', 'bb1624')
  s.buses[bus.id] = bus
  assert(Boolean(route), 'Found route from maa')
  assert(Boolean(bus), 'Found bus')

  const q = calculateCharterQuote(s, bus, route)
  console.log(`Route: ${route.id} (${route.km * 2} km roundtrip)`)
  console.log(`Quote for ${bus.reg}: fee=₹${q.fee / 100}, expenses=₹${q.totalExpenses / 100}, net profit=₹${q.profit / 100} (rate: ₹${q.ratePerKm}/km)`)
  console.log(`Cost breakdown: fuel=₹${q.fuelCost / 100}, toll=₹${q.tollCost / 100}, bata=₹${q.bataCost / 100}, adblue=₹${q.adblueCost / 100}, other=₹${q.otherCosts / 100}`)

  assert(q.profit > 0, `Profit must be positive! Got ₹${q.profit / 100}`)
  assert(q.profit >= rs(5_000), `Profit should meet minimum floor of ₹5,000, got ₹${q.profit / 100}`)
  assert(q.fee >= q.totalExpenses, `Fee ₹${q.fee / 100} must cover expenses ₹${q.totalExpenses / 100}`)
  const margin = q.profit / q.fee
  console.log(`Profit margin: ${(margin * 100).toFixed(1)}%`)
  assert(margin >= 0.30, `Profit margin should be healthy (>= 30%), got ${(margin * 100).toFixed(1)}%`)
  assert(q.fee % rs(500) === 0, `Fee should be rounded to nearest ₹500, got ${q.fee}`)
}

console.log('\n--- 2. Testing Schedule Manager gating (no manager -> NO charters) ---')
{
  const s = newGame('Charter Test Co', 'malik', 'maa-cbe', 42)
  // Ensure no schedule manager
  s.company.scheduleManagerId = undefined
  assert(!s.company.scheduleManagerId, 'No schedule manager')

  // Attempt to create charter inquiry
  const fired = createCharterInquiry(s)
  assert(!fired, 'createCharterInquiry must return false when no schedule manager is appointed')
  assert(s.decisions.filter((d) => d.kind === 'festival_charter').length === 0, 'No decisions pushed')

  // Run dailyCharterPass
  dailyCharterPass(s)
  assert(s.decisions.filter((d) => d.kind === 'festival_charter').length === 0, 'dailyCharterPass created 0 charters without manager')

  // Check events.ts festival_charter event
  const charterEvt = EVENTS.find((e) => e.id === 'festival_charter')!
  assert(Boolean(charterEvt), 'Found festival_charter event')
  assert(!charterEvt.canFire(s), 'festival_charter event canFire must be false without schedule manager')
  console.log('Verified: Without a Schedule Manager, NO charters generate.')
}

console.log('\n--- 3. Testing with Schedule Manager appointed ---')
{
  const s = newGame('Charter Test Co', 'malik', 'maa-cbe', 42)

  // Hire a manager candidate and appoint as schedule manager
  const mgrCandidate = s.hiringPool.find((c) => c.role === 'manager') || {
    id: 'test_mgr_1',
    name: 'Ramanathan',
    role: 'manager' as const,
    salary: rs(35_000),
    experience: 5,
    joinedDay: 1,
    skill: 7,
    morale: 80,
    stress: 10,
    active: true,
  }
  s.staff[mgrCandidate.id] = mgrCandidate
  appointScheduleManager(s, mgrCandidate.id)
  assert(Boolean(s.company.scheduleManagerId), 'Schedule manager appointed')

  // Ensure there is an idle bus at depot city
  const bus = makeTestBus('bus_test_3', 'bb1624')
  s.buses[bus.id] = bus
  bus.scheduleId = undefined
  bus.parkedCityId = s.company.homeCityId || 'maa'
  bus.ownership = 'owned'
  bus.status = 'active'

  // Test Auto-Accept mode (default)
  s.company.scheduleAutoAcceptCharters = true
  const initialCash = s.company.cash
  const initialHistoryLen = s.seasonalStats?.history.length ?? 0

  const firedAuto = createCharterInquiry(s)
  assert(firedAuto, 'Charter generated and auto-accepted')
  assert(s.company.cash > initialCash, `Cash increased from charter revenue (was ${initialCash}, now ${s.company.cash})`)
  assert((s.seasonalStats?.history.length ?? 0) === initialHistoryLen + 1, 'Seasonal history recorded 1 charter run')
  assert(s.decisions.filter((d) => d.kind === 'festival_charter').length === 0, 'No pending decision hanging in auto-accept mode')
  console.log(`Auto-accept successful: cash changed by +₹${(s.company.cash - initialCash) / 100}`)

  // Test Manual Decision mode (scheduleAutoAcceptCharters = false)
  s.company.scheduleAutoAcceptCharters = false
  const firedManual = createCharterInquiry(s)
  assert(firedManual, 'Charter inquiry created')
  const pending = s.decisions.filter((d) => d.kind === 'festival_charter')
  assert(pending.length === 1, 'Exactly 1 charter decision pending')
  const dec = pending[0]
  console.log(`Decision title: ${dec.title}`)
  console.log(`Decision body:\n${dec.body}`)
  assert(dec.body.includes('Net Profit: +₹'), 'Decision body shows positive net profit')
  assert(!dec.body.includes('+₹0'), 'Decision body does NOT show +₹0 net profit')
  assert(dec.options[0].label.includes('Accept charter (+₹'), 'Accept button shows positive net profit')
  assert(!dec.options[0].label.includes('+₹0 net'), 'Accept button does NOT show +₹0 net')
}

console.log('\n--- 4. Testing Cooldown and Spam Reduction ---')
{
  const s = newGame('Charter Test Co', 'malik', 'maa-cbe', 42)
  const mgr = Object.values(s.staff).find((st) => st.role === 'manager') || {
    id: 'test_mgr_2',
    name: 'Karthik',
    role: 'manager' as const,
    salary: rs(35_000),
    experience: 5,
    joinedDay: 1,
    skill: 7,
    morale: 80,
    stress: 10,
    active: true,
  }
  s.staff[mgr.id] = mgr
  appointScheduleManager(s, mgr.id)
  s.company.scheduleAutoAcceptCharters = false

  const bus = makeTestBus('bus_test_4', 'bb1624')
  s.buses[bus.id] = bus

  // Set lastCharterDay to today
  s.world.lastCharterDay = s.day

  // dailyCharterPass should respect cooldown
  dailyCharterPass(s)
  assert(s.decisions.filter((d) => d.kind === 'festival_charter').length === 0, 'Cooldown blocked generation on same day')

  // Advance by 3 days (still < 6 days cooldown)
  s.day += 3
  dailyCharterPass(s)
  assert(s.decisions.filter((d) => d.kind === 'festival_charter').length === 0, 'Cooldown blocked generation on day + 3')

  // Event should also respect cooldown
  const charterEvt = EVENTS.find((e) => e.id === 'festival_charter')!
  assert(!charterEvt.canFire(s), 'Event cannot fire during cooldown')

  // Advance past cooldown (day + 7)
  s.day += 4
  assert(s.day - s.world.lastCharterDay >= 6, 'Past cooldown')
  assert(charterEvt.canFire(s), 'Event can fire after cooldown expires')
  console.log('Verified: 6-day cooldown and anti-spam gates work as designed.')
}

console.log('\n--- ALL CHARTER TESTS PASSED ---')
