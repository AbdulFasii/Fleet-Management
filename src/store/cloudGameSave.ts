/**
 * Cloud Game Saves — multi-slot append-style cloud saves on Supabase.
 * Each slot is an independent game with a compacted base snapshot + day deltas.
 */
import { getSupabase, isCloudImagesConfigured } from '../lib/supabase'
import { toSaveDto } from './saveCodec'
import type { GameState } from '../engine/types'

export const ACTIVE_CLOUD_SAVE_KEY = 'busgame_cloud_save_id'

export interface CloudSaveHeader {
  id: string
  label: string
  company_name: string
  day: number
  difficulty: string
  updated_at: string
  created_at: string
}

export interface CloudSaveDelta {
  day: number
  patch: Record<string, any>
}

export interface CloudSaveRow extends CloudSaveHeader {
  base: Record<string, any>
  base_day: number
  deltas: CloudSaveDelta[]
}

// In-memory cache of the last synced state DTO per active save ID
let lastSyncedSlotId: string | null = null
let lastSyncedDto: Record<string, any> | null = null

export function getActiveCloudSaveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CLOUD_SAVE_KEY) || null
  } catch {
    return null
  }
}

export function setActiveCloudSaveId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_CLOUD_SAVE_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_CLOUD_SAVE_KEY)
    }
  } catch {
    /* ignore storage errors */
  }
  if (!id || id !== lastSyncedSlotId) {
    lastSyncedSlotId = id
    lastSyncedDto = null
  }
}

/**
 * Computes a patch between two save DTOs.
 * Only changed sub-keys in trips/buses are sent, rather than the entire collection.
 */
export function computeDelta(
  prev: Record<string, any>,
  curr: Record<string, any>,
): Record<string, any> {
  const patch: Record<string, any> = {}

  // 1. Day & metadata
  if (curr.day !== prev.day) patch.day = curr.day

  // 2. Company stats (cash, name, brand, metrics)
  if (JSON.stringify(curr.company) !== JSON.stringify(prev.company)) {
    patch.company = curr.company
  }

  // 3. Trips (record of packed trips): only transmit modified trips and track deleted ones
  if (curr.trips || prev.trips) {
    const prevTrips = prev.trips || {}
    const currTrips = curr.trips || {}
    const changedTrips: Record<string, any> = {}
    const deletedTrips: string[] = []

    for (const [id, t] of Object.entries(currTrips)) {
      if (!prevTrips[id] || JSON.stringify(t) !== JSON.stringify(prevTrips[id])) {
        changedTrips[id] = t
      }
    }
    for (const id of Object.keys(prevTrips)) {
      if (!currTrips[id]) {
        deletedTrips.push(id)
      }
    }

    if (Object.keys(changedTrips).length > 0) {
      patch.trips = changedTrips
    }
    if (deletedTrips.length > 0) {
      patch.deletedTrips = deletedTrips
    }
  }

  // 4. Buses (record of buses)
  if (curr.buses || prev.buses) {
    const prevBuses = prev.buses || {}
    const currBuses = curr.buses || {}
    const changedBuses: Record<string, any> = {}
    const deletedBuses: string[] = []

    for (const [id, b] of Object.entries(currBuses)) {
      if (!prevBuses[id] || JSON.stringify(b) !== JSON.stringify(prevBuses[id])) {
        changedBuses[id] = b
      }
    }
    for (const id of Object.keys(prevBuses)) {
      if (!currBuses[id]) {
        deletedBuses.push(id)
      }
    }

    if (Object.keys(changedBuses).length > 0) {
      patch.buses = changedBuses
    }
    if (deletedBuses.length > 0) {
      patch.deletedBuses = deletedBuses
    }
  }

  // 5. Other dynamic collections / arrays
  const otherKeys = [
    'routes',
    'drivers',
    'loans',
    'loanOffers',
    'fuelPurchases',
    'fuelContracts',
    'marketing',
    'inbox',
    'txns',
    'monthly',
    'routeHistory',
    'groups',
    'uiPrefs',
    'config',
    'kpis',
    'version',
    'difficulty',
  ]

  for (const k of otherKeys) {
    if (curr[k] !== undefined && JSON.stringify(curr[k]) !== JSON.stringify(prev[k])) {
      patch[k] = curr[k]
    }
  }

  return patch
}

