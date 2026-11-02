import { L, Cr } from '../core/money'
import type { BusClassId, BusModel } from '../types'

export const BUS_MODELS: Record<string, BusModel> = {
  /*
   * fareIndex = going ticket rate vs route AC-sleeper benchmark (new coach).
   * Ladder (India-ish): budget AL semi < BB semi < hybrid mid < Volvo/Scania semi
   * < BB sleeper < legacy Volvo sleeper < 9600 / 9600 Pro. EV seater sits near AC-seater fares.
   * Hybrid trip.fare is mid-index; seat zones push berths ~sleeper and cabin ~semi.
   * cargoCapKg: semi 600 · hybrid/sleeper 400 · EV semi 250 (underbelly bays).
   *
   * mileage is loaded highway km/l with AC on, for a cautious driver.
   * An aggressive driver lands at about 86% of that (3.5 → 3.0 on the 1824HD).
   * Cargo figures are the light-truck book; a full payload burns about 40% more.
   *
   * Ashok Leyland / BharatBenz passenger priceNew = chassis on-road (India dealer band).
   * Third-party / factory body package is added via body design bodyPrice.
   * Volvo / Scania / Olectra stay fully-built coach list prices.
   */

  /* ---------- AC semi-sleeper ---------- */
  cheetah: {
    id: 'cheetah', name: '12M', maker: 'Ashok Leyland',
    cls: 'AC_SEMI', priceNew: L(38), seats: 44,
    layout: { kind: 'semi', cols: '2+2', rows: 11 },
    mileage: 4.4, electric: false, ac: true, sleeper: false,
    comfort: 5, leadTimeDays: 18, fareIndex: 0.50, maintCostIndex: 0.95,
    launchedYear: 2010, cargoCapKg: 600, cargoVolumeCbm: 5.5,
  },
  bb917: {
    id: 'bb917', name: '1017', maker: 'BharatBenz',
    cls: 'AC_SEMI', priceNew: L(37), seats: 44,
    layout: { kind: 'semi', cols: '2+2', rows: 11 },
    mileage: 4.2, electric: false, ac: true, sleeper: false,
    comfort: 6, leadTimeDays: 18, fareIndex: 0.55, maintCostIndex: 0.98,
    launchedYear: 2012, cargoCapKg: 600, cargoVolumeCbm: 5.5,
  },
  volvo9400semi: {
    id: 'volvo9400semi', name: '9400', maker: 'Volvo',
    cls: 'AC_SEMI', priceNew: Cr(1.15), seats: 45,
    layout: { kind: 'semi', cols: '2+2', rows: 12 },
    mileage: 3.6, electric: false, ac: true, sleeper: false,
    comfort: 7, leadTimeDays: 55, fareIndex: 0.60, maintCostIndex: 1.2,
    launchedYear: 2009, cargoCapKg: 600, cargoVolumeCbm: 5.5,
  },
  metrolink: {
    id: 'metrolink', name: 'Metrolink', maker: 'Scania',
    cls: 'AC_SEMI', priceNew: Cr(1.25), seats: 45,
    layout: { kind: 'semi', cols: '2+2', rows: 11 },
    mileage: 3.5, electric: false, ac: true, sleeper: false,
    comfort: 7, leadTimeDays: 60, fareIndex: 0.60, maintCostIndex: 1.25,
    launchedYear: 2015, cargoCapKg: 600, cargoVolumeCbm: 5.5,
  },
  volvo9600s: {
    id: 'volvo9600s', name: '9600', maker: 'Volvo',
    cls: 'AC_SEMI_PREM', priceNew: Cr(1.75), seats: 50,
    layout: { kind: 'semi', cols: '2+2', rows: 12 },
    mileage: 3.4, electric: false, ac: true, sleeper: false,
    comfort: 8, leadTimeDays: 60, fareIndex: 0.68, maintCostIndex: 1.4,
    launchedYear: 2023, cargoCapKg: 600, cargoVolumeCbm: 5.5,
  },

  /* ---------- AC sleeper ---------- */
  leyacsleep: {
    id: 'leyacsleep', name: '12M', maker: 'Ashok Leyland',
    cls: 'AC_SLEEPER', priceNew: L(38), seats: 30,
    layout: { kind: 'sleeper', cols: '2+1', rows: 5 },
    mileage: 4.0, electric: false, ac: true, sleeper: true,
    comfort: 7, leadTimeDays: 18, fareIndex: 0.92, maintCostIndex: 0.98,
    launchedYear: 2012, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  leyacsleep2: {
    id: 'leyacsleep2', name: '13.5M', maker: 'Ashok Leyland',
    cls: 'AC_SLEEPER', priceNew: L(48), seats: 36,
    layout: { kind: 'sleeper', cols: '2+1', rows: 6 },
    mileage: 3.8, electric: false, ac: true, sleeper: true,
    comfort: 7, leadTimeDays: 20, fareIndex: 0.92, maintCostIndex: 1,
    launchedYear: 2012, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  leyacsleep15: {
    id: 'leyacsleep15', name: '15M', maker: 'Ashok Leyland',
    // Multi-axle 15M chassis sits above 13.5M (₹48L)
    cls: 'AC_SLEEPER', priceNew: L(56), seats: 40,
    layout: { kind: 'sleeper', cols: '2+1', rows: 7 },
    mileage: 3.5, electric: false, ac: true, sleeper: true,
    comfort: 8, leadTimeDays: 22, fareIndex: 0.96, maintCostIndex: 1.05,
    launchedYear: 2024, cargoCapKg: 400, cargoVolumeCbm: 3.8,
  },
  bb1624: {
    id: 'bb1624', name: '1624', maker: 'BharatBenz',
    cls: 'AC_SLEEPER', priceNew: L(40), seats: 30,
    layout: { kind: 'sleeper', cols: '2+1', rows: 5 },
    mileage: 3.7, electric: false, ac: true, sleeper: true,
    comfort: 8, leadTimeDays: 20, fareIndex: 1.00, maintCostIndex: 1.0,
    launchedYear: 2013, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  bb1824: {
    id: 'bb1824', name: '1824hd', maker: 'BharatBenz',
    cls: 'AC_SLEEPER', priceNew: L(45), seats: 34,
    layout: { kind: 'sleeper', cols: '2+1', rows: 6 },
    mileage: 3.5, electric: false, ac: true, sleeper: true,
    comfort: 8, leadTimeDays: 22, fareIndex: 1.00, maintCostIndex: 1.15,
    launchedYear: 2013, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },

  /* ---------- AC hybrid (half berths, half rear cabin) ---------- */
  leyhybrid: {
    id: 'leyhybrid', name: '12M', maker: 'Ashok Leyland',
    cls: 'AC_HYBRID', priceNew: L(38), seats: 40,
    layout: { kind: 'hybrid', cols: '2+1', rows: 5 },
    mileage: 3.9, electric: false, ac: true, sleeper: true,
    comfort: 6, leadTimeDays: 18, fareIndex: 0.74, maintCostIndex: 0.98,
    launchedYear: 2014, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  leyhybrid15: {
    id: 'leyhybrid15', name: '15M', maker: 'Ashok Leyland',
    cls: 'AC_HYBRID', priceNew: L(46), seats: 48,
    layout: { kind: 'hybrid', cols: '2+1', rows: 6 },
    mileage: 3.4, electric: false, ac: true, sleeper: true,
    comfort: 7, leadTimeDays: 22, fareIndex: 0.80, maintCostIndex: 1.05,
    launchedYear: 2024, cargoCapKg: 400, cargoVolumeCbm: 3.8,
  },
  // bb917hybrid: {
  //   id: 'bb917hybrid', name: '917 Hybrid', maker: 'BharatBenz',
  //   cls: 'AC_HYBRID', priceNew: L(37), seats: 36,
  //   layout: { kind: 'hybrid', cols: '2+1', rows: 3 },
  //   mileage: 3.9, electric: false, ac: true, sleeper: true,
  //   comfort: 7, leadTimeDays: 20, fareIndex: 0.74, maintCostIndex: 1.0,
  //   launchedYear: 2015, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  // },
  bb1624hybrid: {
    id: 'bb1624hybrid', name: '1624', maker: 'BharatBenz',
    cls: 'AC_HYBRID', priceNew: L(40), seats: 40,
    layout: { kind: 'hybrid', cols: '2+1', rows: 5 },
    mileage: 3.6, electric: false, ac: true, sleeper: true,
    comfort: 8, leadTimeDays: 20, fareIndex: 0.78, maintCostIndex: 1.05,
    launchedYear: 2015, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  bb1824hybrid: {
    id: 'bb1824hybrid', name: '1824hd', maker: 'BharatBenz',
    cls: 'AC_HYBRID', priceNew: L(45), seats: 46,
    layout: { kind: 'hybrid', cols: '2+1', rows: 6 },
    mileage: 3.4, electric: false, ac: true, sleeper: true,
    comfort: 8, leadTimeDays: 22, fareIndex: 0.78, maintCostIndex: 1.05,
    launchedYear: 2015, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  volvo9400: {
    id: 'volvo9400', name: '9400', maker: 'Volvo',
    cls: 'AC_SLEEPER', priceNew: Cr(1.45), seats: 36,
    layout: { kind: 'sleeper', cols: '2+1', rows: 6 },
    mileage: 3.3, electric: false, ac: true, sleeper: true,
    comfort: 9, leadTimeDays: 40, fareIndex: 1.06, maintCostIndex: 1.25,
    launchedYear: 2009, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },

  /* ---------- Premium AC sleeper ---------- */
  volvo9600: {
    id: 'volvo9600', name: '9600', maker: 'Volvo',
    cls: 'AC_SLEEPER_PREM', priceNew: Cr(2.05), seats: 34,
    layout: { kind: 'sleeper', cols: '2+1', rows: 6 },
    mileage: 3.2, electric: false, ac: true, sleeper: true,
    comfort: 10, leadTimeDays: 60, fareIndex: 1.14, maintCostIndex: 1.4,
    launchedYear: 2021, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },
  volvo9600_Pro: {
    id: 'volvo9600_Pro', name: '9600slx', maker: 'Volvo',
    cls: 'AC_SLEEPER_PREM', priceNew: Cr(2.45), seats: 40,
    layout: { kind: 'sleeper', cols: '2+1', rows: 7 },
    mileage: 3.0, electric: false, ac: true, sleeper: true,
    comfort: 10, leadTimeDays: 60, fareIndex: 1.16, maintCostIndex: 1.5,
    launchedYear: 2023, cargoCapKg: 400, cargoVolumeCbm: 3.6,
  },

  /* ---------- Electric AC semi-sleeper ---------- */
  evolectra: {
    id: 'evolectra', name: 'eBuzz K9', maker: 'Olectra',
    cls: 'E_AC_SEMI', priceNew: Cr(2.15), seats: 44,
    layout: { kind: 'semi', cols: '2+2', rows: 11 },
    mileage: 1, electric: true, ac: true, sleeper: false,
    comfort: 8, leadTimeDays: 90, fareIndex: 0.65, maintCostIndex: 0.8,
    launchedYear: 2019, rangeKm: 400, cargoCapKg: 250, cargoVolumeCbm: 2.3,
  },

  /* ---------- Dedicated Commercial Cargo Vehicles ---------- */
  bolero_pikup: {
    id: 'bolero_pikup', name: 'Bolero Pik-Up (4T)', maker: 'Mahindra',
    cls: 'CARGO', priceNew: L(11.5), seats: 0,
    layout: { kind: 'cargo', cols: 'cargo', rows: 1 },
    mileage: 9.0, electric: false, ac: false, sleeper: false,
    comfort: 3, leadTimeDays: 7, fareIndex: 0, maintCostIndex: 0.5,
    launchedYear: 2010, cargoCapKg: 4000, cargoVolumeCbm: 16.0,
    isCargoOnly: true,
  },
  eicher_plus: {
    id: 'eicher_plus', name: 'Eicher Plus (8T)', maker: 'Eicher',
    cls: 'CARGO', priceNew: L(21), seats: 0,
    layout: { kind: 'cargo', cols: 'cargo', rows: 1 },
    mileage: 5.5, electric: false, ac: false, sleeper: false,
    comfort: 4, leadTimeDays: 12, fareIndex: 0, maintCostIndex: 0.75,
    launchedYear: 2014, cargoCapKg: 8000, cargoVolumeCbm: 35.0,
    isCargoOnly: true,
  },
  eicher_xp: {
    id: 'eicher_xp', name: 'Eicher XP (12T)', maker: 'Eicher',
    cls: 'CARGO', priceNew: L(29.5), seats: 0,
    layout: { kind: 'cargo', cols: 'cargo', rows: 1 },
    mileage: 4.2, electric: false, ac: false, sleeper: false,
    comfort: 4, leadTimeDays: 16, fareIndex: 0, maintCostIndex: 0.95,
    launchedYear: 2016, cargoCapKg: 12000, cargoVolumeCbm: 52.0,
    isCargoOnly: true,
  },
  eicher_pro: {
    id: 'eicher_pro', name: 'Eicher Pro (18T)', maker: 'Eicher',
    cls: 'CARGO', priceNew: L(41), seats: 0,
    layout: { kind: 'cargo', cols: 'cargo', rows: 1 },
    mileage: 3.2, electric: false, ac: false, sleeper: false,
    comfort: 5, leadTimeDays: 20, fareIndex: 0, maintCostIndex: 1.15,
    launchedYear: 2018, cargoCapKg: 18000, cargoVolumeCbm: 75.0,
    isCargoOnly: true,
  },
  bb_5528t: {
    id: 'bb_5528t', name: '5528T Heavy (26T)', maker: 'BharatBenz',
    cls: 'CARGO', priceNew: L(68), seats: 0,
    layout: { kind: 'cargo', cols: 'cargo', rows: 1 },
    mileage: 2.5, electric: false, ac: false, sleeper: false,
    comfort: 6, leadTimeDays: 25, fareIndex: 0, maintCostIndex: 1.45,
    launchedYear: 2020, cargoCapKg: 26000, cargoVolumeCbm: 110.0,
    isCargoOnly: true,
  },
}

const CLASS_ORDER: Record<BusClassId, number> = {
  CARGO: 1,
  E_AC_SEMI: 3,
  AC_SEMI: 4,
  AC_SEMI_PREM: 5,
  AC_HYBRID: 6,
  AC_SLEEPER: 7,
  AC_SLEEPER_PREM: 8,
}

const HIDDEN_MAKERS = new Set(['Tata Motors', 'Force Motors'])

export const MODEL_LIST = Object.values(BUS_MODELS)
  .filter((m) => !HIDDEN_MAKERS.has(m.maker))
  .sort((a, b) => (CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls]) || a.priceNew - b.priceNew)

/** Discontinued / legacy — not sold new; still rare on used / lease / attach. */
export const NO_NEW_ORDER_IDS = new Set([
  'volvo9400',
  'volvo9400semi',
  'metrolink',
  'leysleep',
])

export function isLegacyMarketModel(m: BusModel): boolean {
  return NO_NEW_ORDER_IDS.has(m.id)
}

export const NEW_MODEL_LIST = MODEL_LIST.filter((m) => !NO_NEW_ORDER_IDS.has(m.id))

export const CLASS_LABEL: Record<string, string> = {
  CARGO: 'Dedicated Cargo Carrier',
  AC_SEMI: 'AC Semi-Sleeper',
  AC_SEMI_PREM: 'Premium AC Semi-Sleeper',
  AC_HYBRID: 'AC Hybrid (Sleeper + Semi)',
  AC_SLEEPER: 'AC Sleeper',
  AC_SLEEPER_PREM: 'Premium AC Sleeper',
  E_AC_SEMI: 'Electric AC Semi-Sleeper',
}

export function isCargoModel(modelOrId: BusModel | string | undefined): boolean {
  if (!modelOrId) return false
  const m = typeof modelOrId === 'string' ? BUS_MODELS[modelOrId] : modelOrId
  return Boolean(m && (m.cls === 'CARGO' || m.layout?.kind === 'cargo' || m.isCargoOnly))
}

export function coachKind(m: BusModel): 'Semi-sleeper' | 'Sleeper' | 'Seater' | 'Hybrid' | 'Cargo' {
  if (isCargoModel(m)) return 'Cargo'
  if (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID') return 'Hybrid'
  if (m.sleeper || m.layout.kind === 'sleeper') return 'Sleeper'
  if (m.layout.kind === 'seater') return 'Seater'
  return 'Semi-sleeper'
}

/** CSS tone for layout labels — hybrid stays distinct from sleeper amber / semi blue. */
export function coachKindClass(m: BusModel | undefined): 'hybrid' | 'accent' | 'info' | 'warn' {
  if (!m) return 'info'
  if (isCargoModel(m)) return 'warn'
  if (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID') return 'hybrid'
  if (m.sleeper || m.layout.kind === 'sleeper') return 'accent'
  return 'info'
}

/** Analytics / route split key — premium & EV classes stay distinct; always include AC tag. */
export function layoutKey(modelId: string): string {
  const m = BUS_MODELS[modelId]
  if (!m) return 'Unknown'
  if (isCargoModel(m)) {
    return `Cargo ${(m.cargoCapKg / 1000).toFixed(0)}T`
  }
  const ac = m.ac ? ' AC' : ''
  switch (m.cls) {
    case 'AC_SLEEPER_PREM':
      return `Premium sleeper ${m.layout.cols}${ac}`
    case 'AC_SEMI_PREM':
      return `Premium semi ${m.layout.cols}${ac}`
    case 'E_AC_SEMI':
      return `Electric semi ${m.layout.cols}${ac}`
    case 'AC_HYBRID':
      return `Hybrid ${m.layout.cols}${ac}`
    case 'AC_SLEEPER':
      return `Sleeper ${m.layout.cols}${ac}`
    case 'AC_SEMI':
      return `Semi-sleeper ${m.layout.cols}${ac}`
    default:
      return `${coachKind(m)} ${m.layout.cols}${ac}`
  }
}

/** Hybrid berths count as sleeper; rear cabin counts as semi-sleeper. */
export function layoutKeyForZone(modelId: string, zone?: 'sleeper' | 'semi'): string {
  const m = BUS_MODELS[modelId]
  if (m && (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID')) {
    const ac = m.ac ? ' AC' : ''
    return zone === 'semi' ? `Semi-sleeper 2+2${ac}` : `Sleeper 2+1${ac}`
  }
  return layoutKey(modelId)
}

/** Capacity shares for splitting shared trip costs / km on a hybrid. */
export function layoutShares(modelId: string): { key: string; share: number }[] {
  const m = BUS_MODELS[modelId]
  if (!m) return [{ key: 'Unknown', share: 1 }]
  if (m.layout.kind === 'hybrid' || m.cls === 'AC_HYBRID') {
    const slp = hybridSleeperCount(m)
    const semi = Math.max(0, m.seats - slp)
    const n = Math.max(1, slp + semi)
    const ac = m.ac ? ' AC' : ''
    return [
      { key: `Sleeper 2+1${ac}`, share: slp / n },
      { key: `Semi-sleeper 2+2${ac}`, share: semi / n },
    ]
  }
  return [{ key: layoutKey(modelId), share: 1 }]
}

/** Fold keys that briefly omitted the AC suffix back onto the canonical label. */
export function canonicalizeLayoutKey(key: string): string {
  if (/\s(?:AC|Non-AC)$/.test(key)) return key
  if (/^(?:Premium sleeper|Premium semi|Electric semi|Electric seater|Hybrid|Sleeper|Semi-sleeper)\b/.test(key)) {
    return `${key} AC`
  }
  return key
}

/** Compact spec for market rows: "36 · Hybrid 2+1/2+2 · AC" */
export function coachSpec(m: BusModel): string {
  if (m.layout.kind === 'hybrid') {
    const sleep = hybridSleeperCount(m)
    return `${m.seats} · Hybrid ${sleep}sl/${m.seats - sleep}semi · ${m.ac ? 'AC' : 'Non-AC'}`
  }
  return `${m.seats} · ${coachKind(m)} ${m.layout.cols} · ${m.ac ? 'AC' : 'Non-AC'}`
}

/** Berths on a hybrid: half the coach. Cabin gets the rest. */
export function hybridSleeperCount(m: BusModel): number {
  if (m.layout.kind !== 'hybrid') return m.sleeper ? m.seats : 0
  return Math.floor(m.seats / 2)
}

/** Same OEM chassis platform (layout variants share maker + name, e.g. AL 12M). */
export function chassisPlatformKey(m: BusModel): string {
  return `${m.maker}::${m.name}`
}

/** All new-order layout variants of the same chassis platform. */
export function chassisLayoutVariants(m: BusModel, pool: BusModel[] = NEW_MODEL_LIST): BusModel[] {
  return pool
    .filter((x) => x.maker === m.maker && x.name === m.name && !isCargoModel(x))
    .sort((a, b) => (CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls]) || a.seats - b.seats)
}

/** Dealer catalog rows: one row per AL/BB chassis platform; other makers stay per model. */
export function dealerCatalogRows(catalog: BusModel[]): BusModel[] {
  const seen = new Set<string>()
  const rows: BusModel[] = []
  for (const m of catalog) {
    if (m.maker === 'Ashok Leyland' || m.maker === 'BharatBenz') {
      if (isCargoModel(m)) {
        rows.push(m)
        continue
      }
      const key = chassisPlatformKey(m)
      if (seen.has(key)) continue
      seen.add(key)
      // Prefer sleeper as the representative when present; else first by class order.
      const variants = chassisLayoutVariants(m, catalog)
      rows.push(variants.find((v) => v.cls === 'AC_SLEEPER') ?? variants[0] ?? m)
      continue
    }
    rows.push(m)
  }
  // Cheapest chassis / model first within the dealer list.
  return rows.sort((a, b) => a.priceNew - b.priceNew || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Short layout label for pickers: "Sleeper 2+1 · 30 berths". */
export function layoutOptionLabel(m: BusModel): string {
  if (isCargoModel(m)) return `Cargo · ${(m.cargoCapKg / 1000).toFixed(0)}T`
  const kind = coachKind(m)
  const unit = kind === 'Sleeper' || kind === 'Hybrid' ? 'berths' : 'seats'
  return `${kind} ${m.layout.cols} · ${m.seats} ${unit}`
}

/** Display title without layout words, e.g. "Volvo 9600". */
export function modelTitle(m: BusModel): string {
  return `${m.maker} ${m.name}`
}

/** Resolve a model id to a display title (safe for missing ids). */
export function modelTitleById(modelId: string): string {
  const m = BUS_MODELS[modelId]
  return m ? modelTitle(m) : modelId
}

/** Years since the coach entered Indian service (0 = brand-new platform). */
export function modelMaxAgeYears(m: BusModel, calendarYear: number): number {
  return Math.max(0, calendarYear - (m.launchedYear ?? calendarYear))
}

/** Market never lists coaches older than this (years). */
export const MARKET_MAX_AGE_YEARS = 10

/**
 * Realistic listing age for used / lease / attach.
 * Older platforms (9400) skew older; recent ones (9600) stay young.
 * Legacy / discontinued stock is pushed toward high age.
 * Never exceeds {@link MARKET_MAX_AGE_YEARS}.
 */
export function marketAgeRange(
  m: BusModel,
  calendarYear: number,
  kind: 'used' | 'lease' | 'attach',
): { min: number; max: number } {
  const since = Math.min(modelMaxAgeYears(m, calendarYear), MARKET_MAX_AGE_YEARS)
  if (since <= 0) return { min: 0, max: 0 }

  if (isLegacyMarketModel(m)) {
    // Worked hard for years — listings are old stock with high miles
    if (kind === 'lease') {
      const max = Math.min(since, 9)
      const min = Math.min(max, Math.max(5, Math.floor(since * 0.65)))
      return { min, max }
    }
    if (kind === 'attach') {
      const max = since
      const min = Math.min(max, Math.max(6, Math.floor(since * 0.7)))
      return { min, max }
    }
    const max = since
    const min = Math.min(max, Math.max(7, Math.floor(since * 0.75)))
    return { min, max }
  }

  if (kind === 'lease') {
    // Lessors prefer younger stock
    return { min: 1, max: Math.min(since, Math.max(1, Math.min(6, since))) }
  }
  if (kind === 'attach') {
    return {
      min: Math.max(1, Math.min(2, since)),
      max: Math.min(since, Math.max(2, since)),
    }
  }
  // used: prefer mid-to-late life of the platform, never older than launch / market cap
  const min = since >= 8 ? Math.max(2, Math.floor(since * 0.35)) : Math.max(1, Math.min(2, since))
  const max = since
  return { min: Math.min(min, max), max }
}

/** Annual km band for market odo — legacy coaches run harder / older fleet duty. */
export function marketOdoBand(
  m: BusModel,
  kind: 'used' | 'lease' | 'attach',
): { lo: number; hi: number } {
  if (isLegacyMarketModel(m)) {
    if (kind === 'lease') return { lo: 75_000, hi: 115_000 }
    if (kind === 'attach') return { lo: 90_000, hi: 130_000 }
    return { lo: 85_000, hi: 135_000 }
  }
  if (kind === 'lease') return { lo: 50_000, hi: 90_000 }
  if (kind === 'attach') return { lo: 60_000, hi: 100_000 }
  return { lo: 55_000, hi: 110_000 }
}

/** Typical annual km for a coach on Indian corridors (~55–100k). */
export function marketOdometer(ageYears: number, kmPerYearLo: number, kmPerYearHi: number, rng: () => number): number {
  if (ageYears <= 0) return Math.round(5_000 + rng() * 15_000)
  const span = kmPerYearHi - kmPerYearLo
  const perYear = kmPerYearLo + rng() * span
  return Math.round(ageYears * perYear)
}


/** Retired ids from older saves, remapped to a travel coach. */
export const RETIRED_MODEL_MAP: Record<string, string> = {
  traveller: 'leyacsleep',
  viking: 'cheetah',
  sunshine: 'cheetah',
  leysleep: 'leyacsleep',
  volvo9400x: 'volvo9400semi',
  volvo9600x: 'volvo9600s',
  skyline: 'bb917',
}

const MAKER_ORDER = ['Ashok Leyland', 'BharatBenz', 'Volvo', 'Scania', 'Olectra']

function sortMakers(makers: string[]): string[] {
  return [...makers].sort(
    (a, b) => (MAKER_ORDER.indexOf(a) === -1 ? 99 : MAKER_ORDER.indexOf(a)) - (MAKER_ORDER.indexOf(b) === -1 ? 99 : MAKER_ORDER.indexOf(b)),
  )
}

export const MAKERS = sortMakers([...new Set(MODEL_LIST.map((m) => m.maker))])
export const NEW_MAKERS = sortMakers([...new Set(NEW_MODEL_LIST.map((m) => m.maker))])


/** Volvo and Scania heavy passenger coaches require an HMV_HP licence. */
export function modelNeedsHp(modelId: string): boolean {
  const m = BUS_MODELS[modelId]
  if (!m) return false
  const maker = m.maker?.toLowerCase() ?? ''
  return maker.includes('volvo') || maker.includes('scania')
}

/** Bus cargo volume in CBM from model seating capacity (Sprint 12). */
export function cargoVolumeForSeats(seats: number): number {
  return seats < 30 ? 4 : seats < 45 ? 8 : 12
}
