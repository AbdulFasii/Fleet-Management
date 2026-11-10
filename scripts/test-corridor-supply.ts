/**
 * Every route (aliases included) must resolve to a real corridor-supply row,
 * and the derived numbers must stay in a believable range.
 */
import { ROUTES } from '../src/engine/data/routes'
import { CORRIDOR_SUPPLY, MIN_DEPARTURES, corridorSupply, realPaxPerDay, realParcelKgPerDay } from '../src/engine/data/corridorSupply'

let failures = 0
const fail = (msg: string) => { failures++; console.error('FAIL', msg) }

const rows = new Set<string>()
for (const [id, route] of Object.entries(ROUTES)) {
  const direct = CORRIDOR_SUPPLY[id]
  const resolved = corridorSupply(id)
  const row = direct ? id : Object.keys(CORRIDOR_SUPPLY).find((k) => CORRIDOR_SUPPLY[k] === resolved)
  if (!row) { fail(`${id} (${route.from}-${route.to}) falls back to the default row`); continue }
  rows.add(row)
  const c = resolved
  if (c.departures < MIN_DEPARTURES || c.departures > 500) fail(`${id} departures ${c.departures} out of range`)
  if (c.parcelKgPerBus < 100 || c.parcelKgPerBus > 500) fail(`${id} parcel kg/bus ${c.parcelKgPerBus} out of range`)
}

for (const id of Object.keys(CORRIDOR_SUPPLY)) {
  if (!ROUTES[id]) fail(`table row ${id} has no matching route`)
}

// Long marathons must be thinner than the metro pairs they compete with.
if (realPaxPerDay('maa-goa') >= realPaxPerDay('maa-blr') / 10) fail('Chennai–Goa should be far thinner than Chennai–Bengaluru')
if (realPaxPerDay('blr-maa') !== realPaxPerDay('maa-blr')) fail('alias blr-maa must match maa-blr')

console.log(`routes checked: ${Object.keys(ROUTES).length}, table rows used: ${rows.size}`)
const sample = ['maa-blr', 'blr-hyd', 'maa-mdu', 'mum-idr', 'maa-goa', 'mys-viz']
for (const id of sample) {
  console.log(`  ${id.padEnd(8)} pax/day ${String(realPaxPerDay(id)).padStart(6)}  parcel kg/day ${String(realParcelKgPerDay(id)).padStart(7)}`)
  if (ROUTES[id]!.baseDemand !== realPaxPerDay(id)) fail(`${id} route baseDemand is not wired to the supply table`)
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nOK')
