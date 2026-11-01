/**
 * Insurance claims: file after accident → surveyor lag → Accounts Manager / settle vs pay garage now.
 * Accounts Manager automatically handles claims upon survey clearance:
 *  - Aims to settle and credits payout to "Insurance settlements"
 *  - If insurance process fails or is rejected, repair cost is deducted from cash reserve
 *    and expensed under "Accident & repair" directly below "Maintenance & repairs".
 */
import { BAL } from '../data/balance'
import { nextId } from '../core/ids'
import { rngFor, rInt, rChance } from '../core/rng'
import { fmtCompact } from '../core/money'
import type { GameState, ID, InsuranceClaim, InsuranceClaimStatus } from '../types'
import { canAfford, earn, spend, pushTxn } from './finance'
import { pushLog } from './log'
import { accountantOnDuty } from './staffing'
import { deskCapacity, deskCoverage } from './span'

const C = BAL.insuranceClaim

const REJECTION_REASONS = [
  'Surveyor disputed driver negligence & road conditions',
  'Insurer cited policy exclusion on pre-existing mechanical wear',
  'Delayed accident reporting & disputed damage invoice',
  'Surveyor technical query: disputed repair estimate',
  'Insurer denied third-party liability coverage',
]

export function fileAccidentClaim(
  s: GameState,
  busId: ID,
  repairEstimate: number,
  tripId?: ID,
): InsuranceClaim {
  const rng = rngFor(s.seed, 'claim', busId, s.day, tripId ?? '')
  const claim: InsuranceClaim = {
    id: nextId(s.ids, 'ic'),
    busId,
    filedDay: s.day,
    surveyorUntilDay: s.day + rInt(rng, C.surveyorDaysMin, C.surveyorDaysMax),
    repairEstimate,
    status: 'survey',
    tripId,
  }
  s.insuranceClaims.push(claim)
  const bus = s.buses[busId]
  const acct = accountantOnDuty(s)
  pushLog(
    s,
    'info',
    `Claim filed on ${bus?.reg ?? busId}: surveyor due day ${claim.surveyorUntilDay}.${acct ? ` Accounts Manager ${acct.name} will handle settlement upon survey clearance.` : ' Pay garage now or wait to settle.'}`,
  )
  return claim
}

/** Pay the full garage bill now; claim stays open for later reimbursement. */
export function payGarageNow(s: GameState, claimId: ID): string | null {
  const claim = s.insuranceClaims.find((c) => c.id === claimId)
  if (!claim || claim.status === 'settled' || claim.status === 'rejected') return 'Claim gone or already resolved.'
  if (claim.status === 'garage_paid') return 'Garage already paid.'
  const bill = Math.round(claim.repairEstimate * C.garageNowShare)
  if (!canAfford(s, bill)) return 'Cannot afford garage bill.'
  spend(s, 'maintenance', bill, { busId: claim.busId, note: 'accident garage (claim pending)' })
  claim.status = 'garage_paid'
  pushLog(s, 'alert', `Garage paid ${bill} on claim ${claim.id} — waiting on insurer.`)
  return null
}

export interface ClaimProcessResult {
  ok: boolean
  status?: InsuranceClaimStatus
  payout?: number
  reason?: string
  error?: string
}

/**
 * Process an insurance claim (aims to settle, or handles rejection).
 * Called automatically by Accounts Manager or manually by player.
 */
