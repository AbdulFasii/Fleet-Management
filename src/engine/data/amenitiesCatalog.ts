/**
 * Full passenger amenity + cabin fitting catalog.
 * Trim entries here later — UI, cost, PSS, demand, delivery and retrofit all read this list.
 *
 * PSS lifts are intentionally soft: stacking uses diminishing returns and hard caps so a
 * full amenities + fittings pack cannot push every trip review to 10/10.
 */
import { rs } from '../core/money'
import type { Bus } from '../types'

export interface AmenityDef {
  id: string
  title: string
  shortLabel: string
  blurb: string
  /** Per-pax consumable cost (paise). */
  cost: number
  pssBonus: number
  /** Charge + PSS only on night departures (19:00–05:00). */
  nightOnly?: boolean
}

export interface FittingDef {
  id: string
  title: string
  shortLabel: string
  blurb: string
  retrofitCost: number
  pssBonus: number
  demandMult: number
}

export const AMENITY_CATALOG: AmenityDef[] = [
  { id: 'waterBottle', title: 'Mineral Water', shortLabel: 'Water', blurb: '₹7/pax · Sealed 500ml water bottle.', cost: rs(7), pssBonus: 0.18 },
  { id: 'snackHamper', title: 'Snack Hamper', shortLabel: 'Hamper', blurb: '₹35/pax · Biscuit pack, savouries & wet wipe.', cost: rs(35), pssBonus: 0.28 },
  { id: 'sanitizedBedding', title: 'Sanitized Bedding', shortLabel: 'Bedding', blurb: '₹25/pax (night) · Pillow, sheet & blanket.', cost: rs(25), pssBonus: 0.35, nightOnly: true },
  { id: 'travelKit', title: 'Sleep Travel Kit', shortLabel: 'Sleep kit', blurb: '₹18/pax · Eye mask & soft ear plugs.', cost: rs(18), pssBonus: 0.16 },
  { id: 'fruitJuice', title: 'Chilled Fruit Juice', shortLabel: 'Juice', blurb: '₹20/pax · Tetra-pack juice with the hamper.', cost: rs(20), pssBonus: 0.14 },
  { id: 'breakfastBox', title: 'Breakfast Box', shortLabel: 'Breakfast', blurb: '₹45/pax · Packaged breakfast on morning arrivals.', cost: rs(45), pssBonus: 0.2 },
  { id: 'sanitaryKit', title: 'Sanitary Comfort Kit', shortLabel: 'Sanitary kit', blurb: '₹15/pax · Discreet women-friendly travel kit.', cost: rs(15), pssBonus: 0.12 },
  { id: 'namkeen', title: 'Namkeen Mix', shortLabel: 'Namkeen', blurb: '₹20/pax · Spicy savory mix pouch.', cost: rs(20), pssBonus: 0.08 },
  { id: 'oralKit', title: 'Oral Care Kit', shortLabel: 'Oral kit', blurb: '₹12/pax · Mini toothbrush & paste.', cost: rs(12), pssBonus: 0.1 },
  { id: 'wetWipes', title: 'Wet Wipes Pack', shortLabel: 'Wipes', blurb: '₹10/pax · Multi-wipe hygiene pack.', cost: rs(10), pssBonus: 0.07 },
  { id: 'comboMeal', title: 'Combo Meal (Veg / Non-Veg)', shortLabel: 'Meal', blurb: '₹95/pax · Veg thali / wrap or chicken / egg packed meal.', cost: rs(95), pssBonus: 0.25 },
  { id: 'multiLingualCard', title: 'Multi-lingual Welcome Card', shortLabel: 'Card', blurb: '₹2/pax · Route & safety card in TN/KN/ML/EN.', cost: rs(2), pssBonus: 0.02 },
]

export const FITTING_CATALOG: FittingDef[] = [
  { id: 'wifi', title: '4G/5G Wi-Fi Router', shortLabel: 'WiFi', blurb: 'Cabin hotspot & OTA appeal.', retrofitCost: rs(18_000), pssBonus: 0.1, demandMult: 1.012 },
  { id: 'cctv', title: 'Cabin CCTV Security Cameras', shortLabel: 'CCTV', blurb: 'Door & aisle cameras; women-friendly badge.', retrofitCost: rs(15_000), pssBonus: 0.06, demandMult: 1.008 },
  { id: 'airPurifier', title: 'Cabin Air Purifier', shortLabel: 'Purifier', blurb: 'HEPA / ion purifier for AC coaches.', retrofitCost: rs(14_000), pssBonus: 0.08, demandMult: 1.005 },
  { id: 'cabinFreshener', title: 'Cabin Freshener Dispenser', shortLabel: 'Freshener', blurb: 'Auto perfume mist between trips.', retrofitCost: rs(5_000), pssBonus: 0.05, demandMult: 1.002 },
  { id: 'powerSockets', title: '220V AC Power Sockets', shortLabel: 'AC sockets', blurb: 'Laptop sockets at seats/berths.', retrofitCost: rs(10_000), pssBonus: 0.08, demandMult: 1.005 },
  { id: 'pantryCounter', title: 'Mini Pantry Counter', shortLabel: 'Pantry', blurb: 'Hot-water urn & service counter.', retrofitCost: rs(28_000), pssBonus: 0.1, demandMult: 1.005 },
  { id: 'fridge', title: 'Cabin Mini Fridge', shortLabel: 'Fridge', blurb: 'Chilled drinks fridge for attendant.', retrofitCost: rs(18_000), pssBonus: 0.08, demandMult: 1.003 },
  { id: 'solarAssist', title: 'Roof Solar Assist Pack', shortLabel: 'Solar', blurb: 'Aux solar for lights / USB overnight — ops only, no passenger effect.', retrofitCost: rs(55_000), pssBonus: 0, demandMult: 1 },
  { id: 'leatheretteSeats', title: 'Leatherette Seat Covers', shortLabel: 'Leatherette', blurb: 'Premium wipe-clean seat/berth covers.', retrofitCost: rs(32_000), pssBonus: 0.12, demandMult: 1.006 },
]

