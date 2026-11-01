/**
 * Banking: hire-purchase loans with EMI schedules, overdraft with daily
 * interest accrual, credit scoring, missed-EMI penalties and hypothecated
 * bus repossession.
 */
import { BAL, DIFFICULTIES } from '../data/balance'
import {
  LOAN_PRODUCTS,
  CASH_LOAN_SLABS,
  MSME_LENDERS,
  calcEmi,
  cashLoanRateBps,
  effectiveRateBps,
  monthlyInterest,
  splitEmi,
  type LoanProduct,
  type MsmeLenderScheme,
} from '../data/loanProducts'
import { nextId } from '../core/ids'
import { fmtCompact, L, type Money } from '../core/money'
import type { GameState, Loan, ID } from '../types'
import { capitalIn, capitalOut, spend, spendNetted, assetCashValue, fleetBookValue, loansOutstanding, netWorth } from './finance'
import { cancelOpenTripsForBus } from './booking'
import { pushLog } from './log'

export function availableLoanProducts(s: GameState): LoanProduct[] {
  return LOAN_PRODUCTS.filter(
    (p) => s.company.creditScore >= p.minCredit && s.company.reputation >= p.minReputation,
  )
}

/** Credit-score floor for OD. */
export function odCreditFloor(s: GameState): Money {
  for (const [minScore, limit] of BAL.odLimitByCredit) {
    if (s.company.creditScore >= minScore) return limit
  }
  return BAL.odLimitByCredit[BAL.odLimitByCredit.length - 1]![1]
}

/**
 * Cash-credit limit: credit score sets the floor; growing book equity
 * (net worth with OD drawn added back) expands headroom, capped by
 * credit tier and an absolute ceiling.
 */
export function computeOdLimit(s: GameState): Money {
  const floor = odCreditFloor(s)
  const equity = Math.max(0, netWorth(s) + s.od.drawn)
  const fromNw = Math.round(equity * BAL.odPctOfNetWorth)
  const tierCap = Math.round(floor * BAL.odNwMultipleCap)
  const expanded = Math.min(BAL.odAbsoluteCap, Math.min(tierCap, floor + fromNw))
  return Math.max(floor, expanded)
}

export function refreshOdLimit(s: GameState): void {
  const next = computeOdLimit(s)
  // Never cut the limit below what's already drawn
  s.od.limit = Math.max(next, s.od.drawn)
}

export function quoteLoan(s: GameState, productId: string, price: Money, months: number): {
  principal: Money; downPayment: Money; rateBps: number; months: number; emi: Money; processingFee: Money
} | null {
  const p = LOAN_PRODUCTS.find((x) => x.id === productId)
  if (!p) return null
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)!
  const principal = Math.round(price * p.maxLtv)
  const relScore = getLenderRelationshipScore(s, p.id)
  const rateBps = effectiveRateBps(p, s.company.creditScore, diff.loanRateExtraBps, relScore)
  const m = Math.max(p.minMonths, Math.min(p.maxMonths, months))
  return {
    principal,
    downPayment: price - principal,
    rateBps,
    months: m,
    emi: calcEmi(principal, rateBps, m),
    processingFee: Math.round((principal * p.processingBps) / 10000),
  }
}

/** Disburse a hire-purchase loan against a bus purchase. */
export function createLoan(s: GameState, productId: string, price: Money, months: number, busId?: ID): Loan | null {
  const p = LOAN_PRODUCTS.find((x) => x.id === productId)
  const q = quoteLoan(s, productId, price, months)
  if (!p || !q) return null
  const loan: Loan = {
    id: nextId(s.ids, 'ln'),
    kind: 'vehicle',
    lender: p.lender,
    lenderId: p.id,
    principal: q.principal,
    balance: q.principal,
    rateBps: q.rateBps,
    months: q.months,
    emi: q.emi,
    startDay: s.day,
    nextEmiDay: s.day + 30,
    emisPaid: 0,
    emisMissed: 0,
    consecutiveMissed: 0,
    busId,
    status: 'active',
  }
  s.loans[loan.id] = loan
  capitalIn(s, 'loan_disbursal', q.principal, { note: `${p.lender} HP loan` })
  spend(s, 'processing_fee', q.processingFee, { note: `${p.lender} processing` })
  return loan
}

