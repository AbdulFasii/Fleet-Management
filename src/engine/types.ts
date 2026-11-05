import type { Money } from './core/money'
export type { Money } from './core/money'
import type { IdCounter } from './core/ids'
import type { RivalDef } from './data/rivals'

export type ID = string

/**
 * Asset depreciation policy for owned coaches.
 * - SLM  straight line over the slab life to a salvage floor
 * - WDV  written-down value at a fixed annual rate
 * - NONE book the asset at cost and charge no depreciation
 */
export type DepreciationMethod = 'SLM' | 'WDV' | 'NONE'

export interface BodyDesign {
  id: string
  name: string // e.g. "JCBL Classic Sleeper"
  bodyPrice: Money // additive body package cost
  leadDaysAdd: number
  comfortDelta: number
  maintDelta: number
  image?: string // optional data-URL (as-uploaded, same as branding pic)
  notes?: string
  /** Chassis platform names this design fits (e.g. "12M", "13.5M", "1824hd").
   * Empty / omitted = fits every chassis length for the builder's makers.
   */
  chassisNames?: string[]
  /** Coach seating layout built by this body design: sleeper 2+1, semi-sleeper 2+2, or hybrid 2+1. */
  layoutKind?: 'sleeper' | 'semi' | 'hybrid'
  /** Supported seating layouts built by this body design (multi-select). */
  layoutKinds?: ('sleeper' | 'semi' | 'hybrid')[]
  /** When false, design never rolls on used market. Default true. */
  availableUsed?: boolean
  /** When false, design never rolls on dry-lease or attach market. Default true. */
  availableLeaseAttach?: boolean
  /** When false, design never rolls on used / dry-lease / attach. Default true. */
  secondaryMarket?: boolean
}

export interface BodyBuilder {
  id: string
  name: string
  makers: ('Ashok Leyland' | 'BharatBenz')[]
  designs: BodyDesign[] // aim 1–3; Settings can add more
}

/* ================================ Buses ================================ */

export type BusClassId =
  | 'AC_SEMI'
  | 'AC_SEMI_PREM'
  | 'AC_HYBRID'
  | 'AC_SLEEPER'
  | 'AC_SLEEPER_PREM'
  | 'E_AC_SEMI'
  | 'CARGO'
  | 'CHARTER'

export interface BusModel {
  id: string
  name: string
  maker: string
  cls: BusClassId
  /**
   * New list price. For Ashok Leyland / BharatBenz passenger coaches this is the
   * chassis on-road price; body design `bodyPrice` is added at order time.
   * Fully-built makers (Volvo, Scania, Olectra, cargo) keep complete-vehicle price.
   */
  priceNew: Money
  seats: number
  layout: LayoutSpec
  /** km per litre (or km/kWh-equivalent cost unit for electric) */
  mileage: number
  electric: boolean
  ac: boolean
  sleeper: boolean
  comfort: number // 1-10, drives reviews and demand
  /** Chassis delivery days for AL/BB; body design adds leadDaysAdd. Fully-built = total lead. */
  leadTimeDays: number
  /** multiplier vs the route's benchmark AC-sleeper market fare */
  fareIndex: number
  maintCostIndex: number // 1 = average; Volvos cost more to keep alive
  /** Calendar year the coach entered Indian service — caps used/lease age. */
  launchedYear: number
  rangeKm?: number // electric only
  /** Underbelly / luggage-bay parcel capacity (kg). Semi 600 · hybrid/sleeper 400 · EV 250. */
  cargoCapKg: number
  /** Luggage hold volume in cubic meters (cbm). */
  cargoVolumeCbm?: number
  /** Dedicated cargo carrier with 0 passenger seats */
  isCargoOnly?: boolean
  isCharterOnly?: boolean
}

export type LayoutCols = '2+1' | '2+2' | '2+3' | 'cargo'

export function isLayoutCols(val: unknown): val is LayoutCols {
  return val === '2+1' || val === '2+2' || val === '2+3' || val === 'cargo'
}

export interface LayoutSpec {
  kind: 'seater' | 'semi' | 'sleeper' | 'hybrid' | 'cargo'
  /** Hybrid uses 2+1 sleeper + 2+2 semi; display as 2+1/2+2. */
  cols: LayoutCols
  /**
   * Seater/semi: cabin rows. Sleeper: berth bay rows (×2 decks ×3 = berths).
   * Hybrid: ignored for the split — berths = floor(seats / 2), cabin the rest.
   */
  rows: number
}

export type SubsystemId = 'engine' | 'gearbox' | 'brakes' | 'suspension' | 'ac' | 'body' | 'electrical'
export const SUBSYSTEMS: SubsystemId[] = ['engine', 'gearbox', 'brakes', 'suspension', 'ac', 'body', 'electrical']

export type Condition = Record<SubsystemId, number> // 0-100 each

export type Ownership = 'owned' | 'leased' | 'attached'

export interface AttachTerms {
  /** share of ticket revenue paid to the bus owner (owner bears fuel/crew/service) */
  ownerShare: number
  /** 0-1: how well the owner maintains the bus (from the quality tier) */
  careLevel: number
}

export interface Bus {
  id: ID
  reg: string
  nickname: string
  /** Brand / subsidiary membership */
  groupId?: ID
  /** Timeline of brand reassignments for historical P&L attribution */
  groupHistory?: { day: number; groupId?: ID }[]
  modelId: string
  ownership: Ownership
  /** Asset depreciation method (owned buses only). NONE keeps the asset at cost. */
  depreciationMethod?: DepreciationMethod
  /** Annual write-off rate fixed at purchase (per cent). Undefined = legacy policy. */
  depreciationRatePct?: number
  leaseOfferRent?: Money // monthly, for leased
  /** Security deposit actually paid at signing (returned if the lease runs to term). */
  leaseDeposit?: Money
  leaseEndDay?: number
  attach?: AttachTerms
  mfgYear: number
  acquiredDay: number
  acquiredPrice: Money // 0 for leased/attached
  bookValue: Money // SLM book, owned only
  odometer: number
  condition: Condition
  tyreKm: number // km since last tyre change (legacy / max of front, rear)
  tyresRetreaded: boolean
  frontTyreKm: number
  rearTyreKm: number
  frontBrand: 'oem' | 'tier2'
  rearBrand: 'oem' | 'tier2' | 'retread'
  tyreCount: 6 | 10
  outsideGarage?: boolean
  /** Cumulative km at last A-service (or any service) */
  lastServiceOdo: number
  /** Cumulative km at last B-service (major) or overhaul */
  lastMajorServiceOdo?: number
  /** Day of last Annual Overhaul */
  lastOverhaulDay?: number
  /** Cumulative km at last Annual Overhaul */
  lastOverhaulOdo?: number
  insuranceExpiryDay: number
  fitnessExpiryDay: number
  /** Pollution under control certificate expiry day */
  pucExpiryDay: number
  /** Telematics GPS tracking unit fitted */
  gpsDeviceFitted: boolean
  /** High-speed WiFi & infotainment server fitted */
  wifiFitted?: boolean
  /** In-seat USB & mobile charging ports fitted */
  usbChargingFitted?: boolean
  /** Security CCTV camera fitted */
  cctvFitted?: boolean
  /** Individual LED reading lights at each berth/seat */
  readingLightsFitted?: boolean
  /** Privacy curtains / partition screens on sleeper berths */
  privacyCurtainsFitted?: boolean
  /** Overhead / bulkhead entertainment screen */
  entertainmentScreenFitted?: boolean
  /** Cabin HEPA / ion air purifier */
  airPurifierFitted?: boolean
  /** Automatic cabin perfume / freshener dispenser */
  cabinFreshenerFitted?: boolean
  /** 220V AC power sockets at seats/berths */
  powerSocketsFitted?: boolean
  /** Catalog fittings fitted on this coach (preferred over legacy *Fitted flags). */
  cabinFittings?: Record<string, boolean>
  /** Fitness renewal failed due to condition/age; requires repair then retest */
  fitnessFailed?: boolean
  /** Impounded at checkpost until this day */
  impoundUntilDay?: number
  /** Annual state MV road tax payable day (due within 30 days of registration anniversary) */
  roadTaxPayableDay: number
  /** AITP interstate permit paid-until day */
  aitpPaidUntilDay: number
  /** City where the bus is currently parked overnight */
  parkedCityId?: string
  /** Multi-day haul: still on the road until this calendar day (exclusive of parking). */
  inTransitUntilDay?: number
  /** Destination city while `inTransitUntilDay` is set. */
  inTransitToCityId?: string
  /** Origin city of the open haul (for UI). */
  inTransitFromCityId?: string
  status: 'active' | 'workshop' | 'delivery' | 'grounded'
  /** Used/lot buy: papers not transferred until this day. */
  transferReadyDay?: number
  /** Insurance premium hike multiplier after claim NCB loss (1 = none). */
  insurancePremiumMult?: number
  duty: BusDuty
  /** if this spare is standing in, the line bus it is covering */
  coveringBusId?: ID
  workshopUntilDay?: number
  workshopJob?: string
  workshopCost?: Money
  scheduleId?: ID
  loanId?: ID // hypothecation
  accidentHistory: boolean
  /** Bus cleanliness score 0-100 */
  busCleanliness: number
  /** Calendar day of last deep clean */
  lastDeepCleanDay?: number
  lifeRevenue: Money
  lifeCost: Money
  lifeTrips: number
  /** perceived bus quality 1-5 (cleanliness, comfort as reviewed) */
  qualityScore: number
  /** Day this chassis took a new fibreglass body (FM-03). Once per bus. */
  refurbishedDay?: number
  /** Extra calendar years of useful life granted by the re-body. */
  lifeExtensionYears?: number
  /** Seat comfort bonus over the model's base comfort (up to +1.5). */
  comfortBonus?: number
  /** Day the seats were last refurbished (cushions, armrests, footrests). */
  seatRefurbDay?: number
  /** Cargo volume capacity in cubic metres (CBM) */
  cargoVolumeCbm?: number
  /** Custom body builder ID (Ashok Leyland / BharatBenz). */
  bodyBuilderId?: string
  /** Custom body design ID. */
  bodyDesignId?: string
  /** Snapshot of body design name for display resilience. */
  bodyDesignName?: string
  /** Calendar day when Engine & Transmission underwent precision mid-life overhaul */
  powertrainOverhaulDay?: number
  /** Fuel efficiency bonus multiplier from precision powertrain overhaul (+8% to +12% km/l, e.g. 0.10) */
  powertrainKmplBonus?: number
  /** Calendar day when luxury tech & amenities package retrofit was completed */
  luxuryRetrofitDay?: number
  /** Whether pneumatic air-suspension retrofit kit is fitted */
  airSuspensionFitted?: boolean
}

