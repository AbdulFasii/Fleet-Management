/**
 * Cargo services are one-way: no 2nd trip.
 *
 *   - creating a freight service ignores a paired request
 *   - updateSchedule refuses to pair an existing cargo run
 *   - legacy saves that paired a cargo run get repaired (2nd trip removed and
 *     the phantom return departures closed)
 *
 *   npx tsx scripts/test-cargo-no-second-trip.ts
 */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { createSchedule, updateSchedule, unpairCargoSchedules } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { scheduleIsCargo } from '../src/engine/sim/schedules'
import { rs } from '../src/engine/core/money'
import type { Bus, GameState } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

function setup(): GameState {
  const s = newGame('Cargo One-Way', 'seth', 'mdu-koc', 4242)
  s.company.dedicatedCargoSubsidiary = true
  const bus: Bus = {
    id: 'truck1',
    reg: 'TN 59 C 1111',
    modelId: 'eicher_plus',
    status: 'active',
    odometerKm: 10000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4,
    seatCount: 0,
    acquisitionDay: 1,
    purchasePrice: 1800000,
    parkedCityId: 'mdu',
    fitnessExpiryDay: s.day + 365,
    insuranceExpiryDay: s.day + 365,
    permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365,
    pucExpiryDay: s.day + 365,
    tyreKm: 10000,
    engineOilKm: 10000,
    brakeOilKm: 10000,
    coolantKm: 10000,
    lastMajorServiceKm: 0,
    lifeTrips: 0,
  } as unknown as Bus
  s.buses[bus.id] = bus
  return s
}

const baseInput = () => ({
  routeId: 'mdu-koc',
  depHour: 22,
  depMin: 0 as const,
  baseFare: rs(700),
  autoPrice: true,
  cancellation: 'standard' as const,
  redDeal: false,
})

console.log('--- Cargo services never carry a 2nd trip ---')

// 1. Creating a cargo service ignores paired=true.
{
  const s = setup()
  const res = createSchedule(s, {
    ...baseInput(),
    paired: true,
    returnDepHour: 10,
    returnDepMin: 0,
    serviceKind: 'cargo',
  })
  assert(!('error' in res), 'cargo schedule should create')
  const sch = s.schedules[(res as { id: string }).id]!
  check(sch.paired !== true, 'paired flag is dropped on a cargo service')
  check(sch.returnDepHour === undefined, 'no 2nd departure hour is stored')
  check(sch.returnDepMin === undefined, 'no 2nd departure minute is stored')
  check(scheduleIsCargo(s, sch), 'the schedule is still recognised as cargo')
}

// 2. A passenger service can still be paired (no collateral damage).
{
  const s = setup()
  const res = createSchedule(s, {
    ...baseInput(),
    paired: true,
    serviceKind: 'passenger',
  })
  const sch = s.schedules[(res as { id: string }).id]!
  check(sch.paired === true && sch.returnDepHour !== undefined, 'passenger service still pairs normally')
}

// 3. updateSchedule refuses to pair an existing cargo run.
{
  const s = setup()
  const res = createSchedule(s, { ...baseInput(), serviceKind: 'cargo' })
  const id = (res as { id: string }).id
  s.schedules[id]!.busIds = ['truck1']
  const err = updateSchedule(s, id, { paired: true })
  check(Boolean(err), `pairing a cargo service is rejected (${err ?? 'no error'})`)
  check(s.schedules[id]!.paired !== true, 'cargo schedule stays unpaired after the rejected update')
}

// 4. The board only holds one departure per day for a cargo run.
{
  const s = setup()
  const res = createSchedule(s, { ...baseInput(), serviceKind: 'cargo' })
  const id = (res as { id: string }).id
  s.schedules[id]!.busIds = ['truck1']
  generateTrips(s)
  const open = Object.values(s.trips).filter((t) => t.scheduleId === id && t.status === 'open')
  const days = new Set(open.map((t) => t.day))
  check(open.every((t) => t.slot !== 2), 'no trip is generated for a 2nd-trip slot')
  check(open.length === days.size, `exactly one departure per day (${open.length} trips / ${days.size} days)`)
}

// 5. Legacy save repair: a paired cargo schedule loses its 2nd trip and the
//    phantom return departures close.
{
  const s = setup()
  const res = createSchedule(s, { ...baseInput(), serviceKind: 'passenger' })
  const id = (res as { id: string }).id
  const sch = s.schedules[id]!
  // Simulate a save written when cargo could be paired: mark it cargo + paired.
  sch.serviceKind = 'cargo'
  sch.paired = true
  sch.returnDepHour = 10
  sch.returnDepMin = 0
  sch.busIds = ['truck1']
  generateTrips(s)
  const beforeReturn = Object.values(s.trips).filter(
    (t) => t.scheduleId === id && t.status === 'open' && t.slot === 2,
  )
  check(beforeReturn.length > 0, `legacy save does hold 2nd-trip departures (${beforeReturn.length})`)

  const fixed = unpairCargoSchedules(s)
  generateTrips(s)
  check(fixed === 1, 'one paired cargo schedule was repaired')
  check(sch.paired !== true && sch.returnDepHour === undefined, '2nd trip removed from the schedule')
  const openAfter = Object.values(s.trips).filter((t) => t.scheduleId === id && t.status === 'open')
  const stillSlot2 = openAfter.filter((t) => t.slot === 2 || Boolean(t.pairOfTripId))
  check(stillSlot2.length === 0, 'no open departure keeps a 2nd-trip slot or pairing')
  const stillSecondClock = openAfter.filter((t) => t.depHour === 10)
  check(stillSecondClock.length === 0, 'no open departure keeps the old 2nd-trip clock (10:00)')
  const releasedTrips = beforeReturn.filter((t) => s.trips[t.id]?.status === 'cancelled')
  check(releasedTrips.length > 0, `phantom 2nd-trip departures are cancelled (${releasedTrips.length})`)
  const daysAfter = new Set(openAfter.map((t) => t.day))
  check(openAfter.length === daysAfter.size, 'rebuilt board has one departure per day')
}

// 6. Repair is a no-op when nothing is paired (idempotent on a clean save).
{
  const s = setup()
  createSchedule(s, { ...baseInput(), serviceKind: 'cargo' })
  check(unpairCargoSchedules(s) === 0, 'clean cargo save needs no repair')
  check(unpairCargoSchedules(s) === 0, 'second pass is still a no-op')
}

console.log(failures === 0 ? '\n--- ALL CARGO ONE-WAY CHECKS PASSED ---' : `\n--- ${failures} CARGO CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