export function forecloseLoan(s: GameState, loanId: ID): string | null {
  const loan = s.loans[loanId]
  if (!loan || loan.status !== 'active') return 'No active loan.'
  const p = LOAN_PRODUCTS.find((x) => x.lender === loan.lender)
  const fee = Math.round((loan.balance * (p?.foreclosureBps ?? 300)) / 10000)
  const total = loan.balance + fee
  if (s.company.cash < total) return `Need ${fmtCompact(total)} cash to foreclose.`
  capitalOut(s, 'loan_principal', loan.balance, { note: `foreclose ${loan.lender}` })
  spend(s, 'penalty', fee, { note: 'foreclosure charges' })
  loan.balance = 0
  loan.status = 'closed'
  const bus = loan.busId ? s.buses[loan.busId] : undefined
  if (bus) bus.loanId = undefined
  const remainingActive = Object.values(s.loans).filter((l) => l.status === 'active').length
  const bonus = remainingActive === 0 ? 25 : 8
  s.company.creditScore = Math.min(900, s.company.creditScore + bonus)
  if (loan.lenderId) {
    if (!s.company.lenderRelations) s.company.lenderRelations = {}
    s.company.lenderRelations[loan.lenderId] = Math.min(100, (s.company.lenderRelations[loan.lenderId] ?? 0) + 5)
  }
  if (remainingActive === 0) {
    pushLog(
      s,
      'good',
      `ALL LOANS CLEARED! Foreclosed final loan with ${loan.lender}. CIBIL score boosted to ${s.company.creditScore} (+${bonus} pts). Clean debt-free track record will continue to heal your score over time.`,
    )
  } else {
    pushLog(s, 'good', loan.kind === 'cash'
      ? `Working-capital loan closed with ${loan.lender}. Credit score +${bonus}.`
      : `Loan foreclosed with ${loan.lender}. Hypothecation released (credit score +${bonus}).`)
  }
  return null
}

export function quoteCashLoan(s: GameState, slabId: string, opts?: { ignoreCredit?: boolean; distress?: boolean }): {
  principal: Money; rateBps: number; months: number; emi: Money; processingFee: Money; lender: string
} | null {
  const slab = CASH_LOAN_SLABS.find((x) => x.id === slabId)
  if (!slab) return null
  if (!opts?.ignoreCredit && s.company.creditScore < slab.minCredit) return null
  const extra = DIFFICULTIES.find((d) => d.id === s.difficulty)!.loanRateExtraBps
  const relScore = getLenderRelationshipScore(s, slab.id)
  const rateBps = cashLoanRateBps(slab, s.company.creditScore, extra, relScore) + (opts?.distress ? 400 : 0)
  return {
    principal: slab.amount,
    rateBps,
    months: slab.months,
    emi: calcEmi(slab.amount, rateBps, slab.months),
    processingFee: Math.round((slab.amount * slab.processingBps) / 10000),
    lender: opts?.distress ? 'Bank of Bharat — distress WC' : 'Bank of Bharat — WC',
  }
}

export function cashLoanNetInflow(slabId: string): Money | null {
  const slab = CASH_LOAN_SLABS.find((x) => x.id === slabId)
  if (!slab) return null
  return slab.amount - Math.round((slab.amount * slab.processingBps) / 10000)
}

/** Take a hire-purchase loan against an unencumbered owned coach. */
export function takeHpLoan(s: GameState, productId: string, busId: ID, months: number): string | null {
  const p = LOAN_PRODUCTS.find((x) => x.id === productId)
  if (!p) return 'Unknown loan product.'
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'owned') return 'Must hypothecate an owned coach.'
  if (bus.loanId) return 'Coach is already hypothecated.'
  if (s.company.creditScore < p.minCredit) return `Requires credit score ${p.minCredit}+ (current: ${s.company.creditScore})`
  if (s.company.reputation < p.minReputation) return `Requires company reputation ${p.minReputation}+ (current: ${s.company.reputation})`

  const loan = createLoan(s, productId, assetCashValue(s, bus), months, bus.id)
  if (!loan) return 'Failed to sanction loan.'
  bus.loanId = loan.id
  pushLog(s, 'good', `Sanctioned HP facility of ${fmtCompact(loan.principal)} from ${p.lender} against ${bus.reg} at ${(loan.rateBps / 100).toFixed(1)}% p.a.`)
  return null
}

