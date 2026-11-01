/**
 * Sales-channel management: own-app build tiers, marketing-driven install
 * growth, MAU churn, monthly app opex. RedBus commission/settlement live
 * in booking.ts; Primo qualification lives in reputation.ts.
 */
import { BAL } from '../data/balance'
import { fmtCompact } from '../core/money'
import type { GameState } from '../types'
import { canAfford, capitalOut, spend } from './finance'
import { pushLog } from './log'

export const APP_TIER_NAMES = ['No app', 'Basic app', 'Growth app', 'Super app']
export const APP_TIER_DESC = [
  'Tickets only via RedBus / counter.',
  'Listing + booking. Organic installs from your riders.',
  'Push notifications, saved passengers, better retention. +15% app reach.',
  'Wallet, refer-and-earn, live tracking. +15% more reach, stickier MAU. Unlocks attaching other owners under your brand.',
]

export function buildAppTier(s: GameState, tier: 1 | 2 | 3): string | null {
  if (tier !== s.company.app.tier + 1) return 'Tiers must be built in order.'
  const cost = BAL.appBuildCost[tier]
  if (!canAfford(s, cost)) return `Need ${fmtCompact(cost)} liquidity.`
  capitalOut(s, 'app_capex', cost, { note: `${APP_TIER_NAMES[tier]} build` })
  s.company.app.tier = tier
  pushLog(s, 'good', `${APP_TIER_NAMES[tier]} launched (${fmtCompact(cost)}). Own-app bookings settle T+1 with no commission.`)
  return null
}

export function setMarketingBudget(s: GameState, monthly: number): void {
  s.company.app.monthlyMarketing = Math.max(0, Math.round(monthly))
}

/** Month-end app economics: opex, marketing -> installs, churn. */
export function monthlyAppPass(s: GameState): void {
  const app = s.company.app
  if (app.tier === 0) return
  const opex = BAL.appMonthlyOpex[app.tier]
  spend(s, 'app_opex', opex, { note: 'app hosting & support' })

  if (app.monthlyMarketing > 0) {
    spend(s, 'marketing', app.monthlyMarketing, { note: 'app user acquisition' })
    const installs = app.monthlyMarketing / BAL.appCac
    app.installs += installs
    app.mau += installs * BAL.appInstallToMauRatio
    s.company.brandAwareness = Math.min(1, s.company.brandAwareness + installs / 220_000)
  }

  const churn = app.tier >= 3 ? BAL.appMauChurnMonthly * 0.7 : BAL.appMauChurnMonthly
  app.mau = Math.max(0, app.mau * (1 - churn))
}
