/** Complete-state references: --record intentionally updates the checked-in baseline.
 * --benchmark writes isolated 3-run median timings; --profile samples real advanceDay.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { buildProbeFixture, LARGE_FLEET_MODELS } from './test-sim-determinism'
import { advanceDay } from '../src/engine/tick'
import { applyDecision } from '../src/engine/sim/events'
import { unassignBus, assignBus } from '../src/engine/sim/schedules'
import { recruitVeteran, appointFleetManager } from '../src/engine/sim/staffing'
import { tryCoverBus } from '../src/engine/sim/cover'
import { decodeSaveString, encodeSaveString, hydratePackedState, toSaveDto } from '../src/store/saveCodec'
import { isFestivalDay } from '../src/engine/core/calendar'
import type { GameState } from '../src/engine/types'

export function settle(s: GameState) {
  while (s.decisions.length) {
    const d = s.decisions[0]!
    const option = d.kind === 'cheque_bounce' ? d.options.find((o) => o.id !== 'collector') : d.options[0]
    if (applyDecision(s, d.id, option?.id ?? 'pass')) s.decisions.shift()
  }
}
const hash = (s: GameState) => createHash('sha256').update(JSON.stringify(s)).digest('hex')
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value
const dtoHash = (s: GameState) => createHash('sha256').update(JSON.stringify(canonical(toSaveDto(s)))).digest('hex')
const baselineFile = new URL('./fixtures/sim-reference.json', import.meta.url)
const benchmark = process.argv.includes('--benchmark')
const profile = process.argv.includes('--profile')
const record = process.argv.includes('--record')
const fleetArg = process.argv.indexOf('--fleet')
const fleets = (benchmark || profile) && fleetArg >= 0 ? [Number(process.argv[fleetArg + 1])] : [20, 70, 140]
assert(fleets.every((fleet) => Number.isInteger(fleet) && fleet > 0))
const results: { name: string; hashes: string[] }[] = []
const timings: { fleet: number; samples: number[]; medianMs: number }[] = []
mkdirSync('.profiles', { recursive: true })

for (const fleet of fleets) {
  // Timing runs build a real fleet of the requested size; the hash check keeps the original fixture.
  const fixture = benchmark || profile ? buildProbeFixture(fleet, 4242, LARGE_FLEET_MODELS, true) : buildProbeFixture(fleet)
  if (benchmark || profile) {
    const samples: number[] = []
    const session = new Session()
    if (profile) { session.connect(); session.post('Profiler.enable'); session.post('Profiler.start') }
    for (let run = 0; run < 3; run++) {
      const s = structuredClone(fixture)
      let elapsed = 0
      for (let day = 0; day < 14; day++) {
        settle(s)
        const start = performance.now()
        advanceDay(s)
        elapsed += performance.now() - start
      }
      samples.push(elapsed / 14)
    }
    if (profile) {
      await new Promise<void>((resolve, reject) => session.post('Profiler.stop', (err, result) => {
        if (err) { reject(err); return }
        writeFileSync(`.profiles/day-${fleet}.cpuprofile`, JSON.stringify(result.profile))
        session.disconnect()
        resolve()
      }))
    }
    const medianMs = [...samples].sort((a, b) => a - b)[1]!
    timings.push({ fleet, samples, medianMs })
    console.log(`${fleet} coaches: median ${medianMs.toFixed(2)} ms/day (${samples.map((x) => x.toFixed(2)).join(', ')})`)
    continue
  }
  const hashes: string[] = []
  for (let day = 0; day < 35; day++) {
    settle(fixture); advanceDay(fixture); hashes.push(hash(fixture))
  }
  results.push({ name: `fleet-${fleet}-seed-4242`, hashes })
}
if (benchmark || profile) {
  const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'latest'
  assert(/^[a-z0-9-]+$/i.test(label))
  writeFileSync(`.profiles/sim-timing-${label}.json`, JSON.stringify(timings, null, 2))
} else {
  // Multiple seeds, both hybrid zones, seasonal sales, actual breakdown cover,
  // a coach swap and a save/load branch. 180 days spans several festivals.
  for (const seed of [9001, 1776]) {
    const s = buildProbeFixture(12, seed, ['bb1624hybrid', 'leyhybrid', 'leyhybrid13'])
    const hashes: string[] = []
    let covered = false
    let swapped = false
    let festivals = 0
    for (let day = 0; day < 180; day++) {
      settle(s)
      if (day === 10) {
        const sch = Object.values(s.schedules).find((x) => x.active && x.busIds.some((id) => s.buses[id]?.status === 'active'))!
        assert(sch)
        const old = s.buses[sch.busIds.find((id) => s.buses[id]?.status === 'active')!]!
        const replacement = structuredClone(old)
        replacement.id = 'reference-replacement'
        replacement.scheduleId = undefined
        replacement.coveringBusId = undefined
        s.buses[replacement.id] = replacement
        unassignBus(s, sch.id, old.id)
        assert.equal(assignBus(s, sch.id, replacement.id), null)
        swapped = true
      }
      if (day === 20) {
        const bus = Object.values(s.buses).find((b) => b.status === 'active' && b.scheduleId)!
        const spare = structuredClone(bus)
        spare.id = 'reference-spare'
        spare.scheduleId = undefined
        spare.coveringBusId = undefined
        spare.duty = 'spare'
        s.buses[spare.id] = spare
        const manager = recruitVeteran(s, 'manager', { skill: [8, 8] })
        assert.equal(appointFleetManager(s, manager.id), null)
        s.config.autoCoverPolicy = 'any'
        bus.status = 'workshop'
        assert(tryCoverBus(s, bus.id), 'breakdown cover must be exercised')
        covered = true
      }
      advanceDay(s)
      if (isFestivalDay(s.day)) festivals++
      hashes.push(hash(s))
      if (day === 30) {
        const original = structuredClone(s)
        const loaded = decodeSaveString(encodeSaveString(s)) as GameState
        loaded.bodyBuilders = structuredClone(s.bodyBuilders)
        hydratePackedState(loaded)
        // Packed and live seats have different representations; compare their
        // canonical save DTOs while continuing both through the real pipeline.
        const liveHashes: string[] = []
        const loadedHashes: string[] = []
        for (let step = 0; step < 7; step++) {
          settle(original); settle(loaded)
          advanceDay(original); advanceDay(loaded)
          liveHashes.push(dtoHash(original))
          loadedHashes.push(dtoHash(loaded))
        }
        // Existing codec behavior can change near-departure cancellation RNG.
        // Track both branches against pre-optimization references; do not fix
        // gameplay inside a performance change. See docs/simulation-findings.md.
        results.push({ name: `continuation-live-seed-${seed}`, hashes: liveHashes })
        results.push({ name: `continuation-loaded-seed-${seed}`, hashes: loadedHashes })
      }
    }
    assert(swapped && covered && festivals > 0)
    results.push({ name: `hybrid-seasonal-cover-seed-${seed}`, hashes })
  }
  if (record) {
    mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true })
    writeFileSync(baselineFile, JSON.stringify(results, null, 2) + '\n')
    console.log('Recorded checked-in full-state references.')
  } else {
    const reference = JSON.parse(readFileSync(baselineFile, 'utf8')) as typeof results
    writeFileSync('.profiles/sim-actual.json', JSON.stringify(results))
    for (const result of results) {
      const expected = reference.find((r) => r.name === result.name)
      assert(expected, `Missing reference ${result.name}`)
      const mismatch = result.hashes.findIndex((value, index) => value !== expected.hashes[index])
      assert.equal(mismatch, -1, `Simulation changed: ${result.name}, step ${mismatch}; do not regenerate references to hide a regression.`)
    }
    console.log(`${results.reduce((n, r) => n + r.hashes.length, 0)} complete daily states match; including both save/load continuation branches.`)
  }
}
