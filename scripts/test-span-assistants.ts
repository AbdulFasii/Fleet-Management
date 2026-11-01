import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import {
  appointHr,
  appointOps,
  appointDeskAssistant,
  unappointDeskAssistant,
  deskOf,
  deskHead,
  deskManagers,
  fire,
  monthlyOfficeAdminCost,
  autoHireRoleTarget,
  recruitVeteran,
  migrateStaffRoles,
} from '../src/engine/sim/staffing'
import { deskCapacity, assistantsToCover } from '../src/engine/sim/span'
import type { Staff } from '../src/engine/types'

let failures = 0
function check(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ ${desc}`)
  } else {
    console.error(`  ✗ ${desc}`)
    failures++
  }
}

console.log('[1] Appoint and Unappoint Desk Assistant')
{
  const s = newGame('AstAppoint', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, head.id)

  const ast = recruitVeteran(s, 'manager', { skill: [5, 5] })
  check(deskOf(s, ast.id) === undefined, 'ast is initially unposted')

  const err = appointDeskAssistant(s, 'ops', ast.id)
  check(err === null, 'appointDeskAssistant returns null')
  check(deskOf(s, ast.id) === 'ops', 'deskOf returns ops for assistant')
  check((s.company.deskAssistants?.ops ?? []).includes(ast.id), 'ast id stored in deskAssistants.ops')

  // Unappoint
  const unerr = unappointDeskAssistant(s, 'ops', ast.id)
  check(unerr === null, 'unappointDeskAssistant returns null')
  check(deskOf(s, ast.id) === undefined, 'deskOf returns undefined after unappoint')
  check(!(s.company.deskAssistants?.ops ?? []).includes(ast.id), 'ast id removed from deskAssistants.ops')
}

console.log('\n[2] Desk Conflict Rules (No Dual Posting)')
{
  const s = newGame('AstConflict', 'seth', 'maa-mdu', 7)
  const headOps = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, headOps.id)

  const headHr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, headHr.id)

  // 1. Head of Ops cannot be appointed as assistant
  const errHead = appointDeskAssistant(s, 'hr', headOps.id)
  check(errHead !== null, `blocked head from becoming assistant: "${errHead}"`)

  // 2. Assistant on Ops moved to HR gets cleared from Ops
  const ast = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'ops', ast.id)
  check(deskOf(s, ast.id) === 'ops', 'ast posted on ops')

  appointDeskAssistant(s, 'hr', ast.id)
  check(deskOf(s, ast.id) === 'hr', 'ast now posted on hr')
  check(!(s.company.deskAssistants?.ops ?? []).includes(ast.id), 'ast automatically removed from ops')
  check((s.company.deskAssistants?.hr ?? []).includes(ast.id), 'ast present in hr')
}

console.log('\n[3] Firing or Resignation Cleans Desk Assistants')
{
  const s = newGame('AstFire', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, head.id)

  const ast = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'ops', ast.id)
  check((s.company.deskAssistants?.ops ?? []).includes(ast.id), 'ast on ops before fire')

  fire(s, ast.id)
  check(!(s.company.deskAssistants?.ops ?? []).includes(ast.id), 'ast cleared from deskAssistants upon firing')
  check(deskOf(s, ast.id) === undefined, 'deskOf returns undefined after fire')
}

console.log('\n[4] Office Rent Automatically Counts Assistants')
{
  const s = newGame('AstRent', 'seth', 'maa-mdu', 7)
  const head = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, head.id)

  const baseCost = monthlyOfficeAdminCost(s)
  check(baseCost.assignedManagers === 1, '1 assigned manager (head)')

  const ast1 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'ops', ast1.id)
  const costWith1 = monthlyOfficeAdminCost(s)
  check(costWith1.assignedManagers === 2, '2 assigned managers after 1 assistant posted')
  check(costWith1.total > baseCost.total, `rent increased: ${costWith1.total} > ${baseCost.total}`)

  const ast2 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointDeskAssistant(s, 'ops', ast2.id)
  const costWith2 = monthlyOfficeAdminCost(s)
  check(costWith2.assignedManagers === 3, '3 assigned managers after 2 assistants posted')
}

console.log('\n[5] Manager Auto-Hire Target Scales with Span Deficit')
{
  const s = newGame('AstTarget', 'seth', 'maa-mdu', 7)
  // Appoint 8 desk heads
  const headOps = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, headOps.id)

  // With just 1 coach, no assistants needed, target is 8
  const baseTarget = autoHireRoleTarget(s, 'manager')
  check(baseTarget >= 8, `base manager target >= 8 (got ${baseTarget})`)

  // Now create 60 coaches (cap is 30, deficit 30)
  // 30 / (30 * 0.60) = 30 / 18 = 2 assistants needed for ops
  for (let i = 0; i < 60; i++) {
    s.buses[`b_tgt_${i}`] = {
      id: `b_tgt_${i}`,
      modelId: 'cheetah',
      reg: `KA-01-T-${i}`,
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

  const astNeeded = assistantsToCover(s, 'ops')
  check(astNeeded === 2, `assistants needed for ops is 2 (got ${astNeeded})`)

  const newTarget = autoHireRoleTarget(s, 'manager')
  check(newTarget >= 8 + astNeeded, `manager hiring target scaled to include needed assistants (${newTarget} >= 10)`)
}

console.log('\n[6] migrateStaffRoles Pruning')
{
  const s = newGame('AstMigrate', 'seth', 'maa-mdu', 7)
  if (!s.company.deskAssistants) s.company.deskAssistants = {}
  s.company.deskAssistants.ops = ['non_existent_id', 'ghost_id']

  migrateStaffRoles(s)
  check(s.company.deskAssistants.ops.length === 0, 'pruned stale IDs from deskAssistants')
}

console.log(`\n${failures === 0 ? 'ALL ASSISTANT SPAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
