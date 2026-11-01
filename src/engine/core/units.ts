/**
 * Cargo weight in tonnes — 1 t = 1,000 kg.
 * Big books drop decimals, a small parcel keeps two so 350 kg still reads 0.35.
 */
export function tonnes(n: number): string {
  const v = n / 1000
  const abs = Math.abs(v)
  // Big books drop decimals; a small parcel keeps two so 350 kg still reads 0.35.
  const digits = abs >= 100 ? [0, 0] : abs >= 10 ? [0, 1] : [1, 2]
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits[0], maximumFractionDigits: digits[1] })
}

/** Tonnes with the unit appended, for ledger notes and log lines. */
export function tonnesText(kg: number): string {
  return `${tonnes(kg)} t`
}
