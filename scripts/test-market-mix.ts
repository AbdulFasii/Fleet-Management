import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { marketKindOf, refreshMarkets, setMarketMix } from '../src/engine/sim/fleet'

const s = newGame('Market mix', 'malik', 'maa-mdu', 77)
s.company.dedicatedCargoSubsidiary = true

const kinds = () => {
  const all = [...s.usedMarket, ...s.leaseOffers, ...(s.attachOffers ?? [])].map((l) => marketKindOf(l.modelId))
  return new Set(all)
}

refreshMarkets(s)
const before = kinds()
assert(before.has('bus'), 'default boards offer line coaches')
assert(before.has('cargo'), 'default boards offer a truck when the cargo subsidiary is open')

assert.equal(setMarketMix(s, { bus: false, charter: false, cargo: false }), 'Keep at least one kind of vehicle on the market.')

assert.equal(setMarketMix(s, { bus: false, charter: true, cargo: false }), null)
assert(![...kinds()].some((k) => k !== 'charter'), 'switching kinds off removes them straight away')
refreshMarkets(s)
const charterOnly = kinds()
assert(charterOnly.size > 0 && [...charterOnly].every((k) => k === 'charter'), 'a refresh offers only charter coaches')

assert.equal(setMarketMix(s, { bus: true, charter: false, cargo: true }), null)
assert(kinds().has('cargo'), 'switching cargo on lists a truck straight away')
refreshMarkets(s)
const busCargo = kinds()
assert(busCargo.has('bus') && busCargo.has('cargo') && !busCargo.has('charter'), 'bus and cargo only after refresh')

s.company.dedicatedCargoSubsidiary = false
refreshMarkets(s)
assert(!kinds().has('cargo'), 'no trucks while the cargo subsidiary is closed, whatever the setting')
console.log('Market mix checks passed.')