/** Hard caps so a fully loaded pack stays a nudge, not a free 10/10. */
export const AMENITY_PSS_CAP = 0.9
export const FITTING_PSS_CAP = 0.45
/** Each extra amenity/fitting adds this fraction of the previous item's weight. */
const STACK_DECAY = 0.72

/** Legacy Bus flags still synced for older saves / code paths. */
const LEGACY_FITTING_FIELDS: Record<string, keyof Bus> = {
  wifi: 'wifiFitted',
  cctv: 'cctvFitted',
  airPurifier: 'airPurifierFitted',
  cabinFreshener: 'cabinFreshenerFitted',
  powerSockets: 'powerSocketsFitted',
}

export function isNightDep(depHour: number): boolean {
  return depHour >= 19 || depHour <= 5
}

export function amenityActive(
  amenities: Record<string, boolean | undefined> | undefined,
  id: string,
): boolean {
  return !!amenities?.[id]
}

export function busHasFitting(bus: Bus, id: string): boolean {
  if (bus.cabinFittings?.[id]) return true
  const legacy = LEGACY_FITTING_FIELDS[id]
  if (legacy && Boolean(bus[legacy])) return true
  return false
}

export function setBusFitting(bus: Bus, id: string, on: boolean): void {
  if (!bus.cabinFittings) bus.cabinFittings = {}
  bus.cabinFittings[id] = on
  const legacy = LEGACY_FITTING_FIELDS[id]
  if (legacy) {
    ;(bus as unknown as Record<string, boolean>)[legacy] = on
  }
}

export function resolveAmenitiesMap(
  raw: Record<string, boolean | undefined> | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const a of AMENITY_CATALOG) out[a.id] = !!raw?.[a.id]
  return out
}

export function tripAmenityCost(
  amenities: Record<string, boolean>,
  pax: number,
  depHour: number,
): number {
  if (pax <= 0) return 0
  let total = 0
  const night = isNightDep(depHour)
  for (const a of AMENITY_CATALOG) {
    if (!amenities[a.id]) continue
    if (a.nightOnly && !night) continue
    total += pax * a.cost
  }
  return total
}

function stackedBonus(values: number[], cap: number): number {
  let bonus = 0
  let weight = 1
  for (const v of values) {
    if (v <= 0) continue
    bonus += v * weight
    weight *= STACK_DECAY
  }
  return Math.min(cap, Math.round(bonus * 100) / 100)
}

export function tripAmenityPssBonus(
  amenities: Record<string, boolean>,
  depHour: number,
): number {
  const night = isNightDep(depHour)
  const values: number[] = []
  for (const a of AMENITY_CATALOG) {
    if (!amenities[a.id]) continue
    if (a.nightOnly && !night) continue
    values.push(a.pssBonus)
  }
  values.sort((a, b) => b - a)
  return stackedBonus(values, AMENITY_PSS_CAP)
}

/** Night sleeper without sanitized bedding — keep a noticeable gap vs bedded coaches. */
export function missingBeddingPenalty(
  amenities: Record<string, boolean>,
  depHour: number,
  sleeper: boolean,
): number {
  if (!sleeper || !isNightDep(depHour)) return 0
  if (amenities.sanitizedBedding) return 0
  return -0.45
}

export function busFittingsPssBonus(bus: Bus): number {
  const values: number[] = []
  for (const f of FITTING_CATALOG) {
    if (busHasFitting(bus, f.id)) values.push(f.pssBonus)
  }
  values.sort((a, b) => b - a)
  return stackedBonus(values, FITTING_PSS_CAP)
}

export function busFittingsDemandMult(bus: Bus): number {
  let mult = 1
  for (const f of FITTING_CATALOG) {
    if (busHasFitting(bus, f.id)) mult *= f.demandMult
  }
  return Math.min(1.06, mult)
}

export function fittingById(id: string): FittingDef | undefined {
  return FITTING_CATALOG.find((f) => f.id === id)
}

export type RetrofitFeatureId = string
