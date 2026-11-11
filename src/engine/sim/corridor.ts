/**
 * Corridor profile — the hidden per-seed personality of a route, plus the two
 * departure-clock curves the demand model draws from: how many shoppers want
 * each slot, and how thickly rival operators park seats against it.
 *
 * Rival seats spread flatter than demand does (a rival's 21:00 bus has to be
 * somewhere at 04:00 too), so the evening golden hours stay the prize and a
 * dead-of-night departure runs half empty however cheap it is.
 */
import { BAL } from '../data/balance'
import { BUS_MODELS } from '../data/busModels'
import { CITIES } from '../data/cities'
import { displayRouteHours, haulStyleOfHours, inPrimeWindow, HAUL_WINDOWS, type HaulStyle } from '../data/routes'
import { rngFor, rChance, rPick, type Rng } from '../core/rng'
import { FESTIVALS, festivalRunEffect, type FestivalEffect } from '../core/calendar'
import type { BusClassId, RouteDef } from '../types'

const SLOTS = 48
const SLOT_MIN = 30
const DAY_MIN = 1440

export type CoachFamily = 'seater' | 'semi' | 'sleeper' | 'hybrid'

export const ALL_CLASSES: BusClassId[] = [
  'E_AC_SEMI',
  'AC_SEMI', 'AC_SEMI_PREM',
  'AC_HYBRID',
  'AC_SLEEPER', 'AC_SLEEPER_PREM',
]

export function familyOf(cls: BusClassId): CoachFamily {
  if (cls === 'AC_HYBRID') return 'hybrid'
  if (cls === 'AC_SEMI' || cls === 'AC_SEMI_PREM' || cls === 'E_AC_SEMI') return 'semi'
  if (cls === 'AC_SLEEPER' || cls === 'AC_SLEEPER_PREM') return 'sleeper'
  return 'seater'
}

/** Does this direction flow metro -> hometown (the pre-festival surge side)? */
export function isHomebound(route: RouteDef, direction: 'AB' | 'BA'): boolean {
  const origin = direction === 'AB' ? route.from : route.to
  const dest = direction === 'AB' ? route.to : route.from
  const a = CITIES[origin]?.metro ?? 0
  const b = CITIES[dest]?.metro ?? 0
  return a > b || (a === b && (origin === 'maa' || origin === 'blr' || origin === 'bom' || origin === 'del' || direction === 'AB'))
}

/**
 * Pre-sold share of the book for a festival surge departure (homebound before
 * a festival, return after it), or undefined for a normal departure.
 */
const festRunCache = new Map<number, { fest: FestivalEffect; peak: number }>()

function festRunFor(depDay: number): { fest: FestivalEffect; peak: number } {
  let hit = festRunCache.get(depDay)
  if (!hit) {
    const fest = festivalRunEffect(depDay)
    const f = fest.name == null ? undefined : FESTIVALS.find((x) => x.id === fest.id || x.name === fest.name)
    hit = { fest, peak: f?.peak ?? 1.35 }
    if (festRunCache.size > 2048) festRunCache.clear()
    festRunCache.set(depDay, hit)
  }
  return hit
}

export function festivalPreSoldShare(route: RouteDef, direction: 'AB' | 'BA', depDay: number): number | undefined {
  const { fest, peak } = festRunFor(depDay)
  if (fest.name == null) return undefined
  const hb = isHomebound(route, direction)
  const surging = (fest.phase === 'pre' && hb) || ((fest.phase === 'post_first' || fest.phase === 'post_late') && !hb)
  if (!surging) return undefined
  const k = Math.min(1, Math.max(0, (peak - 1.35) / 1.45))
  return BAL.festivalPreSoldMin + (BAL.festivalPreSoldMax - BAL.festivalPreSoldMin) * k
}

/* ------------------------------ haul length ------------------------------ */

export type HaulKind = 'mid' | 'overnight'
export function haulKind(hours: number): HaulKind {
  const h = displayRouteHours(hours)
  return h >= 8 ? 'overnight' : 'mid'
}

export type DurationCategory = 'short' | 'mid' | 'overnight' | 'long'

export function getDurationCategory(hours: number): DurationCategory {
  const h = displayRouteHours(hours)
  if (h < 6) return 'short'
  if (h < 8) return 'mid'
  if (h <= 10) return 'overnight'
  return 'long'
}

export function layoutDurationPreference(cls: BusClassId, hours: number): number {
  const cat = getDurationCategory(hours)
  const fam = familyOf(cls)
  const prefs = BAL.layoutDuration.preferences[cat]
  if (fam === 'sleeper') return prefs.sleeper
  if (fam === 'hybrid') return prefs.hybrid
  if (fam === 'semi') return prefs.semi
  return prefs.seater
}

