/**
 * A paired service must put departures on sale in BOTH directions.
 *
 * Regression: a paired schedule whose return cleared midnight (the classic
 * 21:30 out / 21:00 back overnight run) placed both legs on the same calendar
 * day. One coach cannot fly both, the collision guard then dropped the
 * outbound, and the trip board showed a single bookable direction no matter
 * how many coaches were assigned.
 */
import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { advanceDay } from '../src/engine/tick'
import type { Bus, GameState, Trip } from '../src/engine/types'

function makeBus(s: GameState, id: string, modelId: string, city: string): Bus {
  const model = BUS_MODELS[modelId]!
  return {
    id,
    reg: `TN 32 C 000${id.slice(-1)}`,
    modelId,
    status: 'active',
    odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2,
    seatCount: model.seats,
    acquisitionDay: 1,
    purchasePrice: 6500000,
    parkedCityId: city,
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    tyreKm: 5000,
    engineOilKm: 5000,
    brakeOilKm: 5000,
    coolantKm: 5000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
  } as unknown as Bus
}

function addDriver(s: GameState, busId: string) {
  s.staff[`d_${busId}`] = {
    id: `d_${busId}`,
    name: `Driver ${busId}`,
    role: 'driver',
    busId,
    salary: 2500000,
    skill: 7,
    safety: 8,
    morale: 85,
    loyalty: 85,
    experienceYears: 5,
    hiredDay: s.day,
    fatigue: 0,
    consecutiveDutyDays: 0,
    drivingStyle: 'cautious',
    licenceClass: 'HMV_PSV',
    safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
    cmvrHoursToday: 0,
    tripsDriven: 0,
  } as never
}

function build(label: string, busCount: 1 | 2, depHour: number, retHour: number): { s: GameState; schId: string } {
  const s = newGame(label, 'seth', 'mdu-maa', 4242)
  refreshMarkets(s)
  s.buses['b1'] = makeBus(s, 'b1', 'bb1624', 'mdu')
  if (busCount === 2) s.buses['b2'] = makeBus(s, 'b2', 'bb1624', 'maa')
  for (const id of Object.keys(s.buses)) addDriver(s, id)
  const res = createSchedule(s, {
    routeId: 'mdu-maa',
    depHour,
    depMin: 0,
    paired: true,
    returnDepHour: retHour,
    returnDepMin: 0,
    autoPrice: true,
    redDeal: false,
    cancellation: 'standard',
  } as never)
  if ('error' in res) throw new Error(res.error)
  assignBus(s, res.id, 'b1')
  if (busCount === 2) assignBus(s, res.id, 'b2')
  return { s, schId: res.id }
}

function openTrips(s: GameState, schId: string): Trip[] {
  return Object.values(s.trips).filter((t) => t.scheduleId === schId && t.status === 'open' && t.day >= s.day)
}

function clocksOf(s: GameState, schId: string): Set<string> {
  return new Set(openTrips(s, schId).map((t) => `${t.direction}@${t.depHour}`))
}

function audit(s: GameState, schId: string, label: string, expectBothDirections: boolean) {
  const open = openTrips(s, schId)

  // A coach may run twice in a day (day trip out and back) but never two legs at once.
  const windows = new Map<string, Array<{ start: number; end: number }>>()
  for (const t of open) {
    const start = t.day * 1440 + t.depHour * 60 + (t.depMin ?? 0)
    const end = start + Math.round((ROUTES[t.routeId]?.hours ?? 8) * 60)
    const list = windows.get(t.busId) ?? []
    if (list.some((w) => start < w.end && w.start < end)) {
      throw new Error(`${label}: ${t.busId} is double-booked on ${t.day} (${t.direction} at ${t.depHour}:00)`)
    }
    list.push({ start, end })
    windows.set(t.busId, list)
  }

  const ab = open.filter((t) => t.direction === 'AB').length
  const ba = open.filter((t) => t.direction === 'BA').length

  if (expectBothDirections && (ab === 0 || ba === 0)) {
    throw new Error(`${label}: only one direction on sale (AB=${ab}, BA=${ba})`)
  }
  if (!expectBothDirections && Math.abs(ab - ba) > 1) {
    throw new Error(`${label}: single coach should alternate directions daily (AB=${ab}, BA=${ba})`)
  }
  return { ab, ba }
}

