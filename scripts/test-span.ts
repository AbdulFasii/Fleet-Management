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
  // Every registered desk has a base span; the numbers themselves are balance and live in BAL.span.base.
  check(ALL_SPAN_DESKS.length === Object.keys(BAL.span.base).length, `${ALL_SPAN_DESKS.length} span desks registered, one per base span`)
  for (const desk of ALL_SPAN_DESKS) {
    const base = (BAL.span.base as Record<string, number>)[desk]
    check(typeof base === 'number' && base > 0, `${desk} base span is positive (${base})`)
  }

  for (const desk of ALL_SPAN_DESKS) {
    check(Boolean(DESK_UNIT[desk]), `unit defined for ${desk}: ${DESK_UNIT[desk]}`)
  }
}

console.log('\n[2] Skill Scaling on Desk Capacity')
{
  const s = newGame('SpanSkill', 'seth', 'maa-mdu', 7)
  const m5 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, m5.id)
  const B = BAL.span.base.ops
  check(deskCapacity(s, 'ops') === B, `skill 5 capacity = base ${B} (got ${deskCapacity(s, 'ops')})`)

  const m10 = recruitVeteran(s, 'manager', { skill: [10, 10] })
  appointOps(s, m10.id)
  const cap10 = deskCapacity(s, 'ops')
  const want10 = B * Math.min(BAL.span.skillMax, 1 + 5 * BAL.span.skillPerPoint)
  check(Math.abs(cap10 - want10) < 1e-9, `skill 10 capacity = ${want10} (got ${cap10})`)

  const m2 = recruitVeteran(s, 'manager', { skill: [2, 2] })
  appointOps(s, m2.id)
  const cap2 = deskCapacity(s, 'ops')
  const want2 = B * Math.max(BAL.span.skillMin, 1 - 3 * BAL.span.skillPerPoint)
  check(Math.abs(cap2 - want2) < 1e-9, `skill 2 capacity = ${want2} (got ${cap2})`)

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
  const H = BAL.span.base.hr
  const A = BAL.span.assistantShare
  check(deskCapacity(s, 'hr') === H, `head skill 5 gives ${H} capacity`)

  const ast1 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'hr', ast1.id)
  const capWith1 = deskCapacity(s, 'hr')
  check(Math.abs(capWith1 - H * (1 + A)) < 1e-9, `1 assistant adds ${H * A} -> ${H * (1 + A)} (got ${capWith1})`)

  const ast2 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'hr', ast2.id)
  const capWith2 = deskCapacity(s, 'hr')
  check(Math.abs(capWith2 - H * (1 + 2 * A)) < 1e-9, `2 skill-5 assistants -> ${H * (1 + 2 * A)} (got ${capWith2})`)

  const ast3 = recruitVeteran(s, 'manager', { skill: [9, 9] })
  appointDeskAssistant(s, 'hr', ast3.id)
  const want3 = H * (1 + 2 * A) + H * A * Math.min(BAL.span.skillMax, 1 + 4 * BAL.span.skillPerPoint)
  check(Math.abs(deskCapacity(s, 'hr') - want3) < 0.01, `skill-9 assistant scales with skill: ${want3} (got ${deskCapacity(s, 'hr')})`)
}

console.log('\n[5] assistantsToCover Calculation')
{
  const s = newGame('SpanNeeded', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointWorkshop(head.id)
  function appointWorkshop(id: string) {
    s.workshop.managerId = id
  }
  // Each skill-5 assistant adds base x assistantShare; needed = ceil(deficit / that).
  const W = BAL.span.base.workshop
  const per = W * BAL.span.assistantShare
  for (const extra of [2, 10]) {
    s.workshop.bays = W + extra
    const want = Math.ceil(extra / per)
    check(assistantsToCover(s, 'workshop') === want, `${W + extra} bays (cap ${W}) needs ${want} assistant(s) (got ${assistantsToCover(s, 'workshop')})`)
  }
}

console.log('\n[6] spanMeters Snapshot Structure')
{
  const s = newGame('SpanMeters', 'seth', 'maa-mdu', 7)
  const meters = spanMeters(s)
  check(Object.keys(meters).length === ALL_SPAN_DESKS.length, `spanMeters returns all ${ALL_SPAN_DESKS.length} desks`)
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
