import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import { recruitVeteran } from '../src/engine/sim/staffing'
import {
  spanDemand,
  deskCapacity,
  deskCoverage,
  assistantsToCover,
  assistantsToCoverTotal,
  spanMeters,
  ALL_SPAN_DESKS,
  DESK_UNIT,
} from '../src/engine/sim/span'
import {
  appointHr,
  appointOps,
  appointFleetManager,
  appointCargoManager,
  appointScheduleManager,
  appointDocsManager,
  appointCrm,
  appointAccountant,
  appointDeskAssistant,
} from '../src/engine/sim/staffing'

let failures = 0
function check(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ ${desc}`)
  } else {
    console.error(`  ✗ ${desc}`)
    failures++
  }
}

console.log('[1] Span Base Capacities and Units')
{
  check(ALL_SPAN_DESKS.length === 8, '8 span desks registered')
  check(BAL.span.base.ops === 30, 'ops base: 30 coaches')
  check(BAL.span.base.hr === 60, 'hr base: 60 staff')
  check(BAL.span.base.workshop === 8, 'workshop base: 8 bays')
  check(BAL.span.base.cargo === 10, 'cargo base: 10 lanes')
  check(BAL.span.base.schedule === 30, 'schedule base: 30 services')
  check(BAL.span.base.documents === 50, 'documents base: 50 files')
  check(BAL.span.base.crm === 30, 'crm base: 30 grievances')
  check(BAL.span.base.accountant === 1500, 'accountant base: 1500 rows')

  for (const desk of ALL_SPAN_DESKS) {
    check(Boolean(DESK_UNIT[desk]), `unit defined for ${desk}: ${DESK_UNIT[desk]}`)
  }
}

console.log('\n[2] Skill Scaling on Desk Capacity')
{
  const s = newGame('SpanSkill', 'seth', 'maa-mdu', 7)
  const m5 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, m5.id)
  check(deskCapacity(s, 'ops') === 30, `skill 5 capacity = 30 (got ${deskCapacity(s, 'ops')})`)

  const m10 = recruitVeteran(s, 'manager', { skill: [10, 10] })
  appointOps(s, m10.id)
  const cap10 = deskCapacity(s, 'ops')
  // 30 * (1 + 5 * 0.06) = 30 * 1.30 = 39
  check(cap10 === 39, `skill 10 capacity = 39 (got ${cap10})`)

  const m2 = recruitVeteran(s, 'manager', { skill: [2, 2] })
  appointOps(s, m2.id)
  const cap2 = deskCapacity(s, 'ops')
  // 30 * (1 - 3 * 0.06) = 30 * 0.82 = 24.6 -> Math.round gives 25
  check(Math.round(cap2) === 25, `skill 2 capacity rounded = 25 (got ${cap2})`)

  // Unmanned desk capacity is 0
  appointOps(s, undefined)
  check(deskCapacity(s, 'ops') === 0, 'unmanned desk capacity is 0')
}

console.log('\n[3] Coverage Calculation and Floor')
{
  const s = newGame('SpanCoverage', 'seth', 'maa-mdu', 7)
  // Unmanned coverage is 0
  check(deskCoverage(s, 'ops') === 0, 'unmanned ops coverage is 0')

  const mgr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, mgr.id)
  // Initially fleet has 1 coach, cap is 30 -> 100% coverage
  check(deskCoverage(s, 'ops') === 1.0, 'under span gives 1.0 coverage')

  // When demand > capacity, coverage dilutes
  // minCoverage floor is 0.20
  check(BAL.span.minCoverage === 0.20, 'minCoverage floor is 0.20')
}

console.log('\n[4] Assistant Contribution to Capacity')
{
  const s = newGame('SpanAst', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, head.id)
  check(deskCapacity(s, 'hr') === 60, 'head skill 5 gives 60 capacity')

  const ast1 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'hr', ast1.id)
  // 60 + 60 * 0.60 = 60 + 36 = 96
  const capWith1 = deskCapacity(s, 'hr')
  check(capWith1 === 96, `1 assistant adds 36 -> 96 (got ${capWith1})`)

  const ast2 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'hr', ast2.id)
  // Each skill-5 assistant adds base * 0.60 = 36 -> 60 + 36 + 36 = 132
  const capWith2 = deskCapacity(s, 'hr')
  check(capWith2 === 132, `2 skill-5 assistants add 72 -> 132 (got ${capWith2})`)

  const ast3 = recruitVeteran(s, 'manager', { skill: [9, 9] })
  appointDeskAssistant(s, 'hr', ast3.id)
  // ast3 adds 36 * 1.24 = 44.64 -> 132 + 44.64 = 176.64
  check(Math.abs(deskCapacity(s, 'hr') - 176.64) < 0.01, `skill-9 assistant scales with skill (got ${deskCapacity(s, 'hr')})`)
}

console.log('\n[5] assistantsToCover Calculation')
{
  const s = newGame('SpanNeeded', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointWorkshop(head.id)
  function appointWorkshop(id: string) {
    s.workshop.managerId = id
  }
  // Workshop base is 8, 1 assistant adds ceil(8 * 0.60) = 4.8
  // If bays = 10, deficit = 2, needed = ceil(2 / 4.8) = 1
  s.workshop.bays = 10
  check(assistantsToCover(s, 'workshop') === 1, `10 bays (cap 8) needs 1 assistant (got ${assistantsToCover(s, 'workshop')})`)

  // If bays = 18, deficit = 10, needed = ceil(10 / 4.8) = 3
  s.workshop.bays = 18
  check(assistantsToCover(s, 'workshop') === 3, `18 bays (cap 8) needs 3 assistants (got ${assistantsToCover(s, 'workshop')})`)
}

console.log('\n[6] spanMeters Snapshot Structure')
{
  const s = newGame('SpanMeters', 'seth', 'maa-mdu', 7)
  const meters = spanMeters(s)
  check(Object.keys(meters).length === 8, 'spanMeters returns all 8 desks')
  for (const desk of ALL_SPAN_DESKS) {
    const m = meters[desk]
    check(m.desk === desk, `${desk} desk tag matches`)
    check(typeof m.demand === 'number', `${desk} demand is a number`)
    check(typeof m.capacity === 'number', `${desk} capacity is a number`)
    check(typeof m.coverage === 'number', `${desk} coverage is a number`)
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
