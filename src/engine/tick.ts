/**
 * The whole game in one function: advanceDay mutates a GameState through
 * the daily pipeline. Pure with respect to inputs (seeded RNG only).
 */
import { isMonthEnd, fmtDate } from './core/calendar'
import type { GameState } from './types'
import { dailyWorldPass, dailyEventRoll, accountantDecisionPass } from './sim/events'
import { dailyCargoPass, settleCargoShortfall } from './sim/cargo'
import { deliverOrdersPass, refreshMarkets } from './sim/fleet'
import { permitPass, pruneRetiredRoutes, sanitizeScheduleAssignments } from './sim/schedules'
import { festivalFleetPass } from './sim/festival'
import { dailyCharterPass } from './sim/charter'
import { generateTrips, bookingPass } from './sim/booking'
import { dispatchPass } from './sim/dispatch'
import { dailyCheckpostPass } from './sim/checkpost'
import { dailyDepotPass, settleBusArrivals } from './sim/depot'
import { dailyMaintenancePass, monthlyFleetCosts } from './sim/maintenance'
import { dailyClaimsPass } from './sim/insurance'
import { dailyStaffPass, hrFatiguePass, opsAutoStaffPass, monthlyStaffPass, refreshHiringPool, cmvrResetPass } from './sim/staffing'
import { dailyLoungePass } from './sim/lounge'
import { settleReceivables, applyDepreciation, closeMonth, spendNetted, earn } from './sim/finance'
import { dailyBankingPass, monthlyBankingPass, coverWithOd } from './sim/banking'
import { monthlyAppPass } from './sim/channels'
import { dailyTaxPass, monthlyTaxPass } from './sim/tax'
import { checkSpanWarnings } from './sim/span'
import { checkPrimo, checkCertifications, checkAchievements } from './sim/reputation'
import { checkObjectives } from './sim/objectives'
import { bankruptcyCheck } from './sim/bankruptcy'
import { snapshotKpis } from './sim/kpi'
import { pushLog } from './sim/log'
import { fmtCompact } from './core/money'
import { retainDay } from './sim/retain'
import { dailyCrmPass } from './sim/crm'
import { dailyHealthPass } from './sim/health'
import { dailyBrandPass, monthlyBrandPass } from './sim/brandPolicy'
import { dailyRouteLifePass } from './sim/routeLife'
import { dailyHedgePass, monthlyHedgePass } from './sim/hedge'
import { BAL } from './data/balance'
import { rs } from './core/money'