/** Unsecured term loan: a fixed cash amount, no vehicle attached. */
export function takeCashLoan(s: GameState, slabId: string, opts?: { rescue?: boolean }): string | null {
  const slab = CASH_LOAN_SLABS.find((x) => x.id === slabId)
  if (!slab) return 'Unknown product.'
  if (!opts?.rescue && s.company.creditScore < slab.minCredit) {
    return `Need credit score ${slab.minCredit}+ for the ${slab.label} facility.`
  }
  const openCash = Object.values(s.loans).filter((l) => l.status === 'active' && l.kind === 'cash')
  if (!opts?.rescue && openCash.length > 0) {
    return 'You already have a working-capital loan. Foreclose or repay it before drawing another.'
  }
  const q = quoteCashLoan(s, slabId, { ignoreCredit: !!opts?.rescue, distress: !!opts?.rescue })
  if (!q) return 'Facility declined.'
  const net = q.principal - q.processingFee
  if (opts?.rescue && s.company.cash + net < 0) {
    return `${slab.label} does not cover the ${fmtCompact(-s.company.cash)} shortfall. Take a larger facility.`
  }
  const loan: Loan = {
    id: nextId(s.ids, 'ln'),
    kind: 'cash',
    lender: q.lender,
    lenderId: slab.id,
    principal: q.principal,
    balance: q.principal,
    rateBps: q.rateBps,
    months: q.months,
    emi: q.emi,
    startDay: s.day,
    nextEmiDay: s.day + 30,
    emisPaid: 0,
    emisMissed: 0,
    consecutiveMissed: 0,
    status: 'active',
  }
  s.loans[loan.id] = loan
  capitalIn(s, 'loan_disbursal', q.principal, { note: `${q.lender} ${slab.label}` })
  spend(s, 'processing_fee', q.processingFee, { note: 'WC loan processing' })
  if (opts?.rescue) {
    s.gameOver = undefined
    s.company.creditScore = Math.max(300, s.company.creditScore - 20)
    pushLog(s, 'good', `Distress working-capital sanctioned: ${fmtCompact(q.principal)} for ${q.months} months at ${(q.rateBps / 100).toFixed(1)}%. EMI ${fmtCompact(q.emi)}/month. The NCLT stay is lifted — keep the EMIs current.`)
  } else {
    pushLog(s, 'good', `Working-capital loan sanctioned: ${fmtCompact(q.principal)} for ${q.months} months at ${(q.rateBps / 100).toFixed(1)}%. EMI ${fmtCompact(q.emi)}/month.`)
  }
  return null
}

/* ==================== MSME & Government Subsidised Schemes ==================== */

export function getLenderRelationshipScore(s: GameState, lenderId: string): number {
  return s.company.lenderRelations?.[lenderId] ?? 0
}

export function msmeRateBps(
  s: GameState,
  lender: MsmeLenderScheme,
  extraBps: number = 0,
): { rateBps: number; discountBps: number; spreadBps: number } {
  const relScore = getLenderRelationshipScore(s, lender.id)
  // Higher relationship score discounts interest rate by up to 150 bps (1.5% PA)
  const discountBps = Math.min(150, Math.round((relScore / 100) * 150))
  // Credit score spread
  let spreadBps = 0
  if (lender.minCreditScore && lender.minCreditScore > 0) {
    spreadBps = Math.max(0, Math.round((750 - s.company.creditScore) * 0.8))
  }
  const finalRateBps = Math.max(500, lender.baseRateBps - discountBps + spreadBps + extraBps)
  return { rateBps: finalRateBps, discountBps, spreadBps }
}

export function checkMsmeEligibility(s: GameState, lender: MsmeLenderScheme): { eligible: boolean; reason?: string } {
  // 1. Credit check
  if (lender.minCreditScore && s.company.creditScore < lender.minCreditScore) {
    return { eligible: false, reason: `Requires CIBIL score of ${lender.minCreditScore}+ (current: ${s.company.creditScore})` }
  }

  // 2. 3 months P&L proof
  if (lender.requiresProofPnl3m) {
    const has3Months = s.monthly.length >= 3 || (s.day - s.startDay >= 90)
    if (!has3Months) {
      const daysNeeded = Math.max(0, 90 - (s.day - s.startDay))
      return { eligible: false, reason: `Requires 3 months operating P&L proof (${daysNeeded} days remaining)` }
    }
  }

  // 3. Property collateral
  if (lender.requiresCollateral) {
    const nw = netWorth(s)
    const hasWorkshop = (s.workshop?.level ?? 0) > 0
    if (nw < L(50) && !hasWorkshop) {
      return { eligible: false, reason: 'Requires property collateral (min ₹50L net worth or owned workshop depot)' }
    }
  }

  // 4. Check if existing active loan already open with this lender
  const existingWithLender = Object.values(s.loans).find(
    (l) => l.status === 'active' && l.lenderId === lender.id,
  )
  if (existingWithLender) {
    return { eligible: false, reason: `Active loan already running with ${lender.name} (foreclose or repay first)` }
  }

  return { eligible: true }
}

