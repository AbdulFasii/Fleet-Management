import { L, Cr, type Money } from '../core/money'

export interface LoanProduct {
  id: string
  lender: string
  maxLtv: number
  baseRateBps: number // at credit 750; worse credit pays more
  minMonths: number
  maxMonths: number
  processingBps: number
  foreclosureBps: number
  minCredit: number
  minReputation: number
}

export const LOAN_PRODUCTS: LoanProduct[] = [
  {
    id: 'shriram', lender: 'Shriram Finance',
    maxLtv: 0.80, baseRateBps: 1500, minMonths: 36, maxMonths: 60,
    processingBps: 200, foreclosureBps: 400, minCredit: 550, minReputation: 0,
  },
  {
    id: 'chola', lender: 'Cholamandalam',
    maxLtv: 0.75, baseRateBps: 1400, minMonths: 36, maxMonths: 60,
    processingBps: 150, foreclosureBps: 400, minCredit: 620, minReputation: 0,
  },
  {
    id: 'sundaram', lender: 'Sundaram Finance',
    maxLtv: 0.70, baseRateBps: 1250, minMonths: 36, maxMonths: 48,
    processingBps: 100, foreclosureBps: 300, minCredit: 700, minReputation: 15,
  },
  {
    id: 'sbi', lender: 'SBI Commercial Vehicle',
    maxLtv: 0.85, baseRateBps: 1100, minMonths: 48, maxMonths: 72,
    processingBps: 80, foreclosureBps: 200, minCredit: 750, minReputation: 40,
  },
]

/** Unsecured working-capital slabs — cash in hand, no bus hypothecation. */
export interface CashLoanSlab {
  id: string
  label: string
  amount: Money
  months: number
  minCredit: number
  baseRateBps: number
  processingBps: number
  foreclosureBps: number
}

export const CASH_LOAN_SLABS: CashLoanSlab[] = [
  { id: 'wc5', label: '₹5 lakh', amount: L(5), months: 18, minCredit: 560, baseRateBps: 1600, processingBps: 150, foreclosureBps: 300 },
  { id: 'wc10', label: '₹10 lakh', amount: L(10), months: 24, minCredit: 600, baseRateBps: 1550, processingBps: 120, foreclosureBps: 250 },
  { id: 'wc30', label: '₹30 lakh', amount: L(30), months: 36, minCredit: 640, baseRateBps: 1520, processingBps: 120, foreclosureBps: 250 },
  { id: 'wc50', label: '₹50 lakh', amount: L(50), months: 36, minCredit: 680, baseRateBps: 1500, processingBps: 100, foreclosureBps: 200 },
  { id: 'wc75', label: '₹75 lakh', amount: L(75), months: 48, minCredit: 720, baseRateBps: 1480, processingBps: 100, foreclosureBps: 200 },
  { id: 'wc1cr', label: '₹1 crore', amount: Cr(1), months: 60, minCredit: 750, baseRateBps: 1450, processingBps: 80, foreclosureBps: 180 },
]

/** MSME & Government Subsidised Lender Schemes */
export interface MsmeLenderScheme {
  id: string
  name: string
  schemeName: string
  baseRateBps: number
  maxAmount: Money
  defaultMonths: number
  allowedMonths: number[]
  processingBps: number
  foreclosureBps: number
  notes: string
  requiresProofPnl3m?: boolean
  requiresCollateral?: boolean
  reputationPenalty?: number
  minCreditScore?: number
}

