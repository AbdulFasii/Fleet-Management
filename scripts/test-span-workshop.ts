import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import {
  appointFleetManager,
  recruitVeteran,
} from '../src/engine/sim/staffing'
import { spanDemand, deskCapacity, deskCoverage } from '../src/engine/sim/span'
import {
  quoteService,
  dailyMaintenancePass,
  freeStaffedBays,
} from '../src/engine/sim/maintenance'
import type { Bus } from '../src/engine/types'

let failures = 0
function check(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ ${desc}`)
  } else {
    console.error(`  ✗ ${desc}`)
    failures++
  }
}

console.log('[1] Workshop Demand: Built Bays')
{
  const s = newGame('WorkshopDemand', 'seth', 'maa-mdu', 7)
  s.workshop.bays = 5
  check(spanDemand(s, 'workshop') === 5, 'demand is 5 built bays')

  s.workshop.bays = 12
  check(spanDemand(s, 'workshop') === 12, 'demand is 12 built bays')
}

console.log('\n[2] Workshop Manager Span & Coverage')
{
  const s = newGame('WorkshopSpan', 'seth', 'maa-mdu', 7)
  s.workshop.bays = 8
  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointFleetManager(s, mgr.id)

  check(deskCapacity(s, 'workshop') === 8, 'skill 5 capacity is 8 bays')
  check(deskCoverage(s, 'workshop') === 1.0, '8 bays on cap 8 is 100% coverage')

  // Expand to 16 bays: coverage drops to 0.50
  s.workshop.bays = 16
  check(deskCoverage(s, 'workshop') === 0.50, `16 bays gives 0.50 coverage (got ${deskCoverage(s, 'workshop')})`)

  // Expand to 50 bays: coverage clamps at minCoverage floor (0.20)
  s.workshop.bays = 50
  check(deskCoverage(s, 'workshop') === 0.20, `50 bays clamped at minCoverage 0.20 (got ${deskCoverage(s, 'workshop')})`)
}

console.log('\n[3] Job Cost & Turnaround Discount Dilution')
{
  const s = newGame('WorkshopJob', 'seth', 'maa-mdu', 7)
  s.workshop.level = 1
  s.workshop.bays = 8
  // Add 8 mechanics so bays are staffed
  s.workshop.mechanicIds = []
  for (let i = 0; i < 8; i++) {
    const mech = recruitVeteran(s, 'mechanic', { skill: [5, 5] })
    s.workshop.mechanicIds.push(mech.id)
  }

  const bus: Bus = {
    id: 'b_quote_test',
    modelId: 'cheetah',
    reg: 'KA-01-Q-1001',
    acquiredDay: 1,
    ownership: 'owned',
    status: 'active',
    odometer: 30_000,
    lastServiceOdo: 0,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    aitpPaidUntilDay: s.day + 100,
  }
  s.buses = { b_quote_test: bus }

  // With manager on duty at 1.0 coverage (8 bays)
  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointFleetManager(s, mgr.id)
  const fullCovQuote = quoteService(s, bus, 'a')

  // Now expand bays to 16 with same manager -> coverage drops to 0.50
  s.workshop.bays = 16
  // Keep 8 mechanics so bays are still in-house
  const dilutedQuote = quoteService(s, bus, 'a')

  check(dilutedQuote.cost > fullCovQuote.cost, `diluted job cost (${dilutedQuote.cost}) > full coverage cost (${fullCovQuote.cost})`)
}

console.log('\n[4] managerAutoMaint Booking Cap at floor(capacity)')
{
  const s = newGame('WorkshopAutoMaint', 'seth', 'maa-mdu', 7)
  s.buses = {}
  s.workshop.level = 1
  s.workshop.bays = 16
  s.workshop.mechanicIds = []

  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointFleetManager(s, mgr.id)
  const cap = Math.floor(deskCapacity(s, 'workshop')) // 8 bays

  // Staff all 16 bays so freeBays = 16
  for (let i = 0; i < 16; i++) {
    const m = recruitVeteran(s, 'mechanic', { skill: [5, 5] })
    s.workshop.mechanicIds.push(m.id)
  }

  // Create 15 coaches, all due for general service
  for (let i = 0; i < 15; i++) {
    s.buses[`b_maint_${i}`] = {
      id: `b_maint_${i}`,
      modelId: 'cheetah',
      reg: `KA-01-M-${i.toString().padStart(2, '0')}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      odometer: 30_000,
      lastServiceOdo: 0, // 30k since service -> A-service due (>25k)
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
    }
  }

  check(freeStaffedBays(s) === 16, '16 free staffed bays before pass')
  check(cap === 8, 'manager capacity is 8 bookings/day')

  dailyMaintenancePass(s)

  const inWorkshop = Object.values(s.buses).filter((b) => b.status === 'workshop').length
  check(inWorkshop === cap, `booked exactly floor(capacity) = ${cap} coaches into workshop today (got ${inWorkshop})`)
}

console.log(`\n${failures === 0 ? 'ALL WORKSHOP SPAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
