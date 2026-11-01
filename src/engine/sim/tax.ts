/**
 * Statutory: monthly GST remittance, quarterly TDS returns, and a monthly
 * income-tax provision (tax is charged and paid every month, not as a single
 * year-end settlement).
 */
import { BAL } from '../data/balance'
import { MONTH_SHORT, toCivil } from '../core/calendar'
import { fmtCompact, rs, toRupees, type Money } from '../core/money'
import type { GameState } from '../types'
import { spend, pushTxn } from './finance'
import { pushLog } from './log'
import { accountantOnDuty } from './staffing'
import { deskCoverage } from './span'

export function calcGstDue(s: GameState): { netDue: number; creditUsed: number } {
  const payable = s.company.gstPayable ?? 0
  const credit = s.company.gstInputCredit ?? 0
  const creditUsed = Math.min(payable, credit)
  const netDue = Math.max(0, payable - creditUsed)
  return { netDue, creditUsed }
}

export function remitGst(s: GameState, isAccountant = false): string | null {
  const { netDue, creditUsed } = calcGstDue(s)
  const payable = s.company.gstPayable ?? 0
  if (netDue <= 0 && payable <= 0) {
    s.company.gstDueDay = undefined
    return 'No GST due to remit.'
  }
  if (netDue > 0) {
    spend(s, 'gst', netDue, { note: `GST remittance (net of ₹${toRupees(creditUsed)} ITC)` })
  }
  s.company.gstPayable = Math.max(0, payable - (creditUsed + netDue))
  s.company.gstInputCredit = Math.max(0, (s.company.gstInputCredit ?? 0) - creditUsed)
  s.company.gstDueDay = undefined
  if (isAccountant) {
    pushLog(s, 'finance', `Accountant filed & remitted GST of ${fmtCompact(netDue)} (utilized ${fmtCompact(creditUsed)} ITC).`)
  } else {
    pushLog(s, 'finance', `GST filed & remitted: ${fmtCompact(netDue)} paid (utilized ${fmtCompact(creditUsed)} ITC).`)
  }
  return null
}

export function fileTds(s: GameState, isAccountant = false): string | null {
  const tds = s.company.tdsPayable ?? 0
  if (tds <= 0) {
    s.company.tdsDueDay = undefined
    return 'No TDS payable to file.'
  }
  // The 1% was already expensed to P&L via spendNetted('tds') when withheld from the owner payout.
  // Cash leaves today on filing:
  s.company.cash -= tds
  pushTxn(s, { day: s.day, head: 'tds', kind: 'expense', amount: tds, note: 'TDS quarterly remittance' })
  s.company.tdsPayable = 0
  s.company.tdsDueDay = undefined
  s.company.tdsFiledThroughDay = s.day
  if (isAccountant) {
    pushLog(s, 'finance', `Accountant filed quarterly TDS return: ${fmtCompact(tds)} remitted.`)
  } else {
    pushLog(s, 'finance', `Quarterly TDS filed and remitted: ${fmtCompact(tds)}.`)
  }
  return null
}

