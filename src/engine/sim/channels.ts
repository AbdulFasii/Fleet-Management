/**
 * Sales-channel management: own-app build tiers, marketing-driven install
 * growth, MAU churn, monthly app opex. RedBus commission/settlement live
 * in booking.ts; Primo qualification lives in reputation.ts.
 */
import { BAL } from '../data/balance'
import { fmtCompact } from '../core/money'
import type { AppMonthRecord, AppMonthTally, AppState, GameState, Money } from '../types'
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

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const emptyAppTally = (): AppMonthTally => ({
  organicInstalls: 0,
  seats: 0,
  gross: 0,
  pgFees: 0,
  commissionSaved: 0,
})

/** The month in progress, created on first use (older saves have none). */
export function appMonthTally(app: AppState): AppMonthTally {
  if (!app.month) app.month = emptyAppTally()
  return app.month
}

/**
 * What one paid install costs at a given monthly ad spend. The first rupees are cheapest; the cost
 * rises with spend (doubling at `appCacSpendKnee`), falls with a good company rating, and falls as
 * brand awareness grows.
 */
export function appCacPerInstall(s: GameState, monthlySpend: Money): Money {
  const spendFactor = 1 + Math.max(0, monthlySpend) / BAL.appCacSpendKnee
  const ratingFactor = clamp(1.25 - 0.15 * (s.company.rating - 3), 0.85, 1.4)
  const awarenessFactor = 1 - 0.25 * Math.min(1, (s.company.brandAwareness ?? 0) / 0.5)
  return Math.round(BAL.appCac * spendFactor * ratingFactor * awarenessFactor)
}

/** Paid installs a monthly ad spend buys. */
export function appPaidInstalls(s: GameState, monthlySpend: Money): number {
  if (monthlySpend <= 0) return 0
  return monthlySpend / appCacPerInstall(s, monthlySpend)
}

/**
 * Installs per rider who booked on another channel: how often they find and keep the app.
 * Happier riders (company rating) and a better app listing (tier) both raise it.
 */
export function appOrganicRate(s: GameState): number {
  const ratingFactor = clamp(0.75 + 0.25 * (s.company.rating - 3), 0.6, 1.3)
  const tierFactor = BAL.appOrganicTierMult[s.company.app.tier] ?? 1
  return BAL.appOrganicInstallsPerPax * ratingFactor * tierFactor
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

  let paidInstalls = 0
  let cac = 0
  if (app.monthlyMarketing > 0) {
    spend(s, 'marketing', app.monthlyMarketing, { note: 'app user acquisition' })
    cac = appCacPerInstall(s, app.monthlyMarketing)
    paidInstalls = appPaidInstalls(s, app.monthlyMarketing)
    app.installs += paidInstalls
    app.mau += paidInstalls * BAL.appInstallToMauRatio
    s.company.brandAwareness = Math.min(1, s.company.brandAwareness + paidInstalls / 220_000)
  }

  const churn = app.tier >= 3 ? BAL.appMauChurnMonthly * 0.7 : BAL.appMauChurnMonthly
  app.mau = Math.max(0, app.mau * (1 - churn))

  // Close the month into history and start a fresh tally.
  const tally = appMonthTally(app)
  const record: AppMonthRecord = {
    ...tally,
    day: s.day,
    paidInstalls,
    cac,
    mau: Math.round(app.mau),
    marketing: app.monthlyMarketing,
    opex,
    net: tally.commissionSaved - app.monthlyMarketing - opex,
  }
  app.history = [...(app.history ?? []), record].slice(-12)
  app.month = emptyAppTally()
}