console.log('--- Paired services sell both directions ---')

// 1. Two coaches, overnight out-and-back at the same clock.
{
  const { s, schId } = build('two-coach overnight', 2, 21, 21)
  const { ab, ba } = audit(s, schId, 'two-coach overnight', true)
  console.log(`✓ two coaches, 21:00 ↔ 21:00: AB=${ab} BA=${ba} on sale`)
  // ...and still both directions after days roll (dispatch finishes yesterday's legs).
  for (let i = 0; i < 8; i++) advanceDay(s)
  const later = audit(s, schId, 'two-coach overnight (day 8)', true)
  console.log(`✓ after 8 days: AB=${later.ab} BA=${later.ba} still both directions`)
}

// 2. Early-morning return: each coach runs one round trip a day, so both
// directions sell twice a day (one departure per coach).
{
  const { s, schId } = build('two-coach 21:00/06:00', 2, 21, 6)
  const { ab, ba } = audit(s, schId, 'two-coach 21:00/06:00', true)
  const clocks = clocksOf(s, schId)
  if (!clocks.has('AB@21') || !clocks.has('BA@6')) {
    throw new Error(`expected outbound at 21:00 and return at 06:00, got ${[...clocks].join(', ')}`)
  }
  console.log(`✓ two coaches, 21:00 ↔ 06:00: AB=${ab} BA=${ba}, each way at its own clock`)
}

// 3. A single coach cannot be in two places: it alternates bases, one leg a day.
{
  const { s, schId } = build('single-coach overnight', 1, 21, 21)
  const { ab, ba } = audit(s, schId, 'single-coach overnight', false)
  console.log(`✓ single coach 21:00 ↔ 21:00 alternates bases (AB=${ab}, BA=${ba}) — assign a 2nd coach for daily both-ways`)
}

// 3b. An early-morning return still fits one round trip a day.
{
  const { s, schId } = build('single-coach early return', 1, 21, 6)
  const { ab, ba } = audit(s, schId, 'single-coach early return', true)
  const clocks = clocksOf(s, schId)
  if (!clocks.has('AB@21') || !clocks.has('BA@6')) {
    throw new Error(`expected outbound at 21:00 and return at 06:00, got ${[...clocks].join(', ')}`)
  }
  console.log(`✓ single coach 21:00 ↔ 06:00 round-trips daily (AB=${ab}, BA=${ba})`)
}

// 4. Day trip (return same day): the coach runs out and back, both slots used.
{
  const { s, schId } = build('two-coach day trip', 2, 9, 21)
  const { ab, ba } = audit(s, schId, 'two-coach day trip', true)
  console.log(`✓ two coaches, 09:00 ↔ 21:00: AB=${ab} BA=${ba} on sale`)
}

// 5. A legacy broken board (all down, no up) is rebuilt on the next pass.
{
  const { s, schId } = build('legacy repair', 2, 21, 21)
  for (const t of Object.values(s.trips)) {
    if (t.scheduleId !== schId) continue
    if (t.direction === 'AB' && t.busId === 'b2') delete s.trips[t.id]
    if (t.direction === 'AB' && t.busId === 'b1' && t.day !== s.day) delete s.trips[t.id]
  }
  s.openTripIds = Object.values(s.trips).filter((t) => t.status === 'open').map((t) => t.id)
  generateTrips(s)
  const { ab, ba } = audit(s, schId, 'legacy repair', true)
  console.log(`✓ legacy single-direction board healed: AB=${ab} BA=${ba}`)
}

console.log('\n--- ALL PAIRED DIRECTION CHECKS PASSED ---')
