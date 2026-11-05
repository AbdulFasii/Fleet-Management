/**
 * Step 2 timing rules: normal departures sell late inside the 7-day board,
 * festival surge departures open part-sold and book early, and parcels build
 * up before festivals and dip on the day.
 */
import { BAL, elapsedBookingFrac } from '../src/engine/data/balance'
import { ROUTES } from '../src/engine/data/routes'
import { fromCivil, dow } from '../src/engine/core/calendar'
import { festivalPreSoldShare, isHomebound } from '../src/engine/sim/corridor'
import { cargoFestivalMult } from '../src/engine/sim/cargo'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

// Normal curve, 7-day window
check(BAL.bookingWindowDays === 7, 'booking window stays at 7 days')
const lastTwo = 1 - elapsedBookingFrac(1) // share sold on T-1 and day-of
const firstDay = elapsedBookingFrac(6) // already sold before T-6 = the T-7 opening slice
console.log(`     normal trip: ${(firstDay * 100).toFixed(0)}% on opening day, ${(lastTwo * 100).toFixed(0)}% in the last day and a half`)
check(lastTwo >= 0.35 && lastTwo <= 0.45, 'about 35-45% of seats sell on T-1 and day-of')
check(firstDay >= 0.08 && firstDay <= 0.12, 'about 10% sell when the board opens')
check(elapsedBookingFrac(7) === 0 && Math.abs(elapsedBookingFrac(-1) - 1) < 1e-9, 'nothing before the board opens, everything by departure')

// Festival surge departures
const route = ROUTES['maa-mdu']!
const homebound: 'AB' | 'BA' = isHomebound(route, 'AB') ? 'AB' : 'BA'
const returning: 'AB' | 'BA' = homebound === 'AB' ? 'BA' : 'AB'
const diwali = fromCivil(2025, 11, 1)
const preSoldDiwali = festivalPreSoldShare(route, homebound, diwali - 2)
const preSoldRepublic = festivalPreSoldShare(route, homebound, fromCivil(2025, 1, 26) - 2)
console.log(`     pre-sold before the board opens: Diwali ${preSoldDiwali}, Republic Day ${preSoldRepublic}`)
check(preSoldDiwali !== undefined && Math.abs(preSoldDiwali - BAL.festivalPreSoldMax) < 1e-9, 'Diwali homebound trips open with the most pre-sold')
check(preSoldRepublic !== undefined && preSoldRepublic < preSoldDiwali!, 'smaller festivals pre-sell less')
check(festivalPreSoldShare(route, returning, diwali - 2) === undefined, 'the return direction before a festival is a normal trip')
check(festivalPreSoldShare(route, returning, diwali + 2) !== undefined, 'the return direction after a festival surges')
let quiet = fromCivil(2025, 2, 11)
while (dow(quiet) !== 2) quiet++
check(festivalPreSoldShare(route, homebound, quiet) === undefined, 'a February Tuesday is a normal trip')
const p = preSoldDiwali!
check(Math.abs(elapsedBookingFrac(7, p) - p) < 1e-9, 'a festival trip opens with its pre-sold block on the book')
check(elapsedBookingFrac(4, p) > elapsedBookingFrac(4), 'festival trips are further along than normal trips at every point')
check(1 - elapsedBookingFrac(1, p) < 0.10, 'festival trips have little left for the last day and a half')

// Cargo around festivals
const lead = (o: number) => cargoFestivalMult(diwali + o)
console.log(`     Diwali parcels: D-14 x${lead(-14).toFixed(2)}, D-3 x${lead(-3).toFixed(2)}, day-of x${lead(0).toFixed(2)}, D+1 x${lead(1).toFixed(2)}`)
check(lead(-3) > lead(-14) && lead(-14) > 1, 'parcels build up through the weeks before Diwali')
check(Math.abs(lead(-3) - (1 + BAL.cargoFestival.liftMax)) < 1e-9, 'the last days before Diwali carry the full lift')
check(Math.abs(lead(0) - BAL.cargoFestival.dayOf) < 1e-9, 'markets close on the festival day')
check(lead(1) < 1 && lead(1) > lead(0), 'slow for a couple of days after')
const rep = fromCivil(2025, 1, 26)
check(cargoFestivalMult(rep - 3) < lead(-3), 'a small festival lifts parcels less than Diwali')
check(cargoFestivalMult(quiet) === 1, 'no festival nearby, no change')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
