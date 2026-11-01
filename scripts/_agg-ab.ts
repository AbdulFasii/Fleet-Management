/**
 * A/B harness: total hybrid zone occupancy at departure, for the aggregate
 * booking path vs the live per-seat walk (flip LIVE_SEAT_DAYS to compare).
 *
 *   npx tsx scripts/_agg-ab.ts
 */
import { newGame } from '../src/engine/newGame'
import { BUS_MODELS } from '../src/engine/data/busModels'
import { createSchedule } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { advanceDay } from '../src/engine/tick'
import { seatZoneOfId } from '../src/engine/sim/seatmap'
import { AGG_SEATER_SEAT, AGG_SLEEPER_SEAT } from '../src/engine/sim/seatstate'
import type { GameState } from '../src/engine/types'

const routeId = 'mdu-maa'
const N = 6
const s: GameState = newGame('x', 'seth', routeId, 4242)
refreshMarkets(s)
const model = BUS_MODELS['leyhybrid']!
const busIds: string[] = []
for (let i = 1; i <= N; i++) {
  const id = `b${i}`
  busIds.push(id)
  s.buses[id] = {
    id, reg: `TN 1 ${i}`, modelId: 'leyhybrid', status: 'active', odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2, seatCount: model.seats, acquisitionDay: 1, purchasePrice: 6500000, parkedCityId: 'mdu',
    fitnessExpiryDay: s.day + 365, insuranceExpiryDay: s.day + 365, permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365, pucExpiryDay: s.day + 365, tyreKm: 5000, engineOilKm: 5000,
    brakeOilKm: 5000, coolantKm: 5000, lastMajorServiceKm: 0, lifeTrips: 0,
  } as never
  s.staff[`d${i}`] = {
    id: `d${i}`, name: `D${i}`, role: 'driver', busId: id, salary: 2500000, skill: 8, safety: 8,
    morale: 85, loyalty: 85, experienceYears: 6, hiredDay: s.day, fatigue: 0, consecutiveDutyDays: 0,
    drivingStyle: 'cautious', licenceClass: 'HMV_PSV', safetyRecord: { accidents: 0, hardBrakes: 0, violations: 0 },
    cmvrHoursToday: 0, tripsDriven: 0,
  } as never
}
const res = createSchedule(s, { routeId, depHour: 21, depMin: 0, autoPrice: true, redDeal: false, cancellation: 'standard' } as never)
if ('error' in res) throw new Error(res.error)
s.schedules[res.id]!.busIds = busIds
generateTrips(s)

const zones = (t: any) => {
  let slp = 0
  let semi = 0
  if (t.seats.length > 0) {
    for (const seat of t.seats) {
      if (!seat.sale) continue
      if (seat.zone === 'sleeper') slp++
      else semi++
    }
    return { slp, semi }
  }
  for (const row of t.seatSales ?? []) {
    if (row.id === AGG_SLEEPER_SEAT || seatZoneOfId(model, row.id) === 'sleeper') slp++
    else semi++
  }
  return { slp, semi }
}

let slpSold = 0
let semiSold = 0
let capSold = 0
let trips = 0
for (let d = 0; d < 20; d++) {
  // departures leaving tomorrow, measured the morning before they leave
  const departing = Object.values(s.trips).filter(
    (t) => t.scheduleId === res.id && t.status === 'open' && t.day === s.day + 1,
  )
  for (const t of departing) {
    const z = zones(t)
    slpSold += z.slp
    semiSold += z.semi
    capSold += t.sold
    trips++
  }
  advanceDay(s)
}
const per = (n: number) => (trips ? (n / trips).toFixed(2) : '0')
console.log(
  `trips=${trips} berths/trip=${per(slpSold)} cabin/trip=${per(semiSold)} sold/trip=${per(capSold)}`
  + ` cabin%ofSold=${capSold ? ((semiSold / capSold) * 100).toFixed(1) : '0'}`,
)
