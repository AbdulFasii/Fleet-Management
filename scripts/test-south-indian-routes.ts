import { ROUTES, ROUTE_LIST, RIVALS, getRouteCategory, haulStyle, haulBrief } from '../src/engine/data/routes'
import { CITIES } from '../src/engine/data/cities'
import { RIVAL_ALIASES, RIVALS_DATA } from '../src/engine/data/rivals'

console.log('Total routes:', ROUTE_LIST.length)
let errors = 0
for (const r of ROUTE_LIST) {
  if (!CITIES[r.from]) {
    console.error('Missing city from:', r.from, r.id)
    errors++
  }
  if (!CITIES[r.to]) {
    console.error('Missing city to:', r.to, r.id)
    errors++
  }
  if (!RIVALS[r.id]) {
    console.error('Missing rivals for:', r.id)
    errors++
  }
  const cat = getRouteCategory(r)
  const haul = haulStyle(r)
  const brief = haulBrief(r)
}
console.log('Validation finished. Errors:', errors)
if (errors === 0) {
  console.log('ALL ROUTES VALID!')
}
