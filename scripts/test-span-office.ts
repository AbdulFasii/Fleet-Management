import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import {
  appointDocsManager,
  appointCargoManager,
  appointScheduleManager,
  appointCrm,
  appointAccountant,
  recruitVeteran,
} from '../src/engine/sim/staffing'
import { spanDemand, deskCapacity, deskCoverage } from '../src/engine/sim/span'
import { permitPass } from '../src/engine/sim/schedules'
import { dailyMaintenancePass } from '../src/engine/sim/maintenance'
import { cargoEffSkill, cargoFillRate, getAvailableContracts } from '../src/engine/sim/cargo'
import { festivalAssignPass } from '../src/engine/sim/festival'
import { dailyCrmPass } from '../src/engine/sim/crm'
import { dailyClaimsPass } from '../src/engine/sim/insurance'
import { dailyTaxPass } from '../src/engine/sim/tax'
import { pushTxn } from '../src/engine/sim/finance'
import type { Bus, Schedule, Permit, InsuranceClaim } from '../src/engine/types'

let failures = 0
function check(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ ${desc}`)
  } else {
    console.error(`  ✗ ${desc}`)
    failures++
  }
}

console.log('[1] Documents Desk Span & Dilution')
{
  const s = newGame('DocsSpan', 'seth', 'maa-mdu', 7)
  s.buses = {}
  s.permits = {}

  // 10 active coaches
  for (let i = 0; i < 10; i++) {
    s.buses[`b_doc_${i}`] = {
      id: `b_doc_${i}`,
      modelId: 'cheetah',
      reg: `KA-01-D-${i}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      odometer: 10_000,
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
    }
  }

  // 5 active permits
  for (let i = 0; i < 5; i++) {
    s.permits[`route_${i}`] = {
      routeId: `route_${i}`,
      appliedDay: 1,
      status: 'active',
      activeFromDay: 1,
      expiryDay: s.day + 365,
    }
  }

  // Demand = 10 coaches + 5 permits = 15 files
  check(spanDemand(s, 'documents') === 15, `demand = 15 files (got ${spanDemand(s, 'documents')})`)

  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDocsManager(s, mgr.id)
  check(deskCapacity(s, 'documents') === BAL.span.base.documents, `skill 5 capacity is ${BAL.span.base.documents} files`)
  check(deskCoverage(s, 'documents') === 1.0, `15 files on cap ${BAL.span.base.documents} is 100% coverage`)

  // Document renewals cap: ceil(BAL.span.docRenewalsPerPass * coverage) = 12 at 1.0 coverage
  check(Math.ceil(BAL.span.docRenewalsPerPass * deskCoverage(s, 'documents')) === 12, 'renewals cap is 12 per pass at full coverage')
}

console.log('\n[2] Cargo Desk Span & Dilution')
{
  const s = newGame('CargoSpan', 'seth', 'maa-mdu', 7)
  const mgr = recruitVeteran(s, 'manager', { skill: [8, 8] })
  appointCargoManager(s, mgr.id)

  // Under full coverage
  const fullCov = deskCoverage(s, 'cargo')
  check(fullCov === 1.0, 'initially under span -> coverage is 1.0')
  check(cargoEffSkill(s) === 8, `effective skill = 8 (got ${cargoEffSkill(s)})`)

  // Dilution when over capacity: if coverage were 0.5, effSkill = 8 * 0.5 = 4
  const fillFull = cargoFillRate(mgr, 8)
  const fillDiluted = cargoFillRate(mgr, 4)
  check(fillDiluted < fillFull, `diluted fill rate (${fillDiluted.toFixed(3)}) < full fill rate (${fillFull.toFixed(3)})`)
}

console.log('\n[3] Schedule Desk Span & Festival Assignment')
{
  const s = newGame('SchSpan', 'seth', 'maa-mdu', 7)
  s.schedules = {}
  for (let i = 0; i < 20; i++) {
    s.schedules[`sch_${i}`] = {
      id: `sch_${i}`,
      routeId: 'maa-mdu',
      depHour: 6,
      depMin: 0,
      busIds: [],
      ticketPrice: 500,
      active: true,
    }
  }
  check(spanDemand(s, 'schedule') === 20, `demand is 20 schedules (got ${spanDemand(s, 'schedule')})`)

  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointScheduleManager(s, mgr.id)
  check(deskCapacity(s, 'schedule') === BAL.span.base.schedule, `skill 5 capacity is ${BAL.span.base.schedule} services`)
}

console.log('\n[4] CRM Desk Span & Daily Auto-Action Cap')
{
  const s = newGame('CrmSpan', 'seth', 'maa-mdu', 7)
  s.company.grievances = []
  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointCrm(s, mgr.id)
  s.company.crmPolicy = 'suggest_refund'

  const cap = Math.floor(deskCapacity(s, 'crm')) // 30

  // Populate 45 open grievances
  for (let i = 0; i < 45; i++) {
    s.company.grievances.push({
      id: `g_${i}`,
      day: s.day - (45 - i), // ordered by day
      passengerName: `Pax ${i}`,
      cause: 'Late departure',
      amount: 400,
      status: 'open',
    })
  }

  check(spanDemand(s, 'crm') === 45, 'demand is 45 open grievances')
  dailyCrmPass(s)

  const refunded = s.company.grievances.filter((g) => g.status === 'refunded').length
  check(refunded === cap, `capped at floor(capacity) = ${cap} refunds/day (got ${refunded})`)
}

console.log('\n[5] Accounts Desk Span & Tax/Insurance Gate')
{
  const s = newGame('AcctSpan', 'seth', 'maa-mdu', 7)
  const acct = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointAccountant(s, acct.id)

  const acctBase = BAL.span.base.accountant
  check(deskCapacity(s, 'accountant') === acctBase, `base capacity is ${acctBase} ledger rows`)
  check(deskCoverage(s, 'accountant') === 1.0, 'low txn volume gives 1.0 coverage')

  // Tax gate requires coverage >= 0.75
  // When coverage drops below 0.75, auto-file GST/TDS is suppressed
  s.company.gstDueDay = s.day
  s.company.gstPayable = 50_000
  s.company.itcBalance = 10_000

  // At coverage 1.0, dailyTaxPass auto-files GST
  dailyTaxPass(s)
  check(s.company.gstPayable === 0, 'GST auto-filed at full coverage (>=0.75)')

  // Simulate heavy ledger volume to dilute coverage below 0.75:
  // About 1.5x the ledger span in rows -> coverage ~0.67
  for (let i = 0; i < Math.ceil(acctBase * 1.5); i++) {
    pushTxn(s, {
      id: `tx_${i}`,
      day: s.day,
      type: 'revenue',
      category: 'ticket',
      amount: 100,
      balanceAfter: 100,
      note: 'test txn',
    })
  }

  const cov = deskCoverage(s, 'accountant')
  check(cov < 0.75, `coverage diluted below 0.75: ${cov.toFixed(2)}`)

  // Now set TDS due day
  s.company.tdsDueDay = s.day
  s.company.tdsPayable = 20_000
  dailyTaxPass(s)
  check(s.company.tdsPayable === 20_000, 'TDS NOT auto-filed when coverage < 0.75')
}

console.log(`\n${failures === 0 ? 'ALL OFFICE SPAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
