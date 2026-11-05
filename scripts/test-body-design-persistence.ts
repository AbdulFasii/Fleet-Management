/**
 * Renamed and deleted body designs must survive a page refresh.
 *
 * On startup the save loads before the shared catalog finishes loading. The
 * merge used to fall back to the built-in defaults as the authority, which
 * undid renames, revived deleted designs and wrote that back over the catalog.
 */
import assert from 'node:assert/strict'

const storage: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v },
  removeItem: (k: string) => { delete storage[k] },
  clear: () => { for (const k in storage) delete storage[k] },
  get length() { return Object.keys(storage).length },
  key: (i: number) => Object.keys(storage)[i] ?? null,
}

const { cloneDefaultBodyBuilders } = await import('../src/engine/data/bodyBuilders')
const shared = await import('../src/store/sharedBodyDesigns')

const builders = cloneDefaultBodyBuilders()
const [builderId, builder] = Object.entries(builders).find(([, b]) => b.designs.length >= 2)!
const renamed = builder.designs[0]!
const removed = builder.designs[1]!
const originalName = renamed.name

// The player's save after renaming one design and deleting another.
renamed.name = 'Renamed Coach Body'
builder.designs = builder.designs.filter((d) => d.id !== removed.id)
const savedState = JSON.parse(JSON.stringify(builders))

// 1. Refresh: the save loads before the shared catalog is read.
const early = shared.syncStateBodyBuildersWithShared(savedState)
const earlyBuilder = early.bodyBuilders[builderId]!
assert.equal(earlyBuilder.designs.find((d) => d.id === renamed.id)?.name, 'Renamed Coach Body', 'rename kept before the catalog loads')
assert(!earlyBuilder.designs.some((d) => d.id === removed.id), 'deleted design stays deleted before the catalog loads')
assert.equal(early.changed, false, 'nothing is written back before the catalog loads')
assert.notEqual(originalName, 'Renamed Coach Body')
console.log('✓ before the catalog loads, the save keeps its rename and deletion and writes nothing back')

// 2. The edits were saved to the shared catalog (this is what the Edit/Delete buttons do).
const full = cloneDefaultBodyBuilders()
await shared.saveSharedBodyDesigns(full) // catalog as it was
await shared.saveSharedBodyDesigns(savedState) // after the rename + delete
const deletedIds = JSON.parse(storage['busgame_deleted_design_ids'] ?? '[]') as string[]
assert(deletedIds.includes(removed.id), 'the deletion is remembered')
console.log('✓ deleting a design records it')

// 3. A stale save (written before the delete reached it) still lists the design.
const staleSave = cloneDefaultBodyBuilders()
staleSave[builderId]!.designs.find((d) => d.id === renamed.id)!.name = 'Renamed Coach Body'
const merged = shared.syncStateBodyBuildersWithShared(staleSave)
const mergedBuilder = merged.bodyBuilders[builderId]!
assert(!mergedBuilder.designs.some((d) => d.id === removed.id), 'a stale save cannot bring a deleted design back')
assert.equal(mergedBuilder.designs.find((d) => d.id === renamed.id)?.name, 'Renamed Coach Body', 'rename survives the merge')
console.log('✓ a stale save cannot revive a deleted design, and the rename holds')

// 4. Restoring a design (e.g. reset to defaults) clears its deletion record.
await shared.saveSharedBodyDesigns(cloneDefaultBodyBuilders())
const after = JSON.parse(storage['busgame_deleted_design_ids'] ?? '[]') as string[]
assert(!after.includes(removed.id), 'restoring a design forgets its deletion')
console.log('✓ restoring a design clears its deletion record')

console.log('\nOK')