export interface BusOrder {
  id: ID
  modelId: string
  orderedDay: number
  deliveryDay: number
  price: Money
  loanId?: ID
  /** Asset policy locked in when the order was placed. */
  depreciationMethod?: DepreciationMethod
  depreciationRatePct?: number
  groupId?: ID
  bodyBuilderId?: string
  bodyDesignId?: string
  bodyDesignName?: string
}

/* ============================ Used market etc =========================== */

export interface UsedListing {
  id: ID
  reg: string
  modelId: string
  ageYears: number
  odometer: number
  askPrice: Money
  expiresDay: number
  // hidden until inspected
  condition: Condition
  accidentHistory: boolean
  inspected: boolean
  sellerNote: string
  gpsDeviceFitted?: boolean
  bodyBuilderId?: string
  bodyDesignId?: string
  bodyDesignName?: string
}

export interface LeaseOffer {
  id: ID
  modelId: string
  monthlyRent: Money
  depositMonths: number
  minMonths: number
  ageYears: number
  odometer: number
  expiresDay: number
  gpsDeviceFitted?: boolean
  bodyBuilderId?: string
  bodyDesignId?: string
  bodyDesignName?: string
}

export interface AttachOffer {
  id: ID
  reg: string
  modelId: string
  ownerShare: number
  ageYears: number
  odometer: number
  qualityTier: 'good' | 'average' | 'rough' // visible hint; true condition varies
  expiresDay: number
  gpsDeviceFitted?: boolean
  /** Raised by an event, not the weekly market — survives a refresh until it expires. */
  fromEvent?: boolean
  bodyBuilderId?: string
  bodyDesignId?: string
  bodyDesignName?: string
}

/* ================================ Staff ================================ */

export type StaffRole = 'driver' | 'co_driver' | 'conductor' | 'mechanic' | 'manager'
export type DeskPost = 'hr' | 'ops' | 'workshop' | 'cargo' | 'schedule' | 'documents' | 'crm' | 'accountant' | 'charter'

export interface SpanMeter {
  desk: DeskPost
  demand: number
  capacity: number
  coverage: number // 0..1
  assistantsToCover: number
  headSkill?: number
  assistantCount: number
}

export type LicenceClass = 'HMV_PSV' | 'HMV_HP'
export type MechanicTrade = 'engine_gearbox' | 'electrical_ac' | 'body_suspension' | 'general'

export type BusDuty = 'line' | 'spare' | 'charter'

export interface Staff {
  id: ID
  name: string
  role: StaffRole
  skill: number // 1-10
  experienceYears: number
  salary: Money // per month
  loyalty: number // 0-100
  morale: number // 0-100
  fatigue: number // 0-100 (drivers)
  safety: number // 1-10, drivers: accident avoidance
  hiredDay: number
  /** last day HR raised this person's skill (experience reviews) */
  lastHrSkillDay?: number
  busId?: ID
  /** Drivers: line is posted on a bus; spare sits on the depot bench for cover. */
  duty?: BusDuty
  /** Last calendar day this driver ran a trip (no rest recovery that day). */
  lastTripDay?: number
  /** Consecutive calendar days ending at lastTripDay that this driver worked. */
  consecutiveDutyDays?: number
  drivingStyle?: 'aggressive' | 'cautious'
  onLeaveUntilDay?: number
  lastPaidDay?: number
  licenceClass?: LicenceClass
  mechanicTrade?: MechanicTrade
  cmvrHoursToday?: number
  nextDutyNotBeforeHour?: number
  safetyRecord?: { accidents: number; hardBrakes: number; violations: number }
  tripsDriven?: number
  /** Career rank 0-3 (Trainee, Driver, Senior, Master) last acknowledged. See sim/careers.ts. */
  careerRank?: number
  retrainUntilDay?: number
  licenceUpgradeUntilDay?: number
  nightRestUntilDay?: number
  nightRestUntilHour?: number
}

/* ============================ Routes & permits ========================== */

export interface City {
  id: string
  name: string
  state: string
  /** 0-1: job-hub score; homebound festival flow runs from high to low */
  metro: number
  /** Typical RedBus-style boarding points when departing this city */
  pickups: number
}

export interface RouteDef {
  id: string
  from: string
  to: string
  km: number
  hours: number
  /** benchmark market fare for an AC sleeper berth, full trip */
  marketFareAC: Money
  /** Private-operator pax/day per direction (derived from data/corridorSupply). */
  baseDemand: number
  /** 0-1: how saturated the corridor is with competitor supply */
  competition: number
  railCompetition: number // 0-1
  ghat: boolean // hill sections: monsoon risk
  interstate: boolean
  borderTaxPerTrip: Money
  tollPerKm: Money
  /** minimum reputation (0-100) to get a permit application accepted */
  unlockRep: number
  notes: string
}

export type SeasonId = 'summer' | 'diwali' | 'pilgrim'

export interface SeasonalPermit {
  status: 'applied' | 'active' | 'expired'
  seasonId: SeasonId
  appliedDay: number
  activeFromDay?: number
  expiryDay?: number
}

/**
 * Annual goods (cargo) licence for one corridor. Contracts are only invited on
 * corridors that hold one, so freight cannot be signed on every permit at once.
 */
export interface CargoServicePermit {
  status: 'active' | 'lapsed'
  appliedDay: number
  activeFromDay?: number
  expiryDay: number
  /** Licence fee paid for the current term. */
  feePaid: Money
}

export interface Permit {
  routeId: string
  status: 'applied' | 'active'
  appliedDay: number
  activeFromDay?: number
  expiryDay?: number
  seasonal?: SeasonalPermit
  /** Cargo service licence — gates contract invites on this corridor. */
  cargo?: CargoServicePermit
}

/* ============================== Schedules ============================== */

export type CancellationPolicy = 'flexible' | 'standard' | 'strict'

