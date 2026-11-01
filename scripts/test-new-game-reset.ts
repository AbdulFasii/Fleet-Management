import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { clearSaveStores, writeSave, readSave } from '../src/store/saveCodec'
import { useGame } from '../src/store/gameStore'

console.log('=== TEST: New Game & Reset All Data ===')

// 1. Mock LocalStorage / SessionStorage if in node
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const mockStorage: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k) },
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
  globalThis.localStorage = mockStorage
  globalThis.sessionStorage = mockStorage
}

// 2. Start a mock game and populate data
useGame.getState().startNew('Test Old Travels', 'seth', 'maa-cbe')
let s = useGame.getState().state!
assert.equal(s.company.name, 'Test Old Travels')
assert.ok(s.company.cash > 0)

// Put some test keys in localStorage
localStorage.setItem('busraj_analytics_route', 'maa-mdu')
localStorage.setItem('bus_pref_route', 'maa-cbe')

// 3. Test Reset To New Game
useGame.getState().resetToNewGame()

// State should now be null
assert.equal(useGame.getState().state, null, 'Game state should be null after reset')

// Save storage should be empty
assert.equal(readSave(), null, 'Save should not exist in storage')
assert.equal(localStorage.getItem('busgame_save'), null)
assert.equal(localStorage.getItem('busraj_analytics_route'), null)
assert.equal(localStorage.getItem('bus_pref_route'), null)
console.log('✓ Save stores and route preference caches completely purged')

// 4. Start a brand new company
useGame.getState().startNew('Royal Express South', 'malik', 'maa-mdu')
s = useGame.getState().state!
assert.equal(s.company.name, 'Royal Express South')
assert.equal(s.day, s.startDay, 'Day equals startDay')
assert.equal(Object.keys(s.buses).length, 0, 'No buses on new game')
assert.equal(Object.keys(s.staff).length, 0, 'No staff on new game')
assert.equal(s.trips ? Object.keys(s.trips).length : 0, 0, 'No trips on new game')
console.log('✓ Brand new game initialized with clean Day 0 state, 0 buses, 0 staff')

console.log('=== ALL NEW GAME CHECKS PASSED SUCCESSFULLY ===')
