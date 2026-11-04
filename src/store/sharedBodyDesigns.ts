import type { BodyBuilder } from '../engine/types'
import { cloneDefaultBodyBuilders, DEFAULT_BODY_BUILDERS } from '../engine/data/bodyBuilders'
import { isCloudImagesConfigured } from '../lib/supabase'
import {
  fetchBodyCatalog,
  publishBodyCatalog,
  type PublishCatalogResult,
} from './cloudBodyDesigns'

// Safe keys protected from clearSaveStores()
export const LOCAL_KEY_DESIGNS = 'busgame_global_coach_designs'
export const LOCAL_KEY_IMAGES = 'busgame_coach_images'

const IDB_NAME = 'busgame_coach_storage_v2'
const IDB_STORE = 'keyval'
const IDB_KEY_DESIGNS = 'coach_designs'
const IDB_KEY_IMAGES = 'coach_images'

// In-memory caches for instant synchronous availability
let memoryCacheDesigns: Record<string, BodyBuilder> | null = null
let memoryCacheImages: Record<string, string> = {}
let lastCloudSync: string | null = null

export function getLastCloudSyncTime(): string | null {
  return lastCloudSync
}

/** Removes local storage keys so design data is never stored locally. */
export function clearLocalBodyDesignsStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_KEY_DESIGNS)
      localStorage.removeItem(LOCAL_KEY_IMAGES)
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Synchronous Startup Hydration
// ---------------------------------------------------------------------------
// When Supabase cloud is configured, clear local storage and always load fresh from cloud.
// Only fall back to local storage if cloud is not configured (offline / dev).
if (isCloudImagesConfigured()) {
  clearLocalBodyDesignsStorage()
} else {
  try {
    if (typeof localStorage !== 'undefined') {
      const rawImgs = localStorage.getItem(LOCAL_KEY_IMAGES)
      if (rawImgs) {
        const parsedImgs = JSON.parse(rawImgs)
        if (parsedImgs && typeof parsedImgs === 'object') {
          memoryCacheImages = parsedImgs
        }
      }

      const rawDesigns = localStorage.getItem(LOCAL_KEY_DESIGNS)
      if (rawDesigns) {
        const parsed = JSON.parse(rawDesigns)
        if (parsed && typeof parsed === 'object') {
          memoryCacheDesigns = parsed
          for (const b of Object.values(memoryCacheDesigns as Record<string, BodyBuilder>)) {
            for (const d of b.designs) {
              if (d.chassisNames && d.chassisNames.includes('1017')) {
                d.chassisNames = d.chassisNames.filter((n) => n !== '1017')
              }
              if (d.image) {
                memoryCacheImages[d.id] = d.image
              } else if (memoryCacheImages[d.id]) {
                d.image = memoryCacheImages[d.id]
              }
            }
          }
        }
      }
    }
  } catch {
    // Storage unavailable
  }
}

