/**
 * Festival service hold: scheduled coaches are never pulled into the workshop on
 * festival dates — the service stays due and they keep earning. Bookings open again
 * 3 days after the festival window closes.
 *   npx tsx scripts/test-festival-service-deferral.ts
 */
import { newGame } from '../src/engine/newGame'
import { createSchedule, assignBus } from '../src/engine/sim/schedules'
import { fromCivil, isFestivalDay } from '../src/engine/core/calendar'
import { BAL } from '../src/engine/data/balance'
import {
  dailyMaintenancePass,
  serviceBus,
  serviceDeferredForBus,
  serviceHoldActive,
  serviceResumeDay,
  serviceDueKm,
  FESTIVAL_SERVICE_COOLDOWN_DAYS,
} from '../src/engine/sim/maintenance'
import { BUS_MODELS, cargoVolumeForSeats, isCargoModel } from '../src/engine/data/busModels'
import { ROUTES } from '../src/engine/data/routes'
import { rs } from '../src/engine/core/money'
import type { Bus, GameState, Staff } from '../src/engine/types'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

const s: GameState = newGame('Festival', 'seth', 'blr-hyd', 4242)
s.company.cash = 50_000_000_00

let seq = 0
function addCoach(): string {
  const modelId = 'bb1824'
  const model = BUS_MODELS[modelId]!
  const id = `coach${seq}`
  const bus: Bus = {
    id,
    reg: `TN33 FS ${1000 + seq}`,
    nickname: model.name,
    modelId,
    ownership: 'owned',
    mfgYear: 2023,
    acquiredDay: s.day,
    acquiredPrice: rs(2_000_000),
    bookValue: rs(2_000_000),
    odometer: 30_000,
    condition: { engine: 92, gearbox: 92, brakes: 92, suspension: 92, ac: 92, electrical: 92, body: 92 },
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
    qualityScore: 3.6,
    insuranceExpiryDay: s.day + 400,
    fitnessExpiryDay: s.day + 400,
    pucExpiryDay: s.day + 200,
    roadTaxPayableDay: s.day + 200,
    aitpPaidUntilDay: s.day + 200,
    gpsDeviceFitted: true,
    lastServiceOdo: 20_000,
    cargoVolumeCbm: model.cargoVolumeCbm ?? cargoVolumeForSeats(model.seats),
    parkedCityId: ROUTES['blr-hyd']!.from,
  }
  s.buses[id] = bus
  seq++
  return id
}

// --- workshop + manager so the auto-pass can book jobs ----------------------
const manager: Staff = {
  id: 'mgr', name: 'Workshop Manager', role: 'manager', skill: 7, experienceYears: 10,
  salary: 6_000_000, loyalty: 80, morale: 80, fatigue: 0, safety: 8, hiredDay: s.day,
}
s.staff[manager.id] = manager
const mechanic: Staff = {
  id: 'mech', name: 'Bay Mechanic', role: 'mechanic', skill: 8, experienceYears: 8,
  salary: 3_000_000, loyalty: 80, morale: 80, fatigue: 0, safety: 7, hiredDay: s.day,
  mechanicTrade: 'general',
}
s.staff[mechanic.id] = mechanic
s.workshop.level = 1
s.workshop.bays = 1
s.workshop.managerId = manager.id
s.workshop.mechanicIds = [mechanic.id]

// --- a scheduled coach and an idle one, both overdue for an A-service ------
const lineId = addCoach()
const idleId = addCoach()
const made = createSchedule(s, {
  routeId: 'blr-hyd', depHour: 9, depMin: 0, baseFare: rs(1050), autoPrice: true,
  cancellation: 'standard', redDeal: false,
})
if ('error' in made) throw new Error(made.error)
const schedErr = assignBus(s, made.id, lineId)
if (schedErr) throw new Error(schedErr)
const line = s.buses[lineId]!
const idle = s.buses[idleId]!
for (const b of [line, idle]) {
  b.odometer = b.lastServiceOdo + BAL.serviceTiers.a.intervalKm + 3_000
}
if (serviceDueKm(line) <= 0 || serviceDueKm(idle) <= 0) throw new Error('setup: buses should be overdue')

// --- window geometry ------------------------------------------------------
const fest = fromCivil(2026, 8, 14) // Independence Day
if (!isFestivalDay(fest)) throw new Error('setup: expected Aug 14 2026 to be a festival day')
let start = fest
while (isFestivalDay(start - 1)) start--
let end = fest
while (isFestivalDay(end + 1)) end++
console.log(`\nFestival window: day ${start}..${end} (ends day ${end})`)
check(end >= fest, 'window contains the festival day')
check(!isFestivalDay(end + 1), 'window end is the last festival day')
check(serviceResumeDay(end) === end + FESTIVAL_SERVICE_COOLDOWN_DAYS + 1, 'work resumes 3 days after the window ends')

// --- during the festival -------------------------------------------------
s.day = fest
check(serviceHoldActive(s.day), 'hold is active on the festival day')
check(serviceDeferredForBus(s, line), 'scheduled coach is held out of the workshop')
check(!serviceDeferredForBus(s, idle), 'idle coach is not held')

const before = line.lastServiceOdo
const errHold = serviceBus(s, lineId, 'a')
check(typeof errHold === 'string' && /deferred/i.test(errHold), 'manual booking is refused with a deferral message')
check(line.status === 'active', 'scheduled coach stays active (no workshop downtime)')
check(line.lastServiceOdo === before, 'service interval left untouched — service stays due')
check(serviceDueKm(line) > 0, 'service still reads as due/overdue during the hold')

const idleErr = serviceBus(s, idleId, 'a')
check(idleErr === null, 'idle coach can still be serviced during the festival')
check(idle.status === 'workshop', 'idle coach goes into the workshop as usual')

// release the idle coach so it does not occupy the only bay
idle.status = 'active'
idle.workshopUntilDay = undefined
idle.workshopJob = undefined

// --- auto pass must not book the scheduled coach on festival dates --------
dailyMaintenancePass(s)
check(line.status === 'active', 'workshop manager auto-pass leaves the scheduled coach running on a festival day')
check(line.lastServiceOdo === before, 'auto-pass did not apply a service')

// --- still held through the 3-day cooldown --------------------------------
for (let d = end; d <= end + FESTIVAL_SERVICE_COOLDOWN_DAYS; d++) {
  s.day = d
  dailyMaintenancePass(s)
  check(line.status === 'active', `day ${d} (festival end + ${d - end}): scheduled coach still on the road`)
}

// --- resumes after the cooldown -------------------------------------------
const resume = end + FESTIVAL_SERVICE_COOLDOWN_DAYS + 1
s.day = resume
check(!serviceDeferredForBus(s, line), 'hold lifted 3 days after the festival ends')
dailyMaintenancePass(s)
check(line.status === 'workshop', 'workshop manager books the overdue service once the hold lifts')
check(line.lastServiceOdo > before, 'service applied after the hold')

console.log('\n======================================================')
if (failures === 0) {
  console.log('🎉 FESTIVAL SERVICE DEFERRAL TESTS PASSED!')
} else {
  console.log(`❌ ${failures} CHECK(S) FAILED`)
  process.exitCode = 1
}
console.log('======================================================')
