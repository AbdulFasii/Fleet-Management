/**
 * Compact save codec: pack trip seat maps (rebuild on load), zlib compress,
 * and chunk across localStorage + sessionStorage so large fleets fit without
 * dropping gameplay data.
 */
import { compressSync, decompressSync, strToU8, strFromU8 } from 'fflate'
import { BAL } from '../engine/data/balance'
import type { Channel, GameState, Trip, TripSeat } from '../engine/types'

/** Tunables — raise maxChunks / chunkChars to keep more history in-browser. */
export const SAVE_STORAGE = {
  localKey: 'busgame_save',
  sessionKey: 'busgame_save',
  /** Max UTF-16 units per chunk (under typical ~5MB item limits). */
  chunkChars: 700_000,
  /** Total capacity ≈ chunkChars × maxChunks (plus meta). */
  maxChunks: 16,
  preferCompress: true,
} as const

const CHUNK_PREFIX = 'busgame_save#'

interface SeatSalePacked {
  id: string
  p: number
  c: Channel
  d: number
}

type PackedTrip = Omit<Trip, 'seats' | 'seatSales'> & {
  seats?: TripSeat[]
  sales?: SeatSalePacked[]
}

interface SaveMeta {
  v: number
  fmt: 'seatpack'
  enc: 'raw' | 'zlib-b64'
  chunks: number
  bytes: number
}

/**
 * Strip the live seat map down to the sold rows. Cold trips already carry
 * `seatSales`, so this is a rename rather than a scan; a live map (today's
 * board) is walked once.
 */
function packTrip(t: Trip): PackedTrip {
  const { seats, seatSales, ...rest } = t
  let sales: SeatSalePacked[]
  if (seats && seats.length > 0) {
    sales = []
    for (const seat of seats) {
      if (!seat.sale) continue
      sales.push({
        id: seat.id,
        p: seat.sale.price,
        c: seat.sale.channel,
        d: seat.sale.bookedDay,
      })
    }
  } else {
    sales = seatSales ?? []
  }
  // Keep every scalar field (slot, isSeasonal, hybridSnapshot, fare overrides…):
  // dropping them here used to silently change a saved game's behaviour on load.
  return {
    ...rest,
    seatCount: t.seatCount || seats?.length || 0,
    ...(sales.length > 0 ? { sales } : {}),
  }
}

/**
 * Load a packed trip. The state stays packed: seats are rebuilt from the coach
 * template when the booking pass or the UI needs them, so loading a 70-coach
 * save does not allocate ~130k seat objects up front.
 */
function hydrateTripSeats(s: GameState, t: Trip & { sales?: SeatSalePacked[] }): void {
  const sales = t.sales
  delete t.sales
  if (!t.seatModelId) {
    const bus = s.buses[t.busId]
    if (bus) t.seatModelId = bus.modelId
  }
  // Legacy save already has full seat maps (no sales pack): keep them. The
  // daily retention pass packs whatever is outside the live window.
  if (t.seats?.length) return
  if (!t.seats) t.seats = []
  if (sales?.length) t.seatSales = sales
  else delete t.seatSales
  if (!t.seatCount) t.seatCount = 0
}

export function hydratePackedState(s: GameState): void {
  for (const t of Object.values(s.trips ?? {})) {
    hydrateTripSeats(s, t as Trip & { sales?: SeatSalePacked[] })
  }
  const keep = BAL.completedTripKeepDays
  s.openTripIds = Object.keys(s.trips ?? {}).filter((id) => {
    const t = s.trips[id]
    return !!t && (t.status === 'open' || t.day >= s.day - keep)
  })
  // Inbox retains recent 30-day messages
  s.inbox = s.inbox ?? []
}