export function processInsuranceClaim(
  s: GameState,
  claimId: ID,
  options?: { forceSettle?: boolean; forceReject?: boolean },
): ClaimProcessResult {
  const claim = s.insuranceClaims.find((c) => c.id === claimId)
  if (!claim) return { ok: false, error: 'Claim not found.' }
  if (claim.status === 'settled' || claim.status === 'rejected') {
    return { ok: false, error: `Claim already ${claim.status}.` }
  }
  if (s.day < claim.surveyorUntilDay && claim.status === 'survey') {
    return { ok: false, error: `Surveyor still inspecting until Day ${claim.surveyorUntilDay}.` }
  }

  const acct = accountantOnDuty(s)
  const rng = rngFor(s.seed, 'claim_process', claim.id, claim.busId, claim.filedDay)

  // Settle chance based on Accounts Manager skill:
  // Base 70% unmanaged; with Accounts Manager, scales from ~64% (skill 1) to ~96% (skill 10).
  let settleChance = acct
    ? Math.min(0.96, Math.max(0.60, 0.60 + acct.skill * deskCoverage(s, 'accountant') * 0.036))
    : (BAL.insuranceClaim.baseSettleChance ?? 0.70)

  if (options?.forceSettle) settleChance = 1
  if (options?.forceReject) settleChance = 0

  const rollsSettle = rChance(rng, settleChance)
  const bus = s.buses[claim.busId]
  const wasGaragePaid = claim.status === 'garage_paid'

  if (rollsSettle) {
    // Settle success: credit to Insurance settlements in money
    const skillBonus = acct ? (acct.skill * deskCoverage(s, 'accountant') - 5) * 0.02 : 0
    const payoutRate = Math.min(0.88, Math.max(0.60, C.settleShare + skillBonus))
    const payout = Math.round(claim.repairEstimate * payoutRate)

    earn(s, 'insurance_claim', payout, {
      busId: claim.busId,
      note: acct ? `insurance settlement (${acct.name})` : 'insurance settlement',
    })

    if (bus) {
      bus.insurancePremiumMult = (bus.insurancePremiumMult ?? 1) * (1 + C.ncbPremiumHike)
      bus.accidentHistory = true
    }

    claim.status = 'settled'
    claim.resolvedDay = s.day
    claim.payout = payout

    const mgrTag = acct ? `Accounts Manager ${acct.name}` : 'Company'
    pushLog(
      s,
      'good',
      `${mgrTag} settled insurance claim for ${bus?.reg ?? claim.busId}: ${fmtCompact(payout)} received into Insurance settlements (NCB lost, premium +${Math.round(C.ncbPremiumHike * 100)}%).`,
    )
    return { ok: true, status: 'settled', payout }
  } else {
    // Rejected / Failed: deduct repair cost from cash reserve and add to Accident & repair in money table
    const reasonIndex = rInt(rng, 0, REJECTION_REASONS.length - 1)
    const reason = REJECTION_REASONS[reasonIndex] ?? 'Surveyor disputed accident liability'

    claim.status = 'rejected'
    claim.resolvedDay = s.day
    claim.rejectionReason = reason

    if (wasGaragePaid) {
      // Reclassify earlier payment from maintenance to accident_repair
      const bill = Math.round(claim.repairEstimate * C.garageNowShare)
      s.curMonth.expense.maintenance = Math.max(0, (s.curMonth.expense.maintenance ?? 0) - bill)
      s.curMonth.expense.accident_repair = (s.curMonth.expense.accident_repair ?? 0) + bill
      pushTxn(s, {
        day: s.day,
        head: 'accident_repair',
        kind: 'expense',
        amount: bill,
        busId: claim.busId,
        note: `accident repair — claim rejected: ${reason}`,
      })
    } else {
      // Deduct full repair estimate from cash reserve under accident_repair
      const repairCost = claim.repairEstimate
      spend(s, 'accident_repair', repairCost, {
        busId: claim.busId,
        note: `accident repair — claim rejected: ${reason}`,
      })
    }

    if (bus) {
      bus.accidentHistory = true
      // NCB preserved because insurer paid 0 and rejected claim
    }

    const mgrTag = acct ? `Accounts Manager ${acct.name}` : 'Insurance process'
    pushLog(
      s,
      'alert',
      `Insurance claim for ${bus?.reg ?? claim.busId} was REJECTED by insurer (${reason}). ${mgrTag} deducted ${fmtCompact(claim.repairEstimate)} from cash reserve under Accident & repair.`,
    )
    return { ok: true, status: 'rejected', reason }
  }
}

export function settleClaim(s: GameState, claimId: ID): string | null {
  const res = processInsuranceClaim(s, claimId)
  if (!res.ok) return res.error ?? 'Failed to process claim.'
  return null
}

/** Auto-progress survey → ready; Accounts Manager automatically processes open claims. */
export function dailyClaimsPass(s: GameState): void {
  const acct = accountantOnDuty(s)
  const cap = Math.floor(deskCapacity(s, 'accountant') / 4)
  let processed = 0

  for (const c of s.insuranceClaims) {
    if (c.status === 'survey' || c.status === 'garage_paid') {
      if (s.day >= c.surveyorUntilDay) {
        if (acct) {
          // Accounts Manager handles claim automatically!
          if (processed < cap) {
            processInsuranceClaim(s, c.id)
            processed++
          }
        } else {
          // Alert once on survey completion date for manual settlement
          if (s.day === c.surveyorUntilDay) {
            pushLog(
              s,
              'info',
              `Surveyor cleared claim on ${s.buses[c.busId]?.reg ?? c.busId} — settle on Workshop / Money or appoint an Accounts Manager to automate.`,
            )
          }
        }
      }
    }
  }

  // Prune old settled or rejected claims after 60 days
  s.insuranceClaims = s.insuranceClaims.filter(
    (c) => (c.status !== 'settled' && c.status !== 'rejected') || s.day - c.filedDay < 60,
  )
}