/** Earliest start and latest end of a haul band's prime windows (HAUL_WINDOWS is constant). */
const primeSpans = new Map<HaulStyle, { from: number; to: number }>()
function primeSpan(style: HaulStyle): { from: number; to: number } {
  let span = primeSpans.get(style)
  if (!span) {
    const wins = HAUL_WINDOWS[style]
    span = { from: Math.min(...wins.map((w) => w[0])), to: Math.max(...wins.map((w) => w[1])) }
    primeSpans.set(style, span)
  }
  return span
}

export function haulWeights(hours: number): { short: number; mid: number; long: number } {
  const h = displayRouteHours(hours)
  if (h < 6) return { short: 1, mid: 0, long: 0 }
  if (h > 10) return { short: 0, mid: 0, long: 1 }
  if (h >= 6 && h < 8) return { short: 0, mid: 1, long: 0 }
  return { short: 0, mid: 0.35, long: 0.65 }
}

export function blendHaul(hours: number, short: number, mid: number, long: number): number {
  const w = haulWeights(hours)
  return w.short * short + w.mid * mid + w.long * long
}

/**
 * Layout appeal from haul duration relative to 50% neutral baseline:
 * - Long haul (> 10h): Seater 20% (0.40x appeal), Sleeper 80% (1.60x appeal), Hybrid 50% (1.00x)
 * - Overnight (8 - 10h): Seater 30% (0.60x), Sleeper 70% (1.40x), Hybrid 50% (1.00x)
 * - Mid-haul (6 - 8h): Seater 40% (0.80x), Sleeper 60% (1.20x), Hybrid 50% (1.00x)
 * - Short (< 6h): Seater 70% (1.40x), Sleeper 30% (0.60x), Hybrid 50% (1.00x)
 */
export function haulLayoutAppeal(cls: BusClassId, hours: number): number {
  return layoutDurationPreference(cls, hours) / 0.50
}

/**
 * Demand multiplier for one zone of a hybrid coach (berths or rear cabin).
 * Explicit by haul length: mid-haul berths and cabin sell at the same rate,
 * overnight berths fill while the cabin takes about half, and a short hop is
 * the mirror image. See BAL.layoutDuration.hybridZones.
 */
export function hybridZoneFactors(hours: number): { sleeper: number; seater: number } {
  const cat = getDurationCategory(hours)
  const zone = BAL.layoutDuration.hybridZones[cat]
  return zone ?? { sleeper: 1, seater: 1 }
}

export interface DepartureTimeFit {
  appeal: number
  isPeak: boolean
  isOffPeak: boolean
}

/**
 * Departure-clock appeal based on route haul duration. The prime windows come
 * from HAUL_WINDOWS (routes.ts) so tooltips and the model never disagree:
 * - Mid-haul: 18:00-00:00 (~1.18x), morning is moderate (~0.78x), midday/night lower.
 * - Night haul 20:00-23:30, marathon 18:00-23:30, ultra 16:00-22:00 (~1.20x, +0.05 for sleepers).
 *   Morning daytime (05:30-12:00) burns the whole working day in transit (~0.35x).
 */
