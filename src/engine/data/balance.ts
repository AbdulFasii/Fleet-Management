/**
 * Every tunable constant in the economy, in one place, in rupees
 * (converted to paise via rs/L/Cr). Balancing = editing this file only.
 */
import { rs, L, Cr, type Money } from '../core/money'
import { dow, festivalRunEffect } from '../core/calendar'
import { CITIES } from './cities'
import type { BusClassId, CancellationPolicy, Difficulty, RouteDef, StaffRole } from '../types'

export const BAL = {
  /* ---------------- fuel & consumables ---------------- */
  dieselBase: rs(94.5), // per litre
  dieselWalkSd: 0.0035, // daily random walk sd
  dieselMin: rs(82),
  dieselMax: rs(118),
  adbluePctOfFuel: 0.05,
  electricCostPerKm: rs(21), // energy cost for EV buses
  acFuelPenalty: 1.12, // legacy; coach book km/l already includes AC
  loadFuelPenalty: 0.06, // coach: a few percent around a typical 70% load. Book km/l is that load.
  /** Full payload vs empty. A loaded truck drinks far more than a coach's 6% bump. */
  cargoLoadFuelPenalty: 0.40,

  /* ---------------- per-trip operating cost ---------------- */
  driverBataMin: rs(350), // short hop
  driverBataMax: rs(1000), // long haul
  driverBataKmLo: 200, // at-or-below this km → min bata
  driverBataKmHi: 1000, // at-or-above this km → max bata
  conductorBata: rs(150),
  parkingCleaningPerTrip: rs(250),
  terminusCleanCost: rs(500), // terminus turnaround cleaning
  deepCleanCost: rs(3_200), // workshop deep clean (restores to 95)

  /** Optional vinyl / livery / badge swap when a coach moves onto a different brand. */
  rebrandCost: L(1),

  /* ---------------- side revenue ---------------- */
  /** Default ₹/kg per 100 km — player can override in Settings (cargoBaseRateRs). */
  cargoBaseRateDefaultRs: 1,
  cargoShortRouteMult: 1.5, // < 300 km express parcel premium
  cargoLongRouteMult: 0.8, // > 800 km bulk discount
  cargoManagerFillFloor: 0.40, // without manager capped at 40%
  cargoManagerFillPerSkill: 0.05, // with manager up to 85%
  cargoNoManagerRatePenalty: 0.4, // 40% rate cut without a manager
  fragilePremium: 0.2, // +25% rate for fragile cargo
  fragileLiabilityMin: rs(5_000),
  fragileLiabilityMax: rs(20_000),
  /** Share of corridor parcel demand our brand can win (manager skill scales this). */
  cargoMarketShare: 0.25,
  cargoNoManagerShare: 0.10,
  /** Spot offer + counter walk-in parcel volume vs full book (1 = prior rate). */
  cargoAdHocParcelMult: 0.75,
  /** Base scale for lane gravity freight market (kg/day before operator share). */
  cargoGravityK: 16_000,
  /** Directional imbalance thresholds (forward / reverse ratio). */
  cargoImbalanceHeadhaul: 1.25,
  cargoImbalanceBackhaul: 0.80,
  /** Volumetric density standards (kg per CBM). */
  cargoDensity: {
    hardware: 250,
    mixed: 167,
    agri: 140,
    textiles: 120,
    fmcg: 120,
  } as Record<string, number>,
  /**
   * Parcel desk selling power vs an average private operator's counter, at a
   * mid-skill manager: our parcel book = our departure share x this x desk.
   */
  cargoParcelCaptureScale: 1.15,
  /** How hard this corridor's crowd ships, on top of its passenger demand. */
  cargoArchetypeIntensity: { tech: 1.1, commercial: 1.15, pilgrim: 0.85, leisure: 0.8, marathon: 0.95 } as Record<string, number>,
  /** Live contracts may promise at most this share of the lane's book. */
  cargoContractBookShare: 0.6,
  /**
   * Hard ceiling on promised kilograms per lane per day, so two contracts can
   * never promise more than the departures on that corridor can lift.
   */
  cargoContractDailyCapParcelKg: 1_800,
  cargoContractDailyCapBulkKg: 3_600,
  /** Corporate contracts annual capacity growth rate range: fluctuates between -10% (-0.10) and +20% (+0.20) based on annual profit vs loss. */
  cargoCorporateOfferGrowthMinPct: -0.10,
  cargoCorporateOfferGrowthMaxPct: 0.20,
  /** Corporate contracts baseline fallback rate (retained for backward compatibility). */
  cargoCorporateOfferAnnualGrowthPct: 0.05,
  /** Courier lots and bulk lots are capped separately, so a lane shows 2–4 deals. */
  cargoMaxContractsPerLane: 2,
  /** Retired as governor — departures load all available book up to bay capacity. */
  cargoTargetUtilization: 1.0,
  /** Spread around that aim. 0.4 → about 0.6×–1.4×. */
  cargoLoadJitter: 0.4,
  /** Quiet departures leave empty even when some freight is waiting. */
  cargoEmptyChance: 0.06,
  /** Crowded passenger corridors leave less of the freight book for one operator. */
  cargoShareCompetitionDamp: 0.35,
  /** Subsidiary desk wins a bit more of the same finite book. It does not create freight. */
  cargoSubsidiaryShareBonus: 0.15,
  /** How hard a lane's freight book reacts to our posted rate. Above 1 = shippers walk. */
  cargoPriceElasticity: 1.3,
  /** Weekday cargo (Sun..Sat). Offices ship Mon–Fri; Sat half; Sun quieter. */
  cargoDowMult: [0.62, 1.08, 1.02, 1.00, 1.04, 1.12, 0.78] as number[],
  /** Coolie loading charge at the origin dock, per kg handled (12 paise/kg). */
  cargoLoadingPaisePerKg: 12,
  /** Coolie unloading charge at the destination dock, per kg handled (8 paise/kg). */
  cargoUnloadingPaisePerKg: 8,
  /**
   * Truck part-load rate as a fraction of the parcel slider.
   * Default parcel ₹2.50 → about ₹0.90/kg per 100 km. Capped so a high parcel
   * slider cannot price a 26T like a courier desk.
     */
  cargoTruckRateVsParcel: 0.36,
  cargoTruckRateCapRs: 1.25,
  /** Signed contracts land just under the posted rate (volume discount). */
  cargoContractRateLo: 0.86,
  cargoContractRateHi: 0.94,
  /** Fee on promised kilograms that never left the dock, as a share of that freight. */
  cargoShortfallFeePct: 0.15,
  adIncomePerBusMonth: 0, // body advertising removed

  /* ---------------- channels ---------------- */
  redbusCommissionBps: 800, // 5%
  redbusSettleDays: 5,
  redDealExtraBps: 300, // promo costs +3% commission
  redDealVisibility: 1.3,
  ownappPgBps: 200, // 2% payment gateway
  ownappSettleDays: 2,
  counterCommissionBps: 1000, // agents 10%
  primoVisibility: 1.28,
  primoCommissionExtraBps: 100,
  // own app
  appBuildCost: [0, L(3), L(8), L(15)] as Money[], // tier 0..3
  appMonthlyOpex: [0, rs(15_000), rs(40_000), rs(90_000)] as Money[],
  appCac: rs(200), // India Android travel UA ~₹250–450/install; ₹100 was unrealistically cheap
  appInstallToMauRatio: 0.35,
  appMauChurnMonthly: 0.12,
  appOrganicInstallsPerPax: 0.06, // redbus riders discovering the app
  /** MAU at which raw own-app weight ≈ RedBus baseline (1.0) before tier bonuses. */
  appMauForParity: 35_000,
  /** Soft ceiling on own-app channel weight (can exceed RedBus so mix can pass ~50%). */
  appMaxChannelWeight: 3.0,
  /** Growing own-app pulls listing share off RedBus (0 = no cannibalization). */
  appDisplaceRedbus: 0.55,

  /* ---------------- fare composition ---------------- */
  autoPriceAdjMax: 0.03, // occupancy yield band ±3% inside last 3 days
  /** Calendar fare swings — weekday discount, weekend/festival surge. */
  fareCalendar: {
    dowMult: [1.25, 1.00, 1.00, 1.00, 1.00, 1.00, 1.25] as number[], // Sun..Sat (Sat/Sun 125%, Mon-Fri normal)
    seasonWeight: 0.90,
    festivalWeight: 0.55,
    weekdayFloor: 0.85,
    peakCap: 2.50,
    peakCapNormal: 2.50,
    peakCapDiwaliWeekend: 3.00,
    lastMinSurgeDays: 3,
    lastMinFullSurge: 0.03,
    /** Thin nights are discounted gently — a deep cut refills them and erases the spread. */
    lastMinEmptyCut: 0.03,
    manualOccWeight: 0.40,
    /** Yield slope on occupancy vs pace. */
    yieldSlope: 0.25,
    /** Behind-pace discount as a share of the ahead-of-pace surge (1 = symmetric). */
    yieldDownScale: 0.45,
    /** A trip must trail pace by this much occupancy before any discount applies. */
    yieldDownDeadband: 0.06,
  },

  /* ---------------- demand model ---------------- */
  /**
   * A marketplace, not a pile of nudges. Each corridor has a daily pax pool
   * spread across the clock, rival operators park seats against that clock,
   * and our bus wins a share of the shoppers looking at our departure window.
   *
   * Calibration anchors for Indian private intercity AC services:
   *   - operator fleet LF averages 65-72%; strong brands hold the high 70s
   *   - lean-season Tue/Wed sleepers run 45-60%; festival dates sell out
   *   - the 10-day board shows the book already on sale: a fair coach is
   *     roughly 35-55% a week out and 55-75% inside two days. Off-peak and
   *     overpriced trips stay thinner because their target LF is lower.
   *   - inside one corridor and window, fare substitution is sharp (share
   *     elasticity ~2) while the corridor's own pool barely moves on price
   */
  market: {
    /** LF the rival supply settles at on an average corridor. */
    equilibriumLf: 0.71,
    /** route.competition at which equilibriumLf applies as-is. */
    competitionRef: 0.65,
    /**
     * Contested corridors run surplus seats, so everyone's LF sags. Kept
     * mild: the crowded corridors are also the fat ones, and baseDemand
     * already pays for that separately.
     */
    equilibriumLfPerCompetition: 0.20,
    /** Sharper rivals (VRL / Orange grade) on contested corridors. */
    rivalAttrPerCompetition: 0.20,
    /**
     * How rival supply answers demand. A fixed timetable runs all week, so a
     * Friday is genuinely fuller than a Tuesday and only some operators add
     * weekend extras. Seasons get a real answer — festival specials, summer
     * fleets — but no corridor can conjure three times its buses for Diwali,
     * so past the cap demand wins and dates sell out.
     */
    supplyElasticityWeekly: 0.35,
    supplyElasticitySeason: 0.85,
    supplySurgeCap: 1.35,
    /** Rival seats concentrate against demand — peak slots are heavily contested. */
    supplyPeakExp: 0.84,
    /** How much of the clock profile the corridor's hidden peak can shape. */
    hiddenPeakFloor: 0.62,
    /**
     * How far apart (min) two departures still compete for the same shopper.
     * Someone who wants to leave at 21:00 will take 22:00 and grumble at
     * 23:30; they will not take 04:00, so the tail has to die off.
     */
    substitutionDecay: [
      [30, 1.00],
      [60, 0.80],
      [120, 0.46],
      [180, 0.24],
      [300, 0.09],
      [1440, 0.02],
    ] as [number, number][],
    /**
     * How much our own roster competes with itself. A planned timetable still
     * shares shoppers with a nearby departure, but far more gently than the
     * market kernel above: half the weight inside half an hour, a quarter at
     * an hour, a tenth at two hours, and nothing by three. Anchors are
     * linearly interpolated, so the fade is smooth rather than a staircase at
     * half-hour marks.
     */
    ownFleetSubstitution: {
      /** Gap (min) -> share of a neighbour's seats that competes for the same shopper. */
      curve: [
        [0, 0.50],
        [30, 0.50],
        [60, 0.25],
        [120, 0.10],
        [180, 0.00],
      ] as [number, number][],
    },
    /**
     * Fare vs this coach's own going rate. Drives share, not market size —
     * published intercity bus elasticities sit around 1.2-2.0, and this is
     * the lever a price war pulls.
     */
    priceElasticity: 1.70,
    priceAttrMin: 0.32,
    priceAttrMax: 1.55,
    /** Last-minute shoppers have somewhere to be — price matters less. */
    elasticityLateMult: 0.60,
    elasticityLateDays: 2,
    /** RedBus shoppers filter at 4★, and sub-3.5 traffic collapses. Pivots on ratingBase. */
    ratingWidth: 0.55,
    ratingSpread: 0.22,
    ratingLossMult: 1.35,
    ratingReviewHalfLife: 80,
    /**
     * Extra nudge from the player's corridor share on top of the rival-seat
     * model. Neutral is 25%. The floor used to be 0.70, which cut a new
     * permit (~8% seeded share) from a mid-50s evening into the 30s even
     * when the coach itself was ordinary. Rival seats already price competition.
     */
    shareNeutralPct: 25,
    shareMultMin: 0.90,
    shareMultMax: 1.35,
    /** Listing visibility. RedBus alone ≈ market normal. */
    reachNormal: 1.15,
    reachFloor: 0.45,
    reachSpan: 0.55,
    reachAttrMin: 0.30,
    reachAttrMax: 1.35,
    punctualityScale: 0.30,
    brandScale: 0.30,
    comfortScale: 0.010,
    /** Per star above 3 on the coach's own listing. Shoppers notice a 4★ sleeper. */
    qualityScale: 0.032,
    /** The last seats are the bad seats — middle, last row, upper berth. */
    lastSeatsDrag: 0.30,
    /** Trips running hot book earlier in the window. */
    earlyBookingBoost: 0.40,
    earlyBookingLfRef: 0.55,
    /**
     * How fast a trip behind its curve closes the gap. Rate is the share of
     * the deficit sold today; the slice cap is a multiple of today's organic
     * arrivals so a late-opened service can catch up in a few days without
     * dumping the entire deficit in one day. Full-gap catch-up only runs on day-of (T-0).
     * Headroom still stops at the target LF, so catch-up does not sell the bus out.
     */
    catchUpRate: 0.60,
    catchUpMaxFrac: 3,
    /**
     * Trip-level luck baked into the target LF (stable for the booking window).
     * Wide enough that two identical coaches on different nights don't land
     * on the same fill — RedBus nights routinely swing 15-25 pts.
     */
    noiseSd: 0.14,
    /** Extra jitter on today's arrivals only — does not move the target. */
    arrivalNoiseSd: 0.20,
    /** Sticky corridor×week pool mood (soft weeks, wedding weeks, exams). */
    weekMoodSd: 0.18,
    /** Permanent lean/fat of a corridor in this save. */
    corridorBiasSd: 0.16,
    lfMax: 1.00,
    /**
     * Supply: each coach of ours adds this share of its seats as brand-new
     * corridor riders (switching from rail, state buses or cars), by how many
     * private departures the corridor already runs. Linear between anchors.
     */
    inducedDemand: [
      [30, 0.35],
      [100, 0.25],
      [200, 0.10],
    ] as [number, number][],
    /** Lowest fill multiplier a flooded window can fall to. */
    supplyPressureMin: 0.40,
    /** A rival capacity flood lands on peak slots: its seats count this many times a window's share. */
    rivalFloodPeakConcentration: 2,
    /** Discounts stop adding fill past this multiple. */
    priceBoostMax: 1.35,
    /** How the per-corridor real-world swings compound on the target fill. */
    corridorModifier: {
      biasExp: 0.4,
      moodExp: 0.3,
      archExp: 0.15,
      weatherExp: 0.5,
      min: 0.80,
      max: 1.20,
    },
    /** Dynamic rival caliber on contested corridors. Top rivals field modern fleets and compete hard. */
    rivalCompetitivenessScale: 0.35,
    /** Soft saturation slope on compounding operator appeal: allows top operators ~76-82% lifetime LF */
    attrSaturationSlope: 0.14,
    /** Subsystem appeal weights */
    suspensionAppealScale: 0.10,
    electricalAppealScale: 0.08,
    nvhAppealScale: 0.06,
    bodyAppealScale: 0.05,
    /** Fresh bus bonus vs aging high-odo fatigue */
    newBusOdoKm: 80_000,
    newBusBonus: 0.07,
    highOdoKm: 400_000,
    highOdoDragPer100k: 0.012,
    highOdoMaxDrag: 0.09,
    /** Maintenance discipline */
    overdueServiceDrag: 0.07,
    retreadTyreDrag: 0.035,
    accidentHistoryDrag: 0.04,
    /** Multi-axle highway cruise stability bonus (>8h or ghat) */
    multiAxleBonus: 0.09,
    /** Dynamic rail Tatkal spillover */
    railSpilloverPeak: 0.22,
    railOffPeakTheft: 0.12,
    /**
     * Soft cap on the stacked star appeal (rating × brand × Primo placement).
     * Past the knee extra stars add a diminishing share, so a 4.8★ Primo
     * brand does not print 92-95% on every peak night.
     */
    starStackKnee: 1.30,
    starStackSlope: 1.10,
    /**
     * Soft cap on the trip's expected fill. Above the knee the raw share
     * bends exponentially toward a ceiling (never a hard wall), so peak
     * sleepers with huge raw share stop all printing 92-95%. Festival dates
     * (seasonal ≥ festSeasonal) lift the ceiling — rivals cannot follow demand
     * and those dates sell out.
     */
    shareSoftCapLf: 0.78,
    shareSoftCapCeil: 0.92,
    shareSoftCapFestCeil: 1.00,
    shareSoftCapFestSeasonal: 1.25,
    /** Ceiling shift per unit of coach-state appeal above/below 1.00. */
    shareSoftCapCoachSpan: 1.2,
    /**
     * Coach state in share — service discipline, tyres, accident history,
     * odometer and AC health, weighted hard enough that two sleepers on one
     * corridor split the pool instead of tying.
     */
    coachState: {
      /** Overdue service: base drag, plus per 10,000 km past the interval. */
      overdueBase: 0.03,
      overduePer10k: 0.012,
      overdueMax: 0.14,
      retread: 0.05,
      accident: 0.07,
      freshOdoBonus: 0.06,
      /** Odometer past highOdoKm: drag per 100,000 km, capped. */
      highOdoPer100k: 0.025,
      highOdoMax: 0.12,
      /** AC health below `acFloorHealth` hurts; hot weeks hurt more. */
      acFloorHealth: 0.80,
      acWeight: 0.30,
      acHotMult: 1.5,
      acHealthyBonus: 0.04,
      floor: 0.68,
      ceil: 1.10,
    },
    /**
     * Corridor archetypes (tech / pilgrim / leisure / marathon / commercial).
     * `pool` scales the corridor's shoppers; `priceMult` scales fare
     * elasticity; the remaining weights say which operator traits that
     * crowd actually shops on, so Madurai and Hyderabad do not reward the
     * same coach.
     */
    archetype: {
      pool: { tech: 1.05, pilgrim: 0.97, leisure: 0.94, marathon: 0.93, commercial: 1.00 } as Record<string, number>,
      priceMult: { tech: 0.85, pilgrim: 1.30, leisure: 1.00, marathon: 0.90, commercial: 1.15 } as Record<string, number>,
      /** Weights on (rating-1), (brand-1), (coach-1), (subsystems-1), (punctuality-1). */
      tech: { rating: 0.35, brand: 0.30, coach: 0.10, cond: 0.10, punct: 0.20 },
      pilgrim: { rating: 0.10, brand: 0.05, coach: 0.10, cond: 0.10, punct: 0.15 },
      leisure: { rating: 0.20, brand: 0.15, coach: 0.45, cond: 0.15, punct: 0.05 },
      marathon: { rating: 0.20, brand: 0.15, coach: 0.30, cond: 0.45, punct: 0.10 },
      commercial: { rating: 0.10, brand: 0.10, coach: 0.05, cond: 0.05, punct: 0.35 },
      min: 0.85,
      max: 1.18,
    },
  },
  /**
   * When shoppers want to leave, by corridor type: unnormalised weight per
   * clock band, `[fromHour, toHour, weight]`, wrapping past 24. Overnight
   * corridors are an evening business (the 20:00-23:00 golden hours); day
   * corridors sell a morning and a late-afternoon peak; nobody shops 03:00.
   */
  depDensity: {
    overnight: [[18, 23.5, 1.00], [16, 18, 0.46], [23.5, 25, 0.30], [5, 10, 0.34], [10, 16, 0.26], [1, 5, 0.06]],
    mid: [[17.5, 23, 0.95], [6, 10.5, 0.72], [14, 17.5, 0.58], [10.5, 14, 0.30], [23, 30, 0.10]],
    day: [[5.5, 10, 1.00], [15.5, 20.5, 0.94], [10, 15.5, 0.40], [20.5, 23, 0.32], [23, 29.5, 0.07]],
  } as Record<'overnight' | 'mid' | 'day', [number, number, number][]>,
  ratingBase: 3.5, // market-average operator rating
  brandAwarenessMax: 1.35,
  /** Attach partners only after brand is known on the corridor (mid-game). */
  attachMinBrandAwareness: 0.35,
  bpDemandPerPoint: 0.02,
  /** Boarding points a rival offers on a normal corridor — the neutral point. */
  bpDemandNormal: 3,
  railSteal: 0.12,
  demandNoiseSd: 0.20,
  paydayHomebound: 1.08,
  paydayReturn: 1.03,
  noConductorDemand: 0.94,
  /**
   * Fri/Sun directional flows: metros empty out, then refill. Roughly
   * mean-neutral, because the weekly demand level already sits in DOW_DEMAND
   * — this only decides which side of the corridor gets it.
   */
  weekdayFlow: {
    friHomebound: 1.25,
    friReturn: 0.80,
    friFromHour: 16,
    sunReturn: 1.25,
    sunHomebound: 0.80,
    sunFromHour: 14,
    satBoth: 1.05,
  },
  /**
   * Product appeal vs the corridor's average operator (1.00 = market normal).
   * Read it as the LF this class holds at market price on an average
   * corridor: appeal × market.equilibriumLf.
   */
  classAppeal: {
    AC_SEMI: 1.08,
    AC_SEMI_PREM: 1.00,
    AC_HYBRID: 1.14,
    AC_SLEEPER: 0.94,
    AC_SLEEPER_PREM: 0.86,
    E_AC_SEMI: 1.04,
    CARGO: 1.0,
    CHARTER: 1.0,
  } as Record<BusClassId, number>,
  /**
   * Spread across the open booking window so a schedule created yesterday is
   * not an empty board. One weight per day-to-departure (index = days left;
   * the array length defines the window), normalised at load.
   * Front-loaded 8-bucket curve: strong advance bookings at T-7/T-6 (~43% cumulative
   * entering T-5, ~70% entering T-3, ~86% entering T-1) with a steady finish toward
   * target, finishing with walk-up remnants at T-0/T-1 rather than an artificial late dump.
   */
  bookingCurve: [
    0.05, // T-0 walk-up remnant
    0.07, // T-1
    0.08, // T-2
    0.09, // T-3
    0.12, // T-4
    0.14, // T-5
    0.18, // T-6
    0.24, // T-7 first open day — advance wave
  ],
  bookingWindowDays: 7,
  dailyCancelRate: 0.010, // ~5-7% cumulative cancellations across the window
  noShowRate: 0.025,
  cancellationTiers: { over24h: 0.15, h12to24: 0.30, h4to12: 0.50, under4h: 1.0 },
  cancellationPolicyDemand: { flexible: 1.06, standard: 1.0, strict: 0.95 } as Record<CancellationPolicy, number>,
  cancellationPolicyRetention: { flexible: 0.5, standard: 1.0, strict: 1.6 } as Record<CancellationPolicy, number>,
  ladiesSeatShare: 0.15,
  ladiesDemandShare: 0.22, // share of pax who prefer/need ladies seats

  /* ---------------- seat multipliers ---------------- */
  seatMult: {
    lowerBerth: 1.04,
    upperBerth: 0.96,
    singleBerth: 1.06,
    window: 1.02,
    aisle: 1.0,
    middle: 0.92, // 2+3 middle seat
    frontRows: 0.03, // bonus for first 3 rows
    lastRow: -0.05,
    /**
     * Hybrid coach: trip.fare is mid-index (~0.72). Zone scales push berth
     * tickets near sleeper fares and cabin seats near semi fares.
     */
    hybridSleeperZone: 1.08,
    hybridSemiZone: 0.72,
  },
  /**
   * Layout preference by haul duration (Indian private-bus booking):
   *   short (< 6h):      70% seater, 30% sleeper
   *   mid-haul (6-8h):   40% seater, 60% sleeper
   *   overnight (8-10h): 30% seater, 70% sleeper
   *   long haul (> 10h): 20% seater, 80% sleeper
   * Hybrid is neutral 50/50 blend across layouts.
   */
  layoutDuration: {
    preferences: {
      short: { seater: 0.70, sleeper: 0.30, hybrid: 0.50 },
      mid: { seater: 0.40, sleeper: 0.60, hybrid: 0.50 },
      overnight: { seater: 0.30, sleeper: 0.70, hybrid: 0.50 },
      long: { seater: 0.20, sleeper: 0.80, hybrid: 0.50 },
    },
    /**
     * Hybrid coaches carry both products, so each zone gets its own demand
     * pull. Multipliers on the coach's own load-factor target:
     *   mid haul (6-8h)  — both cabins sell at the SAME rate. A 6.5h run is
     *                      short enough that a berth and a recliner are
     *                      equally good, so the cabin follows the berth rate.
     *   overnight (8-10h)— berths sell out, the rear cabin takes about half
     *                      (a 20-seat cabin lands near 10/20).
     *   long (>10h)      — the cabin is the price-led product, ~a third.
     *   short (<6h)      — seats are the product, berths are the discount.
     */
    hybridZones: {
      short: { sleeper: 0.68, seater: 1.40 },
      mid: { sleeper: 1.20, seater: 1.20 },
      overnight: { sleeper: 1.48, seater: 0.75 },
      long: { sleeper: 1.60, seater: 0.50 },
    },
    shortMax: 6,
    midMax: 8,
    overnightMax: 10,
    /**
     * Mismatch curves. A layout that is wrong for the haul still sells to
     * price-led travellers and to anyone shut out of the "right" product, so
     * the shortfall is compressed instead of taken at the raw share ratio.
     * 1.00 would restore the old full-strength penalty.
     */
    penaltyExponent: 0.62, // whole coach vs the haul (seater on a night haul, berths on a day hop)
    sleeper: { short: 0.60, mid: 1.20, long: 1.60 },
    semi: { short: 1.40, mid: 0.80, long: 0.40 },
    hybrid: { short: 1.00, mid: 1.00, long: 1.00 },
  },
  /**
   * Departure-clock fit per layout, on top of the corridor's own peak: a
   * berth on a noon run is a hard sell even when the bus is going somewhere.
   */
  classHourFit: {
    sleeperNight: 1.08, // 19:00-23:30
    sleeperDay: 0.65, // 08:00-16:00
    sleeperEvening: 1.00, // 16:00-19:00
    sleeperOther: 0.58, // 00:00-05:30 dead of night
    hybridNight: 1.06,
    hybridShoulder: 1.04, // 05:30-10:30 / 15:30-19:00
    hybridMidday: 0.95,
    hybridLateNight: 0.58,
    semiNight: 0.98,
    semiDay: 1.06, // 05:30-10:30 / 15:30-20:30
    semiMidday: 0.96,
    semiLateNight: 0.52, // 23:30-05:30 dead of night for seats
  },

  /**
   * Target occupancy ranges by coach class, individual bus quality score (rating), and day type.
   * 1. AC sleeper (Standard)
   * 2. AC semi-sleeper (Standard)
   * 3. Premium Volvo AC sleeper
   * 4. Premium Volvo AC semi-sleeper
   */
  classRatingOccupancy: {
    // 1. AC sleeper — estimated occupancy
    acSleeper: {
      '4.5': { normal: [0.65, 0.85], weekend: [0.80, 0.95], festival: [0.95, 1.00] },
      '4.0': { normal: [0.50, 0.75], weekend: [0.70, 0.90], festival: [0.90, 1.00] },
      '3.5': { normal: [0.45, 0.65], weekend: [0.60, 0.85], festival: [0.85, 1.00] },
      '3.0': { normal: [0.35, 0.60], weekend: [0.55, 0.80], festival: [0.80, 1.00] },
      '2.5': { normal: [0.25, 0.50], weekend: [0.40, 0.70], festival: [0.65, 0.90] },
    } as Record<RatingTier, RatingOccupancyRange>,

    // 2. AC semi-sleeper — estimated occupancy
    acSemi: {
      '4.5': { normal: [0.60, 0.80], weekend: [0.80, 0.95], festival: [0.95, 1.00] },
      '4.0': { normal: [0.50, 0.70], weekend: [0.70, 0.90], festival: [0.90, 1.00] },
      '3.5': { normal: [0.40, 0.65], weekend: [0.60, 0.85], festival: [0.85, 1.00] },
      '3.0': { normal: [0.30, 0.55], weekend: [0.50, 0.75], festival: [0.75, 0.95] },
      '2.5': { normal: [0.20, 0.45], weekend: [0.35, 0.65], festival: [0.60, 0.85] },
    } as Record<RatingTier, RatingOccupancyRange>,

    // 3. Premium Volvo AC sleeper — estimated occupancy
    premSleeper: {
      '4.5': { normal: [0.70, 0.90], weekend: [0.85, 0.98], festival: [0.95, 1.00] },
      '4.0': { normal: [0.55, 0.80], weekend: [0.75, 0.95], festival: [0.90, 1.00] },
      '3.5': { normal: [0.45, 0.70], weekend: [0.65, 0.85], festival: [0.85, 1.00] },
      '3.0': { normal: [0.35, 0.60], weekend: [0.55, 0.80], festival: [0.75, 0.95] },
      '2.5': { normal: [0.25, 0.50], weekend: [0.40, 0.70], festival: [0.65, 0.90] },
    } as Record<RatingTier, RatingOccupancyRange>,

    // 4. Premium Volvo AC semi-sleeper (and Electric EV semi-sleeper: eBuzz K9) — estimated occupancy
    premSemi: {
      '4.5': { normal: [0.65, 0.85], weekend: [0.80, 0.95], festival: [0.95, 1.00] },
      '4.0': { normal: [0.55, 0.75], weekend: [0.70, 0.90], festival: [0.90, 1.00] },
      '3.5': { normal: [0.45, 0.65], weekend: [0.60, 0.85], festival: [0.85, 1.00] },
      '3.0': { normal: [0.35, 0.55], weekend: [0.50, 0.75], festival: [0.75, 0.95] },
      '2.5': { normal: [0.25, 0.45], weekend: [0.40, 0.65], festival: [0.60, 0.85] },
    } as Record<RatingTier, RatingOccupancyRange>,
  },

  /* ---------------- staff ---------------- */
  salaryRange: {
    driver: [rs(20_000), rs(30_000)],
    co_driver: [rs(15_000), rs(25_000)],
    conductor: [rs(10_000), rs(20_000)],
    mechanic: [rs(20_000), rs(30_000)],
    manager: [rs(25_000), rs(40_000)],
  } as Record<StaffRole, [Money, Money]>,
  fatiguePerTripHour: 1.2, // per driving hour, split across the drivers on the trip
  fatigueRestRecovery: 100, // only on days the driver did not run a trip
  fatigueAccidentThreshold: 50,
  hrFatigueSwapAt: 80, // HR auto-appoints a spare when a line driver is this tired
  hrSkillReviewDays: 180, // HR reviews a person's skill this often (before the skill ramp)
  /** Each skill point above 5 stretches the HR review gap by this fraction. */
  hrSkillReviewRamp: 0.30,
  moraleDriftBelowMarketPay: -2, // per month if paid below market
  attritionBase: 0.006, // monthly quit chance at loyalty 50
  poachChance: 0.015, // monthly, best staff get offers
  strikeMoraleThreshold: 25,
  trainingCostPerStaff: rs(7_000),
  trainingSkillGain: 1,
  /** One leg longer than this needs a second driver, co-driver, or skilled conductor. */
  maxDrivingHoursSingleDriver: 10,
  /** Hours one driver may accumulate in a calendar day (an out-and-back day hop is legal). */
  cmvrDailyHours: 13,
  /** After a night departure, the next duty cannot start before this hour. */
  cmvrNightRestUntilHour: 8,

  /* ---------------- maintenance ---------------- */
  serviceIntervalKm: 25_000,
  /** Tiered odometer-based maintenance service parameters (EI-01) */
  serviceTiers: {
    a: {
      label: 'A-Service (Minor)',
      intervalKm: 25_000,
      costMult: 1.0,
      days: 1,
    },
    b: {
      label: 'B-Service (Major)',
      intervalKm: 100_000,
      costMult: 3.5,
      days: 2, // 2–3 days
    },
    overhaul: {
      label: 'Annual Overhaul',
      intervalDays: 365,
      intervalKm: 250_000,
      costMult: 7.0,
      days: 6, // 5–7 days
    },
  },
  serviceCostBase: rs(18_000), // × model.maintCostIndex × age/odo/AC
  serviceDays: 1,
  // older coaches: more labour, bushings, leaks. AC gas/compressor on top.
  serviceAgeBands: [
    { maxYears: 2, mult: 1.00 },
    { maxYears: 4, mult: 1.12 },
    { maxYears: 6, mult: 1.28 },
    { maxYears: 9, mult: 1.48 },
    { maxYears: 12, mult: 1.70 },
    { maxYears: 99, mult: 2.00 },
  ] as { maxYears: number; mult: number }[],
  serviceOdoFromKm: 200_000, // extra cost after this odo
  serviceOdoPerLakh: 0.08, // +8% per 1,00,000 km over the floor
  serviceAcSurcharge: 0.12,
  servicedWearMult: 0.18, // on-time service: parts barely wear; skip overhauls
  overdueWearMult: 2.2, // wear acceleration when service overdue
  serviceKeepFloor: 85, // scheduled service holds healthy parts at this (wrecks still need overhaul)
  tyres: {
    oem: {
      price: rs(32_000),
      frontLifeKm: 200_000,
      rearLifeKm: 220_000,
      label: 'OEM (Apollo / MRF)',
    },
    tier2: {
      price: rs(23_000),
      frontLifeKm: 140_000,
      rearLifeKm: 160_000,
      label: 'Tier-2 (JK / BKT)',
    },
    retread: {
      price: rs(11_000),
      frontLifeKm: 0,
      rearLifeKm: 120_000,
      label: 'Retread (Cold Process)',
    },
    frontWearMult: 1.25,
    rearWearMult: 1.0,
    alertThreshold: 0.90, // Alert when an axle is at 90% of its brand life
  },
  tyreLifeKm: 200_000, // 2L km — change only after this mark
  tyreLifeRetreadKm: 150_000,
  tyreSetCost: rs(1_92_000), // 6 × ₹32k
  tyreRetreadCost: rs(66_000),
  // condition points lost per 1,000 km (half the original rate)
  wearPerKKm: { engine: 0.05, gearbox: 0.04, brakes: 0.125, suspension: 0.07, ac: 0.085, body: 0.035, electrical: 0.055 },
  serviceRestore: { engine: 3, gearbox: 2, brakes: 13, suspension: 5, ac: 11, body: 1, electrical: 5 },
  repairCostPer10Points: rs(12_000), // × maintCostIndex, per subsystem, then × repairCostMult
  repairCostMult: {
    engine: 0.75, gearbox: 0.65, body: 0.55, ac: 0.50,
    suspension: 0.40, brakes: 0.30, electrical: 0.25,
  },
  repairDaysPer20Points: 1,
  /** First bay at any location (opens HQ or satellite depot) — includes opening that site. */
  workshopSiteFirstBayCost: L(30),
  /** Each additional bay at any existing location flat. */
  workshopBayCostFlat: L(10),
  /** Legacy aliases kept for compatibility. */
  workshopOpenCost: L(30),
  workshopBayBaseCost: L(10),
  workshopBayCostStep: 0,
  /** Own-shop job discount vs outside garage; grows with built bays, soft cap. */
  workshopDiscountBase: 0.32,
  workshopDiscountPerBay: 0.035,
  workshopDiscountCap: 0.55,
  workshopSpeedupBase: 0.22,
  workshopSpeedupPerBay: 0.035,
  workshopSpeedupCap: 0.48,
  breakdownRescueCost: rs(42_000), // alternate bus arrangement + towing
  breakdownRefundShare: 0.5, // refund half the tickets on a breakdown

  /**
   * FM-03 re-body / refurbishment. Old Indian chassis (Tata / Ashok Leyland)
   * get a new fibreglass body at a fraction of a new bus, then run on.
   */
  refurb: {
    /** These chassis parts must still be sound for a body swap to pay off. */
    chassisSubsystems: ['engine', 'gearbox', 'suspension'] as const,
    chassisMinCondition: 50,
    /** New body + AC + electrical — scales with the model's upkeep index. */
    rebodyCostMin: L(5),
    rebodyCostMax: L(9),
    rebodyDays: 14,
    rebodyRestore: 90,
    rebodyLifeExtensionYears: 5,
    /** Seat cushions, armrests, footrests — scales with seats & upkeep index. */
    seatRefurbCostMin: rs(40_000),
    seatRefurbCostMax: rs(95_000),
    seatRefurbDays: 2,
    seatRefurbComfortBonus: 1.5,
    /** Max PSS points a fully refurbished cabin adds on a trip. */
    seatRefurbPssMax: 0.45,

    /** Powertrain (Engine & Transmission) precision mid-life overhaul */
    powertrainCostMin: L(3.5),
    powertrainCostMax: L(5.5),
    powertrainDays: 14,
    powertrainRestore: 98,
    /** Restores fuel efficiency by 8–12% (+10% mileage boost) */
    powertrainKmplBonus: 0.10,

    /** Luxury amenities & pneumatic air-suspension retrofit */
    luxuryCostMin: L(2.5),
    luxuryCostMax: L(4.2),
    luxuryDays: 10,
    luxuryComfortBonus: 2.0,
    luxuryPssBonus: 0.65,
    luxuryRestoreSuspension: 95,
  },

  /* ---------------- insurance / statutory / fixed ---------------- */
  insurancePctOfValue: 0.013, // annual comprehensive
  insuranceMin: rs(32_500),
  fitnessRenewalCost: rs(16_000), // annual
  fitnessFailRepair: rs(35_000),
  /** Insurance, fitness, PUC & road tax auto-renew when this many days or fewer remain (retries daily). */
  docRenewLeadDays: 7,
  /** PUC certificate cost */
  pucCost: rs(600),
  /** PUC validity duration in days (180 days) */
  pucValidityDays: 180,
  /** AIS-140 GPS device retrofit capex per coach */
  gpsFitCost: rs(10_000),
  /** Expressway GPS mandate missing fine */
  gpsMissingExpresswayFine: rs(5_000),
  /** Daily RTO checkpost interception chance (8%) */
  checkpostDailyChance: 0.08,
  /** RTO checkpost penalty range */
  checkpostFineMin: rs(10_000),
  checkpostFineMax: rs(50_000),
  /** Checkpost impound duration in days (2-5 days) */
  checkpostImpoundDaysMin: 2,
  checkpostImpoundDaysMax: 5,
  aitpQuarterly: rs(65_000), // interstate composite (AITP + state taxes)
  stateTaxQuarterly: rs(20_000), // intrastate MV tax
  /** Annual road tax overdue penalty (₹2,000 per month past grace period) */
  roadTaxPenaltyMonthly: rs(2_000),
  /** Grace period for paying annual road tax after registration anniversary (days) */
  roadTaxGraceDays: 30,
  routePermitFee: rs(28_000), // per route application, 1yr validity
  routePermitRenewal: rs(20_000),
  seasonalPermitFee: rs(11_200), // 40% of routePermitFee
  seasonalPermitRenewal: rs(8_000), // 40% of routePermitRenewal
  /**
   * Cargo service licence: one year, per corridor, both directions.
   * Priced as a fixed RTO/goods-tax fee plus a distance slab, so a long haul
   * costs more than a shuttle. Contracts are invited only on licensed lanes.
   */
  cargoPermitBaseFee: rs(25_000),
  cargoPermitPerKmFee: rs(125),
  cargoPermitTermDays: 365,
  /** Renewals are cheaper than a fresh licence, like the passenger permit. */
  cargoPermitRenewalPct: 0.65,
  /** Auto-renew starts this many days before expiry. */
  cargoPermitRenewLeadDays: 21,
  permitLeadDaysMin: 12,
  permitLeadDaysMax: 28,
  permitRejectChance: 0.08,
  gpsPerBusMonth: rs(550),
  depotRentBase: rs(12_000), // base home depot yard rent (default 12k for 4-slot base yard)
  depotRentPerExtraBus: rs(3_000), // added based on vehicle count beyond 4 slots
  officeAdminMonthly: rs(10_000), // base fleet head office & admin (rent, electricity, broadband, terminals, software, tea/coffee)
  officeAdminPerManager: rs(5_000), // additional office rent/workstation overhead for each manager hired and assigned to a desk
  span: {
    base: {
      ops: 20,        // active owned + leased coaches
      hr: 40,         // non-manager staff
      workshop: 4,    // built bays
      cargo: 5,       // licensed cargo lanes
      schedule: 20,   // active schedules
      documents: 40,  // vehicle files: coaches + route permits
      crm: 40,        // open grievances processed per day
      accountant: 2500, // ledger rows in the trailing 30 days
      charter: 12,    // active charter contracts & dedicated fleet
    },
    /** Each skill point away from 5 changes span by this share. */
    skillPerPoint: 0.06,       // +30% at skill 10, -18% at skill 2
    skillMin: 0.75,
    skillMax: 1.35,
    /** An assistant posted to the desk adds this share of a head's span. */
    assistantShare: 0.60,
    /** Coverage floor so an overstretched desk still does something. */
    minCoverage: 0.20,
    /** HR fatigue swaps per day at full coverage. */
    hrInterventionsPerDay: 3,
    /** Coaches beyond the Ops span skip the proactive roster passes. */
    opsRotationSalt: 'ops-span',
    /** Cargo/Schedule/Documents processing caps per pass at full coverage. */
    cargoLanesPerPass: 4,
    scheduleAssignmentsPerPass: 3,
    docRenewalsPerPass: 12,
  },
  gstAcBps: 500, // 5% GST on AC tickets
  incomeTaxRate: 0.20,
  challanFine: rs(12_000), // RTO crackdown per lapse found
  odoHighlightDefaultKm: 400_000,

  /* ---------------- trips: risk ---------------- */
  breakdownBase: 0.0025, // per trip
  breakdownPerBadSubsystem: 0.011, // per subsystem below 60, scaled
  breakdownOverduePer10kKm: 0.008,
  accidentBase: 0.00045,
  accidentNightMult: 1.5,
  accidentMonsoonMult: 1.7,
  accidentGhatMult: 1.4,
  accidentDeductible: rs(75_000),
  accidentDowntimeDays: [5, 20],
  accidentRatingHit: 0.25,
  delayBaseMin: 12, // avg delay minutes
  delayMonsoonExtra: 30,
  delayGhatExtra: 15,
  punctualityThresholdMin: 30, // later than this counts as late

  /* ---------------- ratings / reputation ---------------- */
  ratingEmaWeight: 0.04, // per trip contribution to displayed rating
  reviewShare: 0.18, // fraction of pax who leave a review
  groupRatingMinReviews: 25,
  primoRatingReq: 4.3,
  /** Drop below this while Primo → delisted. Kept below invite thresh so small swings don't churn. */
  primoDelistRating: 4.1,
  primoPunctualityReq: 0.85,
  primoMinTrips: 200,
  /** After delist, wait this many days before RedBus invites again (stops weekly rating-churn spam). */
  primoReinviteCooldownDays: 90,
  /** After declining an invite, wait this many days before another offer. */
  primoDeclineCooldownDays: 180,
  reputationPerTrip: 0.02,

  /* ---------------- market listings ---------------- */
  usedDepreciationYr: 0.15, // WDV
  usedMarketMin: 3,
  usedMarketMax: 9,
  leaseOffersMin: 2,
  leaseOffersMax: 6,
  attachOffersMin: 1,
  attachOffersMax: 5,
  marketRefreshDays: 7,
  /**
   * Layout generation share for secondary markets (used, dry lease, attach).
   * Preference is sleeper -> hybrid -> semi (no straight seater class).
   */
  marketLayoutWeights: {
    sleeper: 0.50,
    hybrid: 0.30,
    semi: 0.20,
  },
  inspectionCost: rs(8_000),
  resaleHaircut: 0.82, // normal sale vs book value
  fireSaleHaircut: 0.68,
  /**
   * Dry-lease rent is built bottom-up like an owner would price it, not as a flat
   * share of the bus value: capital recovery on today's value over the years the
   * coach has left, plus the running costs the owner still pays (service,
   * overhauls, tyres, insurance, fitness, road tax), plus a lessor's margin.
   */
  leaseCapitalRate: 0.15, // lessor's annual cost of money
  leaseRemainingLifeYears: 12, // coach life from date of manufacture
  leaseMinTermMonths: 24, // never amortise a used coach over less than this
  leaseAssumedKmPerMonth: 10_000, // utilisation the rent is priced on
  leaseLessorMargin: 0.12, // upkeep + capital uplift the owner earns
  /** Market ceiling: nobody pays more than this share of market value a month to hire a coach. */
  leaseMaxPctOfValue: 0.045,
  leaseRentRounding: rs(500), // owners quote round figures
  attachOwnerShareMin: 0.75,
  attachOwnerShareMax: 0.85,

  /* ---------------- distressed-rival deals ---------------- */
  distress: {
    /** Minimum liquidity before a distress lot offer can be raised. */
    minLiquidity: rs(6_00_000),
    /** Share of a deal the player must be able to cover in cash (rest is hire-purchase). */
    minCashShare: 0.22,
    /** Lot sizing floor share of budget */
    lotFloorShare: 0.06,
    lotFloorCap: Cr(15),
    /** Supported lot counts for purchasing distressed fleets (6 to 24 buses). */
    lotCounts: [24, 22, 20, 18, 16, 14, 12, 10, 8, 6] as const,
  },

  /* ---------------- banking ---------------- */
  odRateBps: 1500,
  /** Credit-score floor for the cash-credit / OD line. */
  odLimitByCredit: [
    [750, L(50)],
    [700, L(25)],
    [650, L(10)],
    [0, L(4)],
  ] as [number, Money][],
  /** Extra OD headroom ≈ this share of book equity (cash+fleet+AR − loans, OD added back). */
  odPctOfNetWorth: 0.12,
  /** OD cannot exceed this multiple of the credit-score floor. */
  odNwMultipleCap: 5,
  /** Hard ceiling on OD facility. */
  odAbsoluteCap: Cr(5),
  emiPenaltyBps: 200, // one-time on missed EMI amount
  missedEmiCreditHit: 25,
  paidEmiCreditGain: 1,
  repoAfterConsecutiveMissed: 4,
  /** SLM life for owned coaches — private buses run 12–15 yrs; 8-yr books crushed monthly P&L. */
  depreciationLifeYears: 15,
  depreciationResidualPct: 0.15,
  /** Player-selectable annual write-off rate, per cent of cost (SLM) or book (WDV). */
  depreciationRateMinPct: 5,
  depreciationRateMaxPct: 30,
  depreciationRateStepPct: 0.5,
  /** Standard rate each method quotes: SLM spreads (1 − residual) over the 15-yr life. */
  depreciationStandardRate: { SLM: 6, WDV: 30 } as Record<'SLM' | 'WDV', number>,

  /* ---------------- payroll / misc ---------------- */
  payrollDayOfMonth: 1,

  /* ---------------- world dynamics ---------------- */
  fareIndexWalkSd: 0.008,
  fareIndexMin: 0.88,
  fareIndexMax: 1.14,
  eventChancePerDay: 0.10,

  /**
   * Data budget. Every action deep-clones the live state and every autosave
   * re-encodes it, so unbounded logs are what turn a long game (5+ years,
   * 20+ coaches) into a browser out-of-memory crash rather than a bigger file.
   * These caps keep the working set flat: the ledger keeps four weeks, reports
   * read monthly summaries and route-day rows instead of raw transactions.
   */
  kpiHistoryDays: 240,
  txnRetentionDays: 28,
  txnMaxCount: 6_000,
  completedTripKeepDays: 3,
  /** Daily rows kept per route for the Analytics windows (1-year view needs ~370). */
  routeHistoryDays: 400,
  /** Resolved insurance claims kept for the fleet-history panel. */
  insuranceClaimKeep: 40,
  /** Month summaries kept in the live state (reports use 12–24, 5 years is plenty). */
  monthlyKeep: 60,
  /** Seasonal run rows kept for the festival report. */
  seasonalRunKeep: 300,
  /** Inbox messages kept in the live state. */
  inboxKeep: 200,
  /** Cargo contracts kept after they end, so a lapsed lane still shows history. */
  cargoContractKeepDays: 90,

  /* ---------------- v2 ops: rest / slots / festival / fuel ---------------- */
  restLaw: {
    /** Max calendar days in a row a driver may run without a rest day. */
    maxConsecutiveDays: 6,
    /** If forced out illegally, chance of a challan (else trip grounds). */
    violateChallanChance: 0.55,
    challanFine: rs(8_000),
  },
  terminal: {
    /** Prime departure window (local clock). */
    primeHourLo: 21,
    primeHourHi: 22,
    primeMinHi: 30, // inclusive through 22:30
    /** Bay slots per city in the prime window (rivals take some). */
    primeBays: 4,
    rivalHoldMin: 1,
    rivalHoldMax: 3,
    /** Cash to lock a contended prime slot for 30 days. */
    slotLockFee: rs(25_000),
    slotLockDays: 30,
  },
  festivalSpecial: {
    durationDays: 8,
    /** Extra one-way legs mounted when player adds a festival special. */
    extraLegs: 1,
    reverseDemandMult: 0.35,
  },
  fuelVariance: {
    /** Book km/l is a cautious driver on a normal load. Aggressive is the 3.0 vs 3.5 case. */
    jitter: 0.03,
    skillSoft: 0.004, // skill 10 is about 2% better than skill 5; skill does not invert the book
    cautiousKmpl: 1,
    normalKmpl: 0.929, // midway, ~3.25 km/l when the book is 3.5
    aggressiveKmpl: 0.857, // 3.0 km/l when the book is 3.5
    /** Roadside bunk only when the run is already well under the book. */
    bunkBelow: 0.80,
    shortfallBunkChance: 0.12,
    bunkSurcharge: 0.08,
  },

  /* ---------------- v2 ops: claims / check-post / depot / docs ------------ */
  insuranceClaim: {
    surveyorDaysMin: 5,
    surveyorDaysMax: 14,
    /** Share of repair paid by insurer after survey (rest is NCB / wear). */
    settleShare: 0.70,
    ncbPremiumHike: 0.15,
    garageNowShare: 1.0, // pay full garage bill now, claim reimburses later
    baseSettleChance: 0.70,
  },
  checkPost: {
    stopChance: 0.22,
    delayMin: [15, 90] as [number, number],
    challanChance: 0.25,
    challanFine: rs(3_500),
    settleChance: 0.20,
    settleCost: rs(1_200),
    cargoHoldChance: 0.18,
    cargoHoldShare: 0.40, // revenue lost / delayed
  },
  depot: {
    baseSlots: 4,
    expandSlotCost: rs(4_00_000),
    overflowFeePerBusNight: rs(300),
  },
  docsGrounded: {
    /** Days after used/lot buy before papers transfer completes. */
    transferLagDays: 3,
  },

  /* ---------------- paired return schedules ---------------- */
  /** Max coaches assignable to a single schedule for marathon rotations. */
  scheduleMaxCoaches: 4,
  /** Route duration hours threshold beyond which marathon layover scaling kicks in. */
  layoverMinHaulHours: 6,
  /** Layover scaling slope per route hour above threshold. */
  layoverSlope: 0.48,
  /**
   * Vehicle cooldown by haul length (delay counts inside this window).
   * UI shows ceil hours (4 / 6 / 8 / 10 / 12).
   * default 3.9h; ≥18 → 5.9h; ≥24 → 7.9h; ≥28 → 9.9h; ≥34 → 11.9h.
   */
  layoverDefaultMin: 234,
  layoverAt18Min: 354,
  layoverAt24Min: 474,
  layoverAt28Min: 594,
  layoverAt34Min: 714,
  /** Terminal + rest turnaround uses corridor km / this speed. */
  pairAvgSpeedKmh: 35,
  /** Floor on turnaround even for short hops. */
  pairMinTurnMin: 45,
  /** How late BA may slip waiting for a delayed AB. */
  pairDelayBufferMin: 90,
  /** Reputation hit when BA strands passengers and leaves empty. */
  pairStrandRepHit: 2.5,
  /** Mild rating nudge when passengers are stranded on the return. */
  pairStrandRatingHit: 0.04,

  /* ---------------- realism expansion: amenities, commercial fuel, eco, yield ---------------- */
  amenities: {
    waterBottleCost: rs(7),
    snackHamperCost: rs(35),
    sanitizedBeddingCost: rs(25),
    hotBeverageCost: rs(12),
    travelKitCost: rs(18),
    faceTissueCost: rs(8),
    welcomeMintsCost: rs(4),
    fruitJuiceCost: rs(20),
    breakfastBoxCost: rs(45),
    sanitaryKitCost: rs(15),
    wifiRetrofitCost: rs(18_000),
    usbChargingRetrofitCost: rs(12_000),
    cctvRetrofitCost: rs(15_000),
    readingLightsRetrofitCost: rs(8_000),
    privacyCurtainsRetrofitCost: rs(12_000),
    entertainmentScreenRetrofitCost: rs(22_000),
    airPurifierRetrofitCost: rs(14_000),
    cabinFreshenerRetrofitCost: rs(5_000),
    powerSocketsRetrofitCost: rs(10_000),
    waterPssBonus: 0.18,
    snackPssBonus: 0.28,
    beddingPssBonus: 0.35,
    hotBeveragePssBonus: 0.14,
    travelKitPssBonus: 0.16,
    faceTissuePssBonus: 0.08,
    welcomeMintsPssBonus: 0.04,
    fruitJuicePssBonus: 0.14,
    breakfastBoxPssBonus: 0.2,
    sanitaryKitPssBonus: 0.12,
    missingBeddingNightPenalty: -0.45,
    techPssBonus: 0.2,
    readingLightsPssBonus: 0.08,
    privacyCurtainsPssBonus: 0.1,
    entertainmentScreenPssBonus: 0.12,
    airPurifierPssBonus: 0.08,
    cabinFreshenerPssBonus: 0.05,
    powerSocketsPssBonus: 0.08,
    goldTierDemandMult: 1.22,
    premiumTierDemandMult: 1.16,
    standardTierDemandMult: 1.10,
    economyTierDemandMult: 1.00,
    /** Ticket list-price vs corridor AC benchmark by brand service tier. */
    goldTierFareMult: 1.2,
    premiumTierFareMult: 1.10,
    standardTierFareMult: 1.00,
    economyTierFareMult: 0.88,
  },
  fuelCommercial: {
    fleetCardRebateBps: 250, // 2.5% rebate cashback
    depotTankCapLitres: 10_000,
    depotTankInstallCost: rs(450_000), // ₹4.5 L capex
    wholesaleDiscountPerLitre: rs(4.0), // ₹4 discount / litre
    tankerLoadLitres: 8_000,
  },
  ecoDriving: {
    bataBonusPerDriver: rs(250), // ₹250 / trip bonus
    mileageBonusMult: 1.08, // +8% km/l
    wearReductionMult: 0.85, // -15% tyre and brake wear
  },
  yieldDeals: {
    flashSaleDiscount: 0.20, // -20% fare
    flashSaleDemandBoost: 1.65, // +65% booking pace
    surgePriceMultiplier: 1.25, // +25% fare
  },
  certifications: {
    primoMinRating: 4.5,
    primoMinPunctuality: 0.88,
    womenFriendlyDemandMult: 1.12,
    cleanCertifiedDemandMult: 1.08,
  },
} as const

