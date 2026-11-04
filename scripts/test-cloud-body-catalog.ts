import assert from 'node:assert'
import { cloneDefaultBodyBuilders } from '../src/engine/data/bodyBuilders'
import { dataUrlToBlob } from '../src/store/cloudBodyDesigns'
import { exportSharedDesignsJson, importSharedDesignsJson, getSharedBodyBuildersSync } from '../src/store/sharedBodyDesigns'

console.log('Testing Cloud Body Designs Catalog...')

// 1. dataUrlToBlob
const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const blob = dataUrlToBlob(sampleBase64)
assert(blob instanceof Blob, 'dataUrlToBlob should return a Blob')
assert.strictEqual(blob.type, 'image/png', 'Blob should have correct mime type')
assert(blob.size > 0, 'Blob should have positive size')
console.log('✓ dataUrlToBlob test passed')

// 2. Export / Import Json roundtrip
const exported = exportSharedDesignsJson()
assert(typeof exported === 'string', 'exportSharedDesignsJson returns string')
const parsed = JSON.parse(exported)
assert(parsed.bodyBuilders, 'exported json has bodyBuilders')
assert(parsed.version === 1, 'exported json has version 1')

// Add a test design with image and verify import
const builders = cloneDefaultBodyBuilders()
builders.prakesh.designs.push({
  id: 'test_capella_custom',
  name: 'Capella Custom Cloud Edition',
  bodyPrice: 2800000,
  leadDaysAdd: 14,
  comfortDelta: 0.8,
  maintDelta: -0.05,
  layoutKind: 'sleeper',
  layoutKinds: ['sleeper'],
  image: 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/design_test/body_design/cloud-photo.jpg',
})

const testPayload = JSON.stringify({
  version: 1,
  bodyBuilders: builders,
  images: {
    test_capella_custom: 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/design_test/body_design/cloud-photo.jpg',
  },
})

const importRes = importSharedDesignsJson(testPayload)
assert.strictEqual(importRes.ok, true, 'Import should succeed')

const currentShared = getSharedBodyBuildersSync()
assert(currentShared, 'Shared designs should be cached in memory')
const customFound = currentShared.prakesh.designs.find((d) => d.id === 'test_capella_custom')
assert(customFound, 'Custom design should be found in memory cache')
assert.strictEqual(customFound.name, 'Capella Custom Cloud Edition')
assert.strictEqual(customFound.image, 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/design_test/body_design/cloud-photo.jpg')
console.log('✓ Shared body designs import/export roundtrip passed')

console.log('✓ All cloud body designs catalog tests passed!')
