import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { createGroup, retireGroup, activeGroups } from '../src/engine/sim/groups'
import { sanitizeUiPrefs } from '../src/store/gameStore'

console.log('=== TEST: Brand filter persistence, sanitization and picker exclusivity ===')

const s = newGame('Karnataka Express Lines', 'malik', 'blr-maa')

// 1. Create two brands: A and B
const resA = createGroup(s, { name: 'Brand Alpha', code: 'ALPH' })
const resB = createGroup(s, { name: 'Brand Beta', code: 'BETA' })
assert.ok('id' in resA && 'id' in resB)
const idA = (resA as { id: string }).id
const idB = (resB as { id: string }).id

// Initial active groups include both
let active = activeGroups(s)
assert.ok(active.some((g) => g.id === idA))
assert.ok(active.some((g) => g.id === idB))

// Valid filter preferences
assert.equal(sanitizeUiPrefs({ fleetGroupId: 'all' }, s).fleetGroupId, 'all')
assert.equal(sanitizeUiPrefs({ fleetGroupId: 'none' }, s).fleetGroupId, 'none')
assert.equal(sanitizeUiPrefs({ fleetGroupId: idA }, s).fleetGroupId, idA)
assert.equal(sanitizeUiPrefs({ fleetGroupId: idB }, s).fleetGroupId, idB)

// Non-existent brand resets to 'all'
assert.equal(
  sanitizeUiPrefs({ fleetGroupId: 'non-existent-id' }, s).fleetGroupId,
  'all',
  'Non-existent brand id in uiPrefs should reset to all',
)

// 2. Retire Brand A
retireGroup(s, idA, idB)

// Active groups (used in all UI pickers) must exclude retired brand
active = activeGroups(s)
assert.equal(
  active.some((g) => g.id === idA),
  false,
  'Retired brand must NOT appear in activeGroups (pickers)',
)
assert.ok(
  active.some((g) => g.id === idB),
  'Active brand must still appear in activeGroups',
)
console.log('✓ Retired brand is excluded from activeGroups (all UI pickers)')

// 3. Filter value for retired brand automatically sanitizes and resets to 'all'
const sanitized = sanitizeUiPrefs({ fleetGroupId: idA }, s)
assert.equal(
  sanitized.fleetGroupId,
  'all',
  'uiPrefs pointing to retired brand must reset to all',
)
console.log('✓ UI prefs pointing to retired brand successfully resets to all')

console.log('All brand filter prefs tests passed successfully!')
