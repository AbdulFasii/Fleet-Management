import type { LoungeAmenityId, LoungeSeating, LoungeTier, LoungeTierDef, PassengerHandlingConfig, PassengerLounge } from '../types'
import { rs } from '../core/money'
import { CITIES } from './cities'

export const LOUNGE_TIERS: Record<LoungeTier, LoungeTierDef> = {
  express: {
    id: 'express',
    name: 'Royal Express Lounge',
    label: 'Express (600 sq ft)',
    sqft: 600,
    seats: 20,
    setupCost: rs(400_000), // ₹4 Lakh setup CapEx
    dailyRent: rs(600), // ~₹18,000 / mo
    dailyElectricity: rs(200), // ~₹6,000 / mo
    dailyStaffWage: rs(500), // Front desk attendant (flat cut, ~₹15,000 / mo)
    avgSnackSpend: rs(22), // Tea, filter coffee, biscuits, packaged water
    snackMargin: 0.50, // 50% net profit margin on snack counter
    demandBoostPct: 0.0075, // +0.75% passenger booking conversion (halved from +1.5%)
    maxDailyPaxCapacity: 150,
    desc: 'Compact air-conditioned boarding waiting room with cushioned seats, mobile charging stations, water dispenser, and snack counter. Ideal for high-turnover pickup points.',
    features: [
      'Split AC & 20 cushioned waiting seats',
      'Tea, filter coffee & cold beverage counter',
      'Mobile device charging ports',
      'Digital departure board',
      'Clean passenger washroom',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Royal Premium Lounge & Tour Office',
    label: 'Premium (1,500 sq ft)',
    sqft: 1500,
    seats: 45,
    setupCost: rs(1_200_000), // ₹12 Lakh setup CapEx
    dailyRent: rs(1_600), // ~₹48,000 / mo
    dailyElectricity: rs(550), // ~₹16,500 / mo
    dailyStaffWage: rs(1_100), // 2 staff: desk attendant + hospitality (~₹33,000 / mo)
    avgSnackSpend: rs(38), // Espresso, fresh juices, packaged sandwiches, snacks
    snackMargin: 0.52, // 52% margin
    demandBoostPct: 0.015, // +1.5% passenger booking conversion (halved from +3.0%)
    maxDailyPaxCapacity: 400,
    desc: 'Spacious 1,500 sq. ft. lounge featuring recliners, cafe counter, cloakroom, and dedicated Tour & Charter Booking Office. Unlocks private charter operations from this city.',
    features: [
      '45 plush recliners & sofa seating',
      'Cafe bar with espresso, bakery & cold drinks',
      'High-speed optical Wi-Fi & USB-C fast charging',
      'Cloakroom / luggage handling rack',
      'Tour & Private Charter Booking Branch desk',
      'Dedicated boarding assistance concierge',
    ],
  },
  business: {
    id: 'business',
    name: 'Royal Business Lounge & Executive Hub',
    label: 'Executive (3,200 sq ft)',
    sqft: 3200,
    seats: 90,
    setupCost: rs(2_800_000), // ₹28 Lakh setup CapEx
    dailyRent: rs(3_500), // ~₹1,05,000 / mo
    dailyElectricity: rs(1_200), // ~₹36,000 / mo
    dailyStaffWage: rs(2_200), // 3 staff: concierge, cafe manager & security (~₹66,000 / mo)
    avgSnackSpend: rs(65), // Full gourmet cafe menu, snacks, energy drinks, paid luggage cloaking
    snackMargin: 0.55, // 55% margin
    demandBoostPct: 0.025, // +2.5% passenger booking conversion (halved from +5.0%)
    maxDailyPaxCapacity: 900,
    desc: 'Flagship executive transit lounge with leather recliners, quiet work pods, shower suite, cafe dining, and 24/7 security. Unlocks maximum passenger conversion and charter inquiries.',
    features: [
      '90 executive leather recliners & work pods',
      'Full gourmet cafe & beverage lounge',
      'Private executive rest & shower suite',
      'Priority express boarding gate',
      '24/7 CCTV surveillance & baggage tracking',
      'Regional Charter & Corporate Booking Headquarters',
    ],
  },
}

/** Prominent boarding clusters / locations across Indian transit cities */
export const CITY_BOARDING_CLUSTERS: Record<string, string[]> = {
  maa: [
    'Kilambakkam KCBT (New South Terminus)',
    'Koyambedu Omni Bus Stand (Central)',
    'Guindy / Ashok Pillar Hub',
    'Perungalathur Highway Boarding Point',
  ],
  blr: [
    'Madiwala St. John’s Transit Hub',
    'Kalasipalya / Majestic Central',
    'Electronic City Toll Hub',
    'Anand Rao Circle / Majestic',
  ],
  cbe: [
    'Gandhipuram Omni Bus Stand Hub',
    'Hope College / Peelamedu Junction',
    'Ukkadam Bypass Terminal',
  ],
  mdu: [
    'Mattuthavani Omni Bus Stand Hub',
    'Periyar Bus Stand / Railway Station',
    'Arapalayam Transit Point',
  ],
  try: [
    'Central Bus Stand (Cantonment)',
    'Mannarpuram Highway Bypass',
    'Chatram Bus Stand',
  ],
  slm: [
    'New Bus Stand AVR Circle',
    'Seelanaickenpatti Highway Bypass',
    'Kondalampatti Toll Junction',
  ],
  erd: [
    'Erode Central Bus Stand',
    'Perundurai Toll Bypass',
  ],
  koc: [
    'Vyttila Mobility Hub',
    'Edappally Toll Junction',
    'Aluva Highway Bypass',
  ],
  trv: [
    'Thampanoor Central Stand',
    'Kazhakkoottam Technopark Hub',
  ],
  hyd: [
    'Ameerpet / SR Nagar Hub',
    'Kukatpally / KPHB Colony',
    'MGBS / Afzalgunj Central',
    'Gachibowli / ORR Junction',
  ],
  mum: [
    'Borivali West Gokul Hotel Hub',
    'Dadar Asiad Stand (Central)',
    'Vashi Plaza (Navi Mumbai)',
    'Sion Circle / Chembur',
  ],
  pnq: [
    'Swargate Omni Bus Stand',
    'Wakad / Hinjawadi Bridge',
    'Viman Nagar / Kharadi Bypass',
  ],
  viz: [
    'Dwaraka Bus Station (RTC Complex)',
    'Gajuwaka Junction',
  ],
  vga: [
    'Pandit Nehru Bus Station (PNBS)',
    'Benz Circle Terminal',
  ],
}

/** Get boarding clusters for a city with sensible default fallback */
export function getCityBoardingClusters(cityId: string): string[] {
  if (CITY_BOARDING_CLUSTERS[cityId] && CITY_BOARDING_CLUSTERS[cityId].length > 0) {
    return CITY_BOARDING_CLUSTERS[cityId]
  }
  const name = CITIES[cityId]?.name ?? cityId.toUpperCase()
  return [
    `${name} Omni Bus Stand Hub`,
    `${name} Highway Bypass Terminal`,
    `${name} Railway Station / Central Circle`,
  ]
}

export function getLoungeTierDef(tier: LoungeTier): LoungeTierDef {
  return LOUNGE_TIERS[tier] ?? LOUNGE_TIERS.express
}

/* ============================ seating + amenity packages ============================ */

const TIER_RANK: Record<LoungeTier, number> = { express: 0, premium: 1, business: 2 }

export interface LoungeSeatingDef {
  id: LoungeSeating
  label: string
  /** Multiplies the tier's seat count and daily passenger capacity. */
  seatMult: number
  /** Passenger satisfaction points added to trips boarding here. */
  comfort: number
  /** Added to the route booking-conversion boost (absolute, e.g. 0.004 = +0.4 points). */
  conv: number
  /** Share of the tier setup cost added (or saved) when fitting out. */
  setupPct: number
  minTier: LoungeTier
}

export const LOUNGE_SEATING: Record<LoungeSeating, LoungeSeatingDef> = {
  bench: { id: 'bench', label: 'Bench seating', seatMult: 1.25, comfort: -0.04, conv: -0.0015, setupPct: -0.1, minTier: 'express' },
  cushioned: { id: 'cushioned', label: 'Cushioned seats', seatMult: 1, comfort: 0, conv: 0, setupPct: 0, minTier: 'express' },
  recliner: { id: 'recliner', label: 'Recliners', seatMult: 0.8, comfort: 0.08, conv: 0.002, setupPct: 0.25, minTier: 'express' },
  pods: { id: 'pods', label: 'Recliners and work pods', seatMult: 0.65, comfort: 0.14, conv: 0.0035, setupPct: 0.45, minTier: 'premium' },
}
export const LOUNGE_SEATING_ORDER: LoungeSeating[] = ['bench', 'cushioned', 'recliner', 'pods']

export interface LoungeAmenityDef {
  id: LoungeAmenityId
  label: string
  /** Fixed running cost per day. */
  daily: number
  /** Running cost per waiting passenger. */
  perPax: number
  /** Extra share of departing passengers who use the lounge. */
  capture: number
  /** Extra snack spend per passenger (share, e.g. 0.2 = +20%). */
  spend: number
  comfort: number
  conv: number
  minTier: LoungeTier
}

export const LOUNGE_AMENITIES: LoungeAmenityDef[] = [
  { id: 'tea', label: 'Free tea and coffee', daily: 0, perPax: rs(4), capture: 0.12, spend: 0, comfort: 0.08, conv: 0.001, minTier: 'express' },
  { id: 'wifi', label: 'Wi-Fi and fast charging', daily: rs(50), perPax: 0, capture: 0, spend: 0, comfort: 0.05, conv: 0.0005, minTier: 'express' },
  { id: 'assist', label: 'Boarding alerts and assistance', daily: rs(30), perPax: 0, capture: 0, spend: 0, comfort: 0.07, conv: 0.001, minTier: 'express' },
  { id: 'cctv', label: 'CCTV and luggage security', daily: rs(40), perPax: 0, capture: 0, spend: 0, comfort: 0.05, conv: 0.0005, minTier: 'express' },
  { id: 'cafe', label: 'Full cafe menu', daily: rs(90), perPax: 0, capture: 0.03, spend: 0.2, comfort: 0.02, conv: 0, minTier: 'premium' },
  { id: 'rest', label: 'Rest rooms and showers', daily: rs(120), perPax: 0, capture: 0.05, spend: 0, comfort: 0.06, conv: 0.0015, minTier: 'premium' },
]

export const LOUNGE_AMENITY_PRESETS: { id: string; label: string; amenities: LoungeAmenityId[] }[] = [
  { id: 'essentials', label: 'Essentials', amenities: [] },
  { id: 'comfort', label: 'Comfort', amenities: ['tea', 'wifi'] },
  { id: 'full', label: 'Full service', amenities: ['tea', 'wifi', 'assist', 'cctv'] },
  { id: 'executive', label: 'Executive', amenities: ['tea', 'wifi', 'assist', 'cctv', 'cafe', 'rest'] },
]

export function tierAllows(tier: LoungeTier, min: LoungeTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min]
}

