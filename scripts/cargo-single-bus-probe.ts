/**
 * One vehicle, both directions? Reproduce the "single cargo truck departs up
 * and down at the same clock" report across the flows a player can take when
 * replacing a vehicle, and verify the repair pass + collision guard.
 *   npx tsx scripts/cargo-single-bus-probe.ts
 */
import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { BUS_MODELS, cargoVolumeForSeats, isCargoModel } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { rs } from '../src/engine/core/money'
import { openCargoPermit } from '../src/engine/sim/cargo'
import { assignBus, createSchedule, sanitizeScheduleAssignments, unassignBus, updateSchedule } from '../src/engine/sim/schedules'
import { appointCargoManager } from '../src/engine/sim/staffing'
import { sellBus } from '../src/engine/sim/fleet'
import { generateTrips } from '../src/engine/sim/booking'
import type { Bus, GameState, Staff } from '../src/engine/types'

let n = 0
function fresh(label: string): GameState {
  const s = newGame(label, 'seth', 'maa-blr', 42)
  s.company.cash = 80_000_000_00
  s.company.dedicatedCargoSubsidiary = true
  const mgr: Staff = {
    id: 'mgr1', name: 'Biju Sen', role: 'manager', skill: 8, experienceYears: 6,
    salary: 3500000, loyalty: 80, morale: 80, fatigue: 10, safety: 7, hiredDay: s.day,
  }
  s.staff[mgr.id] = mgr
  appointCargoManager(s, mgr.id)
  openCargoPermit(s, 'maa-blr')
  s.permits['blr-maa'] = JSON.parse(JSON.stringify(s.permits['maa-blr']))
  return s
}

function addBus(s: GameState, modelId: string, reg: string): string {
  const model = BUS_MODELS[modelId]!
  const id = reg.toLowerCase().replace(/\s+/g, '')
  const bus: Bus = {
    id,
    reg,
    nickname: model.name,
    modelId,
    ownership: 'owned',
    mfgYear: 2022,
    acquiredDay: s.day,
    acquiredPrice: rs(2_000_000),
    bookValue: rs(2_000_000),
    odometer: 40_000,
    condition: { engine: 95, gearbox: 95, brakes: 95, suspension: 95, ac: 95, electrical: 95, body: 95 },
    tyreKm: 8_000,
    frontTyreKm: 8_000,
    rearTyreKm: 8_000,
    tyresRetreaded: false,
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: isCargoModel(modelId) ? 10 : 6,
    status: 'active',
    duty: 'line',
    accidentHistory: false,
    busCleanliness: 90,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: 4,
    insuranceExpiryDay: s.day + 400,
    fitnessExpiryDay: s.day + 400,
    pucExpiryDay: s.day + 200,
    roadTaxPayableDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200,
    gpsDeviceFitted: true,
    lastServiceOdo: 30_000,
    cargoVolumeCbm: model.cargoVolumeCbm ?? cargoVolumeForSeats(model.seats),
    parkedCityId: ROUTES['maa-blr']!.from,
  }
  s.buses[id] = bus
  const drv: Staff = {
    id: `drv${n++}`, name: `Driver ${n}`, role: 'driver', skill: 7, experienceYears: 8,
    salary: 2800000, loyalty: 70, morale: 80, fatigue: 5, safety: 7, hiredDay: s.day,
    busId: id, duty: 'line', licenceClass: 'HMV_HP',
  }
  s.staff[drv.id] = drv
  return id
}

function makeSchedule(s: GameState, routeId: string, paired: boolean, hour = 23): string {
  const made = createSchedule(s, {
    routeId,
    depHour: hour,
    depMin: 0,
    baseFare: rs(5.65),
    autoPrice: false,
    cancellation: 'standard',
    channels: { redbus: false, abhibus: false, ownapp: false, counter: false },
    redDeal: false,
    paired,
    serviceKind: 'cargo',
  })
  if ('error' in made) throw new Error(made.error)
  return made.id
}

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

/** Same vehicle booked for two departures that overlap in time. */
function doubleBooked(s: GameState): string[] {
  const clashes: string[] = []
  const rows = Object.values(s.trips).filter((t) => t.status === 'open')
  for (const a of rows) {
    const ra = ROUTES[a.routeId]
    const aStart = a.day * 1440 + a.depHour * 60 + (a.depMin ?? 0)
    const aEnd = aStart + Math.round((ra?.hours ?? 6) * 60)
    for (const b of rows) {
      if (a.id >= b.id || a.busId !== b.busId) continue
      const rb = ROUTES[b.routeId]
      const bStart = b.day * 1440 + b.depHour * 60 + (b.depMin ?? 0)
      const bEnd = bStart + Math.round((rb?.hours ?? 6) * 60)
      if (aStart < bEnd && bStart < aEnd) {
        clashes.push(`${s.buses[a.busId]?.reg ?? a.busId}: ${a.routeId}/${a.direction}@${a.day} ${a.depHour} vs ${b.routeId}/${b.direction}@${b.day} ${b.depHour}`)
      }
    }
  }
  return clashes
}

// A · paired freight service, one truck from the start: up tonight, back tomorrow.
{
  const s = fresh('A')
  const truck = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const schId = makeSchedule(s, 'maa-blr', true)
  console.log('\nA · one truck on a paired freight service:', assignBus(s, schId, truck))
  const rows = Object.values(s.trips).filter((t) => t.scheduleId === schId).slice(0, 4)
  for (const t of rows) console.log(`   day ${t.day} ${t.direction} ${t.depHour}:${String(t.depMin ?? 0).padStart(2, '0')} ${t.status}`)
  check(doubleBooked(s).length === 0, 'truck is never double-booked')
}