/** Per-trip consumables — keys from AMENITY_CATALOG. */
export type PassengerAmenities = Record<string, boolean | undefined>

/** Brand defaults applied as paid fittings on new owned deliveries — keys from FITTING_CATALOG. */
export type BrandFittings = Record<string, boolean | undefined>

export type ServiceTier = 'economy' | 'standard' | 'premium' | 'gold'

export type FuelPartner = 'indianoil' | 'bpcl' | 'hpcl' | 'none'

export interface FuelContract {
  partner: FuelPartner
  cashbackBps?: number // 250 = 2.5%
  adulterationImmune?: boolean
  active: boolean
  signedDay?: number
}

export interface DepotFuelTank {
  installed: boolean
  capacityLitres: number // 10,000
  litres: number
  wholesaleDiscountPaise?: number // rs(4.00)
  autoRefill: boolean
  refillThresholdLitres?: number // 2,000
}

export interface OperatorCertifications {
  primo?: boolean
  womenFriendly?: boolean
  cleanCertified?: boolean
}

export interface Schedule {
  id: ID
  groupId?: ID
  routeId: string
  busIds: ID[] // 1 or 2; 2 buses on a long route = daily service both ways
  depHour: number // 0-23
  depMin?: 0 | 30 // half-hour slot; missing means :00
  baseFare: Money // standard seat, before seat multipliers & surge
  baseFareSleeper?: Money // manual flat fare for sleeper berths on hybrid
  baseFareSeater?: Money // manual flat fare for seater seats on hybrid
  autoPrice: boolean
  boardingPoints: number // fixed from city pickup counts on the corridor
  cancellation: CancellationPolicy
  /** In-cabin passenger amenities */
  amenities?: PassengerAmenities
  /** Service branding tier */
  serviceTier?: ServiceTier
  /** Snapshot of global sell-on flags (kept in sync from Schedule defaults). */
  channels: Record<Channel, boolean>
  redDeal: boolean // paid RedBus promotion
  active: boolean
  createdDay: number
  /** Completed-trip seat fills by day — outbound (or unpaired) last-30-day occupancy. */
  occRecent: { day: number; sold: number; seats: number }[]
  /** Paired BA fills by day — shown on the return strip separately from outbound. */
  occRecentReturn?: { day: number; sold: number; seats: number }[]
  /** Outbound trip duty ('daily' or 'festival') */
  outboundDuty?: 'daily' | 'festival'
  /** Return trip duty ('daily' or 'festival') */
  returnDuty?: 'daily' | 'festival'
  /** Rolling PSS satisfaction scores for trips on this schedule (max 30). */
  pssRecent?: number[]
  /**
   * Festival-only service: may be planned any day, but trips only run on
   * festival calendar windows. Buses are auto-assigned (Schedule manager);
   * no permanent manual assign.
   */
  festivalOnly?: boolean
  /** @deprecated old temp mount — migrated to festivalOnly */
  festivalUntilDay?: number
  /** @deprecated bay lock removed */
  slotLockedUntilDay?: number
  /**
   * Paired = double trip same day (both directions):
   * 1st at depHour/depMin, 2nd at returnDep* (may land next calendar day if wrap).
   */
  paired?: boolean
  /** 2nd trip departure (local clock). Required when paired. */
  returnDepHour?: number
  returnDepMin?: 0 | 30
  /** 2nd trip auto-pricing toggle. If undefined, falls back to autoPrice. */
  returnAutoPrice?: boolean
  /** 2nd trip flat manual base fare. If undefined, falls back to baseFare. */
  returnBaseFare?: Money
  /** 2nd trip manual flat fare for sleeper berths on hybrid */
  returnBaseFareSleeper?: Money
  /** 2nd trip manual flat fare for seater seats on hybrid */
  returnBaseFareSeater?: Money
  /** Buses auto-assigned by Schedule manager during festival booking window (released after festival ends) */
  autoAssignedBusIds?: ID[]
  /** Freight cards sell kilograms, not seats. Missing means passenger. */
  serviceKind?: 'passenger' | 'cargo'
}

/* ================================ Trips ================================ */

/** OTAs + own app + counter. See engine/data/channels.ts for labels & rates. */
export type Channel = 'redbus' | 'abhibus' | 'ownapp' | 'counter'

export interface SeatSale {
  price: Money
  channel: Channel
  bookedDay: number
}

export interface TripSeat {
  id: string // "L5", "U12", "23W"
  deck: 'L' | 'U' | 'M'
  mult: number
  ladies: boolean
  /** Hybrid coaches mark berth vs cabin seats for pricing/UI. */
  zone?: 'sleeper' | 'semi'
  sale?: SeatSale
}

export interface TripOutcome {
  delayMin: number
  breakdown: boolean
  accident: boolean
  fuelCost: Money
  tollCost: Money
  tripCosts: Money // total direct trip cost
  amenitiesCost?: Money
  reliefDispatched?: boolean
  ecoBonusPaid?: boolean
  cargoRevenue: Money
  /** kg loaded this trip (0 if none / attached) */
  cargoKg?: number
  /** Volume-limited kilograms the vehicle could have taken. Fill is kg / this, not the raw model bay. */
  cargoCapKg?: number
  /** How the loaded kilograms were split. */
  cargoContractKg?: number
  cargoSpotKg?: number
  cargoWalkupKg?: number
  reviewScore: number // 0-5 this trip
  /** Passenger Satisfaction Score 0-10 */
  pss: number
  note: string
}

export interface HybridStatsSnapshot {
  sleeper: { cap: number; sold: number; listed: Money; paidAvg?: number | null }
  seater: { cap: number; sold: number; listed: Money; paidAvg?: number | null }
}

/** One sold seat on a trip whose per-seat objects have been shed (see seatstate.ts). */
export interface TripSeatSale {
  /** Seat id from the coach template, e.g. "L2W". */
  id: string
  /** Price paid (paise). */
  p: Money
  /** Booking channel. */
  c: Channel
  /** Game day the seat was booked. */
  d: number
}

export interface Trip {
  id: ID
  scheduleId: ID
  routeId: string
  direction: 'AB' | 'BA'
  busId: ID
  day: number
  depHour: number
  depMin?: 0 | 30
  fare: Money // current base fare for this trip (class-adjusted, repriceable)
  fareSleeper?: Money // manual flat fare for sleeper berths on hybrid
  fareSeater?: Money // manual flat fare for seater seats on hybrid
  flatFare?: boolean // whether this trip uses flat manual pricing without dynamic multipliers
  fareLocked?: boolean // player set this trip's fare; do not overwrite
  lastPricedDay?: number // game day when late dynamic repricing last ran
  /**
   * Live seat map. Empty on a packed trip — cold departures keep only
   * `seatSales` and rebuild the berths from the coach template on demand.
   */
  seats: TripSeat[]
  /** Coach model whose template built the current seat map (exact rebuild key). */
  seatModelId?: string
  /** Sold seats of a packed trip, in the order they were booked. */
  seatSales?: TripSeatSale[]
  /** Layout size. Kept after a trip drops its seat map. */
  seatCount: number
  sold: number
  revenue: Money // gross ticket revenue booked (incl. cancelled retained)
  /** CMVR driving hours or missing co-driver block */
  cmvrBlocked?: boolean
  /** Player confirmed to run trip despite CMVR block */
  cmvrRunAnyway?: boolean
  cancelledRevenue: Money
  channelSold: Record<Channel, number>
  status: 'open' | 'completed' | 'cancelled'
  outcome?: TripOutcome
  /** 1 = 1st trip slot, 2 = 2nd trip (return) slot */
  slot?: 1 | 2
  /** BA leg linked to this outbound trip id. */
  pairOfTripId?: ID
  /** Outbound delayed past buffer — BA left empty after refunds. */
  pairEmptyDepart?: boolean
  /** Whether this trip was generated for a seasonal (festival) duty / service run. */
  isSeasonal?: boolean
  /** Runs only on festival days. */
  festivalOnly?: boolean
  /** Active flash sale discount (-20% fare, +65% booking pace) */
  flashDeal?: boolean
  /** Active last-minute surge (+25% fare) */
  surgeDeal?: boolean
  /** In-cabin passenger amenities direct cost */
  amenitiesCost?: Money
  /** Class breakdown for hybrid sleeper/seater coaches, preserved after seat maps drop. */
  hybridSnapshot?: HybridStatsSnapshot
}

