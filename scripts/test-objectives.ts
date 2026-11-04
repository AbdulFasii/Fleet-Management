import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { checkObjectives, OBJECTIVES, activeObjectives } from '../src/engine/sim/objectives'
import { Cr } from '../src/engine/core/money'

let failed = 0
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++ }

const s = newGame('Goals', 'malik', 'maa-mdu', 9)
check('starts with no goals done', Object.keys(s.objectives ?? {}).length === 0)
check('shows the first 3 goals', activeObjectives(s).length === 3)

// Fleet goal pays a cash reward through the ledger and logs it.
const cash0 = s.company.cash
const profit0 = s.lifetimeProfit
const template = Object.values(s.buses)[0]
for (let i = 0; i < 5; i++) {
  const id = `fake${i}`
  s.buses[id] = { ...(template ?? {}), id, status: 'active' } as never
}
checkObjectives(s)
check('fleet goal completes', s.objectives?.g_fleet5 !== undefined)
check('reward is paid as income', s.company.cash > cash0 && s.lifetimeProfit > profit0)
const done = Object.keys(s.objectives ?? {}).length
checkObjectives(s)
check('goals are paid only once', Object.keys(s.objectives ?? {}).length === done)

// Victory needs net worth AND every other goal first.
s.company.cash = Cr(500)
checkObjectives(s)
check('no victory while other goals remain', !s.victory)
for (const o of OBJECTIVES) if (o.id !== 'g_empire') s.objectives![o.id] = s.day
checkObjectives(s)
check('victory declared at 100 Cr with all goals', !!s.victory && s.victory.netWorth >= Cr(100))
advanceDay(s)
check('game continues after victory', !s.gameOver)

if (failed) { console.error(`OBJECTIVE TESTS FAILED (${failed})`); process.exit(1) }
console.log('ALL OBJECTIVE TESTS PASSED ✓')
