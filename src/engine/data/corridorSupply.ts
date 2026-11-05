/**
 * Real-world corridor supply: private intercity bus departures per day, per
 * direction, and the typical parcel load one of those buses carries.
 *
 * Scope: private operators only (KPN, SRS, Orange, VRL, Kallada, Zingbus ...).
 * State undertakings (TNSTC/SETC, KSRTC, APSRTC, MSRTC ...) are left out; they
 * reach the game through route.competition and railCompetition instead.
 *
 * These numbers are planning assumptions, not live counts. They follow the
 * general shape of RedBus/AbhiBus listings (metro pairs run hundreds of
 * departures, deep-south and marathon hauls a handful) and should be revised
 * whenever better data turns up. Everything downstream derives from this one
 * figure so a single edit keeps passengers, parcels and rivals consistent:
 *
 *   passengers/day = departures × AVG_PRIVATE_SEATS × TYPICAL_PRIVATE_LF
 *   parcel kg/day  = departures × parcelKgPerBus
 */
import { canonicalRouteId } from './routes'

/** Average seats on a private intercity coach (sleepers ~30-36, semis ~44-50). */
export const AVG_PRIVATE_SEATS = 36
/** Typical year-round private-operator load factor. */
export const TYPICAL_PRIVATE_LF = 0.70
/**
 * No playable corridor runs fewer private departures than this. Real thin
 * marathons (Chennai–Goa, Chennai–Bhubaneswar) sit nearer 6-10, but at that
 * size a single daily coach would be 10-15% of the lane's seats.
 */
export const MIN_DEPARTURES = 12

export interface CorridorSupply {
  /** Private departures per day, each direction. */
  departures: number
  /** Typical parcel kilograms in one departure's belly. */
  parcelKgPerBus: number
}

const S = (departures: number, parcelKgPerBus: number): CorridorSupply => ({ departures, parcelKgPerBus })

/**
 * Keyed by canonical route id (alias ids such as `blr-maa` resolve through
 * canonicalRouteId). Parcel loads: metro pairs and textile/trade lanes run
 * heavy (300-380 kg), tier-2 links lighter (150-250 kg), marathon hauls carry
 * fewer but longer-distance parcels.
 */
export const CORRIDOR_SUPPLY: Record<string, CorridorSupply> = {
  // —— Chennai hub, short and mid ——
  'maa-blr': S(350, 360),
  'maa-pdy': S(40, 150),
  'maa-tir': S(35, 140),
  'maa-nlr': S(25, 170),
  'maa-try': S(120, 260),
  'maa-slm': S(90, 280),
  'maa-mdu': S(260, 300), // flowers and textiles both ways
  'maa-mdu-ecr': S(40, 200),
  'maa-rmd': S(35, 180),
  'maa-tvr': S(45, 170),

  // —— Chennai hub, Tamil Nadu overnight ——
  'maa-cbe': S(180, 360),
  'maa-ten': S(110, 250),
  'maa-kkm': S(50, 200),

  // —— Chennai hub, neighbouring states and marathons ——
  'maa-mys': S(20, 200),
  'maa-vga': S(45, 260),
  'maa-hyd': S(90, 320),
  'maa-koc': S(50, 280),
  'maa-trv': S(35, 240),
  'maa-clt': S(20, 240),
  'maa-mlr': S(12, 220),
  'maa-viz': S(25, 240),
  'maa-goa': S(12, 150),
  'maa-mum': S(12, 220),

  // —— Tamil Nadu to Kerala ——
  'cbe-koc': S(60, 300),
  'cbe-clt': S(35, 240),
  'cbe-trv': S(40, 240),
  'mdu-koc': S(30, 200),
  'mdu-trv': S(35, 220),
  'ten-trv': S(25, 160),
  'slm-koc': S(35, 240),

  // —— Tamil Nadu to Karnataka ——
  'mdu-mys': S(12, 180),
  'blr-cbe': S(180, 360),
  'blr-try': S(90, 260),
  'blr-slm': S(60, 260),
  'blr-ten': S(70, 240),
  'blr-kkm': S(35, 200),
  'mys-cbe': S(15, 180),

  // —— Karnataka to Kerala ——
  'blr-clt': S(120, 300),
  'blr-trv': S(90, 280),
  'blr-tcr': S(100, 280),
  'blr-knr': S(90, 260),
  'blr-pkd': S(60, 240),
  'blr-mlr': S(140, 300),
  'mys-clt': S(20, 180),

  // —— Rest of the South ——
  'blr-hyd': S(360, 380),
  'hyd-vga': S(300, 320),
  'blr-tir': S(70, 180),
  'blr-mdu': S(130, 280),
  'blr-goa': S(60, 200),
  'blr-koc': S(180, 320),
  'hyd-goa': S(30, 180),

  // —— Northern and western corridors ——
  'del-jai': S(220, 320),
  'del-ixc': S(200, 300),
  'del-lko': S(150, 320),
  'del-agr': S(80, 220),
  'mum-amd': S(220, 380),
  'mum-pnq': S(350, 300),
  'blr-mum': S(60, 300),

  // —— South to north marathons ——
  'blr-nag': S(25, 260),
  'maa-bbs': S(12, 220),

  // —— Andhra and Telangana ——
  'blr-vga': S(110, 300),
  'blr-viz': S(30, 260),
  'hyd-viz': S(140, 320),
  'hyd-cbe': S(20, 260),
  'hyd-koc': S(15, 240),
  'hyd-tir': S(90, 220),
  'hyd-pnq': S(150, 320),
  'hyd-mum': S(110, 340),
  'hyd-kno': S(60, 220),
  'vga-viz': S(160, 300),

  // —— Kerala and coastal Karnataka ——
  'koc-mlr': S(40, 260),
  'trv-clt': S(50, 240),
  'trv-koc': S(70, 220),
  'mlr-goa': S(30, 200),

  // —— Karnataka, Tamil Nadu and Puducherry mid-hauls ——
  'blr-pdy': S(45, 180),
  'blr-hbl': S(150, 300),
  'hbl-goa': S(25, 160),
  'mdu-cbe': S(60, 260),
  'try-cbe': S(40, 240),

  // —— Dindigul corridors (flowers, locks, farm produce) ——
  'maa-dgl': S(60, 280),
  'blr-dgl': S(40, 260),
  'cbe-dgl': S(25, 200),
  'try-dgl': S(15, 160),
}

/** Fallback for a route missing from the table: a thin tier-2 link. */
const FALLBACK: CorridorSupply = S(20, 200)

export function corridorSupply(routeId: string): CorridorSupply {
  return CORRIDOR_SUPPLY[routeId] ?? CORRIDOR_SUPPLY[canonicalRouteId(routeId)] ?? FALLBACK
}

/** Private-operator passengers per day, one direction. */
export function realPaxPerDay(routeId: string): number {
  return Math.round(corridorSupply(routeId).departures * AVG_PRIVATE_SEATS * TYPICAL_PRIVATE_LF)
}

/** Parcel kilograms all private departures carry per day, one direction. */
export function realParcelKgPerDay(routeId: string): number {
  const c = corridorSupply(routeId)
  return c.departures * c.parcelKgPerBus
}
