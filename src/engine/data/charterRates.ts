/**
 * Private hire rates for South India by the vehicle actually rented, in ₹/km.
 * Each band is [low, high]; a quote starts at the band's midpoint and moves
 * with the vehicle's condition. Tolls, permits and driver bata are billed to
 * the client on top, and no quote may earn more than CHARTER_MAX_MARGIN.
 */
import type { BusModel } from '../types'

export interface CharterRateBand {
  id: string
  label: string
  /** ₹ per km, [low, high]. */
  band: [number, number]
}

export const CHARTER_RATE_BANDS = {
  van: { id: 'van', label: 'Van, 9–15 seats', band: [20, 26] },
  van17: { id: 'van17', label: 'Van, 17 seats', band: [24, 30] },
  premiumVan: { id: 'premiumVan', label: 'Premium van (Urbania)', band: [30, 38] },
  miniBus: { id: 'miniBus', label: 'Mini bus, 24–32 seats', band: [34, 45] },
  midBus: { id: 'midBus', label: 'Mid bus, 33–39 seats', band: [45, 60] },
  smallSleeper: { id: 'smallSleeper', label: '24-berth sleeper', band: [55, 70] },
  acSemi: { id: 'acSemi', label: 'AC semi-sleeper, 44–54 seats', band: [60, 75] },
  acSleeper: { id: 'acSleeper', label: 'AC sleeper / hybrid', band: [65, 85] },
  premiumSemi: { id: 'premiumSemi', label: 'Volvo / Scania / electric semi-sleeper', band: [80, 100] },
  premiumSleeper: { id: 'premiumSleeper', label: 'Volvo / Scania sleeper', band: [100, 120] },
} as const satisfies Record<string, CharterRateBand>

/** Billing minimum per hire day (South India bus hire convention). */
export const CHARTER_MIN_KM_PER_DAY = 300
/** Running km short of the minimum are billed at this share of the rate. */
export const CHARTER_DETENTION_SHARE = 0.45
/** Profit may never exceed this share of the price (price ≤ 2 × direct cost). */
export const CHARTER_MAX_MARGIN = 0.50
/** A quote never goes below direct cost plus this share. */
export const CHARTER_MIN_MARKUP = 0.05

export function charterRateBand(model: BusModel): CharterRateBand {
  const premium = model.maker === 'Volvo' || model.maker === 'Scania'
    || model.cls === 'AC_SEMI_PREM' || model.cls === 'AC_SLEEPER_PREM'
  if (model.cls === 'CHARTER' || model.isCharterOnly) {
    if (model.sleeper) return CHARTER_RATE_BANDS.smallSleeper
    if (model.id.startsWith('urbania')) return CHARTER_RATE_BANDS.premiumVan
    if (model.seats <= 15) return CHARTER_RATE_BANDS.van
    if (model.seats <= 17) return CHARTER_RATE_BANDS.van17
    if (model.seats <= 32) return CHARTER_RATE_BANDS.miniBus
    return CHARTER_RATE_BANDS.midBus
  }
  if (model.electric) return CHARTER_RATE_BANDS.premiumSemi
  if (model.sleeper) return premium ? CHARTER_RATE_BANDS.premiumSleeper : CHARTER_RATE_BANDS.acSleeper
  return premium ? CHARTER_RATE_BANDS.premiumSemi : CHARTER_RATE_BANDS.acSemi
}

/**
 * ₹/km for this vehicle: the band midpoint, ±10% with condition (a 100%
 * coach prices at +10%, a 50% one at −10%), held inside the band.
 */
export function charterRatePerKm(model: BusModel, conditionPct = 75): number {
  const [lo, hi] = charterRateBand(model).band
  const mid = (lo + hi) / 2
  const adj = Math.max(-0.10, Math.min(0.10, (conditionPct - 75) / 250))
  return Math.round(Math.max(lo, Math.min(hi, mid * (1 + adj))) * 10) / 10
}

/** Hold a rate-based price between cost + 5% and the 50% profit cap. */
export function capCharterPrice(rateBased: number, directCost: number): { price: number; capped: boolean; floored: boolean } {
  const ceiling = directCost / (1 - CHARTER_MAX_MARGIN)
  const floor = directCost * (1 + CHARTER_MIN_MARKUP)
  if (rateBased > ceiling) return { price: Math.floor(ceiling), capped: true, floored: false }
  if (rateBased < floor) return { price: Math.ceil(floor), capped: false, floored: true }
  return { price: Math.round(rateBased), capped: false, floored: false }
}