export function dailyTaxPass(s: GameState): void {
  const acct = accountantOnDuty(s)
  const canAutoFile = !!acct && deskCoverage(s, 'accountant') >= 0.75

  // 1. GST check
  if (s.company.gstDueDay !== undefined) {
    if (s.day === s.company.gstDueDay && canAutoFile) {
      remitGst(s, true)
    } else if (s.day > s.company.gstDueDay) {
      if (canAutoFile) {
        remitGst(s, true)
      } else {
        if (s.day === s.company.gstDueDay + 1 || (s.day - s.company.gstDueDay) % 30 === 0) {
          const { netDue } = calcGstDue(s)
          if (netDue > 0) {
            const pen = Math.max(rs(100), Math.round(netDue * 0.01))
            spend(s, 'penalty', pen, { note: 'GST late remittance penalty (1%/mo)' })
            pushLog(s, 'alert', `GST payment overdue! Penalty of ${fmtCompact(pen)} charged. Remit under Money tab.`)
          }
        }
      }
    }
  }

  // 2. TDS check
  if (s.company.tdsDueDay !== undefined) {
    if (s.day === s.company.tdsDueDay && canAutoFile) {
      fileTds(s, true)
    } else if (s.day > s.company.tdsDueDay) {
      if (canAutoFile) {
        fileTds(s, true)
      } else {
        if (s.day === s.company.tdsDueDay + 1 || (s.day - s.company.tdsDueDay) % 30 === 0) {
          const tds = s.company.tdsPayable ?? 0
          if (tds > 0) {
            const pen = Math.max(rs(100), Math.round(tds * 0.01))
            spend(s, 'penalty', pen, { note: 'TDS late deposit penalty (1%/mo)' })
            pushLog(s, 'alert', `TDS quarterly filing overdue! Penalty of ${fmtCompact(pen)} charged. File under Money tab.`)
          }
        }
      }
    }
  }
}

/** Income tax on a taxable-profit figure, floored at zero. */
export function incomeTaxOn(taxableProfit: Money): Money {
  return Math.max(0, Math.round(taxableProfit * BAL.incomeTaxRate))
}

/**
 * Called at month end.
 *
 * Income tax is provided every month, not settled in one lump when the year
 * closes. Each month end charges tax on the FY's taxable profit accrued so
 * far, nets off what has already been provided this year, and pays the
 * difference — so a steady one-twelfth of the year's tax leaves the bank
 * instead of a March surprise, and a loss month automatically pays nothing
 * (later months then owe less on the smaller cumulative profit).
 *
 * Tax never reduces `fyProfit`: that figure is the pre-tax base the charge is
 * computed on. A year that ends over-provided (profitable months followed by
 * a loss) carries the excess into the next FY as an advance-tax credit.
 */
export function monthlyTaxPass(s: GameState): void {
  const c = s.company

  // Stop auto-paying GST: set due day to month-end + 7
  if ((c.gstPayable ?? 0) > 0) {
    c.gstDueDay = s.day + 7
  }

  const civ = toCivil(s.day)

  // Quarterly TDS return due day (quarter ends in Mar, Jun, Sep, Dec; due in 15 days)
  if ([3, 6, 9, 12].includes(civ.m) && (c.tdsPayable ?? 0) > 0) {
    c.tdsDueDay = s.day + 15
  }

  // Monthly income-tax provision on the FY's taxable profit to date.
  const target = incomeTaxOn(c.fyProfit)
  const due = target - c.advanceTaxPaid
  if (due > 0) {
    spend(s, 'income_tax', due, { note: `income tax provision · ${MONTH_SHORT[civ.m - 1]}` })
    c.advanceTaxPaid += due
    pushLog(
      s,
      'finance',
      `Income tax provision for ${MONTH_SHORT[civ.m - 1]}: ${fmtCompact(due)} paid · ${fmtCompact(c.advanceTaxPaid)} provided this FY.`,
    )
  }

  // FY close: March month-end
  if (civ.m === 3) {
    const provided = c.advanceTaxPaid
    const carried = Math.max(0, provided - target)
    pushLog(
      s,
      'finance',
      `FY closed. Profit ${fmtCompact(c.fyProfit)}, income tax provided ${fmtCompact(provided)}` +
        (carried > 0 ? ` · ${fmtCompact(carried)} excess carried into the new year` : '') + '.',
    )
    c.fyProfit = 0
    c.fyRevenue = 0
    // An over-provision is an advance-tax credit against next year, not a refund.
    c.advanceTaxPaid = carried
    c.taxProvision = 0
  } else {
    // Unpaid provision: zero now that the month's charge has been paid, but the
    // balance sheet still needs the figure if the year ends over- or under-paid.
    c.taxProvision = Math.max(0, target - c.advanceTaxPaid)
  }
}
