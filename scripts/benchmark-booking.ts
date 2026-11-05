/** Interleaved A/B of the real daily pipeline, with legacy cancellation scans. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildProbeFixture } from './test-sim-determinism'
import { advanceDay } from '../src/engine/tick'
import type { GameState } from '../src/engine/types'

mkdirSync('.profiles', { recursive: true })
function rewrite(source: string, file: string, bookingOverride?: string): string {
  return source.replace(/(from\s+)'(\.[^']+)'/g, (_match, prefix, relative) => {
    const url = new URL(relative + '.ts', pathToFileURL(resolve(file)))
    const target = bookingOverride && relative === './sim/booking' ? pathToFileURL(resolve(bookingOverride)) : url
    return `${prefix}'${target.href}'`
  })
}
const booking = readFileSync('src/engine/sim/booking.ts', 'utf8')
assert(booking.includes('processTripCancellations(s, trip, ledger)'))
writeFileSync('.profiles/booking-reference.ts', rewrite(booking.replace('processTripCancellations(s, trip, ledger)',
  'processCancellations(s, trip)'), 'src/engine/sim/booking.ts'))
writeFileSync('.profiles/tick-reference.ts', rewrite(readFileSync('src/engine/tick.ts', 'utf8'),
  'src/engine/tick.ts', '.profiles/booking-reference.ts'))
const { advanceDay: referenceDay } = await import(pathToFileURL(resolve('.profiles/tick-reference.ts')).href)
const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!
const results = []
for (const fleet of [20, 70, 140]) {
  const fixture = buildProbeFixture(fleet)
  const before: number[] = []
  const after: number[] = []
  for (let run = 0; run < 4; run++) {
    const finals: string[] = []
    for (const optimized of run % 2 === 0 ? [false, true] : [true, false]) {
      const s = structuredClone(fixture)
      const tick: (s: GameState) => void = optimized ? advanceDay : referenceDay
      const start = performance.now()
      for (let day = 0; day < 14; day++) tick(s)
      const elapsed = (performance.now() - start) / 14
      if (run > 0) (optimized ? after : before).push(elapsed)
      finals.push(createHash('sha256').update(JSON.stringify(s)).digest('hex'))
    }
    assert.equal(finals[0], finals[1], `${fleet}-coach A/B state mismatch`)
  }
  const row = { fleet, beforeMedianMs: median(before), afterMedianMs: median(after), before, after }
  results.push(row)
  console.log(`${fleet} coaches: ${row.beforeMedianMs.toFixed(2)} → ${row.afterMedianMs.toFixed(2)} ms/day (${(row.beforeMedianMs / row.afterMedianMs).toFixed(2)}x)`)
}
writeFileSync('.profiles/booking-comparison.json', JSON.stringify(results, null, 2))