export function quoteMsmeLoan(
  s: GameState,
  lenderId: string,
  amount: Money,
  months: number,
): {
  principal: Money
  rateBps: number
  baseRateBps: number
  discountBps: number
  months: number
  emi: Money
  processingFee: Money
  netInflow: Money
  lender: MsmeLenderScheme
} | null {
  const lender = MSME_LENDERS.find((x) => x.id === lenderId)
  if (!lender) return null
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)!
  const { rateBps, discountBps } = msmeRateBps(s, lender, diff.loanRateExtraBps)
  const principal = Math.min(lender.maxAmount, Math.max(10_000_00, amount))
  const m = Math.max(lender.allowedMonths[0], Math.min(lender.allowedMonths[lender.allowedMonths.length - 1], months))
  const emi = calcEmi(principal, rateBps, m)
  const processingFee = Math.round((principal * lender.processingBps) / 10000)
  return {
    principal,
    rateBps,
    baseRateBps: lender.baseRateBps,
    discountBps,
    months: m,
    emi,
    processingFee,
    netInflow: principal - processingFee,
    lender,
  }
}

export function takeMsmeLoan(s: GameState, lenderId: string, amount: Money, months: number): string | null {
  const lender = MSME_LENDERS.find((x) => x.id === lenderId)
  if (!lender) return 'Lender not found.'
  const check = checkMsmeEligibility(s, lender)
  if (!check.eligible) return check.reason ?? 'Not eligible.'

  const q = quoteMsmeLoan(s, lenderId, amount, months)
  if (!q) return 'Could not generate loan quote.'

  const loan: Loan = {
    id: nextId(s.ids, 'ln'),
    kind: 'cash',
    lender: lender.name,
    lenderId: lender.id,
    principal: q.principal,
    balance: q.principal,
    rateBps: q.rateBps,
    months: q.months,
    emi: q.emi,
    startDay: s.day,
    nextEmiDay: s.day + 30,
    emisPaid: 0,
    emisMissed: 0,
    consecutiveMissed: 0,
    status: 'active',
  }

  s.loans[loan.id] = loan
  capitalIn(s, 'loan_disbursal', q.principal, { note: `${lender.name} MSME loan` })
  if (q.processingFee > 0) {
    spend(s, 'processing_fee', q.processingFee, { note: `${lender.name} processing fee` })
  }

  if (lender.reputationPenalty) {
    s.company.reputation = Math.max(0, s.company.reputation - lender.reputationPenalty)
    pushLog(
      s,
      'alert',
      `Borrowed ${fmtCompact(q.principal)} from ${lender.name} at ${(q.rateBps / 100).toFixed(1)}% p.a. Informal moneylenders carry heavy social stigma — Company Reputation dropped by ${lender.reputationPenalty}.`,
    )
  } else {
    pushLog(
      s,
      'good',
      `Sanctioned ${fmtCompact(q.principal)} from ${lender.name} (${lender.schemeName}) for ${q.months} months at ${(q.rateBps / 100).toFixed(1)}% p.a. Monthly EMI: ${fmtCompact(q.emi)}. On-time payments will build your relationship score!`,
    )
  }

  return null
}

function remainingTenor(loan: Loan): number {
  return Math.max(1, (loan.months || 36) - loan.emisPaid)
}

/** If a stored EMI no longer covers monthly interest (snowballed balance, bad save), rebuild it. */
function repairEmi(loan: Loan): void {
  if (loan.balance <= 0) return
  const need = monthlyInterest(loan.balance, loan.rateBps)
  if (loan.emi <= need) {
    loan.emi = calcEmi(loan.balance, loan.rateBps, remainingTenor(loan))
  }
}