export function departureTimeFit(route: RouteDef, depHour: number, depMin = 0, cls?: BusClassId): DepartureTimeFit {
  const h = depHour + (depMin === 30 ? 0.5 : 0)
  const hours = route.hours
  const style = haulStyleOfHours(hours)
  const prime = inPrimeWindow(style, h)

  if (hours >= 7.5) {
    // Overnight haul (8h - 24h)
    if (prime) {
      const clsBonus = cls && familyOf(cls) === 'sleeper' ? 0.05 : 0
      return { appeal: 1.20 + clsBonus, isPeak: true, isOffPeak: false }
    }
    // Shoulder: two hours before the prime window, or late night after it until 01:00
    const { from: primeFrom, to: primeTo } = primeSpan(style)
    if ((h >= primeFrom - 2 && h < primeFrom) || (h > primeTo || h <= 1.0)) {
      return { appeal: 0.95, isPeak: false, isOffPeak: false }
    }
    // Dead of night 01:00 - 05:30
    if (h > 1.0 && h < 5.5) {
      return { appeal: 0.28, isPeak: false, isOffPeak: true }
    }
    // Morning daytime 05:30 - 12:00: Wastes whole working day on long haul
    if (h >= 5.5 && h <= 12.0) {
      // 07:30 - 11:00 is the dead daytime slot (09:00 reaches 17:00)
      const dayPenalty = (h >= 7.5 && h <= 11.0) ? 0.35 : 0.45
      const clsAdj = cls && familyOf(cls) === 'sleeper' ? -0.03 : 0
      return { appeal: dayPenalty + clsAdj, isPeak: false, isOffPeak: true }
    }
    // Afternoon: awkward late night arrival
    return { appeal: 0.55, isPeak: false, isOffPeak: true }
  } else if (hours <= 6.0) {
    // Day haul (under 6h): 08:00 - 12:00 and 18:00 - 22:00 are prime
    if (prime) {
      return { appeal: 1.20, isPeak: true, isOffPeak: false }
    }
    // Early morning 06:00 - 08:00 still catches the commuter run-up
    if (h >= 6.0 && h < 8.0) {
      return { appeal: 0.95, isPeak: false, isOffPeak: false }
    }
    // Midday / afternoon 12:00 - 18:00
    if (h > 12.0 && h < 18.0) {
      return { appeal: 0.90, isPeak: false, isOffPeak: false }
    }
    // Night 22:00 - 23:00
    if (h > 22.0 && h <= 23.0) {
      return { appeal: 0.75, isPeak: false, isOffPeak: false }
    }
    // Dead of night 23:00 - 06:00
    return { appeal: 0.32, isPeak: false, isOffPeak: true }
  } else {
    // Mid-haul (6.0h - 7.5h, e.g. blr-maa 6.5h): 18:00 - 00:00 is prime
    if (prime) {
      return { appeal: 1.18, isPeak: true, isOffPeak: false }
    }
    // Early morning 05:30 - 08:30 (reaches by 12:00-15:00)
    if (h >= 5.5 && h <= 8.5) {
      // Semi-sleepers are the morning product on 6-8h runs; everything else keeps the commuter-run-up value.
      const morningAppeal = cls && familyOf(cls) === 'semi' ? BAL.classHourFit.semiMorningMid : 0.78
      return { appeal: morningAppeal, isPeak: false, isOffPeak: false }
    }
    // Late morning / Midday 08:30 - 14:00 (arrives evening)
    if (h > 8.5 && h <= 14.0) {
      return { appeal: 0.52, isPeak: false, isOffPeak: true }
    }
    // Afternoon 14:00 - 18:00
    if (h > 14.0 && h < 18.0) {
      return { appeal: 0.82, isPeak: false, isOffPeak: false }
    }
    // Dead of night 00:00 - 05:30
    return { appeal: 0.30, isPeak: false, isOffPeak: true }
  }
}

/** Departure-clock appeal for this layout, on top of the corridor's own peak. */
export function classHourAppeal(cls: BusClassId, depHour: number, depMin: number, hours: number): number {
  const f = BAL.classHourFit
  const h = depHour + (depMin === 30 ? 0.5 : 0)
  const hw = haulWeights(hours)
  // "Night" for coach-type fit follows the band's prime window.
  const style = haulStyleOfHours(hours)
  const span = primeSpan(style)
  const nightFrom = span.from
  const nightTo = Math.min(23.5, span.to)
  if (familyOf(cls) === 'sleeper') {
    // A 16h run leaving at 15:00 still sleeps; a 4h noon hop never does.
    const pull = 1 - 0.75 * hw.long
    if (h >= nightFrom && h <= nightTo) return 1 + (f.sleeperNight - 1) * (1 - 0.5 * hw.short)
    if (h >= 8 && h < 16) return 1 + (f.sleeperDay - 1) * pull
    if (h >= 16 && h < 19) return f.sleeperEvening + 0.04 * hw.long
    return 1 + (f.sleeperOther - 1) * pull
  }
  if (familyOf(cls) === 'hybrid') {
    if (h >= nightFrom && h <= nightTo) return f.hybridNight
    if ((h >= 5.5 && h <= 10.5) || (h >= 15.5 && h < 19)) {
      return hw.short > 0.5 ? f.hybridShoulder : blendHaul(hours, f.hybridShoulder, 0.90, 0.75)
    }
    if (h >= 10.5 && h < 15.5) return f.hybridMidday
    return f.hybridLateNight
  }
  if (h >= nightFrom && h <= nightTo) return f.semiNight
  if ((h >= 5.5 && h <= 10.5) || (h >= 15.5 && h <= 20.5)) {
    return hw.short > 0.5 ? f.semiDay : blendHaul(hours, f.semiDay, f.semiMidHaulShoulder, 0.72)
  }
  if (h >= 10.5 && h < 15.5) return f.semiMidday
  return f.semiLateNight
}

