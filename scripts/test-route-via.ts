/**
 * Corridor "via" cities and haul headlines.
 *   npx tsx scripts/test-route-via.ts
 */
import {
  ROUTE_LIST,
  ROUTES,
  routeViaCities,
  routeViaNames,
  routeViaLabel,
  routeJourney,
  haulStyle,
  haulTitle,
  haulBrief,
  displayRouteHours,
} from '../src/engine/data/routes'
import { CITIES } from '../src/engine/data/cities'

let failures = 0
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
  if (!ok) failures++
}

console.log('\nVia data integrity')
const allVia = ROUTE_LIST.flatMap((r) => routeViaCities(r.id))
check(allVia.length > 0, 'some corridors carry via cities')
check(
  allVia.every((id) => !!CITIES[id]),
  'every via city exists in the network city list',
)
let endpointLeak = false
let dupes = false
for (const r of ROUTE_LIST) {
  const via = routeViaCities(r.id)
  if (via.includes(r.from) || via.includes(r.to)) endpointLeak = true
  if (new Set(via).size !== via.length) dupes = true
}
check(!endpointLeak, 'a via city is never one of the corridor endpoints')
check(!dupes, 'no duplicate cities inside a via list')

console.log('\nDirection handling')
check(
  routeViaNames('maa-mdu').join() === [...routeViaNames('mdu-maa')].reverse().join(),
  'mirrored corridor lists the same cities in travel order',
)
check(
  routeViaNames('mdu-maa').join(',') === 'Tiruchirappalli',
  'Madurai → Chennai runs via Tiruchirappalli',
)
check(
  routeViaNames('maa-mdu-ecr').join(',') === 'Puducherry,Thanjavur',
  'Chennai → Madurai ECR runs via Puducherry and Thanjavur',
)
check(
  routeViaNames('mdu-maa-ecr').join(',') === 'Thanjavur,Puducherry',
  'Madurai → Chennai ECR flips the via list',
)
check(
  routeViaNames('maa-rmd').join(',') === 'Thanjavur',
  'Chennai → Ramanathapuram runs via Thanjavur',
)
check(
  routeViaNames('maa-tvr').join(',') === 'Puducherry',
  'Chennai → Thiruvarur runs via Puducherry',
)

console.log('\nUser examples')
check(
  routeViaNames('maa-koc').includes('Coimbatore'),
  'Chennai → Kochi shows Coimbatore on the way',
)
check(
  routeViaNames('koc-blr').join(',') === 'Thrissur,Coimbatore,Salem',
  'Kochi → Bengaluru runs via Thrissur, Coimbatore, Salem',
)
check(
  routeViaNames('maa-trv').join(',') === 'Tiruchirappalli,Madurai,Tirunelveli',
  'Chennai → Thiruvananthapuram shows Trichy and Madurai',
)
check(routeViaLabel('maa-trv')!.startsWith('via '), 'the label is prefixed with "via"')
check(routeJourney('maa-trv').includes('via Tiruchirappalli'), 'journey line embeds the via list')
check(routeViaLabel('maa-blr') === null, 'a direct corridor has no via label')

console.log('\nHaul headlines')
check(haulTitle(ROUTES['maa-pdy']!) === 'Day hop', '4h corridor reads as a day hop')
check(haulTitle(ROUTES['blr-tir']!) === 'Mid-haul', '6h corridor sits on the mid-haul side')
check(haulTitle(ROUTES['blr-maa'] ?? ROUTES['maa-blr']!) === 'Mid-haul', '7h corridor reads as a mid-haul')
check(haulTitle(ROUTES['maa-mdu']!) === 'Night haul', '8h corridor reads as a night haul')
check(haulTitle(ROUTES['blr-hyd']!) === 'Night haul', '10h corridor is still a night haul')
check(haulTitle(ROUTES['maa-trv']!) === 'Marathon night haul', '14h corridor reads as a marathon night haul')
check(haulStyle(ROUTES['maa-viz']!) === 'marathon', '15h coastal haul is a marathon')
check(haulStyle(ROUTES['hyd-cbe']!) === 'marathon', '16h is still marathon (band ends at 16)')
check(haulStyle(ROUTES['blr-mum']!) === 'ultra', '19h is ultra marathon')
check(haulStyle(ROUTES['maa-mdu']!) === 'overnight', '8h stays a night haul (not a marathon)')
check(haulStyle(ROUTES['maa-blr']!) === 'mid', '7h stays mid-haul')
check(haulStyle(ROUTES['blr-pkd']!) === 'overnight', '8h blr-pkd is a night haul')
check(displayRouteHours(ROUTES['maa-viz']!.hours) === 15, 'sanity: display hours are numeric')

const briefs = ROUTE_LIST.map((r) => haulBrief(r))
check(briefs.every((b) => b.length > 40), 'every corridor has a real haul description')
check(
  haulBrief(ROUTES['maa-trv']!).includes('two drivers'),
  'marathon brief explains the two-driver rule',
)
check(
  /20:00–23:30/.test(haulBrief(ROUTES['maa-cbe']!)),
  'night-haul brief names the prime departure window',
)
check(
  haulBrief(ROUTES['maa-pdy']!).toLowerCase().includes('day hop'),
  'day-hop brief names its own haul type',
)

console.log('\n======================================================')
if (failures === 0) {
  console.log('🎉 ROUTE VIA & HAUL TESTS PASSED!')
} else {
  console.log(`❌ ${failures} CHECK(S) FAILED`)
  process.exitCode = 1
}
console.log('======================================================')
