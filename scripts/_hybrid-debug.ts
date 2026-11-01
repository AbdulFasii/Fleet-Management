import { newGame } from '../src/engine/newGame'
import { createSchedule } from '../src/engine/sim/schedules'
import { generateTrips } from '../src/engine/sim/booking'
import { refreshMarkets } from '../src/engine/sim/fleet'
import { advanceDay } from '../src/engine/tick'
import { BUS_MODELS } from '../src/engine/data/busModels'
import type { GameState } from '../src/engine/types'

const routeId = 'mdu-maa'
const s: GameState = newGame('x', 'seth', routeId, 4242)
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
const res = createSchedule(s, { routeId, depHour: 21, depMin: 0, autoPrice: true, redDeal: false, cancellation: 'standard' } as never)
if ('error' in res) throw new Error(res.error)
s.schedules[res.id]!.busIds = ['b1']
generateTrips(s)
for (let i = 0; i < 10; i++) advanceDay(s)
for (const t of Object.values(s.trips).filter((x) => x.scheduleId === res.id && x.status === 'open')) {
  const live = t.seats.length > 0
  let slp = 0, slpCap = 0, str = 0, strCap = 0
  for (const seat of t.seats) {
    if (seat.zone === 'sleeper') { slpCap++; if (seat.sale) slp++ }
    else if (seat.zone === 'semi') { strCap++; if (seat.sale) str++ }
  }
  const markers = (t.seatSales ?? []).reduce<Record<string, number>>((a, r) => { a[r.id] = (a[r.id] ?? 0) + 1; return a }, {})
  console.log(`T-${t.day - s.day} sold=${t.sold}/${t.seatCount} live=${live} slp=${slp}/${slpCap} str=${str}/${strCap} rows=${JSON.stringify(markers)}`)
}
