import { newGame } from '../src/engine/newGame'
import { advanceDay } from '../src/engine/tick'
import { createSchedule } from '../src/engine/sim/schedules'
import { BUS_MODELS, isCargoModel } from '../src/engine/data/busModels'
import * as staffing from '../src/engine/sim/staffing'

const s = newGame('Cargo Test', 'malik', 'blr-hyd', 123)
console.log('New game initialized, day:', s.day)

const cargoBusId = 'bus_cargo_1'
s.buses[cargoBusId] = {
  id: cargoBusId,
  reg: 'TN30 RK 7913',
  nickname: 'Bolero 1',
  modelId: 'mahindra_bolero_pikup_4t',
  ownership: 'owned',
  mfgYear: 2024,
  acquiredDay: s.day,
  acquiredPrice: 1000000,
  bookValue: 1000000,
  odometer: 1000,
  lastServiceOdo: 1000,
  lastMajorServiceOdo: 1000,
  tyreKm: 1000,
  condition: { engine: 100, gearbox: 100, suspension: 100, brakes: 100, electrical: 100, body: 100, ac: 100 },
  status: 'active',
  insuranceExpiryDay: s.day + 365,
  pucExpiryDay: s.day + 365,
  fitnessExpiryDay: s.day + 365,
  roadTaxExpiryDay: s.day + 365,
  depotId: 'depot-main',
  depotDistanceKm: 0,
}

const drvId = 'drv_cargo_1'
s.staff[drvId] = {
  id: drvId,
  name: 'Ramesh Cargo',
  role: 'driver',
  skill: 8,
  salary: 20000,
  hiredDay: s.day,
  morale: 100,
  stamina: 100,
  daysWithoutOff: 0,
  busId: cargoBusId,
}

const mgrId = 'mgr_cargo_1'
s.staff[mgrId] = {
  id: mgrId,
  name: 'Biju Sen',
  role: 'manager',
  skill: 10,
  salary: 35000,
  hiredDay: s.day,
  morale: 100,
  stamina: 100,
  daysWithoutOff: 0,
}
staffing.appointCargoManager(s, mgrId)
s.company.dedicatedCargoSubsidiary = true

s.permits['blr-hyd'] = { routeId: 'blr-hyd', status: 'active', appliedDay: s.day, approvedDay: s.day, renewsDay: s.day + 365, costPaise: 0 }
const schRes = createSchedule(s, {
  routeId: 'blr-hyd',
  depHour: 22,
  depMin: 0,
  busId: cargoBusId,
  active: true,
})
console.log('Schedule created result:', schRes)

advanceDay(s)
advanceDay(s)
advanceDay(s)

console.log('Total trips in s.trips:', Object.keys(s.trips).length)
console.log('Open trip IDs:', s.openTripIds.length)
for (const [id, t] of Object.entries(s.trips)) {
  console.log('Trip:', id, 'status:', t.status, 'day:', t.day, 'today is:', s.day)
}
