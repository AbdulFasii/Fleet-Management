import { Cr } from './core/money'
import type { Scenario } from './types'
import { GAME_START_DAY, ymKey } from './core/calendar'
import { BAL, DIFFICULTIES } from './data/balance'
import type { Difficulty, GameState, BodyBuilder } from './types'
import { capitalIn, emptyMonth } from './sim/finance'
import { refreshMarkets } from './sim/fleet'
import { refreshHiringPool, defaultHrAutoFire } from './sim/staffing'
import { generateTrips } from './sim/booking'
import { pushLog } from './sim/log'
import { refreshOdLimit } from './sim/banking'
import { ROUTE_LIST, ROUTES, RIVALS, routeName } from './data/routes'
import { RIVALS_DATA, seedRouteShare } from './data/rivals'
import { fmtCompact, rs } from './core/money'
import { nextId } from './core/ids'
import { GROUP_PALETTE } from './sim/groups'
import { cloneDefaultBodyBuilders } from './data/bodyBuilders'

export const SAVE_VERSION = 33

export function initialBrandCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  let code = ''
  if (words.length >= 2) {
    code = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
  } else if (words.length === 1 && words[0].length >= 2) {
    code = words[0].slice(0, Math.min(4, words[0].length)).toUpperCase()
  }
  if (!code || code.length < 2) code = 'MAIN'
  return code
}

/** Starter routes: no reputation gate. */
export function starterRoutes(): string[] {
  return ROUTE_LIST
    .filter((r) => r.unlockRep === 0)
    .sort((a, b) => routeName(a.id).localeCompare(routeName(b.id)))
    .map((r) => r.id)
}