/** Per-driver trip bata from route km: ₹350 on short hops, ₹1,000 on 1,000 km+ hauls. */
export function driverBataForKm(km: number): Money {
  const span = BAL.driverBataKmHi - BAL.driverBataKmLo
  const t = Math.max(0, Math.min(1, (km - BAL.driverBataKmLo) / span))
  return Math.round(BAL.driverBataMin + (BAL.driverBataMax - BAL.driverBataMin) * t)
}

/**
 * Cost to open (first bay at a site) or add one more bay.
 * Pass bayCountAtLocation (0 = first bay L(30), 1+ = extra bay L(10)).
 * If omitted, treats builtBays <= 0 as first bay, else extra bay flat.
 */
export function nextWorkshopBayCost(builtBays: number, bayCountAtLocation?: number): Money {
  if (bayCountAtLocation !== undefined) {
    return bayCountAtLocation <= 0 ? BAL.workshopSiteFirstBayCost : BAL.workshopBayCostFlat
  }
  if (builtBays <= 0) return BAL.workshopSiteFirstBayCost
  return BAL.workshopBayCostFlat
}

/** Job discount when working in your own staffed workshop (by built bay count). */
export function workshopJobDiscount(builtBays: number): number {
  if (builtBays <= 0) return 0
  return Math.min(
    BAL.workshopDiscountCap,
    BAL.workshopDiscountBase + BAL.workshopDiscountPerBay * (builtBays - 1),
  )
}

