export { tonnes, tonnesText } from '../engine/core/units'

/** Integer with Indian digit grouping. */
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-IN')
}

/** Span / capacity quantity without float noise (7.8, 8.44, 3900). */
export function qty(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '0'
  return String(Number(n.toFixed(digits)))
}
