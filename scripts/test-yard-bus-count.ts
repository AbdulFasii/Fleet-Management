/**
 * Outstation yard vehicle counts.
 *   npx tsx scripts/test-yard-bus-count.ts
 */
import { newGame } from '../src/engine/newGame'
import { busesParkedInCity, parkedBusCounts, outstationNightlyFee, leaseYard } from '../src/engine/sim/depot'
import type { GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const s: GameState = newGame('Yards', 'seth', 'maa-mdu', 7)
const home = s.company.homeCityId

// Clear the starter fleet so counts are exact.
for (const id of Object.keys(s.buses)) delete s.buses[id]

function mkBus(id: string, city: string, status: 'active' | 'workshop' | 'grounded' | 'delivery' = 'active'): void {
  const b = s.buses[id] ?? { id, reg: `TN ${id}` }
  Object.assign(b, { id, reg: `TN ${id}`, status, parkedCityId: city })
  s.buses[id] = b as never
}

mkBus('b1', 'blr')
mkBus('b2', 'blr')
mkBus('b3', 'blr', 'workshop')
mkBus('b4', 'cbe')
mkBus('b5', home)
mkBus('b6', 'cbe', 'delivery')

console.log('\nPer-city parked counts')
check(busesParkedInCity(s, 'blr').length === 3, 'Bengaluru counts active + workshop coaches (3)')
check(busesParkedInCity(s, 'cbe').length === 1, 'a delivery coach is not counted as parked (Coimbatore = 1)')
check(busesParkedInCity(s, home).length === 1, 'home city count is included')
check(busesParkedInCity(s, 'mdu').length === 0, 'a city with no coaches reads 0')

const counts = parkedBusCounts(s)
check(counts['blr'] === 3 && counts['cbe'] === 1, 'the city map agrees with the per-city helper')
check(Object.values(counts).reduce((a, b) => a + b, 0) === 5, 'map total excludes the delivery coach')

console.log('\nLeased yards')
check(leaseYard(s, 'blr') === null, 'lease Bangalore yard')
check(s.yards.some((y) => y.cityId === 'blr'), 'the yard is recorded against the city')

// Ledger the count against rent: Bangalore 25k/mo holds 3 coaches.
check(busesParkedInCity(s, 'blr').length === 3, 'yard view reports 3 assigned vehicles for Bengaluru')

console.log('\nNightly public parking comparator')
const fee = outstationNightlyFee('blr')
check(fee > 0, 'Bengaluru has a nightly public parking fee')
check(outstationNightlyFee('blr') >= outstationNightlyFee('kkm'), 'metro cities cost at least as much as small towns')
check(fee * 30 > 0, 'monthly public parking is derivable from the nightly fee')

console.log('\n======================================================')
if (failures === 0) {
  console.log('🎉 YARD BUS COUNT TESTS PASSED!')
} else {
  console.log(`❌ ${failures} CHECK(S) FAILED`)
  process.exitCode = 1
}
console.log('======================================================')
