import type { BodyBuilder, BodyDesign } from '../engine/types'
import { cloneDefaultBodyBuilders, DEFAULT_BODY_BUILDERS } from '../engine/data/bodyBuilders'

const LOCAL_STORAGE_KEY = 'busgame_shared_body_builders'
const IDB_NAME = 'busgame_shared_storage'
const IDB_STORE = 'keyval'
const IDB_KEY = 'shared_body_builders'

// In-memory cache for synchronous access (e.g. at game start or newGame)
let memoryCache: Record<string, BodyBuilder> | null = null

// Initialize synchronous memory cache from localStorage if available
try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        memoryCache = parsed
      }
    }
  }
} catch {
  // localStorage may be unavailable or disabled
}

// ---------------------------------------------------------------------------
// IndexedDB Helpers
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
// Merging & Synchronization Logic
// ---------------------------------------------------------------------------

/**
 * Merges shared body designs with a save state's body designs.
 * - `shared` is the authoritative source for designs, configs, and images.
 * - Any unique custom designs or images only present in `stateBuilders` are adopted into `shared`.
 * - Returns the resulting `bodyBuilders` to apply, and whether `shared` storage was updated.
 */
export function applySharedToState(
  stateBuilders: Record<string, BodyBuilder> | undefined | null,
  shared: Record<string, BodyBuilder> | undefined | null,
): { bodyBuilders: Record<string, BodyBuilder>; sharedUpdated: boolean } {
  const base = shared ?? memoryCache ?? cloneDefaultBodyBuilders()
  const result: Record<string, BodyBuilder> = JSON.parse(JSON.stringify(base))
  let sharedUpdated = false

  if (stateBuilders) {
    for (const [builderId, b] of Object.entries(stateBuilders)) {
      if (!result[builderId]) {
        result[builderId] = JSON.parse(JSON.stringify(b))
        sharedUpdated = true
        continue
      }

      const resBuilder = result[builderId]
      for (const d of b.designs) {
        const found = resBuilder.designs.find((x) => x.id === d.id)
        if (!found) {
          // Custom design in this save that isn't in shared yet -> adopt it globally
          resBuilder.designs.push(JSON.parse(JSON.stringify(d)))
          sharedUpdated = true
        } else if (d.image && !found.image) {
          // Save has an image that shared doesn't have yet -> adopt it globally
          found.image = d.image
          sharedUpdated = true
        }
      }
    }
  }

  return { bodyBuilders: result, sharedUpdated }
}

/**
 * Returns current shared body builders synchronously.
 * Falls back to null if nothing has been saved yet.
 */
export function getSharedBodyBuildersSync(): Record<string, BodyBuilder> | null {
  return memoryCache ? JSON.parse(JSON.stringify(memoryCache)) : null
}

/**
 * Synchronize a save state's body builders with the global shared body designs.
 * - Any designs or images in shared storage are applied to the save state.
 * - Any unique custom designs or images in the save state are adopted into shared storage.
 */
export function syncStateBodyBuildersWithShared(
  stateBuilders?: Record<string, BodyBuilder> | null,
): { bodyBuilders: Record<string, BodyBuilder>; changed: boolean } {
  const currentShared = memoryCache ?? cloneDefaultBodyBuilders()
  const { bodyBuilders, sharedUpdated } = applySharedToState(stateBuilders, currentShared)

  memoryCache = bodyBuilders
  return { bodyBuilders: JSON.parse(JSON.stringify(bodyBuilders)), changed: sharedUpdated }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Persist body builders globally across all game saves:
 * 1. Updates memory cache
 * 2. Saves to localStorage
 * 3. Saves to IndexedDB (for high capacity & image binary safety)
 * 4. Saves to backend disk (/api/shared-body-designs in gameSave/ folder)
 */
export async function saveSharedBodyDesigns(bodyBuilders: Record<string, BodyBuilder>): Promise<void> {
  const clone = JSON.parse(JSON.stringify(bodyBuilders))
  memoryCache = clone

  // 1. LocalStorage
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(clone))
    }
  } catch {
    // Quota might be hit if uncompressed images are large; IndexedDB and disk handle it
  }

  // 2. IndexedDB
  try {
    await idbSet(IDB_KEY, clone)
  } catch {
    // IndexedDB failure fallback
  }

  // 3. Backend disk file (Downloads/gameSave/shared_body_designs.json)
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/shared-body-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyBuilders: clone }),
      })
    } catch {
      // Hosted or server unreachable, client storage remains valid
    }
  }
}

/**
 * Load shared body designs from persistent storage (Backend -> IndexedDB -> LocalStorage).
 */
export async function loadSharedBodyDesigns(): Promise<Record<string, BodyBuilder> | null> {
  // 1. Try backend
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/shared-body-designs')
      if (res.ok) {
        const text = await res.text()
        const looksHtml = /^\s*</.test(text) || (res.headers.get('content-type') || '').includes('text/html')
        if (!looksHtml) {
          const data = JSON.parse(text)
          if (data.ok && data.bodyBuilders && typeof data.bodyBuilders === 'object') {
            memoryCache = data.bodyBuilders
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.bodyBuilders))
              }
            } catch {}
            idbSet(IDB_KEY, data.bodyBuilders).catch(() => {})
            return data.bodyBuilders
          }
        }
      }
    } catch {
      // Backend offline / static host
    }
  }

  // 2. Try IndexedDB
  try {
    const idbData = await idbGet<Record<string, BodyBuilder>>(IDB_KEY)
    if (idbData && typeof idbData === 'object') {
      memoryCache = idbData
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(idbData))
        }
      } catch {}
      return idbData
    }
  } catch {
    // IndexedDB error
  }

  // 3. Try LocalStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          memoryCache = parsed
          return parsed
        }
      }
    }
  } catch {}

  return memoryCache
}
