/**
 * Force-fires every distressed-rival deal and resolves every option, so the
 * offer text, the pricing and the consequences can be read without waiting
 * for the event deck to roll them.
 *
 *   npm run distress -- --seed 42 --size mid
 *
 * `size` picks the operator the deals are sized against: `small` (one bus, thin
 * cash), `mid` (four buses, a real balance sheet) or `big` (a proper fleet).
 */
import { newGame } from '../src/engine/newGame'
import { fmtCompact } from '../src/engine/core/money'
import { rngFor } from '../src/engine/core/rng'
import { liquidity, netWorth } from '../src/engine/sim/finance'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { applyDecision } from '../src/engine/sim/events'
import { DISTRESS_EVENTS } from '../src/engine/sim/eventsDistress'
import { buyLot } from '../src/engine/sim/eventFleet'
import { BAL } from '../src/engine/data/balance'
import type { GameState } from '../src/engine/types'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def
}

const seed = Number(arg('seed', '42'))
const size = arg('size', 'mid') as 'small' | 'mid' | 'big'

const SIZES = {
  small: { buses: 1, cash: 12_00_000_00, rep: 14, tier: 1 as const },
  mid: { buses: 4, cash: 60_00_000_00, rep: 34, tier: 3 as const },
  big: { buses: 10, cash: 3_00_00_000_00, rep: 62, tier: 3 as const },
}

function setup(): GameState {
  const cfg = SIZES[size]
  const s = newGame('Probe Travels', 'malik', 'blr-hyd', seed)
  s.company.cash = cfg.cash
  s.company.reputation = cfg.rep
  s.company.creditScore = 760
  s.company.app.tier = cfg.tier
  s.company.brandAwareness = 0.2
  s.od.limit = 20_00_000_00

  // A running operation: buses on an active schedule, so route-linked deals fire.
  s.company.cash = 100_00_00_000_00
  const err = buyLot(s, {
    dealKey: 'probe', modelId: 'bb1624', count: cfg.buses, age: 4,
    total: 40_00_000_00 * cfg.buses, odoMult: 1, conditionBias: 0, accidentChance: 0.1,
  })
  if (err) throw new Error(`probe setup: ${err}`)
  const made = createSchedule(s, {
    routeId: 'blr-hyd', depHour: 21, depMin: 0, baseFare: 120000, autoPrice: true,
    cancellation: 'flexible', channels: { redbus: true, abhibus: false, ownapp: false, counter: false }, redDeal: false,
  })
  if ('id' in made) {
    for (const b of Object.keys(s.buses)) assignBus(s, made.id, b)
  }
  s.company.cash = cfg.cash // undo the probe fleet's cost
  s.decisions = []
  return s
}

const money = (m: number) => fmtCompact(m).padStart(9)

console.log(`\nseed ${seed}  operator ${size}  liquidity ${fmtCompact(liquidity(setup()))}\n`)

for (const ev of DISTRESS_EVENTS) {
  console.log('='.repeat(78))
  const base = setup()
  if (!ev.canFire(base)) {
    console.log(`${ev.id}: cannot fire for a ${size} operator`)
    continue
  }
  // Fire on a few days so the RNG shows the spread of offers, then walk the
  // options of the first one that landed.
  let fired: GameState | null = null
  for (let d = 0; d < 6 && !fired; d++) {
    const s = setup()
    s.day += d
    ev.fire(s, rngFor(seed, 'evtfire', ev.id, s.day))
    if (s.decisions.length > 0) fired = s
  }
  if (!fired) {
    console.log(`${ev.id}: fired but raised no offer (nothing affordable)`)
    continue
  }
  const d = fired.decisions[0]!
  console.log(`${ev.id} — ${d.title}\n`)
  console.log(d.body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n'))
  console.log()

  for (const o of d.options) {
    const s = structuredClone(fired)
    const before = { cash: s.company.cash, nw: netWorth(s), fleet: Object.keys(s.buses).length, msgs: s.inbox.length }
    const err = applyDecision(s, s.decisions[0]!.id, o.id)
    const emi = Object.values(s.loans).reduce((a, l) => a + (l.status === 'active' ? l.emi : 0), 0)
    const out = err
      ? `REJECTED: ${err}`
      : `cash ${money(s.company.cash - before.cash)}  net worth ${money(netWorth(s) - before.nw)}`
        + `  fleet ${Object.keys(s.buses).length - before.fleet >= 0 ? '+' : ''}${Object.keys(s.buses).length - before.fleet}`
        + `  staff ${Object.keys(s.staff).length}  EMI ${fmtCompact(emi)}`
    console.log(`  [${o.id}] ${o.label}${o.detail ? ` — ${o.detail}` : ''}`)
    console.log(`      ${out}`)
    const log = s.inbox.length > before.msgs ? s.inbox[s.inbox.length - 1] : undefined
    if (!err && log) console.log(`      "${log.text}"`)
    // Follow-up decisions (the inspection report) get walked one level deep.
    if (!err && s.decisions.length > 0) {
      const f = s.decisions[0]!
      console.log(`      → ${f.title}`)
      console.log(f.body.split('\n').filter(Boolean).map((l) => `        ${l}`).join('\n'))
      for (const fo of f.options) {
        const s2 = structuredClone(s)
        const e2 = applyDecision(s2, s2.decisions[0]!.id, fo.id)
        console.log(`        [${fo.id}] ${fo.label}${fo.detail ? ` — ${fo.detail}` : ''}`
          + `  ${e2 ? `REJECTED: ${e2}` : `cash ${fmtCompact(s2.company.cash - s.company.cash)}, fleet ${Object.keys(s2.buses).length}`}`)
      }
    }
  }
}

console.log('='.repeat(78))
console.log(`\ndeck weight in the full event roll: ${DISTRESS_EVENTS.reduce((a, e) => a + e.weight, 0)} of the total`)
console.log(`event chance per day ${BAL.eventChancePerDay}\n`)
