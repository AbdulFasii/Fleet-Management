import assert from 'node:assert'
import { newGame } from '../src/engine/newGame'
import { createGroup, updateGroup } from '../src/engine/sim/groups'
import { sanitizeStorageKey } from '../src/store/cloudImages'

console.log('Testing Cloud Images & Brand Gallery Foundation...')

// 1. Storage key sanitization
assert.strictEqual(sanitizeStorageKey('group:grp_1'), 'group_grp_1')
assert.strictEqual(sanitizeStorageKey('design:arvex-12m'), 'design_arvex-12m')
assert.strictEqual(sanitizeStorageKey('special @#$ key'), 'special_____key')
console.log('✓ Storage key sanitization passed')

// 2. groups.ts brandingPic validation relaxation
const s = newGame('Kaveri Travels', 'malik', 'blr-maa')

// Accept data:image/
const g1 = createGroup(s, {
  name: 'Kaveri Royal',
  code: 'KROY',
  brandingPic: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
})
assert('id' in g1, 'createGroup should accept data:image/')

// Accept https:// Supabase storage URL
const g2 = createGroup(s, {
  name: 'Kaveri Airavat',
  code: 'KAIR',
  brandingPic: 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_kair/branding/abc-123.jpg',
})
assert('id' in g2, 'createGroup should accept https:// storage URL')
const group2 = s.groups['id' in g2 ? g2.id : '']
assert.strictEqual(group2.brandingPic, 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_kair/branding/abc-123.jpg')

// Reject invalid random string
const g3 = createGroup(s, {
  name: 'Invalid Pic Brand',
  code: 'INVP',
  brandingPic: 'not-an-image-url',
})
const group3 = s.groups['id' in g3 ? g3.id : '']
assert.strictEqual(group3.brandingPic, undefined, 'Invalid brandingPic should not be set')

// Test updateGroup with https:// URL
const updateErr = updateGroup(s, group2.id, {
  brandingPic: 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_kair/branding/def-456.png',
})
assert.strictEqual(updateErr, null, 'updateGroup should succeed with https:// URL')
assert.strictEqual(group2.brandingPic, 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_kair/branding/def-456.png')

// Test updateGroup with gallery URLs
const galleryUrls = Array.from({ length: 12 }, (_, i) => `https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_${group2.id}/gallery/img_${i}.jpg`)
const galleryErr = updateGroup(s, group2.id, { gallery: galleryUrls })
assert.strictEqual(galleryErr, null, 'updateGroup should accept gallery URLs')
assert.strictEqual(group2.gallery?.length, 12, 'group should store 12 gallery URLs')

// Test JSON serialization (save export)
const json = JSON.stringify(s)
const parsed = JSON.parse(json)
const exportedGroup = parsed.groups[group2.id]
assert.strictEqual(exportedGroup.brandingPic, 'https://gylkbwuhzwtnazjwftgk.supabase.co/storage/v1/object/public/game-images/group_kair/branding/def-456.png')
assert.strictEqual(exportedGroup.gallery.length, 12)
assert(exportedGroup.gallery[0].startsWith('https://'), 'Export save keeps public URLs')

console.log('✓ All groups and brand gallery tests passed!')