// B · replacing the second truck on a two-truck paired service.
{
  const s = fresh('B')
  const a = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const b = addBus(s, 'eicher_plus', 'TN31 NM 0001')
  const c = addBus(s, 'eicher_pro', 'TN31 NM 7777')
  const schId = makeSchedule(s, 'maa-blr', true)
  assignBus(s, schId, a)
  assignBus(s, schId, b)
  console.log('\nB · unassign old truck:', unassignBus(s, schId, b))
  console.log('B · assign replacement:', assignBus(s, schId, c))
  check(doubleBooked(s).length === 0, 'two trucks, both directions, no clash')
  check(s.schedules[schId]!.busIds.length === 2, 'schedule still runs 2 trucks')
}

// C · the old bug: the same truck ends up on two 23:00 services (up + down).
{
  const s = fresh('C')
  const truck = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const up = makeSchedule(s, 'maa-blr', false)
  const down = makeSchedule(s, 'blr-maa', false)
  assignBus(s, up, truck)
  // Legacy save shape: the truck was loaded into the return service too.
  s.schedules[down]!.busIds.push(truck)
  generateTrips(s)
  const truckTrips = Object.values(s.trips).filter((t) => t.busId === truck && t.status === 'open')
  const firstDay = Math.min(...truckTrips.map((t) => t.day))
  const sameDay = truckTrips.filter((t) => t.day === firstDay)
  const dirs = new Set(sameDay.map((t) => t.direction))
  console.log(`\nC · corrupt save, day ${firstDay}: ${sameDay.length} live departure(s) across ${dirs.size} direction(s)`)
  check(sameDay.length === 1, 'collision guard allows the truck only one departure that day')
  check(doubleBooked(s).length === 0, 'collision guard blocks the second 23:00 departure')

  const fixed = sanitizeScheduleAssignments(s)
  console.log(`   repair fixes: ${fixed}`)
  check(s.schedules[down]!.busIds.length === 0, 'return service released the shared truck')
  check(s.schedules[up]!.busIds.includes(truck), 'original service keeps the truck')
  check(s.buses[truck]!.scheduleId === up, 'bus points at the service it actually runs')
  const ghosts = Object.values(s.trips).filter((t) => t.status === 'open' && t.busId === truck && t.scheduleId === down)
  check(ghosts.length === 0, 'un-run return departures cancelled')
  check(doubleBooked(s).length === 0, 'still no double booking after repair')
  check(sanitizeScheduleAssignments(s) === 0, 'repair is idempotent')
}

// D · duplicated bus id inside one schedule (legacy two-dropdown editor).
{
  const s = fresh('D')
  const truck = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const schId = makeSchedule(s, 'maa-blr', false)
  assignBus(s, schId, truck)
  s.schedules[schId]!.busIds.push(truck)
  generateTrips(s)
  const fixed = sanitizeScheduleAssignments(s)
  console.log(`\nD · duplicated vehicle in one service, fixes: ${fixed}`)
  check(s.schedules[schId]!.busIds.length === 1, 'duplicate slot dropped')
  check(doubleBooked(s).length === 0, 'one direction per day again')
}

// E · normal two-truck paired service keeps running both ways every day.
{
  const s = fresh('E')
  const a = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const b = addBus(s, 'eicher_plus', 'TN31 NM 0001')
  const schId = makeSchedule(s, 'maa-blr', true)
  assignBus(s, schId, a)
  assignBus(s, schId, b)
  const day = s.day + 1
  const rows = Object.values(s.trips).filter((t) => t.scheduleId === schId && t.day === day && t.status === 'open')
  const ab = rows.filter((t) => t.direction === 'AB')
  const ba = rows.filter((t) => t.direction === 'BA')
  console.log(`\nE · two trucks paired on day ${day}: AB=${ab.length} BA=${ba.length}`)
  check(ab.length === 2 && ba.length === 2, 'each truck runs a round trip (out + back) on the day')
  check(ab.some((t) => t.depHour === 23) && ba.some((t) => t.depHour === 23), 'both directions depart at the schedule clock')
  check(new Set(rows.map((t) => t.busId)).size === 2, 'the two departures at the clock use different trucks')
  check(doubleBooked(s).length === 0, 'no double booking')
}

// F · selling a truck and running a few days must not leave ghost departures.
{
  const s = fresh('F')
  const a = addBus(s, 'eicher_plus', 'TN31 NM 3817')
  const b = addBus(s, 'eicher_plus', 'TN31 NM 0001')
  const schId = makeSchedule(s, 'maa-blr', true)
  assignBus(s, schId, a)
  assignBus(s, schId, b)
  console.log('\nF · sell second truck:', sellBus(s, b))
  const c = addBus(s, 'eicher_plus', 'TN31 NM 7777')
  console.log('F · assign replacement:', assignBus(s, schId, c))
  for (let i = 0; i < 4; i++) advanceDay(s)
  check(doubleBooked(s).length === 0, 'four days after replacing, still no double booking')
  check(s.schedules[schId]!.busIds.length === 2, 'replacement truck is on the service')
  const ghost = Object.values(s.trips).filter((t) => t.status === 'open' && t.busId === b)
  check(ghost.length === 0, 'sold truck has no live departures')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
void updateSchedule
