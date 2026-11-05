import assert from 'node:assert/strict'
import { createSaveQueue } from '../src/store/saveQueue'
import { newGame } from '../src/engine/newGame'

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const timers = new Map<number, { ms: number; fn: () => void }>()
let nextTimer = 0
globalThis.setTimeout = ((fn: () => void, ms: number) => {
  timers.set(++nextTimer, { ms, fn })
  return nextTimer
}) as unknown as typeof setTimeout
globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout

function fire(ms: number) {
  for (const [id, timer] of [...timers]) {
    if (timer.ms !== ms) continue
    timers.delete(id)
    timer.fn()
  }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
function fixture() {
  timers.clear()
  let slot: string | null = 'slot-a'
  let slotRevision = 0
  let accept = true
  const writes: { payload: string; day: number }[] = []
  const clouds: { slot: string; day: number; dto: Record<string, unknown> }[] = []
  const requests: { resolve: (v: string) => void; reject: (e: Error) => void; day: number }[] = []
  const queue = createSaveQueue({
    destination: () => slot,
    destinationRevision: () => slotRevision,
    toDto: (s) => ({ day: s.day, company: s.company }),
    encode: (_dto, _version, day) => new Promise<string>((resolve, reject) => requests.push({ resolve, reject, day })),
    write: (payload, day) => { if (accept) writes.push({ payload, day }); return accept },
    persistSync: (s) => { if (accept) writes.push({ payload: 'sync', day: s.day }); return accept },
    append: async (destination, s, dto) => { clouds.push({ slot: destination, day: s.day, dto }) },
  })
  const s = newGame('Save sequencing', 'malik', 'maa-mdu', 4242)
  return { queue, s, writes, clouds, requests,
    slot: (id: string | null) => { if (slot !== id) slotRevision++; slot = id }, accept: (value: boolean) => { accept = value } }
}

try {
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.s.day++ // The store also mutates shared branches between saves.
    f.queue.enqueue(f.s)
    fire(500)
    f.requests[1]!.resolve('new')
    await settle()
    f.requests[0]!.resolve('old')
    await settle()
    assert.deepEqual(f.writes, [{ payload: 'new', day: f.s.day }])
    fire(1200)
    assert.equal(f.clouds[0]!.day, f.s.day)
    f.s.company.name = 'Changed after send'
    assert.equal((f.clouds[0]!.dto.company as { name: string }).name, 'Save sequencing')
  }
  for (const action of ['reset', 'import', 'load', 'start', 'abandon']) {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.queue.invalidate() // All game replacements use this boundary.
    f.requests[0]!.resolve('obsolete')
    await settle()
    fire(1200)
    assert.equal(f.writes.length, 0, action)
    assert.equal(f.clouds.length, 0, action)
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.s.day++
    assert(f.queue.saveNow(f.s))
    f.requests[0]!.resolve('old')
    await settle()
    assert.deepEqual(f.writes, [{ payload: 'sync', day: f.s.day }])
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    assert(f.queue.flushSync(), 'page-hide flush includes the in-flight save')
    f.requests[0]!.resolve('old')
    await settle()
    assert.equal(f.writes.length, 1)
    assert.equal(f.writes[0]!.payload, 'sync')
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.requests[0]!.reject(new Error('Expected worker failure'))
    await settle()
    assert.equal(f.writes[0]!.payload, 'sync')
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.queue.invalidate()
    f.requests[0]!.reject(new Error('Obsolete failure'))
    await settle()
    assert.equal(f.writes.length, 0, 'stale errors cannot run a synchronous fallback')
  }
  for (const switchWhileEncoding of [false, true]) {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    if (!switchWhileEncoding) { f.requests[0]!.resolve('ok'); await settle() }
    f.slot('slot-b')
    if (switchWhileEncoding) { f.requests[0]!.resolve('ok'); await settle() }
    fire(1200)
    assert.equal(f.clouds.length, 0, 'a deferred append cannot follow a different slot')
    assert.equal(f.writes.length, 1, 'slot changes do not lose local saves')
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.queue.cancelCloud()
    f.slot(null)
    f.slot('slot-a')
    f.requests[0]!.resolve('ok')
    await settle()
    fire(1200)
    assert.equal(f.clouds.length, 0, 'unlink cancels even if the original slot is reselected')
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.slot('slot-b')
    f.slot('slot-a')
    assert(f.queue.flushSync(), 'page-hide must still save locally after a slot change')
    f.requests[0]!.resolve('obsolete')
    await settle()
    fire(1200)
    assert.equal(f.clouds.length, 0, 'switching away and back cancels the original destination')
  }
  {
    const f = fixture()
    f.queue.saveNow(f.s)
    f.queue.invalidate()
    fire(1200)
    assert.equal(f.clouds.length, 0, 'replacement cancels already queued cloud timers')
  }
  {
    const f = fixture()
    f.queue.enqueue(f.s)
    fire(500)
    f.accept(false)
    f.requests[0]!.resolve('storage full')
    await settle()
    f.accept(true)
    assert(f.queue.flushSync(), 'failed writes retain the pending state for retry')
    assert.equal(f.writes.length, 1)
  }
  console.log('All save sequencing checks passed.')
} finally {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
}
