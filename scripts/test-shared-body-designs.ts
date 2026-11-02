import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  applySharedToState,
  syncStateBodyBuildersWithShared,
  saveSharedBodyDesigns,
  getSharedBodyBuildersSync,
} from '../src/store/sharedBodyDesigns'
import { DEFAULT_BODY_BUILDERS, cloneDefaultBodyBuilders } from '../src/engine/data/bodyBuilders'

// Mock localStorage for node environment
const storage: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v },
  removeItem: (k: string) => { delete storage[k] },
  clear: () => { for (const k in storage) delete storage[k] },
}

console.log('Testing Shared Body Designs Across Game Saves...')

// 1. Initial defaults
const initial = cloneDefaultBodyBuilders()
assert.ok(initial.prakesh, 'Prakesh builder exists')
assert.ok(initial.prakesh.designs.length >= 2, 'Prakesh has default designs')
assert.equal(initial.prakesh.designs[0].image, undefined, 'Initially no image')

// 2. User edits Prakesh Standard in Save 1: uploads image & edits comfort
const modified = cloneDefaultBodyBuilders()
const sampleImage = 'data:image/jpeg;base64,sampleImageData123456789'
modified.prakesh.designs[0].image = sampleImage
modified.prakesh.designs[0].comfortDelta = 0.5
modified.prakesh.designs[0].name = 'Prakesh Standard Royal'

// Also adds a custom design
modified.prakesh.designs.push({
  id: 'prakesh_custom_sleeper',
  name: 'Prakesh Custom Sleeper',
  bodyPrice: 3000000,
  leadDaysAdd: 20,
  comfortDelta: 0.8,
  maintDelta: -0.02,
  image: 'data:image/jpeg;base64,customSleeperImage',
})

// Save modified designs to shared storage
saveSharedBodyDesigns(modified)

// Verify memory cache and localStorage got updated
const sharedSync = getSharedBodyBuildersSync()
assert.ok(sharedSync, 'Shared body designs present in sync storage')
assert.equal(sharedSync.prakesh.designs[0].image, sampleImage, 'Image saved in shared storage')
assert.equal(sharedSync.prakesh.designs[0].name, 'Prakesh Standard Royal', 'Name saved in shared storage')
assert.equal(sharedSync.prakesh.designs.length, 3, 'Custom design saved in shared storage')

// 3. User starts a NEW GAME: "dont config every new game"
const newGameState = newGame('New Co', 'malik', 'maa_cbe_day', 12345, sharedSync)
assert.equal(
  newGameState.bodyBuilders.prakesh.designs[0].image,
  sampleImage,
  'New game automatically inherits the uploaded coach image!'
)
assert.equal(
  newGameState.bodyBuilders.prakesh.designs[0].name,
  'Prakesh Standard Royal',
  'New game automatically inherits the modified design config!'
)
assert.equal(
  newGameState.bodyBuilders.prakesh.designs.length,
  3,
  'New game automatically includes the custom body design!'
)

// 4. User loads an existing/old save (which only had default body builders without photos)
const oldSaveBuilders = cloneDefaultBodyBuilders()
assert.equal(oldSaveBuilders.prakesh.designs[0].image, undefined)

const { bodyBuilders: syncedSaveBuilders } = syncStateBodyBuildersWithShared(oldSaveBuilders)
assert.equal(
  syncedSaveBuilders.prakesh.designs[0].image,
  sampleImage,
  'Loaded save receives the shared image!'
)
assert.equal(
  syncedSaveBuilders.prakesh.designs[0].name,
  'Prakesh Standard Royal',
  'Loaded save receives the shared design config!'
)
assert.equal(
  syncedSaveBuilders.prakesh.designs.length,
  3,
  'Loaded save receives custom body designs!'
)

// 5. Test removing a design:
modified.prakesh.designs = modified.prakesh.designs.filter(d => d.id !== 'prakesh_custom_sleeper')
saveSharedBodyDesigns(modified)
const afterRemove = getSharedBodyBuildersSync()!
assert.equal(afterRemove.prakesh.designs.length, 2, 'Removed custom design reflected in shared storage')

// 6. Test reset to defaults
const resetDefaults = cloneDefaultBodyBuilders()
saveSharedBodyDesigns(resetDefaults)
const afterReset = getSharedBodyBuildersSync()!
assert.equal(afterReset.prakesh.designs[0].image, undefined, 'Reset cleans images in shared storage')
assert.equal(afterReset.prakesh.designs[0].name, 'Prakesh Standard', 'Reset cleans name back to default')

console.log('✓ All shared body design tests passed successfully!')