export function newGame(
  name: string,
  difficulty: Difficulty,
  homeRouteId: string,
  seed: number,
  initialBodyBuilders?: Record<string, BodyBuilder>,
  scenario: Scenario = 'standard',
): GameState {
  const day = GAME_START_DAY
  const preset = DIFFICULTIES.find((d) => d.id === difficulty)!

  const s: GameState = {
    version: SAVE_VERSION,
    seed,
    day,
    startDay: day,
    difficulty,
    ids: { next: 1 },

    company: {
      name,
      cash: 0,
      rating: 3.4,
      ratingCount: 0,
      punctuality: 0.9,
      cancelRate: 0,
      primo: false,
      primoOffered: false,
      reputation: 5,
      brandAwareness: 0.05,
      app: { tier: 0, installs: 0, mau: 0, monthlyMarketing: 0 },
      creditScore: preset.startCredit,
      gstPayable: 0,
      taxProvision: 0,
      advanceTaxPaid: 0,
      fyRevenue: 0,
      fyProfit: 0,
      homeCityId: ROUTES[homeRouteId]?.from ?? 'maa',
      crmPolicy: 'ask',
      grievanceCount: 0,
      crmRefundTotal: 0,
      crmRefundCount: 0,
      gstInputCredit: 0,
      tdsPayable: 0,
      attachOwnerPayable: 0,
      tdsFiledThroughDay: 0,
      cmvrOffenceCount: 0,
      cmvrSuspendUntilDay: -1,
      depreciationDefault: 'SLM',
      safeTripStreak: 0,
      cargoLifeRevenue: 0,
      workshopTyreBrand: 'oem',
      hrAutoHire: { enabled: false, mode: 'unlimited', byRole: { driver: [4, 5, 6, 7, 8, 9, 10] } },
      hrAutoRaise: false,
      hrAutoFire: defaultHrAutoFire(),
      opsAutoStaff: true,
      charterConfig: {
        pricingStrategy: 'market',
        operatingBaseCityId: ROUTES[homeRouteId]?.from ?? 'maa',
        autoAccept: false,
        autoDispatch: true,
        minConditionScore: 50,
      },
    },
    workshop: { level: 0, bays: 0, mechanicIds: [], locations: [] },
    config: {
      odoHighlightKm: BAL.odoHighlightDefaultKm,
      autoRenewDocs: true,
      cargoBaseRateRs: BAL.cargoBaseRateDefaultRs,
      cargoPricingType: 'normal',
      mealAllowance: false,
      healthCoverage: false,
      festivalBonus: true,
      pauseOnLowCash: true,
      lowCashThreshold: rs(100_000),
      pauseOnBreakdown: true,
      pauseOnDocExpiry: true,
      pauseOnStrikeRisk: true,
      pauseOnMonthEnd: false,
      pauseOnDecision: false,
      speedGovernor: 'normal',
      preventiveServiceThreshold: 75,
      tyreReplacementKmThreshold: 15_000,
      preferredTyreBrand: 'oem',
      dynamicYieldSurge: true,
      lastMinuteDiscount: false,
      emergencyReserveBuffer: rs(200_000),
    },

    buses: {},
    bodyBuilders: initialBodyBuilders
      ? JSON.parse(JSON.stringify(initialBodyBuilders))
      : cloneDefaultBodyBuilders(),
    busOrders: [],
    usedMarket: [],
    leaseOffers: [],
    attachOffers: [],
    marketRefreshDay: 0,

    staff: {},
    hiringPool: [],
    poolRefreshDay: 0,
    payrollDay: BAL.payrollDayOfMonth,

    permits: {},
    schedules: {},
    trips: {},
    openTripIds: [],

    loans: {},
    od: { limit: 0, drawn: 0, rateBps: BAL.odRateBps, accruedInterest: 0 },
    receivables: [],
    txns: [],
    monthly: [],
    curMonth: emptyMonth(ymKey(day)),

    routeStats: {},
    routeHistory: {},

    depotSlots: BAL.depot?.baseSlots ?? 4,
    yards: [],
    insuranceClaims: [],
    festivalSpecials: [],
    seasonalStats: {
      lifetime: { trips: 0, revenue: 0, expenses: 0, profit: 0, pax: 0, seatKm: 0, paxKm: 0 },
      history: [],
    },
    charterContracts: [],
    charterInquiries: [],
    charterHistory: [],
    charterStats: { totalContracts: 0, totalRevenue: 0, totalProfit: 0, avgRating: 4.8 },

    world: {
      dieselPaise: BAL.dieselBase,
      fareIndex: Object.fromEntries(ROUTE_LIST.map((r) => [r.id, 1])),
      demandShock: {},
      closures: {},
      redbusCommissionBps: BAL.redbusCommissionBps,
      expressways: [],
      priceWars: {},
      strikeUntilDay: -1,
      rtoCrackdownUntilDay: -1,
      evSubsidyUntilDay: -1,
      rivals: { ...RIVALS_DATA },
      share: Object.fromEntries(
        ROUTE_LIST.map((r) => [
          r.id,
          seedRouteShare(
            r.id,
            r.competition,
            RIVALS[r.id],
            r.id === homeRouteId ? Math.round((1 - r.competition) * 40) : 0,
          ),
        ]),
      ),
      shareHistory: {},
    },
    inbox: [],
    decisions: [],
    kpis: [],
    achievements: {},
    peakFleet: 0,
    lifetimeProfit: 0,
    groups: {},
  }

  const initCode = initialBrandCode(name)
  const grpId = nextId(s.ids, 'grp')
  s.groups = s.groups ?? {}
  s.groups[grpId] = {
    id: grpId,
    name,
    code: initCode,
    color: GROUP_PALETTE[0],
    foundedDay: day,
    status: 'active',
    rating: s.company.rating,
    ratingCount: 0,
    cancelRate: 0,
    primo: false,
    primoOffered: false,
    defaultAmenities: { waterBottle: false, snackHamper: false, sanitizedBedding: false },
    defaultFittings: {},
    defaultServiceTier: 'standard',
    defaultCancellation: 'standard',
  }

  // seed capital & credit line (credit floor + equity-linked headroom)
  capitalIn(s, 'seed_capital', preset.seedCapital, { note: 'promoter capital' })
  s.scenario = scenario
  if (scenario === 'sandbox') capitalIn(s, 'seed_capital', Cr(10), { note: 'sandbox funds' })
  refreshOdLimit(s)

  // the home-route permit comes pre-granted so day 1 is playable
  s.permits[homeRouteId] = {
    routeId: homeRouteId,
    status: 'active',
    appliedDay: day - 30,
    activeFromDay: day,
    expiryDay: day + 365,
  }

  refreshMarkets(s)
  refreshHiringPool(s)
  generateTrips(s)

  pushLog(s, 'good', `${name} is registered! Seed capital ${fmtCompact(preset.seedCapital)}, overdraft limit ${fmtCompact(s.od.limit)}, credit score ${s.company.creditScore}.`)
  pushLog(s, 'good', `Your permit on ${routeName(homeRouteId)} is active. Buy a bus, hire a crew, create a schedule — then advance the day.`)

  return s
}
