import { newGame } from '../src/engine/newGame'
import { createSchedule } from '../src/engine/sim/schedules'
import { buildBookingCtx, tripLoadFactor } from '../src/engine/sim/demand'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { BAL } from '../src/engine/data/balance'
import { BUS_MODELS } from '../src/engine/data/busModels'

function rig(routeId: string, depHour: number) {
  const s = newGame('x', 'seth', routeId, 4242)
  refreshMarkets(s)
  const model = BUS_MODELS['leyhybrid']!
  s.buses['b1'] = {
    id: 'b1', reg: 'TN 1', modelId: 'leyhybrid', status: 'active', odometerKm: 5000,
    condition: { engine: 90, gearbox: 90, suspension: 90, brakes: 90, body: 90, electrical: 90, ac: 90, tyres: 90 },
    qualityScore: 4.2, seatCount: model.seats, acquisitionDay: 1, purchasePrice: 6500000, parkedCityId: 'mdu',
    fitnessExpiryDay: s.day + 365, insuranceExpiryDay: s.day + 365, permitExpiryDay: s.day + 365,
    taxExpiryDay: s.day + 365, pucExpiryDay: s.day + 365, tyreKm: 5000, engineOilKm: 5000,
    brakeOilKm: 5000, coolantKm: 5000, lastMajorServiceKm: 0, lifeTrips: 0,
  } as never
  const res = createSchedule(s, { routeId, depHour, depMin: 0, autoPrice: true, redDeal: false, cancellation: 'standard' } as never)
  if ('error' in res) throw new Error(res.error)
  s.schedules[res.id]!.busIds = ['b1']
  generateTrips(s)
  const t = Object.values(s.trips).find((x) => x.scheduleId === res.id)!
  const est = tripLoadFactor(s, t, 5, buildBookingCtx(s))
  return {
    target: est.target,
    slp: est.hybrid?.sleeperTarget,
    str: est.hybrid?.seaterTarget,
    fare: t.fare, slpFare: t.fareSleeper, strFare: t.fareSeater,
  }
}

console.log('7-day curve:', JSON.stringify(rig('mdu-maa', 21)))
const oldCurve = [0.0203, 0.0292, 0.0358, 0.0394, 0.0425, 0.0461, 0.0489, 0.0497, 0.0481, 0.0451, 0.0417, 0.0388, 0.0369, 0.0359, 0.0355, 0.0354, 0.0353, 0.0349, 0.0342, 0.0332, 0.0317, 0.0300, 0.0281, 0.0259, 0.0236, 0.0213, 0.0189, 0.0166, 0.0144, 0.0123, 0.0104]
;(BAL as unknown as { bookingCurve: number[] }).bookingCurve = oldCurve
console.log('30-day curve:', JSON.stringify(rig('mdu-maa', 21)))
