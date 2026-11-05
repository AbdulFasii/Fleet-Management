/**
 * What kind of crowd a corridor carries. Drives the weekly and festival
 * occupancy pattern, how price-sensitive the shoppers are, and which
 * operator traits they shop on.
 *
 *   tech       metro-to-metro IT corridors: Friday exodus, Sunday return, busy midweek
 *   pilgrim    temple towns: weekend and festival crowds both ways
 *   leisure    getaway towns: Friday/Saturday out, Sunday back, empty midweek
 *   marathon   13h+ long hauls: the weekly cycle is muted
 *   commercial everything else: hometown and trade corridors (metro out Friday, back Sunday)
 */
import { ROUTES } from './routes'

export type CorridorArchetype = 'tech' | 'pilgrim' | 'leisure' | 'commercial' | 'marathon'

/** Either direction of a corridor id may be listed; the reverse is looked up too. */
const EXPLICIT: Record<string, CorridorArchetype> = {
  // tech
  'maa-blr': 'tech',
  'blr-hyd': 'tech',
  'maa-hyd': 'tech',
  'hyd-pnq': 'tech',
  'mum-pnq': 'tech',
  'blr-pnq': 'tech',
  // pilgrim
  'maa-tir': 'pilgrim',
  'blr-tir': 'pilgrim',
  'hyd-tir': 'pilgrim',
  'maa-mdu': 'pilgrim',
  'maa-mdu-ecr': 'pilgrim',
  'blr-mdu': 'pilgrim',
  'maa-kkm': 'pilgrim',
  'maa-rmd': 'pilgrim',
  'blr-udp': 'pilgrim',
  // leisure
  'maa-pdy': 'leisure',
  'blr-pdy': 'leisure',
  'blr-goa': 'leisure',
  'maa-goa': 'leisure',
  'hyd-goa': 'leisure',
  'mlr-goa': 'leisure',
  'hbl-goa': 'leisure',
  'mum-goa': 'leisure',
  'pnq-goa': 'leisure',
  'maa-mys': 'leisure',
  // marathon (shorter than the 13h rule but run like one)
  'maa-ten': 'marathon',
}

/** Hauls this long run like marathons unless listed above. */
const MARATHON_HOURS = 13

function reversedId(routeId: string): string {
  const [a, b, ...rest] = routeId.split('-')
  return [b, a, ...rest].join('-')
}

export function corridorArchetype(routeId: string): CorridorArchetype {
  const explicit = EXPLICIT[routeId] ?? EXPLICIT[reversedId(routeId)]
  if (explicit) return explicit
  const route = ROUTES[routeId] ?? ROUTES[reversedId(routeId)]
  if (route && route.hours >= MARATHON_HOURS) return 'marathon'
  return 'commercial'
}

/**
 * Madurai is a hometown city as much as a temple town: its corridors keep the
 * original hometown occupancy table (it was calibrated on Chennai–Madurai),
 * while still shopping like a pilgrim crowd elsewhere in the model.
 */
const HOMETOWN_PATTERN = new Set(['maa-mdu', 'mdu-maa', 'maa-mdu-ecr', 'mdu-maa-ecr', 'blr-mdu', 'mdu-blr'])

/** Which occupancy pattern a corridor follows. */
export function occupancyPatternFor(routeId: string): ArchetypeOccupancyPattern {
  if (HOMETOWN_PATTERN.has(routeId)) return ARCHETYPE_OCCUPANCY.commercial
  return ARCHETYPE_OCCUPANCY[corridorArchetype(routeId)]
}

type Band = [number, number]
/** [homebound band, return band]: homebound = from the bigger city toward the smaller one. */
type DirBands = [Band, Band]

export interface ArchetypeOccupancyPattern {
  weekly: { fri: DirBands; sat: DirBands; sun: DirBands; midweek: DirBands }
  festival: { pre: DirBands; day: DirBands; postFirst: DirBands; postLate: DirBands }
}

/**
 * Occupancy bands for a well-positioned 4.5★ operator, by route type.
 * `commercial` is the original hometown table (Chennai → Madurai style).
 */
export const ARCHETYPE_OCCUPANCY: Record<CorridorArchetype, ArchetypeOccupancyPattern> = {
  commercial: {
    weekly: {
      fri: [[0.80, 0.95], [0.55, 0.75]],
      sat: [[0.65, 0.85], [0.65, 0.85]],
      sun: [[0.50, 0.70], [0.80, 0.95]],
      midweek: [[0.55, 0.78], [0.45, 0.68]],
    },
    festival: {
      pre: [[0.90, 1.00], [0.60, 0.85]],
      day: [[0.40, 0.75], [0.40, 0.75]],
      postFirst: [[0.60, 0.85], [0.90, 1.00]],
      postLate: [[0.50, 0.75], [0.90, 1.00]],
    },
  },
  // Both ends are metros: weekend trips home are strong, and midweek
  // business travel keeps both directions healthy.
  tech: {
    weekly: {
      fri: [[0.82, 0.97], [0.65, 0.85]],
      sat: [[0.55, 0.75], [0.55, 0.75]],
      sun: [[0.62, 0.82], [0.82, 0.97]],
      midweek: [[0.58, 0.80], [0.55, 0.77]],
    },
    festival: {
      pre: [[0.90, 1.00], [0.65, 0.88]],
      day: [[0.40, 0.70], [0.40, 0.70]],
      postFirst: [[0.62, 0.85], [0.90, 1.00]],
      postLate: [[0.55, 0.78], [0.90, 1.00]],
    },
  },
  // Devotees travel on weekends and for the festival itself, both ways.
  pilgrim: {
    weekly: {
      fri: [[0.75, 0.92], [0.55, 0.75]],
      sat: [[0.75, 0.92], [0.62, 0.82]],
      sun: [[0.48, 0.68], [0.80, 0.95]],
      midweek: [[0.45, 0.68], [0.42, 0.64]],
    },
    festival: {
      pre: [[0.90, 1.00], [0.70, 0.90]],
      day: [[0.70, 0.95], [0.70, 0.95]],
      postFirst: [[0.65, 0.85], [0.90, 1.00]],
      postLate: [[0.55, 0.78], [0.85, 1.00]],
    },
  },
  // Getaways: out Friday and Saturday, back Sunday, quiet midweek.
  leisure: {
    weekly: {
      fri: [[0.85, 1.00], [0.40, 0.60]],
      sat: [[0.70, 0.90], [0.50, 0.70]],
      sun: [[0.35, 0.55], [0.85, 1.00]],
      midweek: [[0.35, 0.58], [0.35, 0.58]],
    },
    festival: {
      pre: [[0.90, 1.00], [0.50, 0.70]],
      day: [[0.55, 0.85], [0.45, 0.70]],
      postFirst: [[0.50, 0.70], [0.90, 1.00]],
      postLate: [[0.45, 0.65], [0.85, 1.00]],
    },
  },
  // A 13h+ trip is planned, not a weekend hop: the week matters less.
  marathon: {
    weekly: {
      fri: [[0.72, 0.90], [0.60, 0.80]],
      sat: [[0.62, 0.82], [0.62, 0.82]],
      sun: [[0.55, 0.75], [0.72, 0.90]],
      midweek: [[0.55, 0.75], [0.50, 0.72]],
    },
    festival: {
      pre: [[0.90, 1.00], [0.60, 0.85]],
      day: [[0.40, 0.75], [0.40, 0.75]],
      postFirst: [[0.60, 0.85], [0.90, 1.00]],
      postLate: [[0.50, 0.75], [0.90, 1.00]],
    },
  },
}