// ---------------------------------------------------------------------------
// IndexedDB Persistence Helpers
// ---------------------------------------------------------------------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'))
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openIdb()
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const store = tx.objectStore(IDB_STORE)
      const req = store.get(key)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function idbSet<T>(key: string, val: T): Promise<boolean> {
  try {
    const db = await openIdb()
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const req = store.put(val, key)
      req.onsuccess = () => resolve(true)
      req.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Image Lookup & Attachment
// ---------------------------------------------------------------------------

/** Get shared photo for a design ID, even if a save didn't serialize it. */
export function getSharedDesignImage(designId: string): string | undefined {
  return memoryCacheImages[designId]
}

/** Attaches all known shared images to a set of body builders. */
export function attachSharedImages(builders: Record<string, BodyBuilder>): Record<string, BodyBuilder> {
  const result: Record<string, BodyBuilder> = JSON.parse(JSON.stringify(builders))
  for (const [bId, b] of Object.entries(result)) {
    for (const d of b.designs) {
      if (!d.layoutKinds || d.layoutKinds.length === 0) {
        if (d.layoutKind) {
          d.layoutKinds = [d.layoutKind]
        } else {
          const defaultL = DEFAULT_BODY_BUILDERS[bId]?.designs.find((x) => x.id === d.id)?.layoutKinds
          d.layoutKinds = defaultL ?? [d.name.toLowerCase().includes('semi') ? 'semi' : d.name.toLowerCase().includes('hybrid') ? 'hybrid' : 'sleeper']
        }
      }
      if (d.chassisNames && d.chassisNames.includes('1017')) {
        d.chassisNames = d.chassisNames.filter((n) => n !== '1017')
      }
      if (!d.layoutKind) {
        d.layoutKind = d.layoutKinds[0]
      }
      if (d.image) {
        memoryCacheImages[d.id] = d.image
      } else if (memoryCacheImages[d.id]) {
        d.image = memoryCacheImages[d.id]
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Merging & State Synchronization
// ---------------------------------------------------------------------------

/**
 * Merges shared body designs with a save state's body designs.
 * - `shared` is the authoritative source for designs, configs, and images.
 * - Any unique custom designs or images in `stateBuilders` are preserved & adopted globally.
 * - Images are sticky: once associated with a design ID, they never disappear.
 */
export function applySharedToState(
  stateBuilders: Record<string, BodyBuilder> | undefined | null,
  shared: Record<string, BodyBuilder> | undefined | null,
): { bodyBuilders: Record<string, BodyBuilder>; sharedUpdated: boolean } {
  const base = shared ?? memoryCacheDesigns ?? cloneDefaultBodyBuilders()
  const result: Record<string, BodyBuilder> = JSON.parse(JSON.stringify(base))
  let sharedUpdated = false

  // First attach any globally known images and ensure layoutKind to the base result
  for (const [bId, b] of Object.entries(result)) {
    for (const d of b.designs) {
      if (!d.layoutKinds || d.layoutKinds.length === 0) {
        if (d.layoutKind) {
          d.layoutKinds = [d.layoutKind]
        } else {
          const defaultL = DEFAULT_BODY_BUILDERS[bId]?.designs.find((x) => x.id === d.id)?.layoutKinds
          d.layoutKinds = defaultL ?? [d.name.toLowerCase().includes('semi') ? 'semi' : d.name.toLowerCase().includes('hybrid') ? 'hybrid' : 'sleeper']
        }
        d.layoutKind = d.layoutKinds[0]
        sharedUpdated = true
      } else if (!d.layoutKind) {
        d.layoutKind = d.layoutKinds[0]
        sharedUpdated = true
      }
      if (d.chassisNames && d.chassisNames.includes('1017')) {
        d.chassisNames = d.chassisNames.filter((n) => n !== '1017')
      }
      if (d.image) {
        if (!memoryCacheImages[d.id]) {
          memoryCacheImages[d.id] = d.image
          sharedUpdated = true
        }
      } else if (memoryCacheImages[d.id]) {
        d.image = memoryCacheImages[d.id]
      }
    }
  }

  if (stateBuilders) {
    for (const [builderId, b] of Object.entries(stateBuilders)) {
      if (!result[builderId]) {
        result[builderId] = JSON.parse(JSON.stringify(b))
        for (const d of result[builderId].designs) {
          if (!d.layoutKinds || d.layoutKinds.length === 0) {
            d.layoutKinds = [d.layoutKind ?? (d.name.toLowerCase().includes('semi') ? 'semi' : d.name.toLowerCase().includes('hybrid') ? 'hybrid' : 'sleeper')]
          }
          if (!d.layoutKind) d.layoutKind = d.layoutKinds[0]
          if (d.image) memoryCacheImages[d.id] = d.image
        }
        sharedUpdated = true
        continue
      }

      const resBuilder = result[builderId]
      for (const d of b.designs) {
        // Collect image if state had one
        if (d.image && !memoryCacheImages[d.id]) {
          memoryCacheImages[d.id] = d.image
          sharedUpdated = true
        }

        const found = resBuilder.designs.find((x) => x.id === d.id)
        if (!found) {
          // Custom design only present in this save
          const copy = JSON.parse(JSON.stringify(d))
          if (!copy.layoutKinds || copy.layoutKinds.length === 0) {
            copy.layoutKinds = [copy.layoutKind ?? (copy.name.toLowerCase().includes('semi') ? 'semi' : copy.name.toLowerCase().includes('hybrid') ? 'hybrid' : 'sleeper')]
          }
          if (!copy.layoutKind) copy.layoutKind = copy.layoutKinds[0]
          if (!copy.image && memoryCacheImages[copy.id]) {
            copy.image = memoryCacheImages[copy.id]
          }
          resBuilder.designs.push(copy)
          sharedUpdated = true
        } else {
          // Ensure image is attached
          if (!found.image && (d.image || memoryCacheImages[d.id])) {
            found.image = d.image || memoryCacheImages[d.id]
            sharedUpdated = true
          }
          if (d.layoutKinds && d.layoutKinds.length > 0 && JSON.stringify(found.layoutKinds) !== JSON.stringify(d.layoutKinds)) {
            found.layoutKinds = [...d.layoutKinds]
            found.layoutKind = d.layoutKinds[0]
            sharedUpdated = true
          }
        }
      }
    }
  }

  return { bodyBuilders: result, sharedUpdated }
}

/**
 * Returns current shared body builders synchronously.
 * Always has all cached photos attached.
 */
export function getSharedBodyBuildersSync(): Record<string, BodyBuilder> | null {
  if (!memoryCacheDesigns) return null
  return attachSharedImages(memoryCacheDesigns)
}

/**
 * Synchronize a save state's body builders with the global shared body designs.
 */
export function syncStateBodyBuildersWithShared(
  stateBuilders?: Record<string, BodyBuilder> | null,
): { bodyBuilders: Record<string, BodyBuilder>; changed: boolean } {
  const currentShared = memoryCacheDesigns ?? cloneDefaultBodyBuilders()
  const { bodyBuilders, sharedUpdated } = applySharedToState(stateBuilders, currentShared)

  memoryCacheDesigns = bodyBuilders
  return { bodyBuilders: JSON.parse(JSON.stringify(bodyBuilders)), changed: sharedUpdated }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Persist body builders globally across all game saves:
 * 1. Updates memory caches (designs + images map)
 * 2. Saves designs & images to LocalStorage
 * 3. Saves designs & images to IndexedDB
 * 4. Saves to backend disk (/api/shared-body-designs) if local server is active
 */
export async function saveSharedBodyDesigns(bodyBuilders: Record<string, BodyBuilder>): Promise<{ ok: boolean; error?: string }> {
  const clone = JSON.parse(JSON.stringify(bodyBuilders))

  // Update in-memory images cache
  for (const b of Object.values(clone as Record<string, BodyBuilder>)) {
    for (const d of b.designs) {
      if (d.chassisNames && d.chassisNames.includes('1017')) {
        d.chassisNames = d.chassisNames.filter((n) => n !== '1017')
      }
      if (d.image) {
        memoryCacheImages[d.id] = d.image
      } else if (memoryCacheImages[d.id]) {
        d.image = memoryCacheImages[d.id]
      }
    }
  }
  memoryCacheDesigns = clone

  // Save to IndexedDB as resilient local fallback in case cloud is unreachable or table not yet created
  try {
    await Promise.all([
      idbSet(IDB_KEY_DESIGNS, clone),
      idbSet(IDB_KEY_IMAGES, memoryCacheImages),
    ])
  } catch {}

  // When cloud is configured, sync directly to Supabase
  if (isCloudImagesConfigured()) {
    try {
      const res = await publishBodyCatalog(clone)
      if (res.ok) {
        lastCloudSync = res.updatedAt || new Date().toISOString()
        clearLocalBodyDesignsStorage()
        return { ok: true }
      } else {
        console.warn('Sync to Supabase cloud body_catalog failed:', res.error)
        // Store in localStorage as fallback so designs are not lost
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LOCAL_KEY_DESIGNS, JSON.stringify(clone))
            localStorage.setItem(LOCAL_KEY_IMAGES, JSON.stringify(memoryCacheImages))
          }
        } catch {}
        return { ok: false, error: res.error }
      }
    } catch (err: any) {
      console.warn('Sync to Supabase cloud body_catalog failed:', err)
      return { ok: false, error: err?.message || 'Sync failed' }
    }
  }

  // Offline / local fallback (only used when cloud is not configured)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_KEY_DESIGNS, JSON.stringify(clone))
      localStorage.setItem(LOCAL_KEY_IMAGES, JSON.stringify(memoryCacheImages))
    }
  } catch {}

  if (typeof window !== 'undefined') {
    try {
      fetch('/api/shared-body-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyBuilders: clone, images: memoryCacheImages }),
      }).catch(() => {})
    } catch {}
  }
  return { ok: true }
}

/**
 * Load shared body designs and images.
 * When Supabase is configured: ALWAYS fetch directly from Supabase.
 * When offline / unconfigured: fallback to local storage / IndexedDB / defaults.
 */
export async function loadSharedBodyDesigns(): Promise<Record<string, BodyBuilder> | null> {
  // 1. Supabase Cloud Catalog: ALWAYS fetch fresh from cloud when configured
  if (isCloudImagesConfigured()) {
    try {
      const cloud = await fetchBodyCatalog()
      if (cloud && cloud.bodyBuilders && typeof cloud.bodyBuilders === 'object') {
        const attached = attachSharedImages(cloud.bodyBuilders)
        memoryCacheDesigns = attached
        lastCloudSync = cloud.updatedAt || new Date().toISOString()
        // Cease storing design data in local storage
        clearLocalBodyDesignsStorage()
        return memoryCacheDesigns
      }
    } catch (cErr) {
      console.warn('Failed to load body catalog from Supabase:', cErr)
    }
  }

  // 2. Offline fallback (IndexedDB / LocalStorage) only if cloud is unconfigured or failed
  try {
    const [idbDesigns, idbImgs] = await Promise.all([
      idbGet<Record<string, BodyBuilder>>(IDB_KEY_DESIGNS),
      idbGet<Record<string, string>>(IDB_KEY_IMAGES),
    ])
    if (idbImgs && typeof idbImgs === 'object') {
      memoryCacheImages = { ...memoryCacheImages, ...idbImgs }
    }
    if (idbDesigns && typeof idbDesigns === 'object') {
      memoryCacheDesigns = attachSharedImages(idbDesigns)
      return memoryCacheDesigns
    }
  } catch {}

  try {
    if (typeof localStorage !== 'undefined') {
      const rawImgs = localStorage.getItem(LOCAL_KEY_IMAGES)
      if (rawImgs) {
        const parsedImgs = JSON.parse(rawImgs)
        if (parsedImgs && typeof parsedImgs === 'object') {
          memoryCacheImages = { ...memoryCacheImages, ...parsedImgs }
        }
      }

      const raw = localStorage.getItem(LOCAL_KEY_DESIGNS)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          memoryCacheDesigns = attachSharedImages(parsed)
          return memoryCacheDesigns
        }
      }
    }
  } catch {}

  return memoryCacheDesigns ? attachSharedImages(memoryCacheDesigns) : null
}