/* --------------------------- substitution kernel --------------------------- */

export function wrapDistMin(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, DAY_MIN - d)
}

/** How readily a shopper aiming at one departure settles for another. */
export function substitutionWeight(deltaMin: number): number {
  for (const [maxMin, w] of BAL.market.substitutionDecay) {
    if (deltaMin <= maxMin) return w
  }
  return 0
}

/**
 * How much two of *our own* departures compete for the same pool: 50% inside
 * half an hour, 25% at an hour, 10% at two hours, and nothing beyond three.
 * The anchors in `BAL.market.ownFleetSubstitution.curve` are interpolated so
 * the decay is smooth instead of stepping at each band.
 *
 * Called once per pair of departures in the same lane (hundreds of thousands
 * of times a day on a big fleet) and the curve never changes at runtime, so
 * whole-minute gaps are memoised: the interpolation is a pure function of the
 * gap in minutes.
 */
const ownSubCache = new Map<number, number>()

function ownSubWeight(gap: number): number {
  const curve = BAL.market.ownFleetSubstitution.curve
  if (gap <= curve[0]![0]) return curve[0]![1]
  for (let i = 1; i < curve.length; i++) {
    const [at, w] = curve[i]!
    if (gap <= at) {
      const [prevAt, prevW] = curve[i - 1]!
      const span = at - prevAt
      return span <= 0 ? w : prevW + ((w - prevW) * (gap - prevAt)) / span
    }
  }
  return curve[curve.length - 1]![1]
}

export function ownSubstitutionWeight(deltaMin: number): number {
  if (!Number.isFinite(deltaMin)) return 0
  const gap = Math.max(0, deltaMin)
  if (!Number.isInteger(gap)) return ownSubWeight(gap)
  const hit = ownSubCache.get(gap)
  if (hit !== undefined) return hit
  const w = ownSubWeight(gap)
  ownSubCache.set(gap, w)
  return w
}

/* ---------------------------- corridor profile ---------------------------- */

export interface CorridorProfile {
  /** Hidden appeal of each coach class on this corridor. */
  classMult: Record<BusClassId, number>
  /** The corridor's own peak departure minutes. */
  peaksMin: number[]
  widthH: number
  /** Shoppers reachable from a departure in this slot (share of the day). */
  poolMass: number[]
  /** Rival seat mass competing with this slot (share of corridor supply). */
  supplyMass: number[]
}

function halfHourBand(loH: number, hiH: number): number[] {
  const out: number[] = []
  for (let m = Math.round(loH * 60); m <= Math.round(hiH * 60); m += SLOT_MIN) out.push(m)
  return out
}

function rPickWeighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0
  for (const w of weights) total += w
  let x = rng() * total
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]!
    if (x <= 0) return items[i]!
  }
  return items[items.length - 1]!
}

/** Clock-band demand weight for this corridor type, wrapping past midnight. */
function bandWeight(kind: HaulKind, hour: number, style: HaulStyle): number {
  // The band's prime window (HAUL_WINDOWS) is where shoppers actually want to leave.
  if (inPrimeWindow(style, hour)) return 1.0
  // Outside it the legacy clock table still shapes the shoulders, but never above half weight.
  for (const [from, to, w] of BAL.depDensity[kind]) {
    if (hour >= from && hour < to) return Math.min(w, 0.5)
    if (to > 24 && hour + 24 >= from && hour + 24 < to) return Math.min(w, 0.5)
  }
  return 0.05
}

function normalize(xs: number[]): void {
  let total = 0
  for (const x of xs) total += x
  if (total <= 0) return
  for (let i = 0; i < xs.length; i++) xs[i]! /= total
}

/** Spread a normalised per-slot curve through the substitution kernel. */
function kernelMass(curve: number[]): number[] {
  const out = Array.from<number>({ length: SLOTS }).fill(0)
  for (let i = 0; i < SLOTS; i++) {
    let sum = 0
    for (let j = 0; j < SLOTS; j++) {
      sum += curve[j]! * substitutionWeight(wrapDistMin(i * SLOT_MIN, j * SLOT_MIN))
    }
    out[i] = sum
  }
  return out
}

const profileCache = new Map<string, CorridorProfile>()

/**
 * Hidden per-save corridor profile: which coach sells here, which half-hours
 * are the local peak, and the resulting demand / supply clock curves. Stable
 * for a seed so players can learn a corridor instead of guessing at it.
 */