/** Job duration reduction in your own staffed workshop. */
export function workshopJobSpeedup(builtBays: number): number {
  if (builtBays <= 0) return 0
  return Math.min(
    BAL.workshopSpeedupCap,
    BAL.workshopSpeedupBase + BAL.workshopSpeedupPerBay * (builtBays - 1),
  )
}

export interface DifficultyPreset {
  id: Difficulty
  label: string
  desc: string
  seedCapital: Money
  startCredit: number
  demandMult: number
  loanRateExtraBps: number
}

export const DIFFICULTIES: DifficultyPreset[] = [
  {
    id: 'seth',
    label: 'Easy',
    desc: 'Family money. ₹1 Cr seed, good credit, forgiving demand.',
    seedCapital: L(100),
    startCredit: 720,
    demandMult: 1.0,
    loanRateExtraBps: 0,
  },
  {
    id: 'malik',
    label: 'Normal',
    desc: 'Sold the family land. ₹40 L seed, average credit.',
    seedCapital: L(40),
    startCredit: 660,
    demandMult: 0.98,
    loanRateExtraBps: 100,
  },
  {
    id: 'sahukar',
    label: 'Hard',
    desc: 'Borrowed from everyone you know. ₹15 L seed, thin credit, cruel market.',
    seedCapital: L(15),
    startCredit: 610,
    demandMult: 0.92,
    loanRateExtraBps: 250,
  },
]

