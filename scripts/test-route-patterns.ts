/**
 * Each route type has its own weekly and festival occupancy pattern instead
 * of the Chennai–Madurai one everywhere.
 */
import { getDirectionalOccupancyRange } from '../src/engine/data/balance'
import { corridorArchetype } from '../src/engine/data/routeArchetypes'
import { ROUTES } from '../src/engine/data/routes'
import { fromCivil, dow } from '../src/engine/core/calendar'
import { isHomebound } from '../src/engine/sim/corridor'

let failures = 0
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg) } else console.log('ok  ', msg) }

// Classification
check(corridorArchetype('maa-blr') === 'tech' && corridorArchetype('blr-maa') === 'tech', 'Chennai–Bengaluru is a tech corridor both ways')
check(corridorArchetype('maa-tir') === 'pilgrim', 'Chennai–Tirupati is a pilgrim corridor')
check(corridorArchetype('maa-goa') === 'leisure' && corridorArchetype('blr-pdy') === 'leisure', 'Goa and Puducherry are leisure corridors')
check(corridorArchetype('hyd-koc') === 'marathon' && corridorArchetype('blr-nag') === 'marathon', '13h+ hauls run as marathons')
check(corridorArchetype('blr-koc') === 'commercial' && corridorArchetype('koc-blr') === 'commercial', 'Bengaluru–Kochi is a hometown corridor in both id orders')

/** Mid-band occupancy for a 4.5★ sleeper, homebound or return. */
function mid(routeId: string, day: number, homebound: boolean): number {
  const r = ROUTES[routeId]!
  const dir: 'AB' | 'BA' = isHomebound(r, 'AB') === homebound ? 'AB' : 'BA'
  const [lo, hi] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, r, dir, day)
  return (lo + hi) / 2
}
let day = fromCivil(2025, 2, 3)
while (dow(day) !== 2) day++ // a February Tuesday
const tue = day
const fri = tue + 3
const sun = tue + 5
const diwali = fromCivil(2025, 11, 1)

const homeTown = 'blr-koc'
console.log(`     Tuesday return: hometown ${mid(homeTown, tue, false).toFixed(2)}, tech ${mid('blr-hyd', tue, false).toFixed(2)}, leisure ${mid('maa-pdy', tue, false).toFixed(2)}`)
check(mid('maa-pdy', tue, true) < mid(homeTown, tue, true) - 0.1, 'leisure corridors are quiet midweek')
check(mid('blr-hyd', tue, false) > mid(homeTown, tue, false), 'tech corridors stay busier midweek in both directions')
check(mid('maa-pdy', sun, false) > 0.9, 'leisure Sunday returns run near full')
check(mid('maa-pdy', fri, true) > mid('maa-pdy', fri, false) + 0.3, 'leisure Fridays are strongly one-way')
check(mid('hyd-koc', fri, true) < mid(homeTown, fri, true), 'marathon hauls feel the Friday rush less')
console.log(`     Diwali day: hometown ${mid(homeTown, diwali, true).toFixed(2)}, pilgrim ${mid('maa-tir', diwali, true).toFixed(2)}`)
check(mid('maa-tir', diwali, true) > mid(homeTown, diwali, true) + 0.15, 'pilgrims travel on the festival day itself')
check(mid('maa-tir', tue, true) < mid('maa-tir', fri, true), 'pilgrim corridors are weekend-heavy')

// Calibration anchor stays put
const r = ROUTES['maa-mdu']!
const hbDir: 'AB' | 'BA' = isHomebound(r, 'AB') ? 'AB' : 'BA'
const [fLo, fHi] = getDirectionalOccupancyRange('AC_SLEEPER', 4.5, r, hbDir, fri)
check(Math.abs(fLo - 0.80) < 1e-9 && Math.abs(fHi - 0.95) < 1e-9, 'Chennai–Madurai keeps its Friday 80-95% band')

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
