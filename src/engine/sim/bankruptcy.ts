/**
 * The failure path: cash crunch -> missed EMIs -> lender repossession after
 * grace period -> insolvency when there is nothing left to run.
 */
import { BAL } from '../data/balance'
import { fmtCompact } from '../core/money'
import type { GameState } from '../types'
import { loansOutstanding, netWorth } from './finance'
import { pushLog } from './log'

export function bankruptcyCheck(s: GameState): void {
  if (s.gameOver) return
  if (s.scenario === 'sandbox') return // sandbox games never end
  const c = s.company

  // solvent enough
  if (c.cash >= 0) return

  // OD should have covered this in the banking pass; if cash is still
  // negative, the limit is exhausted — warn but do not force-sell fleet.
  const deficit = -c.cash
  const odRoom = Math.max(0, s.od.limit - s.od.drawn)
  pushLog(
    s,
    'alert',
    `CASH CRUNCH: ${fmtCompact(deficit)} short${odRoom <= 0 ? ' with the overdraft maxed out' : ''}. Fleet stays on the road — EMIs mark missed; lenders repossess after ${BAL.repoAfterConsecutiveMissed} consecutive misses.`,
  )

  const operatingFleet = Object.values(s.buses).filter(
    (b) => (b.ownership === 'owned' || b.ownership === 'leased') && b.status === 'active',
  )
  if (operatingFleet.length > 0) return

  // still underwater with no owned/leased buses left to run or pledge
  const routes = Object.values(s.permits).filter((p) => p.status === 'active').length
  s.gameOver = {
    day: s.day,
    reason:
      loansOutstanding(s) > 0
        ? 'Insolvency: lenders seized the assets and the NCLT admitted the company for liquidation.'
        : 'Insolvency: the company ran out of cash and creditors, with nothing left to sell.',
    score: {
      daysSurvived: s.day - s.startDay,
      peakFleet: s.peakFleet,
      lifetimeProfit: s.lifetimeProfit,
      bestRating: Math.round(s.company.rating * 10) / 10,
      routesServed: routes,
    },
  }
  pushLog(s, 'alert', `GAME OVER on day ${s.day - s.startDay}. Net worth at the end: ${fmtCompact(netWorth(s))}.`)
}