/* =============================== Finance =============================== */

export type TxnHead =
  // income
  | 'ticket' | 'cargo' | 'charter' | 'advertising' | 'onboard' | 'cancellation_fee'
  | 'asset_sale' | 'subsidy' | 'other_income' | 'cargo_spot' | 'fuel_cashback'
  | 'lounge_revenue' | 'fuel_hedge'
  // direct trip cost
  | 'fuel' | 'adblue' | 'toll' | 'border_tax' | 'bata' | 'parking_cleaning' | 'loading_unloading'
  | 'passenger_amenities' | 'driver_incentive'
  // channel cost
  | 'redbus_commission' | 'agent_commission' | 'pg_fees' | 'marketing' | 'app_opex'
  // fleet cost
  | 'maintenance' | 'accident_repair' | 'tyres' | 'insurance' | 'fitness' | 'puc' | 'permit_tax' | 'road_tax' | 'gps_telematics' | 'gps_fit'
  | 'lease_rent' | 'attach_owner_share' | 'inspection' | 'cargo_liability' | 'cleaning' | 'amenity_retrofit' | 'rebranding'
  // people & admin
  | 'salary' | 'training' | 'office_admin' | 'depot_rent' | 'staff_welfare' | 'lounge_opex'
  // finance & statutory
  | 'interest' | 'od_interest' | 'penalty' | 'processing_fee' | 'gst' | 'tds' | 'income_tax' | 'fine' | 'refund' | 'depreciation'
  // capital (not in P&L)
  | 'bus_purchase' | 'workshop_capex' | 'app_capex' | 'depot_capex' | 'depot_fuel_capex' | 'lounge_capex' | 'loan_disbursal' | 'loan_principal'
  | 'od_draw' | 'od_repay' | 'deposit' | 'seed_capital'
  | 'insurance_claim'

export type TxnKind = 'income' | 'expense' | 'capital_in' | 'capital_out'

export type RefundCategory = 'passenger' | 'crm' | 'busCancel'

export interface RefundBreakdown {
  passenger: Money
  crm: Money
  busCancel: Money
}

export interface MonthlyFuelBreakdown {
  gross: Money
  roadside: Money
  depotTanker: Money
  cashback: Money
  net: Money
}

export interface Txn {
  id: ID
  day: number
  head: TxnHead
  kind: TxnKind
  amount: Money // always positive
  /** Postings folded into this row (same day/head/refs/note) — 1 when standalone. */
  count?: number
  note?: string
  busId?: ID
  routeId?: string
  tripId?: ID
  /** Brand (subsidiary) that owns the bus behind this posting, stamped by the ledger. */
  groupId?: ID
  refundCategory?: RefundCategory
}

export interface Receivable {
  id: ID
  amount: Money
  settleDay: number
  channel: Channel
  /** Settlement cheque bounced — held out of the normal settlement sweep. */
  bounced?: boolean
}

export interface ChannelTicketSales {
  revenue: Money
  seats: number
  commission: Money
}

export interface MonthlyTicketBreakdown {
  gross: Money
  seats: number
  channels: Record<Channel, ChannelTicketSales>
  bySeatType?: {
    sleeper: { revenue: Money; seats: number }
    seater: { revenue: Money; seats: number }
  }
}

export interface DetailedMonthlyTicketBreakdown extends MonthlyTicketBreakdown {
  cancellationFees: Money
  totalDeductions: Money
  netRevenue: Money
}

export interface MonthlySummary {
  ym: string
  income: Partial<Record<TxnHead, Money>>
  expense: Partial<Record<TxnHead, Money>>
  revenueTotal: Money
  expenseTotal: Money
  profit: Money
  trips: number
  paxKm: number
  seatKm: number
  loadFactor: number
  refundBreakdown?: RefundBreakdown
  ticketBreakdown?: MonthlyTicketBreakdown
  fuelBreakdown?: MonthlyFuelBreakdown
  cargoKgMtd?: number
  /** Cargo freight earned by parcels riding in a passenger coach belly. */
  cargoCoachRevenue?: Money
  /** Cargo freight earned by dedicated cargo vehicles (LCV / 26T). */
  cargoTruckRevenue?: Money
  /** Kilograms hauled in coach bellies. */
  cargoCoachKg?: number
  /** Kilograms hauled on dedicated cargo vehicles. */
  cargoTruckKg?: number
  /** Revenue earned by dedicated private charters (booked via Charters desk). */
  charterPrivateRevenue?: Money
  /** Revenue earned by festival & seasonal route charters. */
  charterFestivalRevenue?: Money
}

export interface RouteLayoutStats {
  revenue: Money
  cost: Money
  trips: number
  paxKm: number
  seatKm: number
}

export interface RouteStats {
  revenue: Money
  cost: Money
  trips: number
  paxKm: number
  seatKm: number
  /** Lifetime economics split by bus layout on this corridor. */
  byLayout: Record<string, RouteLayoutStats>
  /**
   * Lifetime economics split by subsidiary brand (`groupId`, or `__unassigned__`).
   * Mirrors `byLayout` so Analytics period windows can filter by brand after
   * completed trips have been pruned from the live inventory.
   */
  byBrand?: Record<string, RouteLayoutStats>
}

/** One direction of one corridor on one day. Survives after completed trips are pruned. */
export interface CargoLaneDay {
  trips: number
  cargoOnlyTrips: number
  kg: number
  cargoOnlyKg: number
  capKg: number
  marketKg: number
  bookKg: number
  revenue: Money
  contractKg: number
  spotKg: number
  walkupKg: number
  contractRevenue: Money
  spotRevenue: Money
  walkupRevenue: Money
  /** Coolie charge at the origin dock, charged per kg handled. */
  loading: Money
  /** Coolie charge at the destination dock, charged per kg handled. */
  unloading: Money
  liability: Money
  shortfall: Money
  fuel: Money
  toll: Money
  bata: Money
}

export interface RouteDayStats {
  day: number
  revenue: Money
  cost: Money
  trips: number
  paxKm: number
  seatKm: number
  byLayout: Record<string, RouteLayoutStats>
  /** Same brand keys as RouteStats.byBrand; survives trip inventory trim. */
  byBrand?: Record<string, RouteLayoutStats>
  cargo?: Partial<Record<'AB' | 'BA', CargoLaneDay>>
}

/* =============================== Seasonal Services =============================== */

export interface SeasonalRunRecord {
  tripId: ID
  scheduleId?: ID
  routeId: string
  busId: ID
  day: number
  direction?: 'AB' | 'BA'
  pax: number
  seats: number
  paxKm: number
  seatKm: number
  revenue: Money
  ticketRevenue: Money
  cargoRevenue: Money
  onboardRevenue?: Money
  expenses: Money
  fuelCost: Money
  tollCost: Money
  bata: Money
  otherCosts: Money
  profit: Money
  kind?: 'scheduled' | 'charter'
  coachType?: 'semi' | 'sleeper' | 'hybrid' | string
}

export interface SeasonalServiceStats {
  lifetime: {
    trips: number
    revenue: Money
    expenses: Money
    profit: Money
    pax: number
    seatKm: number
    paxKm: number
  }
  history: SeasonalRunRecord[]
}

export type LoanKind = 'vehicle' | 'cash'

export interface Loan {
  id: ID
  kind: LoanKind
  lender: string
  lenderId?: string
  principal: Money
  balance: Money
  rateBps: number // annual
  months: number
  emi: Money
  startDay: number
  nextEmiDay: number
  emisPaid: number
  emisMissed: number
  consecutiveMissed: number
  busId?: ID
  status: 'active' | 'closed' | 'defaulted'
}

export interface Overdraft {
  limit: Money
  drawn: Money
  rateBps: number
  accruedInterest: Money
}

/* ================================ World ================================ */

export type CorridorStance = 'neutral' | 'undercut' | 'premium_hold' | 'cargo_bundle'

export interface CorridorRivalAction {
  rivalId: string
  rivalName: string
  routeId: string
  tactic: 'predatory_timing' | 'price_war' | 'capacity_dump'
  targetDepartureClocks: string[] // e.g. ["20:45", "22:15"]
  fareDiscountPct: number // e.g. 20 (meaning -20%)
  addedDailySeats: number // e.g. 90
  startDay: number
  untilDay: number
  intensity: 'aggressive' | 'moderate' | 'desperate'
  headline: string
  details: string
}

