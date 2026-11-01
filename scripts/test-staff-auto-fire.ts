import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  appointHr,
  defaultHrAutoFire,
  ensureHrAutoFire,
  fire,
  hrAutoFirePass,
  setHrAutoFire,
  DEFAULT_AUTO_FIRE_SALARY,
  ROLE_LABEL,
} from '../src/engine/sim/staffing'
import { rs } from '../src/engine/core/money'
import type { Staff, StaffRole } from '../src/engine/types'

console.log('[1] Manual firing needs no confirmation and executes immediately')
const s = newGame('TestCorp', 'seth', 'maa-mdu', 42)

// Add dummy staff
const testDriver: Staff = {
  id: 'st-driver-1',
  name: 'Ramesh Kumar',
  role: 'driver',
  skill: 6,
  salary: rs(28_000),
  morale: 80,
  loyalty: 80,
  hiredDay: 1,
  drivingStyle: 'cautious',
  licenceClass: 'HMV_PSV',
  fatigue: 0,
}
s.staff[testDriver.id] = testDriver
assert.equal(s.staff['st-driver-1']?.name, 'Ramesh Kumar')

// Manual fire execution: immediate, no confirm needed
const fireRes = fire(s, testDriver.id)
assert.equal(fireRes, null)
assert.equal(s.staff['st-driver-1'], undefined, 'Employee terminated immediately')
console.log('  ✓ Manual fire executes immediately without confirmation')

console.log('\n[2] Auto-fire role thresholds and default state')
const defAutoFire = defaultHrAutoFire()
assert.equal(defAutoFire.enabled, false)
assert.equal(defAutoFire.maxSalaryByRole.driver, rs(35_000))
assert.equal(defAutoFire.maxSalaryByRole.co_driver, rs(26_000))
assert.equal(defAutoFire.maxSalaryByRole.conductor, rs(22_000))
assert.equal(defAutoFire.maxSalaryByRole.mechanic, rs(38_000))
assert.equal(defAutoFire.maxSalaryByRole.manager, rs(55_000))
console.log('  ✓ All 5 roles have valid default salary caps')

console.log('\n[3] Auto-fire cannot be turned on without HR manager')
const errNoHr = setHrAutoFire(s, { enabled: true })
assert.match(errNoHr ?? '', /Appoint HR first/)
console.log('  ✓ Blocked enabling auto-fire without HR manager')

console.log('\n[4] Appoint HR and configure role salary caps')
const hrManager: Staff = {
  id: 'st-mgr-hr',
  name: 'Meena HR',
  role: 'manager',
  skill: 7,
  salary: rs(60_000),
  morale: 90,
  loyalty: 90,
  hiredDay: 1,
  fatigue: 0,
}
s.staff[hrManager.id] = hrManager
appointHr(s, hrManager.id)
assert.equal(s.company.hrId, hrManager.id)

// Add various staff with different salaries
const highPaidDriver: Staff = {
  id: 'st-driver-high',
  name: 'Suresh High',
  role: 'driver',
  skill: 8,
  salary: rs(38_000), // > 35,000 cap
  morale: 85,
  loyalty: 85,
  hiredDay: 1,
  fatigue: 0,
}
const normalPaidDriver: Staff = {
  id: 'st-driver-norm',
  name: 'Karthik Norm',
  role: 'driver',
  skill: 5,
  salary: rs(30_000), // <= 35,000 cap
  morale: 80,
  loyalty: 80,
  hiredDay: 1,
  fatigue: 0,
}
const highPaidConductor: Staff = {
  id: 'st-cond-high',
  name: 'Mani Cond',
  role: 'conductor',
  skill: 6,
  salary: rs(25_000), // > 22,000 cap
  morale: 75,
  loyalty: 75,
  hiredDay: 1,
  fatigue: 0,
}
const normalPaidMechanic: Staff = {
  id: 'st-mech-norm',
  name: 'Velu Mech',
  role: 'mechanic',
  skill: 7,
  salary: rs(32_000), // <= 38,000 cap
  morale: 80,
  loyalty: 80,
  hiredDay: 1,
  fatigue: 0,
}

s.staff[highPaidDriver.id] = highPaidDriver
s.staff[normalPaidDriver.id] = normalPaidDriver
s.staff[highPaidConductor.id] = highPaidConductor
s.staff[normalPaidMechanic.id] = normalPaidMechanic

