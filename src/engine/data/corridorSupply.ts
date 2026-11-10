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

/** Average seats on a private intercity coach (sleepers ~30-36, semis ~44-50). */
export const AVG_PRIVATE_SEATS = 36
/** Typical year-round private-operator load factor. */
export const TYPICAL_PRIVATE_LF = 0.70
/**
 * No playable corridor runs fewer private departures than this. Real thin
 * marathons (Chennai–Goa, Chennai–Bhubaneswar) sit nearer 6-10, but at that
 * size a single daily coach would be 10-15% of the lane's seats.
 */
export const MIN_DEPARTURES = 15

export interface CorridorSupply {
  /** Private departures per day, each direction. */
  departures: number
  /** Typical parcel kilograms in one departure's belly. */
  parcelKgPerBus: number
}

const S = (departures: number, parcelKgPerBus: number): CorridorSupply => ({ departures, parcelKgPerBus })

/**
 * Keyed by one direction of each corridor; the reversed id (`blr-maa`,
 * `mdu-maa-ecr`) resolves to the same row. Parcel loads: metro pairs and textile/trade lanes run
 * heavy (300-380 kg), tier-2 links lighter (150-250 kg), marathon hauls carry
 * fewer but longer-distance parcels.
 */
export const CORRIDOR_SUPPLY: Record<string, CorridorSupply> = {
  // —— Chennai hub, short and mid ——
  'maa-blr': S(350, 360),
  'maa-try': S(120, 260),
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
  'maa-mlr': S(15, 220),
  'maa-viz': S(25, 240),
  'maa-goa': S(15, 150),
  'maa-mum': S(15, 220),

  // —— Tamil Nadu to Kerala ——
  'cbe-trv': S(40, 240),
  'mdu-koc': S(30, 200),
  'mdu-trv': S(35, 220),
  'slm-koc': S(35, 240),

  // —— Tamil Nadu to Karnataka ——
  'mdu-mys': S(15, 180),
  'blr-cbe': S(180, 360),
  'blr-try': S(90, 260),
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
  'del-lko': S(150, 320),
  'mum-amd': S(220, 380),
  'blr-mum': S(60, 300),

  // —— South to north marathons ——
  'blr-nag': S(25, 260),
  'maa-bbs': S(15, 220),

  // —— Andhra and Telangana ——
  'blr-vga': S(110, 300),
  'blr-viz': S(30, 260),
  'hyd-viz': S(140, 320),
  'hyd-cbe': S(20, 260),
  'hyd-koc': S(15, 240),
  'hyd-tir': S(90, 220),
  'hyd-pnq': S(150, 320),
  'hyd-mum': S(110, 340),
  'vga-viz': S(160, 300),

  // —— Kerala and coastal Karnataka ——
  'koc-mlr': S(40, 260),
  'trv-clt': S(50, 240),
  'mlr-goa': S(30, 200),

  // —— Karnataka, Tamil Nadu and Puducherry mid-hauls ——
  'blr-pdy': S(45, 180),
  'blr-hbl': S(150, 300),

  // —— Dindigul corridors (flowers, locks, farm produce) ——
  'maa-dgl': S(60, 280),
  'blr-dgl': S(40, 260),

  // —— Round-to-100 corridors ——
  'maa-hpt': S(30, 240),
  'blr-klb': S(40, 260),
  'blr-udp': S(50, 220),
  'mum-klp': S(60, 300),
  'hyd-rjy': S(90, 280),
  'hyd-nag': S(40, 300),
  'pnq-goa': S(45, 200),
  'mum-goa': S(120, 220),
  'blr-pnq': S(70, 320),
  'blr-ktm': S(45, 260),
  'maa-qln': S(35, 260),
  'maa-wyd': S(35, 260),
  'mum-idr': S(45, 320),
  'blr-qln': S(40, 240),
  'maa-pnq': S(15, 260),
  'pnq-nag': S(40, 260),
  'viz-ccu': S(20, 240),
  'blr-smg': S(40, 240),
  'jai-ixc': S(35, 260),
  'amd-jai': S(40, 280),
  'bhp-del': S(25, 260),
  'hyd-rpr': S(20, 240),
  'viz-nag': S(20, 240),
  'amd-del': S(30, 280),
  'lko-ccu': S(20, 260),
  'koc-mys': S(22, 240),
  'cbe-pdy': S(20, 230),
  'blr-nlr': S(22, 240),
  'mdu-pdy': S(22, 230),
  'hbl-mys': S(18, 220),
  'hyd-mys': S(24, 250),
  'vga-cbe': S(20, 240),
  'pnq-hbl': S(20, 240),
  'mys-viz': S(22, 260),
  'mlr-trv': S(20, 230),
}

/** Fallback for a route missing from the table: a thin tier-2 link. */
const FALLBACK: CorridorSupply = S(20, 200)

/** `a-b` -> `b-a`, keeping a path suffix such as `-ecr`. */
function reversedId(routeId: string): string {
  const [a, b, ...rest] = routeId.split('-')
  return [b, a, ...rest].join('-')
}

export function corridorSupply(routeId: string): CorridorSupply {
  return CORRIDOR_SUPPLY[routeId] ?? CORRIDOR_SUPPLY[reversedId(routeId)] ?? FALLBACK
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
