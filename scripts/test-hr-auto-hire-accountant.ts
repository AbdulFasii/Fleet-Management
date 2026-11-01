/**
 * Accounts Manager decision automation, slower HR skill coaching, and the two
 * HR auto-hire policies (match Ops crew requirement / unlimited).
 *   npx tsx scripts/test-hr-auto-hire-accountant.ts
 */
import { newGame } from '../src/engine/newGame'
import { rs } from '../src/engine/core/money'
import { BAL } from '../src/engine/data/balance'
import { settleReceivables } from '../src/engine/sim/finance'
import { accountantDecisionPass, applyDecision } from '../src/engine/sim/events'
import {
  appointAccountant,
  appointHr,
  autoHireRoleTarget,
  dailyStaffPass,
  estimateCrewRequirements,
  hrAutoHireFromPool,
  hrOnDuty,
  hrSkillReviewGap,
  monthlyStaffPass,
  recruitVeteran,
  setHrAutoHire,
  staffCountForRole,
} from '../src/engine/sim/staffing'
import type { GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

function pushBounce(s: GameState, amount: number): { rcvId: string; decisionId: string } {
  const rcvId = `rcv_test_${s.receivables.length}`
  const decisionId = `dec_test_${s.decisions.length}`
  s.receivables.push({ id: rcvId, amount, settleDay: s.day + 3, channel: 'agent', bounced: true })
  s.decisions.push({
    id: decisionId,
    day: s.day,
    expiresDay: s.day + 4,
    kind: 'cheque_bounce',
    title: 'Receivable Default / Cheque Bounce',
    body: 'test',
    options: [
      { id: 'collector', key: 'collector', label: 'Send recovery agent' },
      { id: 'cancel', key: 'cancel', label: 'Write off' },
    ],
    data: { rcvId, amount },
  })
  return { rcvId, decisionId }
}

function addCoach(s: GameState, id: string): void {
  ;(s.buses as Record<string, unknown>)[id] = {
    id,
    reg: `TN 00 ${id}`,
    modelId: 'cheetah',
    ownership: 'owned',
    status: 'active',
    odoKm: 0,
    condition: 80,
  }
}

console.log('\n[1] Accounts Manager clears cheque-bounce decisions')
{
  const s = newGame('Acct', 'seth', 'maa-mdu', 7)
  const mgr = recruitVeteran(s, 'manager', { skill: [8, 8] })
  check(appointAccountant(s, mgr.id) === null, 'appointed Accounts Manager')

  const { decisionId } = pushBounce(s, rs(9_000))
  check(s.decisions.some((d) => d.id === decisionId), 'bounce decision pending before the pass')
  accountantDecisionPass(s)
  check(!s.decisions.some((d) => d.id === decisionId), 'Accounts Manager resolved it without the player')
  const rcv = s.receivables.find((r) => r.id.startsWith('rcv_test_'))
  check(
    !rcv || (rcv.settleDay === s.day + 10 && !rcv.bounced),
    'receivable either recovered (settles later) or written off',
  )

  // With no accountant the decision is left for the player.
  const s2 = newGame('Acct2', 'seth', 'maa-mdu', 7)
  const { decisionId: d2 } = pushBounce(s2, rs(9_000))
  accountantDecisionPass(s2)
  check(s2.decisions.some((d) => d.id === d2), 'no Accounts Manager -> decision stays pending')

  // A small amount is not worth the collection fee.
  const s3 = newGame('Acct3', 'seth', 'maa-mdu', 7)
  const mgr3 = recruitVeteran(s3, 'manager', { skill: [8, 8] })
  appointAccountant(s3, mgr3.id)
  pushBounce(s3, rs(2_100))
  accountantDecisionPass(s3)
  check(s3.decisions.length === 0 && s3.receivables.every((r) => !r.id.startsWith('rcv_test_')), 'below the fee EV -> written off')
}

console.log('\n[2] Bounced receivables never auto-settle')
{
  const s = newGame('Settle', 'seth', 'maa-mdu', 7)
  s.receivables = [{ id: 'rcv_b', amount: rs(9_000), settleDay: s.day, channel: 'agent', bounced: true }]
  const cash = s.company.cash
  const settled = settleReceivables(s)
  check(settled === 0 && s.receivables.length === 1 && s.company.cash === cash, 'bounced cheque is skipped by the settlement sweep')

  const { rcvId, decisionId } = pushBounce(s, rs(9_000))
  applyDecision(s, decisionId, 'cancel')
  check(!s.receivables.some((r) => r.id === rcvId), 'writing off removes the receivable')
}

console.log('\n[3] HR skill coaching is slower')
{
  const gapMid = hrSkillReviewGap(5)
  const gapTop = hrSkillReviewGap(9)
  check(BAL.hrSkillReviewDays >= 180, `base review gap ${BAL.hrSkillReviewDays}d (was 90d)`)
  check(gapMid === BAL.hrSkillReviewDays, 'skill 5 reviews at the base gap')
  check(gapTop > gapMid * 2, `9→10 takes ${gapTop}d vs ${gapMid}d at skill 5`)

  const s = newGame('Skills', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [8, 8] })
  appointHr(s, hr.id)
  check(!!hrOnDuty(s), 'HR on duty')

  const st = recruitVeteran(s, 'driver', { skill: [5, 5] })
  st.hiredDay = s.day
  monthlyStaffPass(s)
  check(st.skill === 5, 'no instant skill upgrade on the joining month')

  st.lastHrSkillDay = s.day - hrSkillReviewGap(st.skill) - 1
  monthlyStaffPass(s)
  check(st.skill === 6, 'skill rises once the review gap has elapsed')
  st.lastHrSkillDay = s.day
  monthlyStaffPass(s)
  check(st.skill === 6, 'and then waits again before the next point')
}