console.log('  ✓ Staff members populated across roles')

console.log('\n[5] Turn on Auto-Fire by Salary Cap')
// Give company enough money for severance
s.money = rs(500_000)

const turnOnRes = setHrAutoFire(s, { enabled: true })
assert.equal(turnOnRes, null)

// Auto-fire pass should have run automatically on turn-on
assert.equal(s.staff['st-driver-high'], undefined, 'High paid driver auto-fired without confirmation')
assert.equal(s.staff['st-cond-high'], undefined, 'High paid conductor auto-fired without confirmation')
assert.ok(s.staff['st-driver-norm'], 'Normal paid driver retained')
assert.ok(s.staff['st-mech-norm'], 'Normal paid mechanic retained')
assert.ok(s.staff['st-mgr-hr'], 'HR manager administering department is never auto-fired')
console.log('  ✓ Employees crossing role salary cap auto-fired immediately')

console.log('\n[6] Adjust role salary cap dynamically')
// Change mechanic cap to 30,000 (below Velu Mech's 32,000)
setHrAutoFire(s, { setSalaryCap: { role: 'mechanic', maxSalary: rs(30_000) } })
assert.equal(s.staff['st-mech-norm'], undefined, 'Mechanic auto-fired after lowering role cap')
console.log('  ✓ Lowering role cap auto-fires staff crossing new cap')

console.log('\n[7] Auto-hire with skill filter and driving style selectors')
import { setHrAutoHire, hrAutoHireFromPool } from '../src/engine/sim/staffing'

s.hiringPool = [
  {
    id: 'cand-driver-cautious-5',
    name: 'Anand Cautious 5',
    role: 'driver',
    skill: 5,
    experienceYears: 4,
    salary: rs(25_000),
    morale: 80,
    loyalty: 80,
    hiredDay: -1,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
    fatigue: 0,
  },
  {
    id: 'cand-driver-agg-8',
    name: 'Balaji Aggressive 8',
    role: 'driver',
    skill: 8,
    experienceYears: 9,
    salary: rs(32_000),
    morale: 80,
    loyalty: 80,
    hiredDay: -1,
    drivingStyle: 'aggressive',
    licenceClass: 'HMV_PSV',
    fatigue: 0,
  },
  {
    id: 'cand-driver-cautious-8',
    name: 'Chandra Cautious 8',
    role: 'driver',
    skill: 8,
    experienceYears: 8,
    salary: rs(33_000),
    morale: 80,
    loyalty: 80,
    hiredDay: -1,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
    fatigue: 0,
  },
]

// Filter: Skill 8 only, Cautious driving style only
setHrAutoHire(s, {
  enabled: false,
  mode: 'unlimited',
  byRole: { driver: [8] },
  toggleDrivingStyle: 'cautious',
})
assert.deepEqual(s.company.hrAutoHire?.drivingStyle, ['cautious'])
assert.deepEqual(s.company.hrAutoHire?.byRole.driver, [8])

// Turn on auto-hire
setHrAutoHire(s, { enabled: true })

// Candidate 3 (skill 8, cautious) should be hired
assert.ok(s.staff['cand-driver-cautious-8'], 'Skill 8 Cautious driver was hired')
// Candidate 1 (skill 5) should NOT be hired (filtered out by skill)
assert.equal(s.staff['cand-driver-cautious-5'], undefined, 'Skill 5 driver was NOT hired (skill filter worked)')
// Candidate 2 (skill 8, aggressive) should NOT be hired (filtered out by driving style)
assert.equal(s.staff['cand-driver-agg-8'], undefined, 'Aggressive driver was NOT hired (driving style filter worked)')

// Now toggle skill 5 into allowed skills using toggleSkill
setHrAutoHire(s, { toggleSkill: { role: 'driver', skill: 5 } })
assert.ok(s.company.hrAutoHire?.byRole.driver?.includes(5), 'Skill 5 added via toggleSkill')

// Candidate 1 (skill 5, cautious) should now be hired
assert.ok(s.staff['cand-driver-cautious-5'], 'Skill 5 Cautious driver was hired after toggling skill')
console.log('  ✓ Auto-hire skill filtering and driving style selectors work accurately')

console.log('\nALL STAFF AUTO-FIRE & AUTO-HIRE CHECKS PASSED!')