/**
 * Fold an array of deltas onto a base snapshot to reproduce the complete save DTO.
 */
export function foldDeltas(
  base: Record<string, any>,
  deltas: CloudSaveDelta[],
): Record<string, any> {
  const result = JSON.parse(JSON.stringify(base))

  for (const delta of deltas) {
    const patch = delta.patch || {}

    // Deleted trips
    if (Array.isArray(patch.deletedTrips) && result.trips) {
      for (const id of patch.deletedTrips) {
        delete result.trips[id]
      }
    }

    // Trips updates
    if (patch.trips && typeof patch.trips === 'object') {
      result.trips = result.trips || {}
      for (const [id, t] of Object.entries(patch.trips)) {
        if (t === null) delete result.trips[id]
        else result.trips[id] = t
      }
    }

    // Deleted buses
    if (Array.isArray(patch.deletedBuses) && result.buses) {
      for (const id of patch.deletedBuses) {
        delete result.buses[id]
      }
    }

    // Buses updates
    if (patch.buses && typeof patch.buses === 'object') {
      result.buses = result.buses || {}
      for (const [id, b] of Object.entries(patch.buses)) {
        if (b === null) delete result.buses[id]
        else result.buses[id] = b
      }
    }

    // All other keys
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'trips' || k === 'deletedTrips' || k === 'buses' || k === 'deletedBuses') {
        continue
      }
      result[k] = v
    }
  }

  return result
}

/**
 * List all cloud save slots (metadata only — base & deltas omitted).
 */
export async function listCloudSaves(): Promise<CloudSaveHeader[]> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) return []

  try {
    const { data, error } = await client
      .from('game_saves')
      .select('id, label, company_name, day, difficulty, updated_at, created_at')
      .order('updated_at', { ascending: false })

    if (error) {
      console.warn('Failed to list cloud saves:', error.message)
      return []
    }

    return (data as CloudSaveHeader[]) || []
  } catch (err) {
    console.warn('Error querying cloud saves:', err)
    return []
  }
}

/**
 * Create a new cloud save slot from current game state.
 */