function repossess(s: GameState, loan: Loan): void {
  const bus = loan.busId ? s.buses[loan.busId] : undefined
  loan.status = 'defaulted'
  s.company.creditScore = Math.max(300, s.company.creditScore - 120)
  if (bus) {
    cancelOpenTripsForBus(s, bus.id, 'bus repossessed by lender')
    const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
    if (sch) sch.busIds = sch.busIds.filter((b) => b !== bus.id)
    for (const st of Object.values(s.staff)) if (st.busId === bus.id) st.busId = undefined
    const recovered = Math.round(assetCashValue(s, bus) * BAL.fireSaleHaircut)
    const applied = Math.min(recovered, loan.balance)
    loan.balance -= applied
    delete s.buses[bus.id]
    pushLog(s, 'alert', `${loan.lender} REPOSSESSED ${bus.reg} after ${loan.consecutiveMissed} missed EMIs. ${fmtCompact(applied)} recovered against the loan; ${fmtCompact(loan.balance)} still owed.`)
  } else {
    pushLog(s, 'alert', `${loan.lender} declared your loan NPA. ${fmtCompact(loan.balance)} outstanding moved to recovery.`)
  }
}

/** Daily: OD auto-draw/repay + interest accrual; EMI collection. */
export function dailyBankingPass(s: GameState): void {
  const od = s.od

  // EMIs due today
  for (const loan of Object.values(s.loans)) {
    if (loan.status !== 'active' || s.day < loan.nextEmiDay) continue
    if (loan.balance <= 0) {
      loan.status = 'closed'
      const bus = loan.busId ? s.buses[loan.busId] : undefined
      if (bus) bus.loanId = undefined
      continue
    }
    repairEmi(loan)
    const { interest, principal, payment } = splitEmi(loan.balance, loan.rateBps, loan.emi)
    const liquidityNow = s.company.cash + (od.limit - od.drawn)
    if (payment > 0 && liquidityNow >= payment) {
      spend(s, 'interest', interest, { busId: loan.busId, note: `${loan.lender} EMI interest` })
      capitalOut(s, 'loan_principal', principal, { busId: loan.busId, note: `${loan.lender} EMI principal` })
      loan.balance = Math.max(0, loan.balance - principal)
      loan.emisPaid++
      loan.consecutiveMissed = 0
      loan.nextEmiDay += 30
      s.company.creditScore = Math.min(900, s.company.creditScore + BAL.paidEmiCreditGain)
      if (loan.lenderId) {
        if (!s.company.lenderRelations) s.company.lenderRelations = {}
        const prev = s.company.lenderRelations[loan.lenderId] ?? 0
        const next = Math.min(100, prev + 1)
        s.company.lenderRelations[loan.lenderId] = next
        if (next >= 25 && prev < 25) {
          pushLog(s, 'good', `Relationship with ${loan.lender} upgraded to Silver Partner (Score ${next}/100)! Better rates unlocked.`)
        } else if (next >= 50 && prev < 50) {
          pushLog(s, 'good', `Relationship with ${loan.lender} upgraded to Gold Partner (Score ${next}/100)! Further rate discounts unlocked.`)
        } else if (next >= 75 && prev < 75) {
          pushLog(s, 'good', `Relationship with ${loan.lender} reached Platinum Prime (Score ${next}/100)! Maximum subsidized rates unlocked.`)
        }
      }
      if (loan.balance <= 0) {
        loan.status = 'closed'
        const bus = loan.busId ? s.buses[loan.busId] : undefined
        if (bus) bus.loanId = undefined
        const remainingActive = Object.values(s.loans).filter((l) => l.status === 'active').length
        if (remainingActive === 0) {
          s.company.creditScore = Math.min(900, s.company.creditScore + 20)
          pushLog(
            s,
            'good',
            `ALL LOANS PAID OFF! Hypothecations cleared and zero debt burden. CIBIL score boosted to ${s.company.creditScore} (+20 pts). Score will continue to automatically recover over time.`,
          )
        } else {
          pushLog(s, 'good', loan.kind === 'cash'
            ? `${loan.lender} working-capital loan fully repaid.`
            : `${loan.lender} loan fully repaid. Bus papers released.`)
        }
      }
    } else {
      loan.emisMissed++
      loan.consecutiveMissed++
      const penalty = Math.round((loan.emi * BAL.emiPenaltyBps) / 10000)
      // Capitalise unpaid interest so the book doesn't ignore a missed month.
      loan.balance += interest + penalty
      spendNetted(s, 'interest', interest, { busId: loan.busId, note: `${loan.lender} interest accrued (missed EMI)` })
      s.company.creditScore = Math.max(300, s.company.creditScore - BAL.missedEmiCreditHit)
      if (loan.lenderId && s.company.lenderRelations) {
        s.company.lenderRelations[loan.lenderId] = Math.max(0, (s.company.lenderRelations[loan.lenderId] ?? 0) - 5)
      }
      loan.nextEmiDay += 30
      pushLog(s, 'alert', `MISSED EMI of ${fmtCompact(loan.emi)} to ${loan.lender} (${loan.consecutiveMissed} in a row). Penalty ${fmtCompact(penalty)} added. Credit score now ${s.company.creditScore}.`)
      if (loan.consecutiveMissed >= BAL.repoAfterConsecutiveMissed) repossess(s, loan)
    }
  }

  coverWithOd(s)
  if (od.drawn > 0) {
    od.accruedInterest += Math.round((od.drawn * od.rateBps) / 10000 / 365)
  }
  dailyCreditRehabilitation(s)
  refreshOdLimit(s)
}