export function corridorProfile(seed: number, route: RouteDef): CorridorProfile {
  const key = `${seed}:${route.id}`
  const hit = profileCache.get(key)
  if (hit) return hit

  const rng = rngFor(seed, 'corridor-profile', route.id)
  const kind = haulKind(route.hours)
  const cat = getDurationCategory(route.hours)
  const pref = BAL.layoutDuration.preferences[cat]

  // Which family the corridor's regulars actually book, weighted by haul preference.
  const fams: CoachFamily[] = ['sleeper', 'semi', 'seater']
  const famW: number[] = [
    pref.sleeper * 100,
    pref.semi * 70,
    pref.seater * 30,
  ]
  const winner = rPickWeighted(rng, fams, famW)

  // Class fit based on duration preference and corridor taste
  const classMult = {} as Record<BusClassId, number>
  for (const cls of ALL_CLASSES) {
    const fam = familyOf(cls)
    if (fam === 'hybrid') {
      const base = 1.00
      classMult[cls] = base - 0.05 + rng() * 0.10
      continue
    }
    const layoutAppeal = haulLayoutAppeal(cls, route.hours)
    if (fam === winner) {
      classMult[cls] = Math.max(0.35, Math.min(1.45, layoutAppeal * (1.02 + rng() * 0.12)))
    } else {
      classMult[cls] = Math.max(0.30, Math.min(1.35, layoutAppeal * (0.88 + rng() * 0.12)))
    }
  }

  let peaksMin: number[]
  let widthH: number
  const style = haulStyleOfHours(route.hours)
  const wins = HAUL_WINDOWS[style]
  // Peak candidates come straight from the band's prime window(s); a 24:00 end is capped at 23:30.
  const winBand = (w: [number, number]) => halfHourBand(w[0], Math.min(w[1], 23.5))
  if (kind === 'overnight') {
    const band = winBand(wins[0]!)
    const p1 = rPick(rng, band)
    peaksMin = [p1]
    if (rChance(rng, 0.42)) {
      const far = band.filter((m) => wrapDistMin(m, p1) >= 90)
      if (far.length) peaksMin.push(rPick(rng, far))
    }
    widthH = 1.35 + rng() * 1.0 // broad evening hump — peak still wins
  } else {
    const band = winBand(wins[0]!)
    const p1 = rPick(rng, band)
    peaksMin = [p1]
    if (rChance(rng, 0.45)) {
      const far = band.filter((m) => wrapDistMin(m, p1) >= 90)
      if (far.length) peaksMin.push(rPick(rng, far))
    }
    widthH = 1.3 + rng() * 1.0
  }

  const density = Array.from<number>({ length: SLOTS }).fill(0)
  for (let i = 0; i < SLOTS; i++) {
    const tMin = i * SLOT_MIN
    let peak = 0
    for (const p of peaksMin) {
      const hoursOff = wrapDistMin(tMin, p) / 60
      peak = Math.max(peak, Math.exp(-0.5 * (hoursOff / Math.max(0.5, widthH)) ** 2))
    }
    const floor = BAL.market.hiddenPeakFloor
    density[i] = bandWeight(kind, tMin / 60, style) * (floor + (1 - floor) * peak)
  }
  normalize(density)

  const supply = density.map((d) => Math.pow(d, BAL.market.supplyPeakExp))
  normalize(supply)

  const profile: CorridorProfile = {
    classMult,
    peaksMin,
    widthH,
    poolMass: kernelMass(density),
    supplyMass: kernelMass(supply),
  }
  profileCache.set(key, profile)
  return profile
}

/** How well this coach class sells on this corridor (hidden, per save). */
export function classFit(route: RouteDef, modelId: string, seed: number): number {
  const model = BUS_MODELS[modelId]
  if (!model) return 0.9
  return corridorProfile(seed, route).classMult[model.cls] ?? 0.9
}

/** Shopper pool and rival seat mass visible from one departure slot. */
export function windowMass(profile: CorridorProfile, depHour: number, depMin: number): { pool: number; supply: number } {
  const h = ((depHour % 24) + 24) % 24
  const idx = (h * 2 + (depMin === 30 ? 1 : 0)) % SLOTS
  return { pool: profile.poolMass[idx]!, supply: profile.supplyMass[idx]! }
}

/**
 * Slot quality as a multiple of an average departure: > 1 means more shoppers
 * than rival seats in this window. Drives the departure-time decision.
 */
export function slotStrength(seed: number, route: RouteDef, depHour: number, depMin = 0): number {
  const profile = corridorProfile(seed, route)
  const { pool, supply } = windowMass(profile, depHour, depMin)
  return supply > 0 ? pool / supply : 0
}
