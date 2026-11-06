/** Integration checks through the real store, codec and worker client. */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { decodeSaveString, encodeSaveString, encodeSaveStringFromDto, readSave } from '../src/store/saveCodec'
import type { GameState } from '../src/engine/types'
import { getActiveCloudSaveRevision, setActiveCloudSaveId } from '../src/store/cloudGameSave'

const original = new Map<string, PropertyDescriptor | undefined>()
function replace(key: string, value: unknown) {
  original.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
function storage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } }
}
const timers = new Map<number, { ms: number; fn: () => void }>()
let timerId = 0
const listeners = new Map<string, () => void>()
type Request = { id: number; dto: Record<string, unknown>; version: number; day: number }
class FakeWorker {
  static instance: FakeWorker
  requests: Request[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: unknown) => void
  constructor() { FakeWorker.instance = this }
  postMessage(request: Request) { this.requests.push(structuredClone(request)) }
  finish(request: Request, fail = false) {
    this.onmessage?.({ data: fail ? { id: request.id, ok: false, error: 'Expected worker failure' }
      : { id: request.id, ok: true, payload: encodeSaveStringFromDto(request.dto, request.version) } })
  }
  terminate() {}
}
replace('localStorage', storage())
replace('sessionStorage', storage())
replace('window', { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) })
replace('document', { visibilityState: 'visible', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) })
replace('Worker', FakeWorker)
replace('setTimeout', (fn: () => void, ms: number) => { timers.set(++timerId, { ms, fn }); return timerId })
replace('clearTimeout', (id: number) => { timers.delete(id) })
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function encodePending(): Request {
  for (const [id, task] of [...timers]) {
    if (task.ms === 500) { timers.delete(id); task.fn() }
  }
  const request = FakeWorker.instance.requests.at(-1)
  assert(request)
  return request
}
try {
  const { useGame } = await import('../src/store/gameStore')
  // A day may run in slices (yielding through MessageChannel, not the faked timers): wait it out.
  const advanceOneDay = async () => {
    useGame.getState().advance(1)
    while (useGame.getState().busy) await new Promise<void>((r) => setImmediate(r))
  }
  const start = async () => {
    useGame.getState().resetToNewGame()
    useGame.getState().startNew('Original company', 'malik', 'maa-mdu')
    await advanceOneDay()
    return encodePending()
  }
  for (const action of ['reset', 'abandon', 'start', 'import', 'load'] as const) {
    const request = await start()
    const g = useGame.getState()
    if (action === 'reset') g.resetToNewGame()
    if (action === 'abandon') g.abandon()
    if (action === 'start') g.startNew('Replacement company', 'malik', 'maa-mdu')
    if (action === 'import') assert(g.importSaveJson(encodeSaveString(newGame('Imported company', 'malik', 'maa-mdu', 1))).ok)
    if (action === 'load') assert(g.loadSave())
    const expected = readSave()
    FakeWorker.instance.finish(request)
    await settle()
    assert.equal(readSave(), expected, `stale worker wrote after ${action}`)
    console.log(`✓ Worker completion after ${action} cannot overwrite storage`)
  }
  {
    const request = await start()
    await advanceOneDay()
    assert(useGame.getState().save())
    const expected = readSave()
    FakeWorker.instance.finish(request, true)
    await settle()
    assert.equal(readSave(), expected, 'obsolete worker failure cannot trigger a stale fallback')
  }
  {
    const request = await start()
    listeners.get('pagehide')!()
    const saved = decodeSaveString(readSave()!) as GameState
    assert.equal(saved.day, useGame.getState().state!.day)
    const expected = readSave()
    FakeWorker.instance.finish(request)
    await settle()
    assert.equal(readSave(), expected, 'page-hide save supersedes its active worker')
  }
  {
    const request = await start()
    FakeWorker.instance.finish(request, true)
    await settle()
    assert.equal((decodeSaveString(readSave()!) as GameState).day, request.day, 'current failure uses sync fallback')
  }
  {
    await start()
    FakeWorker.instance.onerror?.(new Error('Expected worker crash'))
    await settle()
    assert.equal((decodeSaveString(readSave()!) as GameState).day, useGame.getState().state!.day)
    const requests = FakeWorker.instance.requests.length
    await advanceOneDay()
    encodePending()
    await settle()
    assert.equal(FakeWorker.instance.requests.length, requests, 'a failed worker is not reused')
    assert.equal((decodeSaveString(readSave()!) as GameState).day, useGame.getState().state!.day)
  }
  {
    const revision = getActiveCloudSaveRevision()
    setActiveCloudSaveId('slot-a')
    setActiveCloudSaveId('slot-b')
    setActiveCloudSaveId('slot-a')
    assert.equal(getActiveCloudSaveRevision(), revision + 3, 'slot round trips invalidate deferred cloud work')
  }
  useGame.getState().resetToNewGame()
  console.log('All store save integration checks passed.')
} finally {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}