export interface CancellationRuleDef {
  id: CancellationPolicy
  label: string
  shortLabel: string
  tagline: string
  demandMult: number
  cancelRateMult: number
  tiers: {
    over24h: number
    h12to24: number
    h4to12: number
    under4h: number
  }
}

export const CANCELLATION_POLICY_RULES: Record<CancellationPolicy, CancellationRuleDef> = {
  flexible: {
    id: 'flexible',
    label: 'Flexible — more demand, easy refund',
    shortLabel: 'Flexible',
    tagline: 'Higher booking demand (+6%), easy refunds with weak fee retention',
    demandMult: 1.06,
    cancelRateMult: 1.25,
    tiers: { over24h: 0.10, h12to24: 0.20, h4to12: 0.40, under4h: 0.75 },
  },
  standard: {
    id: 'standard',
    label: 'Standard — balanced demand & retention',
    shortLabel: 'Standard',
    tagline: 'Balanced market demand, standard industry refund tiers',
    demandMult: 1.00,
    cancelRateMult: 1.00,
    tiers: { over24h: 0.15, h12to24: 0.30, h4to12: 0.50, under4h: 1.00 },
  },
  strict: {
    id: 'strict',
    label: 'Strict — less demand, strong retention',
    shortLabel: 'Strict',
    tagline: 'Lower booking demand (-5%), maximum cancellation fee retention',
    demandMult: 0.95,
    cancelRateMult: 0.80,
    tiers: { over24h: 0.25, h12to24: 0.50, h4to12: 0.80, under4h: 1.00 },
  },
}

