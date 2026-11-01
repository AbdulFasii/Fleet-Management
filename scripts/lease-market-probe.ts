/**
 * Prints a week of the dry-lease board with the owner's cost stack behind each
 * quote, so the numbers can be eyeballed the way an operator would read them.
 *
 *   npx tsx scripts/lease-market-probe.ts
 */
import { newGame } from '../src/engine/newGame'
import { fmtCompact } from '../src/engine/core/money'
import { usedPrice, syncCargoListings } from '../src/engine/sim/fleet'
import { BUS_MODELS } from '../src/engine/data/busModels'
import type { LeaseOffer } from '../src/engine/types'

const seen = new Set<string>()
const rows: Array<{ s: number; o: LeaseOffer }> = []
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const s = newGame('Lease board', 'malik', 'blr-hyd', seed)
  s.company.dedicatedCargoSubsidiary = true
  syncCargoListings(s)
  for (const o of s.leaseOffers) {
    const key = `${o.modelId}-${o.ageYears}-${Math.round(o.odometer / 10000)}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ s: seed, o })
  }
}

console.log('monthly dry-lease board — rent vs today\'s market value\n')
console.log('bus                          age   odo    new       value    rent/mo   rent%V  /yr%V  deposit  lock-in')
for (const { o } of rows.sort((a, b) => a.o.modelId.localeCompare(b.o.modelId) || a.o.ageYears - b.o.ageYears)) {
  const m = BUS_MODELS[o.modelId]!
  const value = usedPrice(o.modelId, o.ageYears)
  console.log(
    `${`${m.maker} ${m.name}`.padEnd(28)} ${String(o.ageYears).padStart(3)}y ${String(Math.round(o.odometer / 1000)).padStart(4)}k ` +
    `${fmtCompact(m.priceNew).padStart(8)} ${fmtCompact(value).padStart(9)} ${fmtCompact(o.monthlyRent).padStart(9)} ` +
    `${(o.monthlyRent / value * 100).toFixed(2).padStart(6)}% ${(o.monthlyRent / value * 1200).toFixed(0).padStart(5)}% ` +
    `${fmtCompact(o.monthlyRent * o.depositMonths).padStart(8)} ${String(o.minMonths).padStart(5)} mo`,
  )
}
