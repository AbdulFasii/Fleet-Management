/**
 * "Recently run" table: freight-only departures must always sit below the
 * passenger rows, even when the cargo run happened on a more recent day.
 *
 *   npx tsx scripts/test-tripboard-cargo-below-pax.ts
 */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { isCargoTrip, sortRecentTrips } from '../src/ui/pages/TripBoard'
import type { GameState, Trip } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

function trip(id: string, routeId: string, day: number, depHour: number, scheduleId: string, direction: 'AB' | 'BA' = 'AB'): Trip {
  return {
    id,
    scheduleId,
    routeId,
    direction,
    busId: `bus_${scheduleId}`,
    day,
    depHour,
    depMin: 0,
    fare: 50000,
    seats: [],
    seatCount: 40,
    sold: 0,
    revenue: 0,
    cancelledRevenue: 0,
    channelSold: { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 },
    status: 'completed',
  } as unknown as Trip
}

function setup() {
  const s: GameState = newGame('Cargo Order Test', 'seth', 'mdu-maa', 777)
  // Passenger schedule (marked explicitly so bus lookup is never the deciding factor).
  s.schedules['pax'] = { id: 'pax', routeId: 'mdu-maa', busIds: [], depHour: 22, depMin: 0, serviceKind: 'passenger' } as never
  // Freight-only schedule.
  s.schedules['cargo'] = { id: 'cargo', routeId: 'mdu-maa', busIds: [], depHour: 22, depMin: 0, serviceKind: 'cargo' } as never
  // Older passenger schedule: proves day never lifts a cargo run above a pax run.
  s.schedules['pax_old'] = { id: 'pax_old', routeId: 'mdu-koc', busIds: [], depHour: 21, depMin: 0, serviceKind: 'passenger' } as never
  return s
}

console.log('--- Trip board: freight-only runs stay below passenger rows ---')

// 1. Cargo on the newest day still sorts last.
{
  const s = setup()
  const sorted = sortRecentTrips(s, [
    trip('c1', 'mdu-maa', 20, 22, 'cargo', 'BA'),
    trip('p1', 'mdu-maa', 20, 21, 'pax'),
    trip('p2', 'mdu-koc', 19, 21, 'pax_old'),
  ])
  const ids = sorted.map((t) => t.id)
  console.log(`    order: ${ids.join(', ')}`)
  check(ids.indexOf('c1') === 2, 'cargo 22:00 row sits last even though it ran today')
  check(isCargoTrip(s, sorted[2]!), 'cargo row is detected from its schedule')
  check(!isCargoTrip(s, sorted[0]!), 'passenger row is not flagged as cargo')
}

// 2. Many cargo rows: they keep their own newest-first ordering at the bottom.
{
  const s = setup()
  const sorted = sortRecentTrips(s, [
    trip('c_old', 'mdu-maa', 18, 22, 'cargo', 'BA'),
    trip('c_new', 'mdu-maa', 20, 22, 'cargo', 'BA'),
    trip('p_new', 'mdu-maa', 20, 21, 'pax'),
    trip('p_old', 'mdu-koc', 17, 21, 'pax_old'),
  ])
  const ids = sorted.map((t) => t.id)
  console.log(`    order: ${ids.join(', ')}`)
  check(ids[0] === 'p_new' && ids[1] === 'p_old', 'passenger rows come first, newest day first')
  check(ids[2] === 'c_new' && ids[3] === 'c_old', 'cargo rows follow, newest day first')
}

// 3. Only cargo runs: no separator is needed, ordering stays by day.
{
  const s = setup()
  const sorted = sortRecentTrips(s, [
    trip('c1', 'mdu-maa', 18, 22, 'cargo', 'BA'),
    trip('c2', 'mdu-maa', 20, 22, 'cargo', 'BA'),
  ])
  check(sorted.map((t) => t.id).join(',') === 'c2,c1', 'all-cargo table still sorts newest first')
}

// 4. A cargo truck on a schedule that is not flagged cargo is still caught.
{
  const s = setup()
  s.buses['bus_pax_old'] = { id: 'bus_pax_old', modelId: 'bolero_pikup' } as never
  const t = trip('p3', 'mdu-koc', 19, 21, 'pax_old')
  check(isCargoTrip(s, t), 'truck model on a passenger-labelled schedule counts as cargo')
  assert.equal(sortRecentTrips(s, [trip('p4', 'mdu-maa', 20, 21, 'pax'), t]).at(-1)!.id, 'p3')
}

console.log(failures === 0 ? '\n--- ALL TRIP BOARD ORDER CHECKS PASSED ---' : `\n--- ${failures} ORDER CHECK(S) FAILED ---`)
process.exit(failures === 0 ? 0 : 1)