/**
 * Pull latest body catalog from Supabase cloud.
 */
export async function pullSharedBodyDesignsFromCloud(): Promise<{
  ok: boolean
  error?: string
  bodyBuilders?: Record<string, BodyBuilder>
}> {
  if (!isCloudImagesConfigured()) {
    return { ok: false, error: 'Cloud storage is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.' }
  }
  const cloud = await fetchBodyCatalog()
  if (!cloud || !cloud.bodyBuilders) {
    return { ok: false, error: 'No body catalog found in Supabase. Click "Publish to cloud" first.' }
  }

  const attached = attachSharedImages(cloud.bodyBuilders)
  memoryCacheDesigns = attached
  lastCloudSync = cloud.updatedAt || new Date().toISOString()
  clearLocalBodyDesignsStorage()

  return { ok: true, bodyBuilders: attached }
}

/**
 * Publish current shared body catalog to Supabase cloud.
 */
export async function publishSharedBodyDesignsToCloud(
  onProgress?: (status: string) => void,
): Promise<PublishCatalogResult> {
  const current = memoryCacheDesigns ?? cloneDefaultBodyBuilders()
  const attached = attachSharedImages(current)
  const res = await publishBodyCatalog(attached, onProgress)
  if (res.ok) {
    memoryCacheDesigns = res.bodyBuilders
    lastCloudSync = res.updatedAt || new Date().toISOString()
    clearLocalBodyDesignsStorage()
  }
  return res
}

// ---------------------------------------------------------------------------
// JSON Export & Import (Manual Backup & Transfer)
// ---------------------------------------------------------------------------

export function exportSharedDesignsJson(): string {
  const current = memoryCacheDesigns ?? cloneDefaultBodyBuilders()
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    bodyBuilders: attachSharedImages(current),
    images: memoryCacheImages,
  }
  return JSON.stringify(payload, null, 2)
}

export function importSharedDesignsJson(text: string): { ok: boolean; error?: string } {
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Invalid JSON file format.' }
    }
    const builders = data.bodyBuilders ?? data
    if (!builders || typeof builders !== 'object') {
      return { ok: false, error: 'No body builders found in file.' }
    }
    if (data.images && typeof data.images === 'object') {
      memoryCacheImages = { ...memoryCacheImages, ...data.images }
    }
    const attached = attachSharedImages(builders)
    memoryCacheDesigns = attached
    saveSharedBodyDesigns(attached).catch(() => {})
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to parse JSON file.' }
  }
}
