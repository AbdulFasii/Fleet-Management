/**
 * Mixed duty presets on an existing schedule: "Seasonal 1st + daily 2nd" and
 * "Daily 1st + seasonal 2nd" must survive updateSchedule (they used to be
 * flattened back to all-daily by the festivalOnly shortcut).
 *   npx tsx scripts/test-mixed-duty.ts
 */
import { newGame } from '../src/engine/newGame'
import { applySeasonalPermit, createSchedule, updateSchedule } from '../src/engine/sim/schedules'
import type { GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const s: GameState = newGame('Mixed', 'seth', 'blr-maa', 12345)
const routeId = 'blr-maa'
s.permits[routeId] = { routeId, status: 'active', appliedDay: s.day - 30, expiryDay: s.day + 335 }
applySeasonalPermit(s, routeId)
s.permits[routeId]!.seasonal!.status = 'active'
s.permits[routeId]!.seasonal!.expiryDay = s.day + 180

const res = createSchedule(s, {
  routeId,
  depHour: 20,
  baseFare: 80_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: true,
  returnDepHour: 9,
  returnDepMin: 30,
})
if ('error' in res) throw new Error(res.error)
const sch = s.schedules[res.id]!
check(sch.outboundDuty === 'daily' && sch.returnDuty === 'daily', 'starts all-daily')

// Option 3: Seasonal 1st + daily 2nd — exactly what the UI sends.
const e3 = updateSchedule(s, sch.id, { outboundDuty: 'festival', returnDuty: 'daily', festivalOnly: false })
check(e3 === null, `option 3 accepted${e3 ? ` (${e3})` : ''}`)
check(sch.outboundDuty === 'festival', `outbound duty persisted as festival (got ${sch.outboundDuty})`)
check(sch.returnDuty === 'daily', `return duty persisted as daily (got ${sch.returnDuty})`)
check(sch.festivalOnly === false, 'schedule is not all-festival')

// Option 4: Daily 1st + seasonal 2nd.
const e4 = updateSchedule(s, sch.id, { outboundDuty: 'daily', returnDuty: 'festival', festivalOnly: false })
check(e4 === null, `option 4 accepted${e4 ? ` (${e4})` : ''}`)
check(sch.outboundDuty === 'daily', `outbound duty persisted as daily (got ${sch.outboundDuty})`)
check(sch.returnDuty === 'festival', `return duty persisted as festival (got ${sch.returnDuty})`)
check(sch.festivalOnly === false, 'schedule is still not all-festival')

// Option 2: all-seasonal.
const e2 = updateSchedule(s, sch.id, { outboundDuty: 'festival', returnDuty: 'festival', festivalOnly: true })
check(e2 === null, 'option 2 accepted')
check(sch.outboundDuty === 'festival' && sch.returnDuty === 'festival' && sch.festivalOnly === true, 'all-seasonal persisted')

// Option 1: all-daily.
const e1 = updateSchedule(s, sch.id, { outboundDuty: 'daily', returnDuty: 'daily', festivalOnly: false })
check(e1 === null, 'option 1 accepted')
check(sch.outboundDuty === 'daily' && sch.returnDuty === 'daily' && sch.festivalOnly === false, 'all-daily persisted')

// The festivalOnly shortcut on its own still works (used by other callers).
updateSchedule(s, sch.id, { festivalOnly: true })
check(sch.outboundDuty === 'festival' && sch.returnDuty === 'festival', 'festivalOnly alone still sets both legs')
updateSchedule(s, sch.id, { festivalOnly: false })
check(sch.outboundDuty === 'daily' && sch.returnDuty === 'daily', 'festivalOnly:false alone still clears both legs')

// Without a seasonal permit the mixed option is refused, not silently applied.
const s2 = newGame('NoPermit', 'seth', 'blr-maa', 999)
const res2 = createSchedule(s2, {
  routeId,
  depHour: 20,
  baseFare: 80_000,
  autoPrice: true,
  cancellation: 'standard',
  redDeal: false,
  paired: true,
  returnDepHour: 9,
})
if ('error' in res2) throw new Error(res2.error)
const sch2 = s2.schedules[res2.id]!
const err = updateSchedule(s2, sch2.id, { outboundDuty: 'daily', returnDuty: 'festival', festivalOnly: false })
check(err !== null, 'no seasonal permit -> mixed option refused')
check(sch2.outboundDuty === 'daily' && sch2.returnDuty === 'daily', 'and the schedule is left all-daily')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
