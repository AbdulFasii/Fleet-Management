import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import {
  appointOps,
  opsAutoStaffPass,
  recruitVeteran,
  assignStaff,
} from '../src/engine/sim/staffing'
import { spanDemand, deskCapacity, deskCoverage } from '../src/engine/sim/span'
import type { Bus, Schedule } from '../src/engine/types'

let failures = 0
function check(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ ${desc}`)
  } else {
    console.error(`  ✗ ${desc}`)
    failures++
  }
}

console.log('[1] Ops Demand: Active Owned + Leased Coaches (Attached Excluded)')
{
  const s = newGame('OpsDemand', 'seth', 'maa-mdu', 7)
  s.buses = {}

  // 1 owned active
  s.buses.b_owned = {
    id: 'b_owned',
    modelId: 'starbus_ultra',
    reg: 'KA-01-OWNED',
    acquiredDay: 1,
    ownership: 'owned',
    status: 'active',
    odometer: 10_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
    lastServiceOdo: 10_000,
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    aitpPaidUntilDay: s.day + 100,
  }

  // 1 leased active
  s.buses.b_leased = {
    id: 'b_leased',
    modelId: 'starbus_ultra',
    reg: 'KA-01-LEASED',
    acquiredDay: 1,
    ownership: 'leased',
    status: 'active',
    odometer: 10_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
    lastServiceOdo: 10_000,
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    aitpPaidUntilDay: s.day + 100,
  }

  // 1 attached active (should be excluded!)
  s.buses.b_attached = {
    id: 'b_attached',
    modelId: 'starbus_ultra',
    reg: 'KA-01-ATTACHED',
    acquiredDay: 1,
    ownership: 'attached',
    status: 'active',
    odometer: 10_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
    lastServiceOdo: 10_000,
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    aitpPaidUntilDay: s.day + 100,
  }

  // 1 owned inactive/grounded (should be excluded!)
  s.buses.b_grounded = {
    id: 'b_grounded',
    modelId: 'starbus_ultra',
    reg: 'KA-01-GROUNDED',
    acquiredDay: 1,
    ownership: 'owned',
    status: 'grounded',
    odometer: 10_000,
    condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
    lastServiceOdo: 10_000,
    insuranceExpiryDay: s.day + 100,
    fitnessExpiryDay: s.day + 100,
    aitpPaidUntilDay: s.day + 100,
  }

  check(spanDemand(s, 'ops') === 2, `demand counts 1 owned + 1 leased = 2 (got ${spanDemand(s, 'ops')})`)
}

console.log('\n[2] Ops Auto-Staff Supervision Cap')
{
  const s = newGame('OpsSupervision', 'seth', 'maa-mdu', 7)
  s.buses = {}
  s.staff = {}
  s.inbox = []

  const ops = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, ops.id)
  s.company.opsAutoStaff = true

  const cap = Math.floor(deskCapacity(s, 'ops')) // 30 coaches

  // Create 50 scheduled active coaches
  const dummySch: Schedule = {
    id: 'sch1',
    routeId: 'maa-mdu',
    depHour: 6,
    depMin: 0,
    busIds: [],
    ticketPrice: 600,
    active: true,
  }
  s.schedules = { sch1: dummySch }

  for (let i = 0; i < 50; i++) {
    const busId = `b_ops_${i}`
    s.buses[busId] = {
      id: busId,
      modelId: 'starbus_ultra',
      reg: `TN-01-OPS-${i.toString().padStart(2, '0')}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      scheduleId: 'sch1',
      odometer: 10_000,
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      lastServiceOdo: 10_000,
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
    }
  }

  // Supply plenty of drivers and conductors
  for (let i = 0; i < 100; i++) {
    const drv = recruitVeteran(s, 'driver', { skill: [5, 5] })
    const cond = recruitVeteran(s, 'conductor', { skill: [5, 5] })
  }

  check(spanDemand(s, 'ops') === 50, 'fleet is 50 coaches')
  check(cap === 30, 'ops capacity is 30 coaches')

  opsAutoStaffPass(s)

  // Supervised coaches (cap 30) get staffed; remaining 20 are unsupervised and remain unstaffed!
  const busesWithDrivers = Object.values(s.buses).filter((b) =>
    Object.values(s.staff).some((st) => st.busId === b.id && st.role === 'driver'),
  ).length

  check(busesWithDrivers === cap, `exactly ${cap} coaches staffed within ops span (got ${busesWithDrivers})`)

  // Check that the daily span log was emitted
  const spanLog = s.inbox.find((msg) => msg.text.includes('Ops manager span exceeded'))
  check(Boolean(spanLog), 'logged "Ops manager span exceeded" alert in inbox')
  if (spanLog) {
    check(spanLog.text.includes('20 coaches unsupervised'), 'mentions 20 coaches unsupervised')
  }
}

console.log('\n[3] HP Coaches Receive Priority in Ops Span')
{
  const s = newGame('OpsHpPriority', 'seth', 'maa-mdu', 7)
  s.buses = {}
  s.staff = {}

  const ops = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointOps(s, ops.id)
  s.company.opsAutoStaff = true

  const dummySch: Schedule = {
    id: 'sch_hp',
    routeId: 'maa-mdu',
    depHour: 6,
    depMin: 0,
    busIds: [],
    ticketPrice: 600,
    active: true,
  }
  s.schedules = { sch_hp: dummySch }

  // Create 40 normal coaches
  for (let i = 0; i < 40; i++) {
    s.buses[`b_norm_${i}`] = {
      id: `b_norm_${i}`,
      modelId: 'starbus_ultra',
      reg: `TN-01-NORM-${i}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      scheduleId: 'sch_hp',
      odometer: 10_000,
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      lastServiceOdo: 10_000,
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
    }
  }

  // Create 5 heavy Volvo HP coaches
  for (let i = 0; i < 5; i++) {
    s.buses[`b_hp_${i}`] = {
      id: `b_hp_${i}`,
      modelId: 'volvo9600', // HP model
      reg: `TN-01-HP-${i}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      scheduleId: 'sch_hp',
      odometer: 10_000,
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      lastServiceOdo: 10_000,
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
    }
  }

  // Supply drivers
  for (let i = 0; i < 80; i++) {
    const drv = recruitVeteran(s, 'driver', { skill: [5, 5] })
    if (i < 10) drv.licenceClass = 'HMV_HP'
    recruitVeteran(s, 'conductor', { skill: [5, 5] })
  }

  opsAutoStaffPass(s)

  // All 5 HP coaches MUST be supervised and staffed because HP coaches sort first!
  const hpStaffed = [0, 1, 2, 3, 4].every((i) =>
    Object.values(s.staff).some((st) => st.busId === `b_hp_${i}` && st.role === 'driver'),
  )
  check(hpStaffed, 'all 5 HP coaches supervised and staffed despite fleet (45) exceeding capacity (30)')
}

console.log(`\n${failures === 0 ? 'ALL OPS SPAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