export function advanceDay(s: GameState): void {
  if (s.gameOver) return
  pruneRetiredRoutes(s)
  s.day += 1

  // 1. world rolls
  dailyWorldPass(s)
  dailyEventRoll(s)
  dailyCargoPass(s)

  // 2. arrivals & admin
  settleBusArrivals(s)
  deliverOrdersPass(s)
  permitPass(s)
  if (s.day >= s.marketRefreshDay) refreshMarkets(s)
  if (s.day >= s.poolRefreshDay) refreshHiringPool(s)

  // 3. festival fleet & charters — park/release idle coaches before trip gen, process group charters
  festivalFleetPass(s)
  dailyCharterPass(s)

  // 4. booking window
  cmvrResetPass(s)
  sanitizeScheduleAssignments(s)
  generateTrips(s)
  const booked = bookingPass(s)

  // 5. today's departures
  hrFatiguePass(s)
  dailyHealthPass(s)
  opsAutoStaffPass(s)
  const dispatched = dispatchPass(s)
  settleCargoShortfall(s)
  dailyCheckpostPass(s)
  dailyDepotPass(s)

  // 6. fleet & people upkeep
  dailyMaintenancePass(s)
  dailyBrandPass(s)
  dailyRouteLifePass(s)
  dailyHedgePass(s)
  dailyClaimsPass(s)
  dailyStaffPass(s)
  dailyCrmPass(s)
  dailyLoungePass(s)
  // One more crew fill after leave/fatigue — same indexed pass, not a third full scan.
  opsAutoStaffPass(s)

  // 7. money movements
  settleReceivables(s)
  accountantDecisionPass(s)
  dailyBankingPass(s)
  dailyTaxPass(s)
  checkSpanWarnings(s)

  // 8. month end
  if (isMonthEnd(s.day)) {
    monthlyStaffPass(s)
    monthlyFleetCosts(s)
    monthlyAppPass(s)
    const dep = applyDepreciation(s)
    if (dep > 0) spendNetted(s, 'depreciation', dep, { note: 'Depreciation (non-cash)' })
    // Settle monthly OMC fleet fuel cashback rebate
    if (s.company.fuelCashbackAccrued && s.company.fuelCashbackAccrued > 0) {
      earn(s, 'fuel_cashback', s.company.fuelCashbackAccrued, {
        note: `OMC Fleet Card monthly cashback rebate (${s.company.fuelContract?.partner?.toUpperCase() ?? 'OMC'})`,
      })
      pushLog(
        s,
        'good',
        `FLEET REBATE: Received ${fmtCompact(s.company.fuelCashbackAccrued)} fuel cashback from ${s.company.fuelContract?.partner?.toUpperCase() ?? 'OMC'} Fleet Card!`,
      )
      s.company.fuelCashbackAccrued = 0
    }
    monthlyTaxPass(s)
    monthlyBankingPass(s)
    monthlyBrandPass(s)
    monthlyHedgePass(s)
    const m = closeMonth(s)
    pushLog(
      s,
      m.profit >= 0 ? 'good' : 'alert',
      `MONTH CLOSED ${fmtDate(s.day)}: revenue ${fmtCompact(m.revenueTotal)}, expenses ${fmtCompact(m.expenseTotal)}, ${m.profit >= 0 ? 'profit' : 'LOSS'} ${fmtCompact(Math.abs(m.profit))}, load factor ${(m.loadFactor * 100).toFixed(0)}%.`,
    )
    coverWithOd(s)
  }

  // 8. standing & failure
  checkPrimo(s)
  checkCertifications(s)
  checkAchievements(s)
  checkObjectives(s)
  bankruptcyCheck(s)

  // 9. bookkeeping & daily retention
  snapshotKpis(s, dispatched.pax, dispatched.seats, booked.seatsSold)
  retainDay(s)
}

/** Stop a week-skip only for things that need an answer, not daily inbox noise. */
export function needsAttention(s: GameState): string | null {
  if (s.gameOver) return 'game over'

  // Decision inbox items never stop a skip. New decisions keep queueing while
  // the clock runs, and the player can answer them from the inbox afterwards —
  // halting a week advance on every request made fast-forwarding unusable.

  // Low cash emergency alert
  if (s.config?.pauseOnLowCash) {
    const threshold = s.config.lowCashThreshold ?? rs(100_000)
    if (s.company.cash < threshold) {
      return `Low Cash: Available cash (${fmtCompact(s.company.cash)}) is below safety threshold ${fmtCompact(threshold)}`
    }
  }

  // Strike risk: staff morale under strike threshold
  if (s.config?.pauseOnStrikeRisk) {
    const inDanger = Object.values(s.staff).find((st) => st.morale < BAL.strikeMoraleThreshold)
    if (inDanger) {
      return `Strike Risk: ${inDanger.name} (${inDanger.role}) morale dropped to ${Math.round(inDanger.morale)}%`
    }
  }

  // Document expiry / delinquency
  if (s.config?.pauseOnDocExpiry) {
    for (const b of Object.values(s.buses)) {
      if (b.status === 'grounded') {
        return `Compliance Alert: Bus ${b.reg} is ${b.status} due to expired documents`
      }
    }
  }

  // Month-end P&L close
  if (s.config?.pauseOnMonthEnd && s.day > s.startDay && (s.day - s.startDay) % 30 === 1) {
    return `Month-End Close: ${fmtDate(s.day)} (review monthly summary)`
  }

  return null
}
