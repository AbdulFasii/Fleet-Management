import { BAL } from '../src/engine/data/balance'
import { newGame } from '../src/engine/newGame'
import {
  appointHr,
  fire,
  hrAutoRaisePass,
  hrAutoHireFromPool,
  hrFatiguePass,
  hrSkillReviewGap,
  recruitVeteran,
  marketSalary,
} from '../src/engine/sim/staffing'
import { spanDemand, deskCapacity, deskCoverage } from '../src/engine/sim/span'
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

console.log('[1] HR Demand: Non-Manager Staff Only')
{
  const s = newGame('HRDemand', 'seth', 'maa-mdu', 7)
  // Initially, newGame may have a few staff
  const initialDemand = spanDemand(s, 'hr')
  const nonManagers = Object.values(s.staff).filter((st) => st.role !== 'manager').length
  check(initialDemand === nonManagers, `initial demand ${initialDemand} matches non-manager staff count ${nonManagers}`)

  // Adding managers should NOT increase HR demand
  const m1 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, m1.id)
  const m2 = recruitVeteran(s, 'manager', { skill: [5, 5] })
  check(spanDemand(s, 'hr') === initialDemand, 'adding managers does not increase HR demand')

  // Adding a driver DOES increase HR demand
  const d = recruitVeteran(s, 'driver', { skill: [5, 5] })
  check(spanDemand(s, 'hr') === initialDemand + 1, 'adding driver increases HR demand by 1')
}

console.log('\n[2] HR Auto-Raise Dilution when Over Capacity')
{
  const s = newGame('HRRaise', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, hr.id)
  s.company.hrAutoRaise = true
  const cap = Math.floor(deskCapacity(s, 'hr')) // 60

  // Populate 100 underpaid drivers
  for (let i = 0; i < 100; i++) {
    const drv: Staff = {
      id: `drv_test_${i}`,
      name: `Driver ${i}`,
      role: 'driver',
      skill: 5,
      salary: 10_000, // heavily underpaid
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
    }
    s.staff[drv.id] = drv
  }

  check(spanDemand(s, 'hr') > cap, `demand (${spanDemand(s, 'hr')}) exceeds capacity (${cap})`)
  const raised = hrAutoRaisePass(s)
  check(raised === cap, `raises capped at floor(capacity) = ${cap} (got ${raised})`)
}

console.log('\n[3] HR Auto-Hire Dilution in Unlimited Mode')
{
  const s = newGame('HRHire', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, hr.id)

  // Inflate staff to 120 so coverage is 0.5
  for (let i = 0; i < 120; i++) {
    const st: Staff = {
      id: `st_pad_${i}`,
      name: `Staff Pad ${i}`,
      role: 'driver',
      skill: 5,
      salary: marketSalary('driver', 5),
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
    }
    s.staff[st.id] = st
  }

  const cov = deskCoverage(s, 'hr')
  check(cov === 0.5, `coverage diluted to 0.5 (got ${cov})`)

  // Add 10 matching driver candidates to pool
  s.hiringPool = []
  for (let i = 0; i < 10; i++) {
    s.hiringPool.push({
      id: `cand_${i}`,
      name: `Candidate ${i}`,
      role: 'driver',
      skill: 5,
      salary: marketSalary('driver', 5),
      hiredDay: 1,
      experienceMonths: 12,
    })
  }

  s.company.hrAutoHire = {
    enabled: true,
    mode: 'unlimited',
    byRole: { driver: [5] },
  }

  // ceil(3 * coverage) = ceil(3 * 0.5) = 2
  const hired = hrAutoHireFromPool(s)
  check(hired === 2, `auto-hires capped at ceil(3 * coverage) = 2 (got ${hired})`)
}