export interface RatingOccupancyRange {
  normal: [number, number]
  weekend: [number, number]
  festival: [number, number]
}

export type RatingTier = '4.5' | '4.0' | '3.5' | '3.0' | '2.5'

const TIER_RATINGS = [4.5, 4.0, 3.5, 3.0, 2.5] as const

function getTableRange(
  table: Record<RatingTier, RatingOccupancyRange>,
  rating: number,
  dayType: 'normal' | 'weekend' | 'festival',
): [number, number] {
  const r = Math.max(1.0, Math.min(5.0, rating))
  if (r >= 4.5) {
    const row = table['4.5'][dayType]
    const bonus = Math.min(0.03, (r - 4.5) * 0.06)
    return [Math.min(1.0, row[0] + bonus), Math.min(1.0, row[1] + bonus)]
  }
  if (r <= 2.5) {
    const row = table['2.5'][dayType]
    const scale = Math.max(0.5, r / 2.5)
    return [row[0] * scale, row[1] * scale]
  }
  for (let i = 0; i < TIER_RATINGS.length - 1; i++) {
    const hi = TIER_RATINGS[i]
    const lo = TIER_RATINGS[i + 1]
    if (r >= lo && r <= hi) {
      const t = (r - lo) / (hi - lo)
      const rowLo = table[lo.toFixed(1) as RatingTier][dayType]
      const rowHi = table[hi.toFixed(1) as RatingTier][dayType]
      return [
        rowLo[0] + t * (rowHi[0] - rowLo[0]),
        rowLo[1] + t * (rowHi[1] - rowLo[1]),
      ]
    }
  }
  return table['3.5'][dayType]
}

