/**
 * All money in the engine is integer PAISE. JS numbers are exact up to
 * 2^53, i.e. ~₹90 lakh crore in paise - far beyond anything the game hits.
 */

export type Money = number // integer paise

export const rs = (rupees: number): Money => Math.round(rupees * 100)
export const L = (lakh: number): Money => rs(lakh * 100_000)
export const Cr = (crore: number): Money => rs(crore * 10_000_000)

export const toRupees = (m: Money): number => m / 100

/** Indian digit grouping: 12,34,56,789 */
export function groupINR(intRupees: number): string {
  const neg = intRupees < 0
  let s = String(Math.abs(Math.round(intRupees)))
  if (s.length > 3) {
    const last3 = s.slice(-3)
    let rest = s.slice(0, -3)
    const parts: string[] = []
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2))
      rest = rest.slice(0, -2)
    }
    if (rest) parts.unshift(rest)
    s = parts.join(',') + ',' + last3
  }
  return (neg ? '-' : '') + s
}

/** Full format: ₹1,24,50,000 (rounded to whole rupees). */
export function fmtINR(m: Money): string {
  return '₹' + groupINR(Math.round(m / 100))
}

/** Compact: ₹1.25Cr / ₹24.5L / ₹8,200 */
export function fmtCompact(m: Money): string {
  const r = m / 100
  const a = Math.abs(r)
  const sign = r < 0 ? '-' : ''
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(2)}Cr`
  if (a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(2)}L`
  if (a >= 1_000) return `${sign}₹${groupINR(a)}`
  return `${sign}₹${a.toFixed(0)}`
}

/** Signed compact with +/- prefix, for P&L deltas. */
export function fmtSigned(m: Money): string {
  return (m >= 0 ? '+' : '') + fmtCompact(m)
}

export function pct(x: number, digits = 0): string {
  return (x * 100).toFixed(digits) + '%'
}