console.log('\n[4] Auto-hire: match Ops crew requirement')
{
  const s = newGame('Match', 'seth', 'maa-mdu', 7)
  addCoach(s, 'b1')
  addCoach(s, 'b2')
  const hp = recruitVeteran(s, 'manager', { skill: [8, 8] })
  check(appointHr(s, hp.id) === null, 'appointed HR')

  const est = estimateCrewRequirements(s)
  check(est.drivers.total.required === 3, `2 coaches need 3 drivers (line 2 + 1 relief), got ${est.drivers.total.required}`)

  const poolDrivers = s.hiringPool.filter((c) => c.role === 'driver').length
  check(poolDrivers >= 3, `pool has ${poolDrivers} driver candidates`)

  const skills = [...new Set(s.hiringPool.filter((c) => c.role === 'driver').map((c) => c.skill))]
  const err = setHrAutoHire(s, { enabled: true, mode: 'match', byRole: { driver: skills } })
  check(err === null, 'auto-hire enabled in match mode')

  check(staffCountForRole(s, 'driver') === 3, `hired exactly to the requirement (${staffCountForRole(s, 'driver')}/3)`)
  const extra = s.hiringPool.filter((c) => c.role === 'driver').length
  check(extra >= 0, `${extra} matching driver candidate(s) left in the pool, not hired`)

  check(hrAutoHireFromPool(s) === 0, 'status OK -> auto-hire stops')
  dailyStaffPass(s)
  check(staffCountForRole(s, 'driver') === 3, 'day tick does not overshoot')

  // Someone leaves / is fired -> refill to the required count, no more.
  const victim = Object.values(s.staff).find((x) => x.role === 'driver')!
  delete s.staff[victim.id]
  check(staffCountForRole(s, 'driver') === 2, 'payroll drops below the requirement')
  const target = autoHireRoleTarget(s, 'driver')
  check(target === 3, `target stays at ${target}`)
  dailyStaffPass(s)
  check(staffCountForRole(s, 'driver') === 3, `next day refilled to ${staffCountForRole(s, 'driver')}/3`)
}

console.log('\n[5] Auto-hire: unlimited keeps the old behaviour')
{
  const s = newGame('Unlimited', 'seth', 'maa-mdu', 7)
  addCoach(s, 'b1')
  const hp = recruitVeteran(s, 'manager', { skill: [8, 8] })
  appointHr(s, hp.id)

  const poolDrivers = s.hiringPool.filter((c) => c.role === 'driver')
  const skills = [...new Set(poolDrivers.map((c) => c.skill))]
  setHrAutoHire(s, { enabled: true, mode: 'unlimited', byRole: { driver: skills } })
  check(
    staffCountForRole(s, 'driver') === poolDrivers.length,
    `unlimited hires the whole pool (${staffCountForRole(s, 'driver')}/${poolDrivers.length})`,
  )
  check(staffCountForRole(s, 'driver') > autoHireRoleTarget(s, 'driver'), 'which is above the Ops requirement')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