export interface RivalMemory {
  /** 0-1: how much this rival wants to hurt you. Grows while you dominate their routes, fades over time. */
  grudge: number
  actions: number
  /** Attacks that failed: you held your ground. Each makes the rival a little more cautious. */
  defeats: number
  /** Attacks that worked: you lost share. Each makes the rival bolder. */
  victories: number
  lastActionDay: number
}

export interface World {
  dieselPaise: number // per litre today
  /** competitor fare index per route (1 = benchmark), random walk + reactions */
  fareIndex: Record<string, number>
  /** transient demand shocks per route (events) */
  demandShock: Record<string, { mult: number; untilDay: number; reason: string }>
  /** route closures (landslide/bandh): no trips depart */
  closures: Record<string, { untilDay: number; reason: string }>
  redbusCommissionBps: number
  /** routes upgraded by a new expressway (permanently faster) */
  expressways: string[]
  /** predatory competitor undercuts by route */
  priceWars: Record<string, { untilDay: number; depth: number }>
  strikeUntilDay: number
  rtoCrackdownUntilDay: number
  evSubsidyUntilDay: number
  /** Live named rivals (8 operators) */
  rivals?: Record<string, RivalDef>
  /** Market share per corridor: player % and rival %s (sum = 100) */
  share?: Record<string, { player: number; byRival: Record<string, number> }>
  /** Rolling player market share history per route (capped at 180 days) */
  shareHistory?: Record<string, { day: number; player: number }[]>
  /** Routes upgraded with road widening (journey hours x0.95, delay -15min) */
  roadWidened?: string[]
  /** Detour routes during bridge closure (adds 45m, fuel x1.12) */
  detour?: Record<string, number>
  /** Adulterated diesel until day at local bunk (-5 engine condition on 40% roll) */
  adulterationUntilDay?: number
  adulterationBunk?: string
  /** New expressway proposals with countdown until inauguration */
  expresswayProposals?: Record<string, number>
  /** Route undergoing cargo pilferage today (50% cargo revenue) */
  cargoPilferageRouteId?: string
  cargoPilferageUntilDay?: number
  /** Celebrity travelling on a sleeper trip (reputation +5 on on-time completion) */
  celebrityDay?: number
  lastUnionDemandDay?: number
  /** Game day when the last group charter was generated (cooldown tracker) */
  lastCharterDay?: number
  /** Dynamic rival intelligence actions (predatory timing, retaliatory price wars) */
  rivalActions?: Record<string, CorridorRivalAction>
  /** What each rival remembers about you. See sim/rivalIntelligence.ts. */
  rivalMemory?: Record<string, RivalMemory>
  /** Game day when rival intelligence was last evaluated (weekly batched evaluation) */
  lastRivalIntelDay?: number
}

/* ============================ Events & inbox ============================ */

export type LogCat = 'finance' | 'trip' | 'alert' | 'event' | 'good' | 'info'

export interface InboxMsg {
  id: ID
  day: number
  cat: LogCat
  text: string
  read?: boolean
  /** Page to open to act on this message, e.g. "/fleet/b12" or "/workshop". */
  link?: string
}

export interface DecisionOption {
  id: string
  label: string
  detail?: string
  /** Some decisions carry a stable key, a cost and a one-line effect for their handler. */
  key?: string
  cost?: number
  effectHint?: string
}

export interface Decision {
  id: ID
  day: number
  groupId?: ID
  kind: string
  title: string
  body: string
  options: DecisionOption[]
  data?: Record<string, unknown>
  /** Last day this decision can still be answered. */
  expiresDay?: number
}

/* =============================== Company =============================== */

export interface AppState {
  tier: 0 | 1 | 2 | 3
  installs: number
  mau: number
  monthlyMarketing: Money
}

export type CargoCargoType = 'mixed' | 'textiles' | 'hardware' | 'agri' | 'fmcg'

export interface CargoContract {
  id: ID
  partner: 'DTDC' | 'Delhivery' | 'Blue Dart' | string
  routeId: string
  /** AB = route.from → route.to. Each contract is one direction. */
  direction: 'AB' | 'BA'
  /** Physical lane, `${originCityId}>${destCityId}`. Alias routes share one key. */
  laneKey: string
  /** Stable identity so a manager cannot sign the same monthly lot twice. */
  offerKey: string
  lot?: 1 | 2
  guaranteedKgPerDay: number
  ratePerKg100Km: number
  tier?: 'local' | 'mid' | 'enterprise'
  startDay: number
  durationDays: 30 | 60 | 90
  expiresDay: number
  active: boolean
  /** Month key (YYYY-MM) the counters below belong to. */
  mtdYm?: string
  hauledKgMtd?: number
  earnedPaiseMtd?: number
  shortfallKgMtd?: number
}

export type SpotCargoStatus = 'offered' | 'queued' | 'shipped' | 'expired'

export interface SpotCargoOffer {
  id: ID
  originCity: string
  destCity: string
  routeId: string
  /** AB = route.from → route.to. Missing offers follow the route as stored. */
  direction?: 'AB' | 'BA'
  weightKg: number
  volumeCbm: number
  /** Chargeable weight in kg accounting for volumetric density: max(weightKg, volumeCbm * density). */
  chargeableKg?: number
  cargoType: CargoCargoType
  fragile: boolean
  /** Quoted rupees-in-paise at offer time. Cash is collected only for kilograms hauled. */
  totalPayment: Money
  /** Premium over the vehicle rate, e.g. 1.2. */
  premiumMult?: number
  offeredDay: number
  expiresDay: number
  status?: SpotCargoStatus
  remainingKg?: number
  shippedDay?: number
  shippedKg?: number
}

/** Promised contract kilograms for one direction on one day. Dispatch fills hauledKg. */
export interface CargoHaulLine {
  contractId: ID
  routeId: string
  direction: 'AB' | 'BA'
  laneKey?: string
  promisedKg: number
  hauledKg: number
  ratePerKg100Km: number
  km: number
}

/** Today's finite freight book for one physical direction. Dispatch draws it down. */
export interface CargoPoolState {
  day: number
  laneKey: string
  routeId: string
  direction: 'AB' | 'BA'
  parcelMarketKg: number
  bulkMarketKg: number
  parcelBookKg: number
  bulkBookKg: number
  parcelLoadedKg: number
  bulkLoadedKg: number
  contractDueKg: number
  departuresPlanned: number
  departuresServed: number
}

export interface CargoHaulDay {
  day: number
  lines: CargoHaulLine[]
  pools?: Record<string, CargoPoolState>
}

/* ================================ Charters & Block Bookings ================================ */

export type CharterPricingStrategy = 'discount' | 'market' | 'premium'

export type CharterCategory = 'pilgrimage' | 'wedding' | 'corporate' | 'school' | 'family' | 'tour'

export interface CharterContract {
  id: ID
  title: string
  category: CharterCategory
  clientName: string
  originCityId: string
  destinationName: string
  roundTripKm: number
  durationDays: number
  preferredCoachKind: 'semi' | 'sleeper' | 'seater' | 'van'
  minSeats: number
  minCondition: number
  payout: Money
  fuelCostEst: Money
  tollCostEst: Money
  driverBataEst: Money
  maintenanceCostEst?: Money
  netProfitEst: Money
  busId?: ID
  driverId?: ID
  startDay: number
  endDay: number
  currentDayProgress: number
  status: 'inquiry' | 'booked' | 'active' | 'completed' | 'cancelled'
  pricingStrategy: CharterPricingStrategy
  /** Peak-month and festival multiplier fixed when the inquiry came in (1 if missing). */
  seasonMult?: number
  /** Empty km to bring the coach from our charter base to the start city and back (0 if missing). */
  positioningKm?: number
  /** Last day the client waits for our answer (falls back to the day before the tour). */
  respondByDay?: number
  clientRating?: number
  completedRevenue?: Money
  completedExpenses?: Money
  notes?: string
  /** Deposit already collected at booking. */
  depositPaid?: Money
}

export interface CharterOpsConfig {
  pricingStrategy: CharterPricingStrategy
  operatingBaseCityId: string
  autoAccept: boolean
  autoDispatch: boolean
  minConditionScore: number
  /** Auto-accept only takes tours with at least this margin. Default 0. */
  minMarginPct?: number
  /** Share of the fee collected when the tour is booked. Default 0. */
  depositPct?: number
}

