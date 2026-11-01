import { BAL } from '../data/balance'
import type { GameState } from '../types'
import { fleetBookValue, loansOutstanding, receivablesTotal } from './finance'

export function snapshotKpis(s: GameState, pax: number, seats: number, seatsSoldToday: number): void {
  let revenue = 0
  let expense = 0
  for (let i = s.txns.length - 1; i >= 0; i--) {
    const t = s.txns[i]
    if (t.day !== s.day) break
    if (t.kind === 'income') revenue += t.amount
    else if (t.kind === 'expense') expense += t.amount
  }
  const nw =
    s.company.cash + receivablesTotal(s) + fleetBookValue(s)
    - loansOutstanding(s) - s.od.drawn - s.company.gstPayable - s.company.taxProvision
  s.kpis.push({
    day: s.day,
    cash: s.company.cash,
    netWorth: nw,
    revenue,
    expense,
    profit: revenue - expense,
    loadFactor: seats > 0 ? pax / seats : 0,
    fleet: Object.keys(s.buses).length,
    rating: s.company.rating,
    seatsSoldToday,
  })
  if (s.kpis.length > BAL.kpiHistoryDays) s.kpis.shift()
}
