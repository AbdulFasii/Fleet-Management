/**
 * Cargo weight in tonnes — 1 t = 1,000 kg.
 * Big books drop decimals, a small parcel keeps two so 350 kg still reads 0.35.
 */
// Building a number formatter is the slow part of toLocaleString; these three cover every case.
const TONNES_FMT = {
  big: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  mid: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
  small: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
}

export function tonnes(n: number): string {
  const v = n / 1000
  const abs = Math.abs(v)
  // Big books drop decimals; a small parcel keeps two so 350 kg still reads 0.35.
  const fmt = abs >= 100 ? TONNES_FMT.big : abs >= 10 ? TONNES_FMT.mid : TONNES_FMT.small
  return fmt.format(v)
}

/** Tonnes with the unit appended, for ledger notes and log lines. */
export function tonnesText(kg: number): string {
  return `${tonnes(kg)} t`
}