export function amenityDef(id: LoungeAmenityId): LoungeAmenityDef {
  return LOUNGE_AMENITIES.find((a) => a.id === id)!
}

/** Amenities a lounge actually offers: its own package, or (older saves) the network policy from Settings. */
export function loungeAmenityIds(l: Pick<PassengerLounge, 'amenities' | 'tier'>, cfg?: PassengerHandlingConfig): LoungeAmenityId[] {
  const own = l.amenities
  const ids: LoungeAmenityId[] = own
    ? own
    : [
        cfg?.complimentaryTeaCoffee ? 'tea' : null,
        cfg?.freeHighSpeedWifi ? 'wifi' : null,
        cfg?.boardingAssistanceAlerts ? 'assist' : null,
        cfg?.cctvLuggageSecurity ? 'cctv' : null,
      ].filter(Boolean) as LoungeAmenityId[]
  return ids.filter((id) => tierAllows(l.tier, amenityDef(id).minTier))
}

export function loungeSeatingDef(l: Pick<PassengerLounge, 'seating'>): LoungeSeatingDef {
  return LOUNGE_SEATING[l.seating ?? 'cushioned']
}

/** Everything a lounge package changes, in one place. Used by the sim and the open/refit screens. */
export function loungePackage(
  tier: LoungeTier,
  seating: LoungeSeating,
  amenities: LoungeAmenityId[],
): {
  seats: number
  capacity: number
  setupCost: number
  dailyFixed: number
  perPax: number
  capture: number
  spend: number
  comfort: number
  conversion: number
} {
  const t = LOUNGE_TIERS[tier]
  const seat = LOUNGE_SEATING[seating]
  const ams = amenities.map(amenityDef).filter((a) => tierAllows(tier, a.minTier))
  return {
    seats: Math.round(t.seats * seat.seatMult),
    capacity: Math.round(t.maxDailyPaxCapacity * seat.seatMult),
    setupCost: Math.round(t.setupCost * (1 + seat.setupPct)),
    dailyFixed: t.dailyRent + t.dailyElectricity + t.dailyStaffWage + ams.reduce((a, x) => a + x.daily, 0),
    perPax: ams.reduce((a, x) => a + x.perPax, 0),
    capture: ams.reduce((a, x) => a + x.capture, 0),
    spend: ams.reduce((a, x) => a + x.spend, 0),
    comfort: seat.comfort + ams.reduce((a, x) => a + x.comfort, 0),
    conversion: Math.max(0, t.demandBoostPct + seat.conv + ams.reduce((a, x) => a + x.conv, 0)),
  }
}

/** The package of an existing lounge (handles older saves that have no package fields). */
export function loungePackageOf(l: PassengerLounge, cfg?: PassengerHandlingConfig) {
  return loungePackage(l.tier, l.seating ?? 'cushioned', loungeAmenityIds(l, cfg))
}
