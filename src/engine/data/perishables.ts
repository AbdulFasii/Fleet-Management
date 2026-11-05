/**
 * Perishable parcels: produce that rides overnight bus bellies from producing
 * towns into bigger city markets (jasmine from Madurai, vegetables from the
 * Nilgiris side, fish from the coast). They pay a time premium but only travel
 * on departures that reach the morning wholesale market.
 */
import { CITIES } from './cities'

export interface PerishableOrigin {
  /** What the town ships. */
  label: string
  /** Share of this lane's walk-in parcels that is perishable, in an ordinary month. */
  share: number
  /** Months (1-12) with a heavier flow, and the multiplier then. */
  peakMonths?: number[]
  peakMult?: number
  /** Months (1-12) with a much thinner flow (e.g. the monsoon fishing ban), and the multiplier then. */
  lowMonths?: number[]
  lowMult?: number
}

const FISH_BAN = { lowMonths: [6, 7], lowMult: 0.3 }

export const PERISHABLE_ORIGINS: Record<string, PerishableOrigin> = {
  mdu: { label: 'jasmine & flowers', share: 0.22, peakMonths: [3, 4, 5, 6], peakMult: 1.4 },
  dgl: { label: 'flowers & vegetables', share: 0.28, peakMonths: [3, 4, 5, 6], peakMult: 1.3 },
  tcr: { label: 'flowers', share: 0.08 },
  cbe: { label: 'vegetables', share: 0.10 },
  pkd: { label: 'vegetables', share: 0.15 },
  slm: { label: 'mangoes', share: 0.12, peakMonths: [4, 5, 6], peakMult: 1.6 },
  kno: { label: 'fruit & vegetables', share: 0.10, peakMonths: [4, 5, 6], peakMult: 1.3 },
  koc: { label: 'fish', share: 0.15, ...FISH_BAN },
  clt: { label: 'fish', share: 0.15, ...FISH_BAN },
  knr: { label: 'fish', share: 0.12, ...FISH_BAN },
  mlr: { label: 'fish', share: 0.15, ...FISH_BAN },
  trv: { label: 'fish', share: 0.10, ...FISH_BAN },
}

/** Time premium on perishable freight over an ordinary parcel. */
export const PERISHABLE_RATE_PREMIUM = 0.35
/** A perishable load must land between these local hours (the morning wholesale market). */
export const PERISHABLE_ARRIVAL_WINDOW: [number, number] = [2, 9]

/**
 * Perishable share of the walk-in parcels on this origin → destination lane in
 * this month: 0 unless produce flows from a smaller town into a bigger market.
 */
export function perishableShare(originId: string, destId: string, month: number): number {
  const p = PERISHABLE_ORIGINS[originId]
  if (!p) return 0
  const o = CITIES[originId]?.metro ?? 0
  const d = CITIES[destId]?.metro ?? 0
  if (d <= o) return 0
  let share = p.share
  if (p.peakMonths?.includes(month)) share *= p.peakMult ?? 1
  if (p.lowMonths?.includes(month)) share *= p.lowMult ?? 1
  return Math.min(0.6, share)
}

/** Does a departure at `depHour` on a run of `hours` land in the morning market window? */
export function reachesMorningMarket(depHour: number, depMin: number, hours: number): boolean {
  const arrival = (depHour + depMin / 60 + hours) % 24
  const [from, to] = PERISHABLE_ARRIVAL_WINDOW
  return arrival >= from && arrival <= to
}