export interface CharterStats {
  totalContracts: number
  totalRevenue: Money
  totalProfit: Money
  avgRating: number
}

/* ================================ Passenger Lounges & Waiting Areas ================================ */

export type LoungeTier = 'express' | 'premium' | 'business'

export interface LoungeTierDef {
  id: LoungeTier
  name: string
  label: string
  sqft: number
  seats: number
  setupCost: Money
  dailyRent: Money
  dailyElectricity: Money
  dailyStaffWage: Money
  avgSnackSpend: Money
  snackMargin: number
  demandBoostPct: number
  maxDailyPaxCapacity: number
  desc: string
  features: string[]
}

export type LoungeSeating = 'bench' | 'cushioned' | 'recliner' | 'pods'
export type LoungeAmenityId = 'tea' | 'wifi' | 'assist' | 'cctv' | 'cafe' | 'rest'

export interface PassengerLounge {
  id: ID
  cityId: string
  locationName: string
  tier: LoungeTier
  /** Seating package. Missing on older saves: treated as cushioned. */
  seating?: LoungeSeating
  /** Amenities this lounge offers. Missing on older saves: the network policy in Settings applies. */
  amenities?: LoungeAmenityId[]
  openedDay: number
  /** Daily stats */
  yesterdayPax: number
  yesterdaySnackRevenue: Money
  yesterdayRentExpense: Money
  yesterdayElectricExpense: Money
  yesterdayStaffExpense: Money
  yesterdayNetProfit: Money
  /** Cumulative totals */
  lifetimePax: number
  lifetimeRevenue: Money
  lifetimeExpense: Money
}

export interface PassengerHandlingConfig {
  /** Amenity policy: complimentary tea, coffee & mineral water for waiting passengers */
  complimentaryTeaCoffee?: boolean
  /** Free high-speed optical Wi-Fi & USB fast charging */
  freeHighSpeedWifi?: boolean
  /** Boarding priority assistance & live SMS / WhatsApp tracking alerts */
  boardingAssistanceAlerts?: boolean
  /** 24/7 CCTV surveillance & digital luggage tag tracking */
  cctvLuggageSecurity?: boolean
  /** Lounge access policy: open to all passengers or premium ticket holders only */
  accessPolicy?: 'all_passengers' | 'ac_only'
}

export interface Grievance {
  id: ID
  day: number
  busId: ID
  routeId: string
  cause: 'delay' | 'ac' | 'clean' | 'driver' | 'ladies' | 'other'
  status: 'open' | 'refunded' | 'dismissed' | 'escalated'
  amount: Money // suggested refund, ₹100–₹800
}

export interface FuelHedge {
  strikePaise: Money // locked price per litre
  litresPerMonth: number
  startDay: number
  untilDay: number
  priceSum: number
  days: number
  premiumPaid: Money
  netSettled: Money
}

export interface Company {
  name: string
  cash: Money
  /** The running fuel hedge, if any. See sim/hedge.ts. */
  fuelHedge?: FuelHedge
  /** 0-100, recomputed daily. See sim/health.ts. */
  fleetHealth?: number
  /** 0-100, recomputed daily. See sim/health.ts. */
  crewWelfare?: number
  rating: number // RedBus star rating 1-5
  ratingCount: number
  punctuality: number // 0-1 on-time factor
  cancelRate: number // operator-cancelled trips EMA
  primo: boolean
  primoOffered: boolean
  /** Earliest day RedBus may invite again after a decline or delist. */
  primoNextEligibleDay?: number
  reputation: number // 0-100, gates unlocks
  brandAwareness: number // 0-1, grows with trips & marketing
  app: AppState
  /** Rolling history of recent trip PSS scores (up to 30) */
  recentTripPss?: number[]
  creditScore: number // 300-900
  gstPayable: Money // accrued, paid monthly
  /** Income tax provided but not yet paid. Paid monthly, so normally zero. */
  taxProvision: Money
  /** Income tax provided so far this FY (paid monthly; excess carries forward). */
  advanceTaxPaid: Money
  fyRevenue: Money
  /** Pre-tax taxable profit for the current FY (income tax never reduces it). */
  fyProfit: Money
  /** Primary depot home city id */
  homeCityId: string
  /** Annual corporate freight growth rates recorded for each completed operational year (between -0.10 and +0.20) */
  corporateAnnualRates?: number[]
  /** appointed HR desk (a manager) — fatigue roster, auto-hire, auto-raise */
  hrId?: ID
  /** HR auto-hires from the pool when roles/skills match (needs appointed HR). */
  hrAutoHire?: HrAutoHire
  /** HR raises underpaid staff to market and matches rival poach offers (needs appointed HR). */
  hrAutoRaise?: boolean
  /** HR auto-fires staff when their monthly salary exceeds the role threshold (needs appointed HR). */
  hrAutoFire?: HrAutoFire
  /** appointed ops desk (a manager) — auto-assigns crew from payroll */
  opsId?: ID
  /** when true and ops is on duty, daily pass keeps each bus at required drivers + conductor */
  opsAutoStaff?: boolean
  /** appointed cargo desk (a manager) — books parcels, negotiates rates */
  cargoManagerId?: ID
  /** Schedule manager — auto-assigns idle buses to festival-only services on fest days */
  scheduleManagerId?: ID
  /** Whether the appointed Schedule manager automatically accepts group charters (defaults to true) */
  scheduleAutoAcceptCharters?: boolean
  /** Document manager — renews PUC, fitness, insurance, road tax, permits */
  docsManagerId?: ID
  /** CRM manager — passenger disputes and grievances */
  crmId?: ID
  /** Accountant — files GST and TDS on due day */
  accountantId?: ID
  /** Charter Operations Manager — coordinates pilgrimage, wedding & block contracts */
  charterManagerId?: ID
  /** Charter operations configuration and pricing policy */
  charterConfig?: CharterOpsConfig
  /** Extra managers posted to a desk beyond the head. Each adds part of a head's span. */
  deskAssistants?: Partial<Record<DeskPost, ID[]>>
  /** Last day a span warning was logged for a desk (throttled to once per 30 days). */
  lastSpanWarnDay?: Partial<Record<DeskPost, number>>
  /** CRM passenger resolution policy */
  crmPolicy: 'ask' | 'refund' | 'dispute' | 'suggest_refund'
  /** Current count of open grievances */
  grievanceCount: number
  /** Passenger grievances queue (max 40 open) */
  grievances?: Grievance[]
  /** Total refunds paid out by CRM desk */
  crmRefundTotal?: Money
  /** Total count of grievances refunded by CRM desk */
  crmRefundCount?: number
  /** Last day a warning decision was triggered for grievances */
  grievanceWarnedDay?: number
  /** Accumulated input tax credit on GST (e.g. from fuel) */
  gstInputCredit: number
  /** Day on which monthly GST is due (month-end + 7) */
  gstDueDay?: number
  /** Accrued TDS payable on contractor/attached owner payouts */
  tdsPayable: number
  /**
   * Cash still owed to attached-bus owners for ticket shares already booked in P&L.
   * Accrued when seats sell; paid out when the trip departs.
   */
  attachOwnerPayable?: Money
  /** Day on which quarterly TDS is due (quarter-end + 15) */
  tdsDueDay?: number
  /** Day through which quarterly TDS returns have been filed */
  tdsFiledThroughDay: number
  /** CMVR driving hours / crew law offence count */
  cmvrOffenceCount: number
  /** Operations permit suspension day from CMVR violations (-1 = none) */
  cmvrSuspendUntilDay: number
  /** Calendar year the festival bonus decision was made */
  festivalBonusDecidedYear?: number
  /** Default asset depreciation method for new purchases */
  depreciationDefault: DepreciationMethod
  /** Default annual depreciation rate (% of cost / book) for new purchases, 5–30 */
  depreciationRatePct?: number
  /** Consecutive completed trips without an accident */
  safeTripStreak: number
  /** Day company unlocked RedBus Primo status */
  primoSinceDay?: number
  /** Cumulative lifetime parcel/cargo revenue */
  cargoLifeRevenue: number
  /** Day company first reached 5.0★ rating consecutively */
  fiveStarSinceDay?: number
  /** Cargo desk defaults and active deals. */
  cargoCargoType?: CargoCargoType
  cargoAcceptFragile?: boolean
  cargoContracts?: CargoContract[]
  spotOffers?: SpotCargoOffer[]
  /** Today's contract promises. Dispatch adds hauled kilograms; shortfall settles after trips. */
  cargoHaulDay?: CargoHaulDay
  /** Dedicated Cargo Service Subsidiary (unlocks dedicated fleet, large contracts up to 26T, bulk spot consignments) */
  dedicatedCargoSubsidiary?: boolean
  /** Player's strategic corridor defensive stance per route against rival predatory moves */
  corridorStance?: Record<string, CorridorStance>
  /** Whether the manager automatically signs corporate contracts (defaults to true; set false to manage manually). */
  cargoAutoSignContracts?: boolean
  /** Relationship score per lender (0-100) — grows with on-time EMI payments, unlocks rate discounts */
  lenderRelations?: Record<string, number>
  /** Cumulative maintenance spend by service tier */
  serviceSpendByTier?: { a: Money; b: Money; overhaul: Money }
  /** Cumulative service count by service tier */
  serviceCountByTier?: { a: number; b: number; overhaul: number }
  /** Preferred replacement tyre brand for workshop manager auto-replacements */
  workshopTyreBrand?: 'oem' | 'tier2'
  /** Commercial fuel partner contract (IndianOil / BPCL / HPCL) */
  fuelContract?: FuelContract
  /** Depot bulk fuel tank installation & stock */
  depotFuelTank?: DepotFuelTank
  /** Accrued fleet fuel cashback rebate (settled monthly) */
  fuelCashbackAccrued?: Money
  /** Default passenger amenities offered on newly created schedules */
  defaultAmenities?: PassengerAmenities
  /** Default service branding tier on newly created schedules */
  defaultServiceTier?: ServiceTier
  /** Official operator ratings & badges (Primo, Women-Friendly, Clean-Certified) */
  certifications?: OperatorCertifications
  /** Driver eco-driving & safety mileage incentive active (₹250/trip bonus) */
  ecoIncentiveActive?: boolean
  /** Passenger waiting areas & boarding lounges opened across cities */
  lounges?: PassengerLounge[]
}