export function getClassRatingOccupancyRange(
  cls: BusClassId,
  qualityScore: number,
  dayType: 'normal' | 'weekend' | 'festival',
): [number, number] {
  const co = BAL.classRatingOccupancy
  if (cls === 'AC_HYBRID') {
    const sl = getTableRange(co.acSleeper, qualityScore, dayType)
    const se = getTableRange(co.acSemi, qualityScore, dayType)
    return [(sl[0] + se[0]) / 2, (sl[1] + se[1]) / 2]
  }
  const table =
    cls === 'AC_SLEEPER_PREM'
      ? co.premSleeper
      : cls === 'AC_SEMI_PREM' || cls === 'E_AC_SEMI'
      ? co.premSemi
      : cls === 'AC_SLEEPER'
      ? co.acSleeper
      : co.acSemi
  return getTableRange(table, qualityScore, dayType)
}

let _curveTail: number[] | null = null

/** Fraction of eventual sales that belong on the book before today's slice. */
export function elapsedBookingFrac(daysToDep: number): number {
  if (!_curveTail) {
    let total = 0
    for (const x of BAL.bookingCurve) total += x
    const curve = BAL.bookingCurve.map((x) => x / (total || 1))
    const tail = Array.from<number>({ length: curve.length + 1 })
    tail[curve.length] = 0
    for (let i = curve.length - 1; i >= 0; i--) tail[i] = curve[i]! + tail[i + 1]!
    _curveTail = tail
  }
  const i = Math.min(_curveTail.length - 1, Math.max(0, daysToDep + 1))
  return _curveTail[i] ?? 0
}

