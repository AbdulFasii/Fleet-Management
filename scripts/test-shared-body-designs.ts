import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import {
  applySharedToState,
  syncStateBodyBuildersWithShared,
  saveSharedBodyDesigns,
  getSharedBodyBuildersSync,
  getSharedDesignImage,
  exportSharedDesignsJson,
  importSharedDesignsJson,
  LOCAL_KEY_DESIGNS,
  LOCAL_KEY_IMAGES,
} from '../src/store/sharedBodyDesigns'
import {
  DEFAULT_BODY_BUILDERS,
  cloneDefaultBodyBuilders,
  resolveModelForChassisAndDesign,
} from '../src/engine/data/bodyBuilders'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { rebodyBus } from '../src/engine/sim/maintenance'
import { clearSaveStores } from '../src/store/saveCodec'

// Mock localStorage for node environment
const storage: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v },
  removeItem: (k: string) => { delete storage[k] },
  clear: () => { for (const k in storage) delete storage[k] },
  get length() { return Object.keys(storage).length },
  key: (i: number) => Object.keys(storage)[i] ?? null,
}

console.log('Testing Shared Body Designs Across Game Saves & Deployments...')

// 1. Initial defaults
const initial = cloneDefaultBodyBuilders()
assert.ok(initial.prakesh, 'Prakesh builder exists')
assert.ok(initial.prakesh.designs.length >= 2, 'Prakesh has default designs')
assert.equal(initial.prakesh.designs[0].image, undefined, 'Initially no image')

// 2. User edits Prakesh Standard: uploads image & edits comfort
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
assert.equal(getSharedDesignImage('prakesh_std'), sampleImage, 'Image indexed in shared images map')

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

// 4. Test clearSaveStores() (which runs during "Empty Data & Start New Game" or import)
storage['busgame_save#0'] = 'chunk0'
storage['busgame_save'] = 'meta'
clearSaveStores()

// Ensure save chunks were cleared, but global coach designs and photos were PRESERVED!
assert.equal(storage['busgame_save'], undefined, 'Save slot cleared')
assert.ok(storage[LOCAL_KEY_DESIGNS], 'Global coach designs survived clearSaveStores()!')
assert.ok(storage[LOCAL_KEY_IMAGES], 'Global coach photos survived clearSaveStores()!')

// 5. User loads an existing/old save (which only had default body builders without photos)
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

// 6. Test JSON Export and Import
const exportedJson = exportSharedDesignsJson()
assert.ok(exportedJson.includes('Prakesh Standard Royal'), 'Export contains design')
assert.ok(exportedJson.includes(sampleImage), 'Export contains photo')

const importResult = importSharedDesignsJson(exportedJson)
assert.ok(importResult.ok, 'Import succeeds')

// 7. Test removing a design:
modified.prakesh.designs = modified.prakesh.designs.filter(d => d.id !== 'prakesh_custom_sleeper')
saveSharedBodyDesigns(modified)
const afterRemove = getSharedBodyBuildersSync()!
assert.equal(afterRemove.prakesh.designs.length, 2, 'Removed custom design reflected in shared storage')

// 8. Test reset to defaults
const resetDefaults = cloneDefaultBodyBuilders()
saveSharedBodyDesigns(resetDefaults)
const afterReset = getSharedBodyBuildersSync()!
assert.equal(afterReset.prakesh.designs[0].name, 'Prakesh Standard', 'Reset cleans name back to default')

// 9. Test Seating Layout on Body Designs & Model Resolution
const bbChassis = BUS_MODELS.bb917
assert.ok(bbChassis, 'bb917 chassis exists')

const sleeperDesign = { ...afterReset.prakesh.designs[0], layoutKind: 'sleeper' as const }
const semiDesign = { ...afterReset.prakesh.designs[0], layoutKind: 'semi' as const }
const hybridDesign = { ...afterReset.prakesh.designs[0], layoutKind: 'hybrid' as const }

const resolvedSleep = resolveModelForChassisAndDesign(bbChassis, sleeperDesign)
assert.equal(resolvedSleep.id, 'bb917sleep', 'BB 1017 + Sleeper design resolves to bb917sleep')
assert.equal(resolvedSleep.layout.kind, 'sleeper')

const resolvedSemi = resolveModelForChassisAndDesign(bbChassis, semiDesign)
assert.equal(resolvedSemi.id, 'bb917', 'BB 1017 + Semi design resolves to bb917')
assert.equal(resolvedSemi.layout.kind, 'semi')

const resolvedHybrid = resolveModelForChassisAndDesign(bbChassis, hybridDesign)
assert.equal(resolvedHybrid.id, 'bb917hybrid', 'BB 1017 + Hybrid design resolves to bb917hybrid')
assert.equal(resolvedHybrid.layout.kind, 'hybrid')

// AL 12M Chassis
const alChassis = BUS_MODELS.cheetah
assert.ok(alChassis, 'cheetah (AL 12M) chassis exists')
assert.equal(resolveModelForChassisAndDesign(alChassis, sleeperDesign).id, 'leyacsleep')
assert.equal(resolveModelForChassisAndDesign(alChassis, semiDesign).id, 'cheetah')
assert.equal(resolveModelForChassisAndDesign(alChassis, hybridDesign).id, 'leyhybrid')

console.log('✓ All shared body design tests passed successfully!')