export type TyreBrand = 'oem' | 'tier2' | 'retread'
export type TyreAxle = 'front' | 'rear' | 'both'

export type ServiceTierId = 'a' | 'b' | 'overhaul'

/** Preferences for HR pulling matching candidates whenever the pool refreshes. */
export interface HrAutoHire {
  enabled: boolean
  /**
   * `unlimited` hires every matching pool candidate; `match` only tops the
   * payroll up to the Ops crew requirement (and stops once it is met).
   */
  mode?: 'unlimited' | 'match'
  /** Per-role skill levels (1–10). Role key present = auto-hire that role. */
  byRole: Partial<Record<StaffRole, number[]>>
  drivingStyle?: ('aggressive' | 'cautious')[]
  licenceClass?: LicenceClass[]
  mechanicTrade?: MechanicTrade[]
}

/** Preferences for HR auto-firing employees whose salary crosses role caps. */
export interface HrAutoFire {
  enabled: boolean
  /** Maximum monthly salary threshold (in paise) per role. If staff salary > threshold, HR auto-fires them. */
  maxSalaryByRole: Partial<Record<StaffRole, Money>>
}

export interface WorkshopLocation {
  id: ID
  cityId: string
  /** Brands allowed to use this site’s bays. Empty = all brands (typical HQ). */
  groupIds: ID[]
  bayCount: number
}

export interface WorkshopState {
  /** 0 = no facility; 1+ = open (bays is the real capacity). */
  level: number
  bays: number
  /** staff id of the appointed workshop manager (must be a manager) */
  managerId?: ID
  /**
   * Mechanic per global bay index (0 .. bays-1). Null/empty slots are unstaffed —
   * do not compact; satellite bays sit at higher indices after HQ.
   */
  mechanicIds?: (ID | null | undefined)[]
  /** Workshop locations (HQ + satellites). Total bays = sum of location bayCounts. */
  locations?: WorkshopLocation[]
}

export type InsuranceClaimStatus = 'pending' | 'survey' | 'settled' | 'garage_paid' | 'rejected'

export interface InsuranceClaim {
  id: ID
  busId: ID
  filedDay: number
  surveyorUntilDay: number
  repairEstimate: Money
  status: InsuranceClaimStatus
  tripId?: ID
  payout?: Money
  resolvedDay?: number
  rejectionReason?: string
}

export interface FestivalSpecial {
  id: ID
  scheduleId: ID
  routeId: string
  untilDay: number
  createdDay: number
}

/** Defaults applied when launching a new schedule (edited on Settings). */
export interface ScheduleDefaults {
  autoPrice: boolean
  cancellation: CancellationPolicy
  /** Fleet-wide sell-on — not per service. */
  channels: Record<Channel, boolean>
  redDeal: boolean
}

export type CargoPricingType = 'normal' | 'aggressive' | 'discount'
export type DriverDormitoryTier = 'none' | 'basic' | 'ac_canteen'
export type FestivalBonusTier = 'full' | 'half' | 'gift' | 'skip'

/** Player-tunable display / ops knobs (not economy balance). */
export interface PlayerConfig {
  /** fleet table highlights odometer at or above this km */
  odoHighlightKm: number
  /** Auto-pay insurance, fitness, road tax and route permits when due (cash + OD). Default on. */
  autoRenewDocs?: boolean
  /** Eco-driving bonus to drivers: better mileage and tyre life. */
  ecoIncentiveActive?: boolean
  /** HR raises salaries to market automatically. */
  hrAutoRaise?: boolean
  /** Parcel base rate in ₹ per kg per 100 km (default 2.0). */
  cargoBaseRateRs?: number
  /** Cargo pricing strategy: normal (1.0x), aggressive (+10% to +20%), discount (-5% to -15%) */
  cargoPricingType?: CargoPricingType
  /** Static schedule policy — cancellation, channels, RedDeal, pricing mode. */
  scheduleDefaults?: ScheduleDefaults
  /** Welfare: daily driver & conductor meal allowance (₹150/day flat, replaces trip bata) */
  mealAllowance?: boolean
  /** Welfare: monthly health cover for crew and mechanics (₹250/staff/mo) */
  healthCoverage?: boolean
  /** Welfare: annual Diwali/festival bonus for staff */
  festivalBonus?: boolean
  /** Welfare: depot driver dormitories (clean AC bunks, hot showers, subsidized canteen) */
  driverDormitoryTier?: DriverDormitoryTier
  /** Welfare: festival bonus policy tier (full = 100% salary, half = 50%, gift = ₹2,500, skip) */
  festivalBonusTier?: FestivalBonusTier

  /* ---- Decision & Simulation Flow Configs ---- */
  /** Auto-pause simulation when cash drops below emergency threshold (default: on) */
  pauseOnLowCash?: boolean
  /** Low cash emergency threshold in paise (default: ₹1,00,000) */
  lowCashThreshold?: Money
  /** Auto-pause simulation when a vehicle suffers a breakdown or accident (default: on) */
  pauseOnBreakdown?: boolean
  /** Auto-pause when vehicle fitness, insurance, or road tax expires (default: on) */
  pauseOnDocExpiry?: boolean
  /** Auto-pause when staff morale falls into the strike danger zone (default: on) */
  pauseOnStrikeRisk?: boolean
  /** Auto-pause at the start of each month (day 1) to review financial P&L (default: false) */
  pauseOnMonthEnd?: boolean
  /** Auto-pause on pending inbox decisions (default: true) */
  pauseOnDecision?: boolean

  /* ---- Operational Fleet Policies ---- */
  /** Speed governor policy: eco (+6% fuel mileage), normal (standard), express (punctuality & ratings) */
  speedGovernor?: 'eco' | 'normal' | 'express'
  /** Minimum condition % to trigger preventative service alert/assignment (default: 75%) */
  preventiveServiceThreshold?: number
  /** Tyre replacement threshold remaining km (default: 15,000 km) */
  tyreReplacementKmThreshold?: number
  /** Preferred replacement tyre brand: oem, tier2, retread (default: tier2) */
  preferredTyreBrand?: 'oem' | 'tier2' | 'retread'