/**
 * Practical occupancy estimates by direction and travel period:
 * Calibrated for a well-positioned sleeper operator (rating ~4.0 - 4.5):
 * Travel period                       Chennai → Madurai    Madurai → Chennai
 * Normal Friday night                 80–95%               55–75%
 * Normal Saturday night               65–85%               65–85%
 * Normal Sunday night                 50–70%               80–95%
 * 1–3 days before a major festival    90–100%              60–85%
 * Festival day itself                 40–75%               40–75%
 * First return day after festival     60–85%               90–100%
 * Final holiday return rush           50–75%               90–100%
 */
export function getDirectionalOccupancyRange(
  cls: BusClassId,
  qualityScore: number,
  route: RouteDef,
  direction: 'AB' | 'BA',
  depDay: number,
): [number, number] {
  const origin = direction === 'AB' ? route.from : route.to
  const dest = direction === 'AB' ? route.to : route.from
  const a = CITIES[origin]?.metro ?? 0
  const b = CITIES[dest]?.metro ?? 0
  const isHb = a > b || (a === b && (origin === 'maa' || origin === 'blr' || origin === 'bom' || origin === 'del' || direction === 'AB'))

  const fest = festivalRunEffect(depDay)
  let baseRange: [number, number]

  if (fest.name != null && fest.phase) {
    if (fest.phase === 'festival_day') {
      // Festival day itself: 40-75% in both directions
      baseRange = [0.40, 0.75]
    } else if (fest.phase === 'pre') {
      // 1-3 days before major festival: homebound 90-100%, return 60-85%
      baseRange = isHb ? [0.90, 1.00] : [0.60, 0.85]
    } else if (fest.phase === 'post_first') {
      // First return day after festival: homebound 60-85%, return 90-100%
      baseRange = isHb ? [0.60, 0.85] : [0.90, 1.00]
    } else {
      // Final holiday return rush: homebound 50-75%, return 90-100%
      baseRange = isHb ? [0.50, 0.75] : [0.90, 1.00]
    }
  } else {
    const d = dow(depDay)
    if (d === 5) {
      // Normal Friday night: homebound 80-95%, return 55-75%
      baseRange = isHb ? [0.80, 0.95] : [0.55, 0.75]
    } else if (d === 6) {
      // Normal Saturday night: 65-85% both directions
      baseRange = [0.65, 0.85]
    } else if (d === 0) {
      // Normal Sunday night: homebound 50-70%, return 80-95%
      baseRange = isHb ? [0.50, 0.70] : [0.80, 0.95]
    } else {
      // Normal Midweek (Mon-Thu): mild metro lean (homebound 55-78%, return 45-68%)
      baseRange = isHb ? [0.55, 0.78] : [0.45, 0.68]
    }
  }

  // Adjust for quality score and bus class.
  // 4.5★ keeps the published band. A 4.0 used to keep ~91% of it and a 4.2
  // about 95%, so two strong sleepers filled like an average coach.
  const r = Math.max(1.0, Math.min(5.0, qualityScore))
  let [minLf, maxLf] = baseRange

  if (r >= 4.5) {
    const bonus = Math.min(0.03, (r - 4.5) * 0.06)
    minLf = Math.min(1.0, minLf + bonus)
    maxLf = Math.min(1.0, maxLf + bonus)
  } else {
    const linear = Math.max(0.40, 0.40 + 0.60 * ((r - 1.0) / 3.5))
    const nearFour = Math.max(0, Math.min(1, (r - 3.2) / 1.3))
    const scale = linear + (1 - linear) * nearFour * 0.85
    minLf = minLf * scale
    maxLf = maxLf * scale
  }

  // Coach class adjustments
  if (cls === 'AC_SLEEPER_PREM') {
    minLf = Math.min(1.0, minLf + 0.03)
    maxLf = Math.min(1.0, maxLf + 0.03)
  } else if (cls === 'AC_SEMI') {
    minLf = minLf * 0.90
    maxLf = maxLf * 0.90
  } else if (cls === 'AC_SEMI_PREM' || cls === 'E_AC_SEMI') {
    minLf = minLf * 0.95
    maxLf = maxLf * 0.95
  } else if (cls === 'AC_HYBRID') {
    minLf = minLf * 0.95
    maxLf = maxLf * 0.95
  }

  return [Math.max(0.10, Math.min(1.0, minLf)), Math.max(0.15, Math.min(1.0, maxLf))]
}