console.log('\n[4] HR Skill Review Gap Stretched by 1 / Coverage')
{
  const s = newGame('HRCoaching', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, hr.id)

  const normalGap = hrSkillReviewGap(5)

  // Inflate staff so coverage drops to 0.5
  for (let i = 0; i < 120; i++) {
    s.staff[`drv_coach_${i}`] = {
      id: `drv_coach_${i}`,
      name: `Driver ${i}`,
      role: 'driver',
      skill: 5,
      salary: 25_000,
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
    }
  }

  const cov = deskCoverage(s, 'hr')
  check(cov === 0.5, `coverage is 0.5 (got ${cov})`)
  const stretchedGap = Math.round(normalGap / cov)
  check(stretchedGap === Math.round(normalGap * 2), `review gap stretched 2.0x: ${stretchedGap}d vs normal ${normalGap}d`)
}

console.log('\n[5] HR Fatigue Interventions Capped')
{
  const s = newGame('HRFatigue', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, hr.id)

  // Inflate staff so coverage is 0.5
  for (let i = 0; i < 120; i++) {
    s.staff[`drv_fat_${i}`] = {
      id: `drv_fat_${i}`,
      name: `Driver Fat ${i}`,
      role: 'driver',
      skill: 5,
      salary: 25_000,
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
    }
  }

  // Set up 5 tired drivers on buses and 5 available spares
  for (let i = 0; i < 5; i++) {
    const busId = `b_fat_${i}`
    s.buses[busId] = {
      id: busId,
      modelId: 'starbus_ultra',
      reg: `KA-01-FAT-${i}`,
      acquiredDay: 1,
      ownership: 'owned',
      status: 'active',
      odometer: 10_000,
      condition: { engine: 90, gearbox: 90, brakes: 90, suspension: 90, body: 90, electrical: 90, ac: 90 },
      lastServiceOdo: 10_000,
      insuranceExpiryDay: s.day + 100,
      fitnessExpiryDay: s.day + 100,
      aitpPaidUntilDay: s.day + 100,
      duty: 'line',
    }
    const tiredDrv = s.staff[`drv_fat_${i}`]
    tiredDrv.busId = busId
    tiredDrv.fatigue = 90

    // Spare driver
    s.staff[`drv_spare_${i}`] = {
      id: `drv_spare_${i}`,
      name: `Spare ${i}`,
      role: 'driver',
      skill: 5,
      salary: 25_000,
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
      fatigue: 0,
      busId: undefined,
    }
  }

  // BAL.span.hrInterventionsPerDay = 3
  // ceil(3 * 0.5) = 2 interventions
  hrFatiguePass(s)
  const tiredUnassigned = [0, 1, 2, 3, 4].filter((i) => !s.staff[`drv_fat_${i}`]?.busId).length
  check(tiredUnassigned === 2, `fatigue swaps capped at ceil(3 * 0.5) = 2 (got ${tiredUnassigned})`)
}

console.log('\n[6] Fire Morale Cushion Weakened by Coverage')
{
  const s = newGame('HRFire', 'seth', 'maa-mdu', 7)
  const hr = recruitVeteran(s, 'manager', { skill: [5, 5] })
  appointHr(s, hr.id)

  const d1 = recruitVeteran(s, 'driver', { skill: [5, 5] })
  const d2 = recruitVeteran(s, 'driver', { skill: [5, 5] })
  d2.morale = 80

  // Under normal full coverage, firing d1 applies base penalty (e.g. 5)
  fire(s, d1.id)
  const dropWithFullCov = 80 - d2.morale

  // Inflate staff so coverage drops to 0.5
  for (let i = 0; i < 120; i++) {
    s.staff[`drv_pad_${i}`] = {
      id: `drv_pad_${i}`,
      name: `Pad ${i}`,
      role: 'driver',
      skill: 5,
      salary: 25_000,
      morale: 80,
      loyalty: 80,
      hiredDay: 1,
      experienceMonths: 6,
    }
  }

  const d3 = recruitVeteran(s, 'driver', { skill: [5, 5] })
  d2.morale = 80
  fire(s, d3.id)
  const dropWithDilutedCov = 80 - d2.morale
  check(dropWithDilutedCov > dropWithFullCov, `firing hit with diluted coverage (${dropWithDilutedCov}) > full coverage (${dropWithFullCov})`)
}

console.log(`\n${failures === 0 ? 'ALL HR SPAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