export async function createCloudSave(
  state: GameState,
  customLabel?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  try {
    const snapshot = toSaveDto(state)
    const label = customLabel?.trim() || state.company.name || 'Cloud Save'

    const { data, error } = await client
      .from('game_saves')
      .insert({
        label,
        company_name: state.company.name,
        day: state.day,
        difficulty: state.difficulty,
        base: snapshot,
        base_day: state.day,
        deltas: [],
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      return { ok: false, error: error.message }
    }

    const newId = data.id as string
    setActiveCloudSaveId(newId)
    lastSyncedSlotId = newId
    lastSyncedDto = snapshot

    return { ok: true, id: newId }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to create cloud save.' }
  }
}

/**
 * Load a cloud save by ID, unfolding any appended deltas.
 */
export async function loadCloudSave(
  id: string,
): Promise<{ ok: boolean; dto?: Record<string, any>; label?: string; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  try {
    const { data, error } = await client
      .from('game_saves')
      .select('id, label, company_name, day, difficulty, base, base_day, deltas')
      .eq('id', id)
      .single()

    if (error || !data) {
      return { ok: false, error: error?.message || 'Save slot not found.' }
    }

    const row = data as CloudSaveRow
    const fullDto = foldDeltas(row.base, row.deltas || [])

    setActiveCloudSaveId(id)
    lastSyncedSlotId = id
    lastSyncedDto = fullDto

    return { ok: true, dto: fullDto, label: row.label }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to load cloud save.' }
  }
}

/**
 * Append a day delta to an existing cloud save slot.
 * Automatically compacts into base if deltas.length >= 14 or payload > 500KB.
 */
export async function appendCloudSave(
  id: string,
  state: GameState,
  precomputedDto?: Record<string, any>,
): Promise<{ ok: boolean; compacted?: boolean; noop?: boolean; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  try {
    const currDto = precomputedDto ?? toSaveDto(state)

    // Fetch existing row's deltas & base_day
    const { data, error } = await client
      .from('game_saves')
      .select('id, base, base_day, deltas')
      .eq('id', id)
      .single()

    if (error || !data) {
      return { ok: false, error: error?.message || 'Save slot not found.' }
    }

    const existingDeltas: CloudSaveDelta[] = Array.isArray(data.deltas) ? data.deltas : []
    const deltasLength = existingDeltas.length

    // Determine baseline to diff against
    let baseline: Record<string, any>
    if (lastSyncedSlotId === id && lastSyncedDto) {
      baseline = lastSyncedDto
    } else if (deltasLength > 0) {
      baseline = foldDeltas(data.base, existingDeltas)
    } else {
      baseline = data.base
    }

    const patch = computeDelta(baseline, currDto)

    // If nothing changed, skip network write
    if (Object.keys(patch).length === 0) {
      lastSyncedSlotId = id
      lastSyncedDto = currDto
      return { ok: true, noop: true }
    }

    // Estimate size of existing deltas
    const existingDeltasJson = JSON.stringify(existingDeltas)
    const deltasByteSize = existingDeltasJson.length

    // Compact if accumulated >= 14 day deltas or > 500 KB
    if (deltasLength >= 14 || deltasByteSize > 500_000) {
      const { error: updateErr } = await client
        .from('game_saves')
        .update({
          base: currDto,
          base_day: state.day,
          deltas: [],
          day: state.day,
          company_name: state.company.name,
          difficulty: state.difficulty,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (updateErr) return { ok: false, error: updateErr.message }

      lastSyncedSlotId = id
      lastSyncedDto = currDto
      return { ok: true, compacted: true }
    }

    // Otherwise append new delta
    const newDeltas: CloudSaveDelta[] = [
      ...existingDeltas,
      { day: state.day, patch },
    ]

    const { error: appendErr } = await client
      .from('game_saves')
      .update({
        deltas: newDeltas,
        day: state.day,
        company_name: state.company.name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (appendErr) return { ok: false, error: appendErr.message }

    lastSyncedSlotId = id
    lastSyncedDto = currDto
    return { ok: true, compacted: false }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to append cloud save.' }
  }
}

/**
 * Force a full snapshot replacement / compaction into base.
 */
export async function replaceCloudSave(
  id: string,
  state: GameState,
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  try {
    const snapshot = toSaveDto(state)
    const { error } = await client
      .from('game_saves')
      .update({
        base: snapshot,
        base_day: state.day,
        deltas: [],
        day: state.day,
        company_name: state.company.name,
        difficulty: state.difficulty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }

    lastSyncedSlotId = id
    lastSyncedDto = snapshot
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to replace cloud save.' }
  }
}

/**
 * Rename a cloud save slot.
 */
export async function renameCloudSave(
  id: string,
  newLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  const label = newLabel.trim()
  if (!label) return { ok: false, error: 'Label cannot be empty.' }

  try {
    const { error } = await client
      .from('game_saves')
      .update({ label, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to rename cloud save.' }
  }
}

/**
 * Delete a cloud save slot.
 */
export async function deleteCloudSave(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase()
  if (!client || !isCloudImagesConfigured()) {
    return { ok: false, error: 'Supabase cloud is not configured.' }
  }

  try {
    const { error } = await client.from('game_saves').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }

    if (getActiveCloudSaveId() === id) {
      setActiveCloudSaveId(null)
    }

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to delete cloud save.' }
  }
}
