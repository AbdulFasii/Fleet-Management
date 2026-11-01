import { newGame } from '../src/engine/newGame'
import { setCrmPolicy } from '../src/engine/sim/staffing'
import { dailyCrmPass } from '../src/engine/sim/crm'
import { rs } from '../src/engine/core/money'
import type { Staff } from '../src/engine/types'

console.log('--- Testing CRM Policy: Suggest Refund (Auto-refund suggested amount) ---')

const s = newGame('Test', 'malik', 'maa-mdu', 12345)

// Appoint CRM manager
const crmMgr: Staff = {
  id: 'crm_mgr_1',
  name: 'Nikhil Qureshi',
  role: 'manager',
  desk: 'crm',
  skill: 7,
  salary: 1_200_000,
  morale: 80,
  loyalty: 80,
  experienceYears: 5,
  hiredDay: 1,
  fatigue: 0,
  consecutiveDutyDays: 0,
  drivingStyle: 'cautious',
  licenceClass: 'HMV_PSV',
  safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
  cmvrHoursToday: 0,
  tripsDriven: 0,
}
s.staff['crm_mgr_1'] = crmMgr
s.company.crmId = 'crm_mgr_1'

// Add grievances matching user screenshot: ₹600, ₹723, ₹628, ₹456, ₹548, ₹480
s.company.grievances = [
  { id: 'g1', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'ac', status: 'open', amount: rs(600) },
  { id: 'g2', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'delay', status: 'open', amount: rs(723) },
  { id: 'g3', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'clean', status: 'open', amount: rs(628) },
  { id: 'g4', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'other', status: 'open', amount: rs(456) },
  { id: 'g5', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'driver', status: 'open', amount: rs(548) },
  { id: 'g6', day: s.day, busId: 'b1', routeId: 'maa-mdu', cause: 'clean', status: 'open', amount: rs(480) },
]
s.company.grievanceCount = 6

console.log('\n[Check 1] Verify old refund policy only refunded <= 500...')
setCrmPolicy(s, 'refund')
dailyCrmPass(s)

const g1AfterRefund = s.company.grievances.find((g) => g.id === 'g1')!
const g4AfterRefund = s.company.grievances.find((g) => g.id === 'g4')!
if (g4AfterRefund.status !== 'refunded') throw new Error('g4 (456) should be refunded')
if (g1AfterRefund.status !== 'open') throw new Error('g1 (600) should still be open under refund <= 500')
console.log('✓ Old refund policy left ₹600 open and refunded ₹456')

console.log('\n[Check 2] Setting policy to suggest_refund...')
setCrmPolicy(s, 'suggest_refund')
if (s.company.crmPolicy !== 'suggest_refund') throw new Error('Policy not set to suggest_refund')

dailyCrmPass(s)

const remainingOpen = s.company.grievances.filter((g) => g.status === 'open')
if (remainingOpen.length !== 0) {
  throw new Error(`Expected 0 open grievances after suggest_refund, found ${remainingOpen.length}`)
}
console.log('✓ All suggested refunds (including ₹600, ₹723, ₹628, ₹548) successfully auto-refunded!')

if (s.company.grievanceCount !== 0) throw new Error(`Expected grievanceCount to be 0, got ${s.company.grievanceCount}`)
console.log('✓ grievanceCount updated to 0')

console.log('\n======================================================')
console.log('🎉 ALL SUGGEST REFUND POLICY CHECKS PASSED!')
console.log('======================================================')