/** JSON DTO: trips without empty seats; openTripIds rebuilt on load. Inbox is session-only. */
export function toSaveDto(s: GameState): Record<string, unknown> {
  const trips: Record<string, PackedTrip> = {}
  for (const [id, t] of Object.entries(s.trips ?? {})) {
    trips[id] = packTrip(t)
  }
  const { openTripIds: _o, trips: _t, ...rest } = s
  return { ...rest, trips, inbox: s.inbox ?? [] }
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function compressBody(json: string): { enc: 'raw' | 'zlib-b64'; body: string } {
  if (!SAVE_STORAGE.preferCompress) return { enc: 'raw', body: json }
  try {
    // Level 3 halves the encode time of level 6 for ~10% more bytes, and this
    // runs after every advance — the save stays well inside the chunk budget.
    const packed = compressSync(strToU8(json), { level: 3 })
    const b64 = bytesToB64(packed)
    // Only use compressed form if it actually saves space (base64 overhead ~33%)
    if (b64.length < json.length * 0.92) return { enc: 'zlib-b64', body: b64 }
  } catch { /* fall through */ }
  return { enc: 'raw', body: json }
}

function decompressBody(enc: 'raw' | 'zlib-b64', body: string): string {
  if (enc !== 'zlib-b64') return body
  const bytes = b64ToBytes(body)
  return strFromU8(decompressSync(bytes))
}

/** Encode live state → storage/export string (packed + optionally zlib). */
export function encodeSaveString(s: GameState): string {
  const dto = toSaveDto(s)
  const json = JSON.stringify(dto)
  const { enc, body } = compressBody(json)
  return JSON.stringify({
    v: s.version,
    fmt: 'seatpack',
    enc,
    body,
  })
}

/** Decode storage/export string → plain state object (trips may still be packed). */
export function decodeSaveString(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') return parsed
  const obj = parsed as Record<string, unknown>

  if (obj.fmt === 'seatpack' && obj.state && typeof obj.state === 'object') {
    return obj.state
  }

  if (obj.fmt === 'seatpack' && typeof obj.body === 'string') {
    const enc = obj.enc === 'zlib-b64' ? 'zlib-b64' : 'raw'
    const json = decompressBody(enc, obj.body)
    return JSON.parse(json)
  }

  return parsed
}

function chunkKey(i: number): string {
  return `${CHUNK_PREFIX}${i}`
}

function clearChunks(store: Storage, max = SAVE_STORAGE.maxChunks): void {
  for (let i = 0; i < max; i++) {
    try { store.removeItem(chunkKey(i)) } catch { /* ignore */ }
  }
}

function writeChunks(store: Storage, metaKey: string, payload: string): boolean {
  const size = SAVE_STORAGE.chunkChars
  const n = Math.ceil(payload.length / size)
  if (n > SAVE_STORAGE.maxChunks) return false

  const meta: SaveMeta = {
    v: 1,
    fmt: 'seatpack',
    enc: 'raw',
    chunks: n,
    bytes: payload.length,
  }

  try {
    clearChunks(store)
    store.setItem(metaKey, JSON.stringify(meta))
    // Slice and write one chunk at a time so the whole payload is never
    // duplicated as an array of strings (a long game's save is multi-MB).
    for (let i = 0; i < n; i++) {
      store.setItem(chunkKey(i), payload.slice(i * size, (i + 1) * size))
    }
    return true
  } catch {
    try {
      clearChunks(store)
      store.removeItem(metaKey)
    } catch { /* ignore */ }
    return false
  }
}

function readChunks(store: Storage, metaKey: string): string | null {
  try {
    const metaRaw = store.getItem(metaKey)
    if (!metaRaw) return null
    const meta = JSON.parse(metaRaw) as SaveMeta | Record<string, unknown>

    if (!meta || typeof meta !== 'object') return null
    if (!('chunks' in meta) || typeof (meta as SaveMeta).chunks !== 'number') {
      return metaRaw
    }

    const n = (meta as SaveMeta).chunks
    let body = ''
    for (let i = 0; i < n; i++) {
      const part = store.getItem(chunkKey(i))
      if (part === null) return null
      body += part
    }
    return body
  } catch {
    return null
  }
}

function writeOneShot(store: Storage, metaKey: string, payload: string): boolean {
  try {
    clearChunks(store)
    store.setItem(metaKey, payload)
    return true
  } catch {
    return false
  }
}

export function writeToStore(store: Storage, metaKey: string, payload: string): boolean {
  if (writeOneShot(store, metaKey, payload)) return true
  return writeChunks(store, metaKey, payload)
}

export function readFromStore(store: Storage, metaKey: string): string | null {
  return readChunks(store, metaKey)
}

export function clearSaveStores(): void {
  try {
    clearChunks(localStorage)
    localStorage.removeItem(SAVE_STORAGE.localKey)
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (
        k &&
        !k.includes('coach') &&
        !k.includes('shared_body') &&
        !k.includes('global_design') &&
        (k.startsWith('busgame_') || k.startsWith('busraj_') || k.startsWith('bus_pref_'))
      ) {
        keysToRemove.push(k)
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
  try {
    clearChunks(sessionStorage)
    sessionStorage.removeItem(SAVE_STORAGE.sessionKey)
  } catch { /* ignore */ }
}

/** Compressed save payload size of the last successful write (bytes). */
let lastSaveBytes = 0
let lastSaveDay = 0

export function getLastSaveInfo(): { bytes: number; day: number } {
  return { bytes: lastSaveBytes, day: lastSaveDay }
}

export function writeSave(payload: string, day = 0): boolean {
  // One copy is enough. Writing the same multi-MB payload to both stores
  // doubled the memory retained by the browser for a save that already fits.
  if (writeToStore(localStorage, SAVE_STORAGE.localKey, payload)) {
    lastSaveBytes = payload.length
    lastSaveDay = day
    return true
  }
  try {
    const ok = writeToStore(sessionStorage, SAVE_STORAGE.sessionKey, payload)
    if (ok) {
      lastSaveBytes = payload.length
      lastSaveDay = day
    }
    return ok
  } catch {
    return false
  }
}

export function readSave(): string | null {
  const local = readFromStore(localStorage, SAVE_STORAGE.localKey)
  if (local) return local
  try {
    return readFromStore(sessionStorage, SAVE_STORAGE.sessionKey)
  } catch {
    return null
  }
}

export function hasSaveBlob(): boolean {
  try {
    if (localStorage.getItem(SAVE_STORAGE.localKey) !== null) return true
    if (localStorage.getItem(chunkKey(0)) !== null) return true
  } catch { /* ignore */ }
  try {
    if (sessionStorage.getItem(SAVE_STORAGE.sessionKey) !== null) return true
  } catch { /* ignore */ }
  return false
}
