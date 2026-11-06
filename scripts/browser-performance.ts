/** Start Vite separately, then: npx tsx scripts/browser-performance.ts
 * Uses an isolated headless Chrome profile; never touches the player's saves.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildProbeFixture } from './test-sim-determinism'

const browser = process.env.PERF_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const url = process.env.PERF_URL ?? 'http://127.0.0.1:5173'
assert(existsSync(browser), 'Set PERF_CHROME to a Chromium browser executable.')
await fetch(url) // Fail before starting a browser if the dev server is absent.
let occupied = false
try { occupied = (await fetch('http://127.0.0.1:9335/json/version')).ok } catch { /* unused port */ }
assert(!occupied, 'Port 9335 is already in use; do not attach to another browser session.')
mkdirSync('.profiles', { recursive: true })
const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--remote-debugging-port=9335', `--user-data-dir=${resolve('.profiles/chrome-performance')}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' })
child.on('error', (err) => { console.error(err) })
let socket: WebSocket | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
async function cdp(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId
  return new Promise((resolveRequest, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out: ${method}`))
    }, 60_000)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolveRequest(value) },
      reject: (error) => { clearTimeout(timeout); reject(error) },
    })
    socket!.send(JSON.stringify({ id, method, params }))
  })
}
try {
  let target: { webSocketDebuggerUrl: string } | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      target = await (await fetch(`http://127.0.0.1:9335/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
      break
    } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  assert(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((r, reject) => { socket!.onopen = () => r(); socket!.onerror = () => reject(new Error('CDP connection failed')) })
  socket.onmessage = (event) => {
    const response = JSON.parse(String(event.data))
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(response.error.message))
    else request.resolve(response.result)
  }
  socket.onclose = () => {
    for (const request of pending.values()) request.reject(new Error('Isolated browser closed'))
    pending.clear()
  }
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  const results: unknown[] = []
  for (const fleet of [20, 70, 140]) {
    const fixture = buildProbeFixture(fleet)
    writeFileSync('.profiles/browser-fixture.json', JSON.stringify(fixture))
    const response = await cdp('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      while (!document.getElementById('root')?.firstChild) await new Promise(r => setTimeout(r, 20))
      // Resolve the same store URL as the rendered App, including Vite HMR's
      // timestamp. Importing a second URL would benchmark an unmounted store.
      const appSource = await (await fetch('/src/ui/App.tsx')).text()
      const storeImport = appSource.split('\\n').find(line => line.startsWith('import') && line.includes('gameStore.ts'))
      if (!storeImport) throw new Error('Cannot resolve the rendered App store')
      const storePath = storeImport.slice(storeImport.indexOf('from') + 4).trim().replaceAll(';', '').slice(1, -1)
      const { useGame } = await import(storePath)
      const { advanceDay } = await import('/src/engine/tick.ts')
      const { toSaveDto } = await import('/src/store/saveCodec.ts')
      const { encodeSaveDtoAsync } = await import('/src/store/saveWorkerClient.ts')
      const fixture = await (await fetch('/.profiles/browser-fixture.json?t=' + Date.now())).json()
      const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
      const times = { clone: [], savePreparation: [], workerDispatch: [], workerRoundTrip: [], renderUpdateToCommitAndLayout: [], engineDay: [], dayToPaint: [], weekToPaint: [] }
      const longTasks = []
      // Long tasks seen while a day or a week is advancing: what the player actually feels.
      const advanceLongTasks = { day: [], week: [] }
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)))
      observer.observe({ type: 'longtask', buffered: false })
      for (let sample = 0; sample < 3; sample++) {
        let start = performance.now(); const s = structuredClone(fixture); times.clone.push(performance.now() - start)
        start = performance.now(); const dto = toSaveDto(s); times.savePreparation.push(performance.now() - start)
        start = performance.now(); const encoded = encodeSaveDtoAsync(dto, s.version, s.day)
        times.workerDispatch.push(performance.now() - start)
        await encoded; times.workerRoundTrip.push(performance.now() - start)
        const engine = structuredClone(fixture)
        start = performance.now(); advanceDay(engine); times.engineDay.push(performance.now() - start)
        useGame.getState().resetToNewGame()
        s.company.name = 'Browser perf ${fleet} sample ' + sample
        const committed = new Promise(resolve => {
          const mutations = new MutationObserver(() => {
            if (document.body.innerText.includes(s.company.name.toUpperCase())) { mutations.disconnect(); resolve() }
          })
          mutations.observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true })
        })
        start = performance.now()
        useGame.setState({ state: s, busy: false })
        await committed
        void document.body.offsetHeight
        times.renderUpdateToCommitAndLayout.push(performance.now() - start)
        await paint()
        if (!document.body.innerText.includes('Dashboard')) throw new Error('The game dashboard did not render')
        let seen = longTasks.length
        start = performance.now(); useGame.getState().advance(1)
        // A day may run in slices across frames; wait for it, then for the paint.
        while (useGame.getState().busy) await new Promise(r => setTimeout(r, 5))
        await paint()
        times.dayToPaint.push(performance.now() - start)
        advanceLongTasks.day.push(...longTasks.slice(seen))
        if (useGame.getState().state.day !== fixture.day + 1) throw new Error('Single day did not advance')
        useGame.getState().resetToNewGame()
        useGame.setState({ state: structuredClone(fixture), busy: false })
        await paint()
        seen = longTasks.length
        start = performance.now(); useGame.getState().advance(7)
        while (useGame.getState().busy) await new Promise(r => setTimeout(r, 5))
        await paint(); times.weekToPaint.push(performance.now() - start)
        advanceLongTasks.week.push(...longTasks.slice(seen))
        if (useGame.getState().state.day !== fixture.day + 7) throw new Error('Week skip did not advance seven days')
      }
      useGame.getState().resetToNewGame()
      observer.disconnect()
      return { fleet: ${fleet}, mediansMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)])), samplesMs: times,
        longTaskCount: longTasks.length, maxLongTaskMs: Math.max(0, ...longTasks),
        dayMaxLongTaskMs: Math.max(0, ...advanceLongTasks.day), weekMaxLongTaskMs: Math.max(0, ...advanceLongTasks.week),
        weekLongTasksPerRun: advanceLongTasks.week.length / 3 }
    })()` })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    results.push(response.result.value)
    console.log(JSON.stringify(response.result.value))
  }
  writeFileSync('.profiles/browser-performance.json', JSON.stringify(results, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close').catch(() => {}); socket.close() }
  child.kill()
}
