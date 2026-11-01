/**
 * Each market board (buy / lease / attach) must carry at most one cargo
 * vehicle when the cargo subsidiary is on, and none when it is off.
 *
 *   npx tsx scripts/test-single-cargo-listing.ts
 */
import { newGame } from '../src/engine/newGame'
import { refreshMarkets, syncCargoListings } from '../src/engine/sim/fleet'
import { isCargoModel } from '../src/engine/data/busModels'
import type { GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

function counts(s: GameState): { buy: number; lease: number; attach: number } {
  return {
    buy: s.usedMarket.filter((l) => isCargoModel(l.modelId)).length,
    lease: s.leaseOffers.filter((l) => isCargoModel(l.modelId)).length,
    attach: (s.attachOffers ?? []).filter((l) => isCargoModel(l.modelId)).length,
  }
}

const oneAtMost = (c: { buy: number; lease: number; attach: number }) =>
  c.buy <= 1 && c.lease <= 1 && c.attach <= 1

console.log('\nsubsidiary on — every weekly refresh')
let worst = { buy: 0, lease: 0, attach: 0 }
for (let seed = 1; seed <= 25; seed++) {
  const s = newGame('Cargo boards', 'seth', 'blr-hyd', seed)
  s.company.dedicatedCargoSubsidiary = true
  for (let week = 0; week < 6; week++) {
    s.day += 7 * (week + 1)
    refreshMarkets(s)
    const c = counts(s)
    worst = { buy: Math.max(worst.buy, c.buy), lease: Math.max(worst.lease, c.lease), attach: Math.max(worst.attach, c.attach) }
  }
}
console.log(`  worst counts over 25 seeds x 6 weeks: buy ${worst.buy}, lease ${worst.lease}, attach ${worst.attach}`)
check(oneAtMost(worst), 'no board ever lists two cargo vehicles')

console.log('\nlegacy save — two trucks already on each board')
const s = newGame('Cargo boards', 'seth', 'blr-hyd', 77)
s.company.dedicatedCargoSubsidiary = true
syncCargoListings(s)
// simulate the old generator: duplicate every cargo row
const dup = <T extends { id: string }>(l: T, suffix: string): T => ({ ...l, id: l.id + suffix })
s.usedMarket.push(...s.usedMarket.filter((l) => isCargoModel(l.modelId)).map((l) => dup(l, 'x')))
s.leaseOffers.push(...s.leaseOffers.filter((l) => isCargoModel(l.modelId)).map((l) => dup(l, 'x')))
s.attachOffers.push(...(s.attachOffers ?? []).filter((l) => isCargoModel(l.modelId)).map((l) => dup(l, 'x')))
const before = counts(s)
console.log(`  before: buy ${before.buy}, lease ${before.lease}, attach ${before.attach}`)
check(before.buy === 2 && before.lease === 2 && before.attach === 2, 'fixture really has two on each board')
syncCargoListings(s)
const after = counts(s)
console.log(`  after:  buy ${after.buy}, lease ${after.lease}, attach ${after.attach}`)
check(after.buy === 1 && after.lease === 1 && after.attach === 1, 'migration trims each board back to one')

console.log('\nsubsidiary off')
s.company.dedicatedCargoSubsidiary = false
syncCargoListings(s)
const off = counts(s)
check(off.buy === 0 && off.lease === 0 && off.attach === 0, 'no cargo rows remain when the subsidiary is closed')

console.log(failures === 0 ? '\nSingle cargo listing per board — all checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
