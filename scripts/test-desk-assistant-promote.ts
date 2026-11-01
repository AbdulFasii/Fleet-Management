import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  appointAccountant,
  appointDeskAssistant,
  appointHr,
  appointOps,
  deskHead,
} from '../src/engine/sim/staffing'
import type { Staff } from '../src/engine/types'

console.log('=== TEST: Assistant promotes to head when manager is relieved (HR on duty) ===')

const s = newGame('Promote Co', 'seth', 'blr-maa', 4242)

function hireManager(name: string): Staff {
  const id = `mgr_${name.replace(/\s+/g, '_').toLowerCase()}`
  const st: Staff = {
    id,
    name,
    role: 'manager',
    skill: 8,
    salary: 50_000_00,
    morale: 80,
    loyalty: 70,
    fatigue: 0,
    hiredDay: s.day,
  } as Staff
  // Prefer engine hire path when available
  s.staff[id] = st
  return st
}

const hr = hireManager('HR Head')
const acct = hireManager('Accounts Head')
const asst = hireManager('Amit Reddy')

assert.equal(appointHr(s, hr.id), null, 'appoint HR')
assert.equal(appointAccountant(s, acct.id), null, 'appoint accountant')
assert.equal(appointDeskAssistant(s, 'accountant', asst.id), null, 'appoint assistant')
assert.equal(deskHead(s, 'accountant')?.id, acct.id)
assert.ok((s.company.deskAssistants?.accountant ?? []).includes(asst.id))

// Relieve accountant — with HR on duty, assistant should step up
assert.equal(appointAccountant(s, undefined), null, 'relieve accountant')
assert.equal(deskHead(s, 'accountant')?.id, asst.id, 'assistant promoted to accountant head')
assert.equal((s.company.deskAssistants?.accountant ?? []).includes(asst.id), false, 'promoted person left assistant list')
console.log('✓ Accountant assistant promoted when head relieved with HR on duty')

// Without HR, no promotion on another desk
const ops = hireManager('Ops Head')
const opsAsst = hireManager('Ops Asst')
s.company.opsId = ops.id
assert.equal(appointDeskAssistant(s, 'ops', opsAsst.id), null)
s.company.hrId = undefined // remove HR without promote path interference
assert.equal(appointOps(s, undefined), null)
assert.equal(deskHead(s, 'ops'), undefined, 'ops stays vacant without HR')
assert.ok((s.company.deskAssistants?.ops ?? []).includes(opsAsst.id), 'ops assistant still waiting')
console.log('✓ Without HR, assistant is not auto-promoted')

// Re-appoint HR — vacant desks with assistants should fill
assert.equal(appointHr(s, hr.id), null)
assert.equal(deskHead(s, 'ops')?.id, opsAsst.id, 'ops assistant promoted when HR returns')
console.log('✓ Vacant desks fill from assistants when HR is appointed')

console.log('All desk assistant promotion tests passed.')