  /* ---- Commercial & Revenue Management ---- */
  /** Dynamic yield surge: auto-raise fares (+15%) on high-demand peak days (default: true) */
  dynamicYieldSurge?: boolean
  /** Last-minute seat discount: -15% on unsold seats within 24h if LF < 40% (default: false) */
  lastMinuteDiscount?: boolean
  /** Minimum cash reserve safety buffer before making large purchases (paise) */
  emergencyReserveBuffer?: Money
  /** New routes ramp up from 60% to full demand over 90 days. Default on. */
  routeLifeCycle?: boolean
  /** Highest fare multiplier dynamic pricing may reach on ordinary days, in percent of the base fare. Default 275. */
  surgeCapPct?: number
  /** Last-minute cut (when enabled) takes fares to this percent of the normal fare. Default 85. */
  lastMinuteFloorPct?: number
  /** Whether a workshop manager covers a broken-down coach with a spare: never, from the same brand only, or from any brand. */
  autoCoverPolicy?: 'off' | 'same_brand' | 'any'
  /** Monthly training budget. Each ₹25,000 sends one crew member on a course (+1 skill, +morale). Default 0. */
  trainingBudgetPerMonth?: Money
  /** Insurance cover: basic is cheaper and pays claims less; comprehensive costs more and pays more. */
  insuranceTier?: 'basic' | 'standard' | 'comprehensive'
  /** Minutes late before a freight run counts as an SLA breach. Default 120. */
  slaToleranceMin?: number
  /** Default passenger amenities offered on newly created schedules */
  defaultAmenities?: PassengerAmenities
  /** Default service branding tier on newly created schedules */
  defaultServiceTier?: ServiceTier
  /** Passenger safety, hospitality & lounge handling policies */
  passengerConfig?: PassengerHandlingConfig
}

/* ================================ KPIs ================================= */

export interface DailyKpi {
  day: number
  cash: Money
  netWorth: Money
  revenue: Money
  expense: Money
  profit: Money
  loadFactor: number
  fleet: number
  rating: number
  seatsSoldToday: number
}

/* ============================== Game state ============================= */

export type Difficulty = 'sahukar' | 'malik' | 'seth' // hard / normal / easy

export interface Victory {
  day: number
  score: GameOver['score']
  netWorth: Money
  /** Player chose to keep playing; do not show the scorecard again. */
  acknowledged?: boolean
}

export interface GameOver {
  day: number
  reason: string
  score: {
    daysSurvived: number
    peakFleet: number
    lifetimeProfit: Money
    bestRating: number
    routesServed: number
  }
}

export interface Yard {
  cityId: string
  monthlyRent: number
  covered: boolean
}

export interface BusGroup {
  id: ID
  name: string                 // "Maruti Travels"
  code: string                 // short uppercase code, unique, 2-5 chars
  color: string                // hex used for the badge
  /** Optional branding photo (e.g. livery / bus shot) as a public HTTPS URL or legacy data URL. */
  brandingPic?: string
  /** Optional brand gallery showcase photos (stored as public HTTPS URLs, capped at 12). */
  gallery?: string[]
  /**
   * UI-only parent subsidiary reference. Not used by sim/finance; for org chart display.
   */
  parentGroupId?: ID
  foundedDay: number
  /** Retired brands stay for reporting and can be restored; only purged on request. */
  status: 'active' | 'retired'
  retiredDay?: number
  /**
   * Freight / cargo subsidiary — hides passenger amenities, cabin fittings,
   * service tier, and refund policy. Listed after passenger brands in pickers.
   */
  cargoBrand?: boolean
  /** Applied to new purchases and prefilled on new schedules. */
  defaultAmenities?: PassengerAmenities
  defaultFittings?: BrandFittings
  defaultServiceTier?: ServiceTier
  /** Refund policy for new schedules under this brand (falls back to company schedule defaults). */
  defaultCancellation?: CancellationPolicy
  /** Fares for this brand stay between these shares of the normal market fare. */
  farePolicy?: { floorPct?: number; ceilingPct?: number }
  /** The brand's promise on driver quality: trips with a weaker crew lose passenger satisfaction. */
  minDriverSkill?: number
  /** Coaches older than this are flagged for replacement. */
  maxBusAgeYears?: number
  /** Coach odometer milestone display limit in km. Coaches past this mark appear amber, 25% past in red. */
  odoHighlightKm?: number
  /** Weekly: the usual cleaning. Every trip: clean after each trip for a daily cost per coach. */
  cleaningStandard?: 'weekly' | 'every_trip'
  /** Spent every month; lifts brand awareness. */
  marketingBudgetMonthly?: Money
  /** Monthly route profit the brand should earn. A miss raises an alert. */
  profitTargetMonthly?: Money
  /** Filled at month end when a target is set. */
  lastMonthProfit?: Money
  targetMissMonths?: number
  /** Own marketplace standing. ratingCount 0 means "inherit the company's". */
  rating: number
  ratingCount: number
  recentTripPss?: number[]
  cancelRate: number
  primo: boolean
  primoOffered: boolean
  primoSinceDay?: number
  /** Earliest day RedBus may invite again after a decline or delist. */
  primoNextEligibleDay?: number
}

export type Scenario = 'standard' | 'sandbox' | 'ironman'

export interface GameState {
  /** How this game was started. Missing on older saves: standard. */
  scenario?: Scenario
  version: number
  seed: number
  day: number
  startDay: number
  difficulty: Difficulty
  ids: IdCounter

  company: Company
  groups?: Record<ID, BusGroup>
  bodyBuilders?: Record<string, BodyBuilder>
  workshop: WorkshopState
  config: PlayerConfig
  /** Overnight parking slots at the home depot. */
  depotSlots: number
  /** Leased outstation parking yards. Home city is owned/covered and not listed here. */
  yards: Yard[]
  insuranceClaims: InsuranceClaim[]
  festivalSpecials: FestivalSpecial[]

  buses: Record<ID, Bus>
  busOrders: BusOrder[]
  usedMarket: UsedListing[]
  leaseOffers: LeaseOffer[]
  attachOffers: AttachOffer[]
  marketRefreshDay: number

  staff: Record<ID, Staff>
  hiringPool: Staff[]
  poolRefreshDay: number
  payrollDay: number // day-of-month for salaries (1)

  permits: Record<string, Permit>
  schedules: Record<ID, Schedule>
  trips: Record<ID, Trip>
  /** trips still open for sale or departing today, ordered by day */
  openTripIds: ID[]

  loans: Record<ID, Loan>
  od: Overdraft
  receivables: Receivable[]
  txns: Txn[] // rolling window (recent)
  monthly: MonthlySummary[]
  /** live accumulator for the current month */
  curMonth: MonthlySummary

  routeStats: Record<string, RouteStats>
  /** Per-route daily buckets for period reports (trimmed to ~370 days). */
  routeHistory: Record<string, RouteDayStats[]>
  /** Route maturity 0-100 by canonical route id. See sim/routeLife.ts. */
  routeMaturity?: Record<string, number>

  /** Separately tracked revenue, direct expenses, and outcomes for seasonal festival scheduled service runs. */
  seasonalStats?: SeasonalServiceStats

  /** Active & running dedicated charter and block contracts */
  charterContracts?: CharterContract[]
  /** Pending incoming customer inquiries for charter bookings */
  charterInquiries?: CharterContract[]
  /** Completed past charter contracts financial history */
  charterHistory?: CharterContract[]
  /** Cumulative lifetime performance stats for charter operations */
  charterStats?: CharterStats

  world: World
  inbox: InboxMsg[]
  decisions: Decision[]
  kpis: DailyKpi[]
  achievements: Record<string, number> // id -> day earned
  peakFleet: number
  lifetimeProfit: Money

  /** Post-migration immunity against staff attrition / resignations */
  migrationImmunityUntilDay?: number
  /** Pending one-time migration toast notice */
  pendingMigrationNotice?: string
  /** Trigger inbox entry on first tick after migration */
  pendingMigrationInboxEntry?: boolean
  /** Forced event ID for debugging or unit testing */
  forcedEventId?: string

  gameOver?: GameOver
  /** Company goals reached: id -> day. */
  objectives?: Record<string, number>
  /** Set once when the final goal is met; the game continues after it. */
  victory?: Victory
}
