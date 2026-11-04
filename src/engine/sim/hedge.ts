import type { GameState, Money } from '../types'
import { fmtCompact } from '../core/money'
import { canAfford, earn, spend } from './finance'
import { pushLog } from './log'

/**
 * Fuel hedge: lock a diesel price for a notional volume of litres a month.
 * At each month end the contract settles against the month's average pump price:
 * if diesel averaged above the locked price you are paid the difference, below it you pay it.
 * You still buy your real fuel at the pump; the hedge only evens out the swings.
 */

const CARRY = 1.03 // locked price sits 3% above today's pump price
const PREMIUM_PCT = 1 // paid upfront, as a share of the contract's notional value
export const HEDGE_MONTHS = [3, 6, 12] as const
export const HEDGE_LITRES = [10_000, 25_000, 50_000, 100_000] as const

export interface HedgeQuote {
  strikePaise: Money
  premium: Money
  notional: Money
}

export function quoteFuelHedge(s: GameState, months: number, litresPerMonth: number): HedgeQuote {
  const strikePaise = Math.round(s.world.dieselPaise * CARRY)
  const notional = Math.round(strikePaise * litresPerMonth * months)
  return { strikePaise, notional, premium: Math.round((notional * PREMIUM_PCT) / 100) }
}

export function buyFuelHedge(s: GameState, months: number, litresPerMonth: number): string | null {
  if (s.company.fuelHedge) return 'A fuel hedge is already running.'
  if (!HEDGE_MONTHS.includes(months as (typeof HEDGE_MONTHS)[number])) return 'Choose 3, 6 or 12 months.'
  if (litresPerMonth < 1_000) return 'Choose a volume.'
  const q = quoteFuelHedge(s, months, litresPerMonth)
  if (!canAfford(s, q.premium)) return `The premium is ${fmtCompact(q.premium)}.`
  spend(s, 'fuel_hedge', q.premium, { note: `Fuel hedge premium: ${litresPerMonth.toLocaleString('en-IN')} L a month for ${months} months` })
  s.company.fuelHedge = {
    strikePaise: q.strikePaise,
    litresPerMonth,
    startDay: s.day,
    untilDay: s.day + months * 30,
    priceSum: 0,
    days: 0,
    premiumPaid: q.premium,
    netSettled: 0,
  }
  pushLog(s, 'finance', `FUEL HEDGE: diesel locked at ${fmtCompact(q.strikePaise)}/L on ${litresPerMonth.toLocaleString('en-IN')} L a month for ${months} months. Premium ${fmtCompact(q.premium)}.`, '/money')
  return null
}

export function dailyHedgePass(s: GameState): void {
  const h = s.company.fuelHedge
  if (!h) return
  h.priceSum += s.world.dieselPaise
  h.days += 1
}

/** Month end: settle against the average pump price, and close the contract once its term is over. */
export function monthlyHedgePass(s: GameState): void {
  const h = s.company.fuelHedge
  if (!h || h.days === 0) return
  const avg = h.priceSum / h.days
  const settlement = Math.round((avg - h.strikePaise) * h.litresPerMonth * Math.min(1, h.days / 30))
  if (settlement > 0) {
    earn(s, 'fuel_hedge', settlement, { note: `Fuel hedge paid out: diesel averaged ${fmtCompact(Math.round(avg))}/L against ${fmtCompact(h.strikePaise)}/L locked` })
  } else if (settlement < 0) {
    spend(s, 'fuel_hedge', -settlement, { note: `Fuel hedge cost: diesel averaged ${fmtCompact(Math.round(avg))}/L against ${fmtCompact(h.strikePaise)}/L locked` })
  }
  h.netSettled += settlement
  pushLog(
    s,
    settlement >= 0 ? 'good' : 'info',
    `Fuel hedge settled: ${settlement >= 0 ? 'received' : 'paid'} ${fmtCompact(Math.abs(settlement))} (diesel averaged ${fmtCompact(Math.round(avg))}/L, locked ${fmtCompact(h.strikePaise)}/L).`,
    '/money',
  )
  h.priceSum = 0
  h.days = 0
  if (s.day >= h.untilDay) {
    const net = h.netSettled - h.premiumPaid
    pushLog(s, 'finance', `Fuel hedge ended. Settlements ${fmtCompact(h.netSettled)}, premium ${fmtCompact(h.premiumPaid)}, net ${net >= 0 ? '+' : '-'}${fmtCompact(Math.abs(net))}.`, '/money')
    s.company.fuelHedge = undefined
  }
}