/**
 * Daily credit rehabilitation: when all term and cash loans are paid off
 * (0 active loans), the credit bureau (CIBIL) automatically heals the company's
 * score over time as past delinquencies age out and clean debt-free history accumulates.
 */
export function dailyCreditRehabilitation(s: GameState): void {
  const activeLoans = Object.values(s.loans).filter((l) => l.status === 'active')
  if (activeLoans.length > 0) return
  if (s.company.creditScore >= 850) return

  // If OD is severely overdrawn (drawn > 85% limit), pause healing
  if (s.od.limit > 0 && s.od.drawn > s.od.limit * 0.85) return

  const prevScore = s.company.creditScore
  let interval = 4 // default days per +1 point
  if (prevScore < 500) interval = 2       // ~15 pts/month when severely damaged
  else if (prevScore < 650) interval = 3  // ~10 pts/month in subprime band
  else if (prevScore < 750) interval = 4  // ~7.5 pts/month in fair/good band
  else interval = 6                       // ~5 pts/month in prime band

  if (s.day % interval === 0) {
    const nextScore = Math.min(850, prevScore + 1)
    s.company.creditScore = nextScore

    // Notify on crossing major CIBIL credit milestones
    const milestones = [
      { score: 500, label: 'Fair Credit (500)', perk: 'working-capital facilities accessible' },
      { score: 620, label: 'Standard Credit (620)', perk: 'standard vehicle finance unlocked' },
      { score: 700, label: 'Good Credit (700)', perk: 'prime vehicle loan rates & higher OD limit' },
      { score: 750, label: 'Prime Credit (750)', perk: 'lowest borrowing spreads & premier lenders' },
      { score: 800, label: 'Excellent Credit (800)', perk: 'maximum OD leverage & Tier-1 bank terms' },
    ]
    for (const m of milestones) {
      if (prevScore < m.score && nextScore >= m.score) {
        pushLog(
          s,
          'good',
          `CIBIL MILESTONE: Credit score reached ${nextScore} (${m.label})! Debt-free track record restored your standing — ${m.perk}.`,
        )
      }
    }
  }
}

/** Draw from OD to cover negative cash; sweep surplus cash back into OD. */
export function coverWithOd(s: GameState): void {
  const od = s.od
  if (s.company.cash < 0) {
    const need = -s.company.cash
    const draw = Math.min(need, od.limit - od.drawn)
    if (draw > 0) {
      od.drawn += draw
      s.company.cash += draw
    }
  } else if (s.company.cash > 0 && od.drawn > 0) {
    const repay = Math.min(s.company.cash, od.drawn)
    od.drawn -= repay
    s.company.cash -= repay
  }
}

/** Month-end: charge accrued OD interest, refresh OD limit from credit + net worth. */
export function monthlyBankingPass(s: GameState): void {
  if (s.od.accruedInterest > 0) {
    spend(s, 'od_interest', s.od.accruedInterest, { note: 'overdraft interest' })
    s.od.accruedInterest = 0
  }
  refreshOdLimit(s)
  // gentle credit drift from leverage health
  const debt = loansOutstanding(s) + s.od.drawn
  const assets = fleetBookValue(s) + Math.max(0, s.company.cash)
  if (debt > 0 && assets > 0) {
    const leverage = debt / assets
    if (leverage < 0.5) s.company.creditScore = Math.min(900, s.company.creditScore + 3)
    else if (leverage > 1.1) s.company.creditScore = Math.max(300, s.company.creditScore - 4)
  }
}