export const MSME_LENDERS: MsmeLenderScheme[] = [
  {
    id: 'sbi_msme',
    name: 'SBI MSME',
    schemeName: 'SME Smart Score / CGTMSE',
    baseRateBps: 950, // 9.5% PA
    maxAmount: L(50),
    defaultMonths: 36,
    allowedMonths: [12, 24, 36, 48, 60],
    processingBps: 50,
    foreclosureBps: 150,
    notes: 'Requires 3 months P&L proof',
    requiresProofPnl3m: true,
    minCreditScore: 650,
  },
  {
    id: 'uco_mudra',
    name: 'UCO MUDRA (Tarun)',
    schemeName: 'Pradhan Mantri MUDRA Yojana',
    baseRateBps: 1000, // 10% PA
    maxAmount: L(10),
    defaultMonths: 24,
    allowedMonths: [12, 24, 36],
    processingBps: 25,
    foreclosureBps: 100,
    notes: 'No collateral, fast disbursal',
    minCreditScore: 500,
  },
  {
    id: 'canara_fleet',
    name: 'Canara Bank Fleet',
    schemeName: 'Canara Commercial Fleet Facility',
    baseRateBps: 880, // 8.8% PA
    maxAmount: Cr(2),
    defaultMonths: 48,
    allowedMonths: [24, 36, 48, 60, 72],
    processingBps: 50,
    foreclosureBps: 150,
    notes: 'Requires property collateral',
    requiresCollateral: true,
    minCreditScore: 700,
  },
  {
    id: 'nbfc_shriram',
    name: 'NBFC (Shriram)',
    schemeName: 'Shriram Transport Working Capital',
    baseRateBps: 1400, // 14% PA
    maxAmount: L(80),
    defaultMonths: 36,
    allowedMonths: [12, 24, 36, 48, 60],
    processingBps: 150,
    foreclosureBps: 300,
    notes: 'Fast, flexible, no property needed',
    minCreditScore: 550,
  },
  {
    id: 'moneylender',
    name: 'Moneylender',
    schemeName: 'Private Informal Cash',
    baseRateBps: 2400, // 24% PA
    maxAmount: L(5),
    defaultMonths: 12,
    allowedMonths: [6, 12, 18],
    processingBps: 300,
    foreclosureBps: 500,
    notes: 'Instant, illegal-adjacent, reputation risk',
    reputationPenalty: 2,
    minCreditScore: 0,
  },
]

export function cashLoanRateBps(slab: CashLoanSlab, creditScore: number, extraBps: number, relScore: number = 0): number {
  const spread = Math.max(0, Math.round((750 - creditScore) * 1.4))
  const discountBps = Math.min(150, Math.round((relScore / 100) * 150))
  return Math.max(500, slab.baseRateBps + spread - discountBps + extraBps)
}

/** Actual annual rate for a borrower: worse credit pays a spread, relationship discounts up to 1.5%. */
export function effectiveRateBps(p: LoanProduct, creditScore: number, extraBps: number, relScore: number = 0): number {
  const spread = Math.max(0, Math.round((750 - creditScore) * 1.2))
  const discountBps = Math.min(150, Math.round((relScore / 100) * 150))
  return Math.max(500, p.baseRateBps + spread - discountBps + extraBps)
}

/** Standard EMI formula, monthly reducing-balance. */
export function calcEmi(principal: Money, rateBps: number, months: number): Money {
  const n = Math.max(1, Math.round(months) || 1)
  const r = rateBps / 10000 / 12
  if (!Number.isFinite(r) || r <= 0) return Math.ceil(principal / n)
  const f = Math.pow(1 + r, n)
  if (!Number.isFinite(f) || f <= 1) return Math.ceil(principal / n)
  return Math.round((principal * r * f) / (f - 1))
}

/** One month of reducing-balance interest on `balance`. */
export function monthlyInterest(balance: Money, rateBps: number): Money {
  if (balance <= 0 || rateBps <= 0) return 0
  return Math.round((balance * rateBps) / 10000 / 12)
}

/**
 * Split one installment: interest is never larger than the cash going out,
 * principal is never negative, and the last payment can be smaller than EMI.
 */
export function splitEmi(balance: Money, rateBps: number, emi: Money): {
  interest: Money
  principal: Money
  payment: Money
} {
  if (balance <= 0) return { interest: 0, principal: 0, payment: 0 }
  const interestDue = monthlyInterest(balance, rateBps)
  const cap = Math.max(0, emi)
  const payment = Math.min(cap > 0 ? cap : interestDue + balance, balance + interestDue)
  const interest = Math.min(interestDue, payment)
  const principal = Math.min(balance, Math.max(0, payment - interest))
  return { interest, principal, payment }
}
