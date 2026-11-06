/**
 * Game calendar. A game date is an integer day count since 1970-01-01
 * (civil days, Hinnant algorithm - no JS Date, fully deterministic).
 * Includes the Indian festival/season calendar that drives demand.
 */

export interface Civil {
  y: number
  m: number // 1-12
  d: number // 1-31
}

export function fromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = Math.floor((y >= 0 ? y : y - 399) / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function toCivil(day: number): Civil {
  let z = day + 719468
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return { y: y + (m <= 2 ? 1 : 0), m, d }
}

/** 0=Sun .. 6=Sat (1970-01-01 was a Thursday). */
export function dow(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(day: number): string {
  const c = toCivil(day)
  return `${DOW_SHORT[dow(day)]} ${String(c.d).padStart(2, '0')} ${MONTH_SHORT[c.m - 1]} ${String(c.y).slice(2)}`
}

export function fmtDateShort(day: number): string {
  const c = toCivil(day)
  return `${String(c.d).padStart(2, '0')} ${MONTH_SHORT[c.m - 1]}`
}

export function ymKey(day: number): string {
  const c = toCivil(day)
  return `${c.y}-${String(c.m).padStart(2, '0')}`
}

export function fmtYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`
}

export function isMonthEnd(day: number): boolean {
  return toCivil(day + 1).d === 1
}

export function daysInMonth(y: number, m: number): number {
  return fromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - fromCivil(y, m, 1)
}

export const GAME_START_DAY = fromCivil(2015, 4, 1) // FY start, a Wednesday

/** Departure clock: hour + optional 30-minute slot (missing min = :00). */
export type DepClock = { depHour: number; depMin?: number }

export function clockMinutes(c: DepClock): number {
  const h = ((c.depHour % 24) + 24) % 24
  const m = c.depMin === 30 ? 30 : 0
  return h * 60 + m
}

export function clockFromMinutes(total: number): { depHour: number; depMin: 0 | 30 } {
  const t = ((total % 1440) + 1440) % 1440
  return { depHour: Math.floor(t / 60), depMin: t % 60 >= 30 ? 30 : 0 }
}

export function fmtClock(c: DepClock): string {
  const { depHour, depMin } = clockFromMinutes(clockMinutes(c))
  return `${String(depHour).padStart(2, '0')}:${String(depMin).padStart(2, '0')}`
}

export const HALF_HOUR_SLOTS: { depHour: number; depMin: 0 | 30 }[] = Array.from({ length: 48 }, (_, i) => clockFromMinutes(i * 30))

/* ============================== Festivals ============================== */

export interface Festival {
  id: string
  name: string
  month: number
  day: number
  /** days before the festival where "homebound" (metro -> hometown) travel surges */
  pre: number
  /** days after where the return direction surges */
  post: number
  /** peak demand multiplier at the festival date */
  peak: number
}

/**
 * Approximate recurring dates. Lunar festivals drift in reality; the game
 * fixes them so players can plan around a stable calendar.
 */
export const FESTIVALS: Festival[] = [
  { id: 'republic', name: 'Republic Day', month: 1, day: 26, pre: 3, post: 2, peak: 1.35 },
  { id: 'holi', name: 'Holi', month: 3, day: 14, pre: 2, post: 2, peak: 1.8 },
  { id: 'ugadi', name: 'Ugadi / Gudi Padwa', month: 4, day: 9, pre: 3, post: 2, peak: 1.4 },
  { id: 'independence', name: 'Independence Day', month: 8, day: 15, pre: 3, post: 2, peak: 1.35 },
  { id: 'onam', name: 'Onam', month: 9, day: 5, pre: 3, post: 3, peak: 1.7 },
  { id: 'pooja', name: 'Pooja Holidays', month: 10, day: 15, pre: 4, post: 4, peak: 2.2 },
  { id: 'diwali', name: 'Diwali', month: 11, day: 1, pre: 4, post: 5, peak: 2.8 },
  { id: 'chhath', name: 'Chhath Puja', month: 11, day: 7, pre: 2, post: 3, peak: 1.5 },
  { id: 'xmas', name: 'Christmas / New Year', month: 12, day: 28, pre: 4, post: 4, peak: 1.6 },
]

export type FestivalPhase = 'pre' | 'festival_day' | 'post_first' | 'post_late'

export interface FestivalEffect {
  name: string | null
  id: string | null
  /** multiplier for the metro->hometown ("homebound") direction */
  homebound: number
  /** multiplier for the hometown->metro ("return") direction */
  returning: number
  /** Days relative to festival date: <0 = pre, 0 = festival day, >0 = post */
  delta?: number
  phase?: FestivalPhase | null
}

/**
 * Directional festival demand. Before a festival, buses OUT of job-hub
 * metros are packed; after it, the return direction is. This asymmetry
 * is one of the defining economics of Indian intercity buses.
 */
/** True when a named festival window is active (pre/peak/post). */
export function isFestivalDay(day: number): boolean {
  return festivalEffect(day).name != null
}

/**
 * Extra festival *service* days either side of the named window. The day before
 * the window runs the homebound surge and the day after runs the return surge,
 * which lets a coach reposition to the outstation base with a paying load
 * instead of dead-heading, and earn the return rush on the way home.
 */
export const FESTIVAL_RUN_PAD_DAYS = 1

export type FestivalRunSlot = 'window' | 'pre_pad' | 'post_pad'

/**
 * Which part of the festival service window a day belongs to. `window` runs
 * both directions; `pre_pad` / `post_pad` carry only that side's flow.
 */
export function festivalRunSlot(day: number): FestivalRunSlot | null {
  const c = toCivil(day)
  let pad: FestivalRunSlot | null = null
  for (const f of FESTIVALS) {
    for (const yy of [c.y - 1, c.y, c.y + 1]) {
      const delta = day - fromCivil(yy, f.month, f.day)
      if (delta >= -f.pre && delta <= f.post) return 'window'
      if (delta === -f.pre - FESTIVAL_RUN_PAD_DAYS) pad = pad === 'post_pad' ? pad : 'pre_pad'
      else if (delta === f.post + FESTIVAL_RUN_PAD_DAYS && !pad) pad = 'post_pad'
    }
  }
  return pad
}

/** Festival window as the calendar defines it — no service padding. */
export function festivalEffect(day: number): FestivalEffect {
  return festivalEffectCore(day, 0)
}

/**
 * Festival demand including the one-day service pad either side, so the
 * repositioning runs see real traffic instead of an empty coach.
 */
export function festivalRunEffect(day: number): FestivalEffect {
  return festivalEffectCore(day, FESTIVAL_RUN_PAD_DAYS)
}

const festivalCache = new Map<number, FestivalEffect>()
const FESTIVAL_CACHE_MAX = 4096

function festivalEffectCore(day: number, padDays: number): FestivalEffect {
  // Pure in (day, padDays). Frozen so a caller can never alter a shared answer.
  const key = day * 16 + padDays
  const hit = festivalCache.get(key)
  if (hit) return hit
  if (festivalCache.size >= FESTIVAL_CACHE_MAX) festivalCache.clear()
  const fresh = Object.freeze(festivalEffectUncached(day, padDays)) as FestivalEffect
  festivalCache.set(key, fresh)
  return fresh
}

function festivalEffectUncached(day: number, padDays: number): FestivalEffect {
  const c = toCivil(day)
  let best: FestivalEffect = { name: null, id: null, homebound: 1, returning: 1, delta: undefined, phase: null }
  for (const f of FESTIVALS) {
    // check this year's and adjacent years' occurrence for window overlap
    for (const yy of [c.y - 1, c.y, c.y + 1]) {
      const fday = fromCivil(yy, f.month, f.day)
      const delta = day - fday // negative = before festival
      let hb = 1
      let ret = 1
      let phase: FestivalPhase | null = null

      if (delta >= -f.pre - padDays && delta <= f.post + padDays) {
        if (delta === 0) {
          // Festival day itself: travel dips in both directions (40-75% occupancy)
          phase = 'festival_day'
          hb = 0.65
          ret = 0.65
        } else if (delta < 0) {
          // 1–3 days before festival: homebound metro->hometown surge (90-100% / 60-85%)
          phase = 'pre'
          const t = Math.max(0, 1 - Math.abs(delta) / (f.pre + 1))
          hb = 1 + (f.peak - 1) * (0.4 + 0.6 * t)
          ret = 1 + (f.peak - 1) * 0.15 // moderate return lift
        } else if (delta === 1) {
          // First return day after festival: return rush (60-85% / 90-100%)
          phase = 'post_first'
          ret = 1 + (f.peak - 1) * 1.0
          hb = 1 + (f.peak - 1) * 0.15
        } else {
          // Final holiday return rush: return rush (50-75% / 90-100%)
          phase = 'post_late'
          const t = Math.max(0, 1 - (delta - 1) / Math.max(1, f.post))
          ret = 1 + (f.peak - 1) * (0.5 + 0.5 * t)
          hb = 1 + (f.peak - 1) * 0.1
        }

        const currStrength = Math.max(hb, ret)
        const bestStrength = Math.max(best.homebound, best.returning)
        if (best.name == null || currStrength > bestStrength || (currStrength === bestStrength && Math.abs(delta) < Math.abs(best.delta ?? 999))) {
          best = {
            name: f.name,
            id: f.id,
            homebound: hb,
            returning: ret,
            delta,
            phase,
          }
        }
      }
    }
  }
  return best
}

/* ============================== Seasons ============================== */

export type SeasonId = 'summer' | 'diwali' | 'pilgrim'

export const SEASONS: { id: SeasonId; label: string; desc: string }[] = [
  { id: 'summer', label: 'Summer', desc: '1 Apr–15 Jun' },
  { id: 'diwali', label: 'Diwali', desc: 'Diwali rush window (±12d)' },
  { id: 'pilgrim', label: 'Pilgrim', desc: '15 Nov–20 Jan' },
]

export function seasonOpen(day: number, seasonId: SeasonId): boolean {
  const c = toCivil(day)
  if (seasonId === 'summer') {
    return inWindow(c, 4, 1, 6, 15)
  }
  if (seasonId === 'pilgrim') {
    return inWindow(c, 11, 15, 1, 20)
  }
  if (seasonId === 'diwali') {
    // Diwali is month 11, day 1, pre 4, post 5. Expanded by 7 days each side: pre 11, post 12.
    for (const yy of [c.y - 1, c.y, c.y + 1]) {
      const fday = fromCivil(yy, 11, 1)
      const delta = day - fday
      if (delta >= -11 && delta <= 12) return true
    }
    return false
  }
  return false
}

export function seasonEndDate(day: number, seasonId: SeasonId): number {
  const c = toCivil(day)
  if (seasonId === 'summer') {
    const endThisYear = fromCivil(c.y, 6, 15)
    return day <= endThisYear ? endThisYear : fromCivil(c.y + 1, 6, 15)
  }
  if (seasonId === 'diwali') {
    const endThisYear = fromCivil(c.y, 11, 1) + 12
    return day <= endThisYear ? endThisYear : fromCivil(c.y + 1, 11, 1) + 12
  }
  if (seasonId === 'pilgrim') {
    const endThisJan = fromCivil(c.y, 1, 20)
    if (day <= endThisJan) return endThisJan
    return fromCivil(c.y + 1, 1, 20)
  }
  return day + 365
}

export function seasonLabel(seasonId: SeasonId): string {
  switch (seasonId) {
    case 'summer': return 'Summer'
    case 'diwali': return 'Diwali'
    case 'pilgrim': return 'Pilgrim'
  }
}

export interface SeasonInfo {
  name: string | null
  demand: number
  /** monsoon adds delay/breakdown/accident risk on trips */
  weatherRisk: number
}

function inWindow(c: Civil, m1: number, d1: number, m2: number, d2: number): boolean {
  const x = c.m * 100 + c.d
  const a = m1 * 100 + d1
  const b = m2 * 100 + d2
  return a <= b ? x >= a && x <= b : x >= a || x <= b
}

export function seasonInfo(day: number): SeasonInfo {
  const c = toCivil(day)
  if (inWindow(c, 6, 10, 9, 15)) return { name: 'Monsoon', demand: 0.85, weatherRisk: 1 }
  if (inWindow(c, 4, 15, 6, 9)) return { name: 'Summer holidays', demand: 1.10, weatherRisk: 0 }
  if (inWindow(c, 11, 15, 2, 15)) return { name: 'Wedding season', demand: 1.10, weatherRisk: 0 }
  return { name: null, demand: 1, weatherRisk: 0 }
}

/** Weekday demand pattern for intercity travel (Fri/Sun heavy). */
export const DOW_DEMAND = [1.28, 0.86, 0.82, 0.88, 1.06, 1.36, 1.12] // Sun..Sat

/** Financial year (April-March) label, e.g. "FY26" for Apr 2025-Mar 2026. */
export function fyLabel(day: number): string {
  const c = toCivil(day)
  const fyEnd = c.m >= 4 ? c.y + 1 : c.y
  return `FY${String(fyEnd).slice(2)}`
}
