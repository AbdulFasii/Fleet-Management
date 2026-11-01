/**
 * Fleet acquisition & ownership: new dealer orders with lead time, used
 * marketplace with hidden condition + paid inspection, dry lease, attached
 * (third-party) buses on revenue share, resale.
 */
import { BAL } from '../data/balance'
import { BUS_MODELS, MODEL_LIST, NO_NEW_ORDER_IDS, isCargoModel, marketAgeRange, marketOdoBand, marketOdometer, modelTitle } from '../data/busModels'
import { BUS_NICKNAMES } from '../data/names'
import { nextId, makeRegistration } from '../core/ids'
import { daysInMonth, fromCivil, toCivil } from '../core/calendar'
import { fmtCompact, rs, type Money } from '../core/money'
import { rngFor, rInt, rPick, rChance, rJitter, type Rng } from '../core/rng'
import type { Bus, BusModel, Condition, GameState, UsedListing, ID, Loan, DepreciationMethod } from '../types'
import { canAfford, assetCashValue, capitalIn, capitalOut, spend } from './finance'
import { createLoan } from './banking'
import { LOAN_PRODUCTS } from '../data/loanProducts'
import { cancelOpenTripsForBus } from './booking'
import { pushLog } from './log'
import { clearCoverRefs } from './cover'
import { serviceCostMult } from './serviceCost'
import { assignBusToGroup } from './groups'
import { FITTING_CATALOG, busHasFitting, setBusFitting } from '../data/amenitiesCatalog'
function makeCondition(rng: Rng, ageYears: number, odoKm: number, careless = false): Condition {
  const base = 100 - ageYears * 4.5 - (odoKm / 100_000) * 5
  const spread = careless ? 22 : 10
  const roll = (bias = 0) =>
    Math.max(15, Math.min(100, Math.round(base + bias + (rng() * 2 - 1) * spread)))
  return {
    engine: roll(), gearbox: roll(), brakes: roll(-4), suspension: roll(-2),
    ac: roll(-6), body: roll(2), electrical: roll(),
  }
}

function newCondition(): Condition {
  return { engine: 100, gearbox: 100, brakes: 100, suspension: 100, ac: 100, body: 100, electrical: 100 }
}

export function worstSubsystem(c: Condition): number {
  return Math.min(c.engine, c.gearbox, c.brakes, c.suspension, c.ac, c.body, c.electrical)
}

export function usedPrice(modelId: string, ageYears: number, rng?: Rng): Money {
  const model = BUS_MODELS[modelId]
  let v = model.priceNew * Math.pow(1 - BAL.usedDepreciationYr, ageYears)
  if (rng) v = rJitter(rng, v, 0.1)
  return Math.round(v)
}

/* --------------------------- dry-lease pricing --------------------------- */

/** Multi-axle coaches, sleepers and hybrids run ten tyres; a straight coach six. */
function tyreCountFor(model: BusModel): number {
  return model.sleeper || model.layout.kind === 'sleeper' || model.layout.kind === 'hybrid'
    || model.cls === 'AC_SLEEPER' || model.cls === 'AC_SLEEPER_PREM' || model.cls === 'AC_HYBRID'
    ? 10
    : 6
}

/** Annual road tax the owner carries (no state loading: a lease offer has no plate yet). */
function ownerRoadTax(model: BusModel, ageYears: number): Money {
  const base =
    model.cls === 'CARGO' ? rs(25_000)
      : model.cls === 'AC_SLEEPER' || model.cls === 'AC_SLEEPER_PREM' ? rs(42_000)
        : model.cls === 'AC_SEMI_PREM' ? rs(36_000)
          : model.cls === 'AC_SEMI' ? rs(25_000)
            : rs(18_000)
  const ageMult = ageYears < 3 ? 0.95 : ageYears <= 7 ? 1 : ageYears <= 10 ? 1.08 : 1.15
  return Math.round(Math.max(rs(15_000), Math.min(rs(45_000), base * ageMult)))
}

/**
 * What an owner actually asks to dry-lease a coach.
 *
 * Real dry-lease rents are quoted off the owner's own cost stack, never a flat
 * share of the price tag:
 *
 *   capital recovery — today's market value amortised over the years the coach
 *   has left, at the owner's cost of money
 * + upkeep the owner still carries under a dry lease — service, overhauls,
 *   tyres, insurance, fitness, road tax
 * + a lessor's margin.
 *
 * Because capital is spread over a shrinking number of years, rent rises as a
 * share of market value with age: a six-year-old coach has to earn its price
 * back over six years, not ten. High odometer and AC loadings also show up, so
 * a hammered example does not rent like a fresh one.
 */
export function leaseMonthlyRent(modelId: string, ageYears: number, odoKm: number): Money {
  const model = BUS_MODELS[modelId]
  if (!model) return 0
  const value = usedPrice(modelId, ageYears)

  // ---- capital recovery
  const monthsLeft = Math.max(BAL.leaseMinTermMonths, Math.round((BAL.leaseRemainingLifeYears - ageYears) * 12))
  const monthlyRate = BAL.leaseCapitalRate / 12
  const capital = value * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -monthsLeft)))

  // ---- owner's upkeep, per km
  const tiers = BAL.serviceTiers
  const cycleKm = tiers.overhaul.intervalKm
  const aCount = Math.max(0, Math.floor(cycleKm / tiers.a.intervalKm) - Math.floor(cycleKm / tiers.b.intervalKm))
  const bCount = Math.floor(cycleKm / tiers.b.intervalKm)
  const serviceBase = BAL.serviceCostBase * model.maintCostIndex * serviceCostMult(ageYears, odoKm, model.ac)
  const servicePerKm = (serviceBase * (aCount * tiers.a.costMult + bCount * tiers.b.costMult + tiers.overhaul.costMult)) / cycleKm

  const tyres = BAL.tyres.oem
  const tyreCount = tyreCountFor(model)
  const tyrePerKm =
    (2 * tyres.price) / tyres.frontLifeKm + ((tyreCount - 2) * tyres.price) / tyres.rearLifeKm

  const kmPerMonth = BAL.leaseAssumedKmPerMonth
  const serviceMonthly = (servicePerKm + tyrePerKm) * kmPerMonth

  // ---- owner's fixed annual bills
  const insured = Math.max(BAL.insuranceMin, Math.round(Math.max(value, model.priceNew * 0.3) * BAL.insurancePctOfValue))
  const fixedMonthly = insured / 12 + ownerRoadTax(model, ageYears) / 12
    + BAL.fitnessRenewalCost / 12 + BAL.pucCost / 12

  const cost = capital + serviceMonthly + fixedMonthly
  // A hammered coach costs the owner more to keep up but is worth less to a lessee:
  // the market discounts wear instead of paying for it.
  const expectedKm = Math.max(60_000, ageYears * 55_000)
  const wear = Math.max(0.88, Math.min(1.03, 1 - 0.10 * (odoKm / expectedKm - 1)))
  // Past a point the owner cannot pass the bills on: a coach that needs more than
  // this in rent is worth more kept on the road (or sold) than dry-leased, and the
  // market simply will not pay it.
  const rent = Math.min(cost * (1 + BAL.leaseLessorMargin), value * BAL.leaseMaxPctOfValue) * wear
  return Math.round(rent / BAL.leaseRentRounding) * BAL.leaseRentRounding
}

/** Rent as the owner would quote it — a little negotiation slack, still round figures. */
function quotedRent(rng: Rng, modelId: string, ageYears: number, odoKm: number, jitter: number): Money {
  const base = leaseMonthlyRent(modelId, ageYears, odoKm)
  if (base <= 0) return 0
  const ceiling = usedPrice(modelId, ageYears) * BAL.leaseMaxPctOfValue
  const quoted = Math.min(rJitter(rng, base, jitter), ceiling)
  return Math.round(quoted / BAL.leaseRentRounding) * BAL.leaseRentRounding
}


/**
 * Each listing rolls its own layout — seater / semi / sleeper share varies
 * week to week instead of a fixed sleeper quota.
 */
/**
 * Used / lease / attach listings. Weight by how often that coach
 * shows up on Indian corridors (BB 1624 is a workhorse).
 * Legacy platforms kept rare; discontinued new models stay low.
 */

export function marketWeight(m: BusModel): number {
  switch (m.id) {

    // ---------- Mainstream South Indian private-travel buses ----------
    case 'leyacsleep':
      return 2.25  // Ashok Leyland 12M sleeper — very common

    case 'leyhybrid':
      return 1.75  // Ashok Leyland 12M hybrid — popular flexible layout

    case 'leyacsleep2':
      return 1.75   // Ashok Leyland 13.5M sleeper — strong and growing

    case 'bb1824':
      return 1.75  // BharatBenz 1824HD — very strong sleeper presence

    case 'bb1624':
      return 2   // BharatBenz 1624 — common, but below 1824x

    case 'bb1624hybrid':
      return 1.75  // BharatBenz 1624 hybrid
    case 'bb1824hybrid':
      return 1.75  // BharatBenz 1824HD hybrid

    case 'cheetah':
      return 1.25  // Ashok Leyland 12M semi-sleeper

    case 'bb917':
      return 1  // BharatBenz 917 — more regional / smaller application




    // ---------- Premium ----------
    case 'volvo9600':
      return 0.75  // Volvo 9600 sleeper — premium but much smaller volume

    case 'volvo9600s':
      return 0.50// Volvo 9600 seater

    case 'volvo9600_Pro':
      return 0.75  // Premium 15m/40-berth class — expensive, fewer operators


    // ---------- Legacy premium ----------
    case 'volvo9400':
      return 0.75   // Still significant in used market

    case 'volvo9400semi':
      return 0.55  // Older 9400 semi-sleeper

    case 'metrolink':
      return 0.65  // Scania: relatively scarce / legacy


    // ---------- Electric ----------
    case 'evolectra':
      return 0.30   // Intercity private sleeper market is still overwhelmingly diesel


    default:
      return 1
  }
}
function rPickMarket(rng: Rng, bag: BusModel[]): BusModel {
  let total = 0
  for (const m of bag) total += marketWeight(m)
  let roll = rng() * total
  for (const m of bag) {
    roll -= marketWeight(m)
    if (roll <= 0) return m
  }
  return bag[bag.length - 1]!
}

function pickMarketModels(rng: Rng, pool: BusModel[], n: number): BusModel[] {
  if (pool.length === 0 || n <= 0) return []
  const byKind = {
    seater: pool.filter((m) => m.layout.kind === 'seater'),
    semi: pool.filter((m) => m.layout.kind === 'semi'),
    sleeper: pool.filter((m) => m.layout.kind === 'sleeper'),
    hybrid: pool.filter((m) => m.layout.kind === 'hybrid'),
  }
  const out: BusModel[] = []
  for (let i = 0; i < n; i++) {
    const roll = rng()
    // Seat / semi / sleeper / hybrid mix; sleepers remain the core product
    let bag =
      roll < 0.22 ? byKind.seater
        : roll < 0.45 ? byKind.semi
          : roll < 0.58 ? byKind.hybrid
            : byKind.sleeper
    if (bag.length === 0) bag = pool
    out.push(rPickMarket(rng, bag))
  }
  return out
}

/* ------------------------------ markets ------------------------------ */

export function refreshMarkets(s: GameState): void {
  const rng = rngFor(s.seed, 'market', s.day)
  const cargoOn = Boolean(s.company.dedicatedCargoSubsidiary)
  const usedPool = MODEL_LIST.filter((m) => !m.electric && !isCargoModel(m))
  const year = toCivil(s.day).y

  const usedN = rInt(rng, BAL.usedMarketMin, BAL.usedMarketMax)
  const leaseN = rInt(rng, BAL.leaseOffersMin, BAL.leaseOffersMax)
  const attachN = rInt(rng, BAL.attachOffersMin, BAL.attachOffersMax)

  s.usedMarket = []
  for (const model of pickMarketModels(rng, usedPool, usedN)) {
    const { min, max } = marketAgeRange(model, year, 'used')
    const age = rInt(rng, min, max)
    const band = marketOdoBand(model, 'used')
    const odo = marketOdometer(age, band.lo, band.hi, rng)
    const careless = rChance(rng, 0.35)
    const cond = makeCondition(rng, age, odo, careless)
    const accident = rChance(rng, 0.18)
    const fair = usedPrice(model.id, age)
    // sellers of rough buses still ask near fair price - that's the trap
    const ask = Math.round(rJitter(rng, fair, 0.12) * (accident ? 0.93 : 1))
    const notes = [
      'Single owner, all papers clear.',
      'Fleet-operated, service records available.',
      'Urgent sale - owner exiting the business.',
      'Recently repainted, fresh interior.',
      'Bank NOC ready, quick transfer.',
    ]
    s.usedMarket.push({
      id: nextId(s.ids, 'ul'),
      reg: makeRegistration(rng),
      modelId: model.id,
      ageYears: age,
      odometer: odo,
      askPrice: ask,
      expiresDay: s.day + BAL.marketRefreshDays,
      condition: cond,
      accidentHistory: accident,
      inspected: false,
      sellerNote: rPick(rng, notes),
      gpsDeviceFitted: rChance(rng, 0.70),
    })
  }

  s.leaseOffers = []
  for (const model of pickMarketModels(rng, usedPool, leaseN)) {
    const { min, max } = marketAgeRange(model, year, 'lease')
    const age = rInt(rng, min, max)
    const band = marketOdoBand(model, 'lease')
    const odo = marketOdometer(age, band.lo, band.hi, rng)
    s.leaseOffers.push({
      id: nextId(s.ids, 'lo'),
      modelId: model.id,
      monthlyRent: quotedRent(rng, model.id, age, odo, 0.05),
      depositMonths: rInt(rng, 2, 3),
      minMonths: rInt(rng, 6, 12),
      ageYears: age,
      odometer: odo,
      expiresDay: s.day + BAL.marketRefreshDays,
      gpsDeviceFitted: rChance(rng, 0.70),
    })
  }

  // Offers an owner brought to you directly outlive the weekly market churn.
  s.attachOffers = s.attachOffers.filter((o) => o.fromEvent && o.expiresDay >= s.day)
  for (const model of pickMarketModels(rng, usedPool, attachN)) {
    const tier = rPick(rng, ['good', 'average', 'rough'] as const)
    const { min, max } = marketAgeRange(model, year, 'attach')
    const age = rInt(rng, min, max)
    const band = marketOdoBand(model, 'attach')
    const odo = marketOdometer(age, band.lo, band.hi, rng)
    s.attachOffers.push({
      id: nextId(s.ids, 'ao'),
      reg: makeRegistration(rng),
      modelId: model.id,
      ownerShare: Math.round(rJitter(rng, (BAL.attachOwnerShareMin + BAL.attachOwnerShareMax) / 2, 0.05) * 100) / 100,
      ageYears: age,
      odometer: odo,
      qualityTier: tier,
      expiresDay: s.day + BAL.marketRefreshDays,
      gpsDeviceFitted: rChance(rng, 0.70),
    })
  }
  s.marketRefreshDay = s.day + BAL.marketRefreshDays
  if (cargoOn) appendCargoOffers(s, rng)
}

/** Put one truck on each weekly list, or take it off when the subsidiary is closed. */
export function syncCargoListings(s: GameState): void {
  if (!s.company.dedicatedCargoSubsidiary) {
    s.usedMarket = s.usedMarket.filter((l) => !isCargoModel(l.modelId))
    s.leaseOffers = s.leaseOffers.filter((l) => !isCargoModel(l.modelId))
    s.attachOffers = (s.attachOffers ?? []).filter((l) => !isCargoModel(l.modelId))
    return
  }
  // One freight option per board — older saves listed two trucks apiece.
  s.usedMarket = keepFirstCargo(s.usedMarket)
  s.leaseOffers = keepFirstCargo(s.leaseOffers)
  s.attachOffers = keepFirstCargo(s.attachOffers ?? [])
  const hasCargo =
    s.usedMarket.some((l) => isCargoModel(l.modelId))
    || s.leaseOffers.some((l) => isCargoModel(l.modelId))
    || (s.attachOffers ?? []).some((l) => isCargoModel(l.modelId))
  if (hasCargo) return
  appendCargoOffers(s, rngFor(s.seed, 'cargo-list', s.day))
}

/** Cargo listings are a single showcase per board; drop any spares. */
function keepFirstCargo<T extends { modelId: string }>(list: T[]): T[] {
  let kept = false
  return list.filter((l) => {
    if (!isCargoModel(l.modelId)) return true
    if (kept) return false
    kept = true
    return true
  })
}

function appendCargoOffers(s: GameState, rng: Rng): void {
  const cargoModels = MODEL_LIST.filter((m) => isCargoModel(m))
  if (cargoModels.length === 0) return
  // One truck per board: buy, lease or attach — never two of the same board.
  const model = rPick(rng, cargoModels)
  const age = rInt(rng, 1, 6)
  const band = marketOdoBand(model, 'used')
  const odo = marketOdometer(age, band.lo, band.hi, rng)
  const cond = makeCondition(rng, age, odo, false)
  const fair = usedPrice(model.id, age)
  s.usedMarket.push({
    id: nextId(s.ids, 'ul'),
    reg: makeRegistration(rng),
    modelId: model.id,
    ageYears: age,
    odometer: odo,
    askPrice: Math.round(rJitter(rng, fair, 0.08)),
    expiresDay: s.day + BAL.marketRefreshDays,
    condition: cond,
    accidentHistory: false,
    inspected: false,
    sellerNote: 'Fleet-operated cargo vehicle, service records available.',
    gpsDeviceFitted: rChance(rng, 0.7),
  })
  s.leaseOffers.push({
    id: nextId(s.ids, 'lo'),
    modelId: model.id,
    monthlyRent: quotedRent(rng, model.id, age, odo, 0.05),
    depositMonths: 2,
    minMonths: 6,
    ageYears: age,
    odometer: odo,
    expiresDay: s.day + BAL.marketRefreshDays,
    gpsDeviceFitted: true,
  })
  s.attachOffers.push({
    id: nextId(s.ids, 'ao'),
    reg: makeRegistration(rng),
    modelId: model.id,
    ownerShare: 0.7,
    ageYears: age,
    odometer: odo,
    qualityTier: 'average',
    expiresDay: s.day + BAL.marketRefreshDays,
    gpsDeviceFitted: true,
  })
}

/* ------------------------------ create bus ------------------------------ */

interface CreateBusOpts {
  modelId: string
  ownership: Bus['ownership']
  ageYears: number
  odometer: number
  condition: Condition
  price: Money
  reg?: string
  accidentHistory?: boolean
  loanId?: ID
  leaseRent?: Money
  leaseDeposit?: Money
  leaseEndDay?: number
  attachShare?: number
  attachCare?: number
  gpsDeviceFitted?: boolean
  depreciationMethod?: DepreciationMethod
  depreciationRatePct?: number
  groupId?: ID
}

function addBus(s: GameState, o: CreateBusOpts): Bus {
  const rng = rngFor(s.seed, 'bus', s.ids.next)
  const model = BUS_MODELS[o.modelId]
  const year = toCivil(s.day).y
  const taken = new Set(Object.values(s.buses).map((b) => b.reg))
  let reg = o.reg ?? makeRegistration(rng)
  // Two vehicles sharing a plate read as one bus running everywhere — keep plates unique.
  for (let attempt = 0; !o.reg && taken.has(reg) && attempt < 40; attempt++) reg = makeRegistration(rng)
  const bus: Bus = {
    id: nextId(s.ids, 'b'),
    reg,
    nickname: rPick(rng, BUS_NICKNAMES),
    modelId: o.modelId,
    ownership: o.ownership,
    leaseOfferRent: o.leaseRent,
    leaseDeposit: o.leaseDeposit,
    leaseEndDay: o.leaseEndDay,
    attach: o.attachShare !== undefined ? { ownerShare: o.attachShare, careLevel: o.attachCare ?? 0.5 } : undefined,
    mfgYear: year - o.ageYears,
    acquiredDay: s.day,
    acquiredPrice: o.price,
    bookValue: o.ownership === 'owned' ? o.price : 0,
    depreciationMethod: o.ownership === 'owned'
      ? (o.depreciationMethod ?? s.company.depreciationDefault ?? 'SLM')
      : undefined,
    depreciationRatePct: o.ownership === 'owned'
      ? (o.depreciationRatePct ?? purchaseDepRate(s))
      : undefined,
    odometer: o.odometer,
    condition: o.condition,
    tyreKm: Math.round(o.odometer % BAL.tyreLifeKm * 0.6),
    tyresRetreaded: false,
    frontTyreKm: Math.round(o.odometer % BAL.tyreLifeKm * 0.6),
    rearTyreKm: Math.round(o.odometer % BAL.tyreLifeKm * 0.6),
    frontBrand: 'oem',
    rearBrand: 'oem',
    tyreCount: (model.cls === 'sleeper' || model.sleeper || model.layout?.kind === 'sleeper' || model.layout?.kind === 'hybrid' || model.cls === 'AC_HYBRID' || model.cls === 'AC_SLEEPER') ? 10 : 6,
    tyrePressure: 'ok',
    lastServiceOdo: Math.max(0, o.odometer - rInt(rng, 0, BAL.serviceIntervalKm)),
    lastMajorServiceOdo: Math.max(0, o.odometer - rInt(rng, 0, BAL.serviceTiers.b.intervalKm)),
    lastOverhaulDay: s.day - rInt(rng, 0, 300),
    lastOverhaulOdo: Math.max(0, o.odometer - rInt(rng, 0, BAL.serviceTiers.overhaul.intervalKm)),
    insuranceExpiryDay: s.day + 365,
    fitnessExpiryDay: s.day + (o.ageYears < 8 ? 730 : 365),
    pucExpiryDay: s.day + BAL.pucValidityDays,
    gpsDeviceFitted: o.gpsDeviceFitted ?? true,
    roadTaxPayableDay: s.day + 365,
    aitpPaidUntilDay: s.day, // first quarter charged by the maintenance pass
    parkedCityId: s.company.homeCityId,
    cargoVolumeCbm: model?.cargoVolumeCbm ?? (model ? (model.seats < 30 ? 4 : model.seats < 45 ? 8 : 12) : 8),
    status: 'active',
    duty: 'line',
    accidentHistory: o.accidentHistory ?? false,
    busCleanliness: 90,
    loanId: o.loanId,
    lifeRevenue: 0,
    lifeCost: 0,
    lifeTrips: 0,
    qualityScore: Math.min(5, 2 + model.comfort * 0.28 + worstSubsystem(o.condition) / 100),
  }
  s.buses[bus.id] = bus
  s.peakFleet = Math.max(s.peakFleet, Object.keys(s.buses).length)
  if (o.groupId) {
    assignBusToGroup(s, bus.id, o.groupId)
    if (bus.ownership === 'owned' && s.groups?.[o.groupId]?.defaultFittings) {
      const df = s.groups[o.groupId].defaultFittings!
      for (const f of FITTING_CATALOG) {
        if (!df[f.id] || busHasFitting(bus, f.id)) continue
        setBusFitting(bus, f.id, true)
        spend(s, 'amenity_retrofit', f.retrofitCost, { busId: bus.id, note: `${f.title} retrofit` })
      }
    }
  }
  return bus
}

/** Calendar years since manufacture (0 for a brand-new delivery this year). */
export function busAgeYears(s: GameState, bus: Bus): number {
  return Math.max(0, toCivil(s.day).y - bus.mfgYear)
}

/** Day count six civil months after `day` (clamped to the target month's length). */
function plusMonths(day: number, months: number): number {
  const c = toCivil(day)
  const m0 = c.m - 1 + months
  const y = c.y + Math.floor(m0 / 12)
  const m = (m0 % 12) + 1
  return fromCivil(y, m, Math.min(c.d, daysInMonth(y, m)))
}

/**
 * Dealer-new coach still inside its first three months on the fleet.
 * A used buy is older than the year it arrived, so it never carries the tag.
 */
export function isNewVehicle(bus: Pick<Bus, 'acquiredDay' | 'mfgYear'>, day: number): boolean {
  if (day < bus.acquiredDay) return false
  const arrived = toCivil(bus.acquiredDay)
  if (arrived.y - bus.mfgYear > 0) return false
  return day < plusMonths(bus.acquiredDay, 3)
}

/** Chassis age less any re-body life extension — what upkeep bands and useful-life displays read. */
export function effectiveAgeYears(s: GameState, bus: Bus): number {
  return Math.max(0, busAgeYears(s, bus) - (bus.lifeExtensionYears ?? 0))
}

/** Short reason shown in parentheses after a non-active status. */
export function busStatusDetail(bus: Bus, day: number): string {
  const bits: string[] = []
  if (bus.status === 'workshop') {
    if (bus.workshopJob) bits.push(bus.workshopJob)
    if (bus.workshopUntilDay !== undefined && bus.workshopUntilDay > day) bits.push(`${bus.workshopUntilDay - day}d`)
    return bits.join(', ')
  }
  if (bus.status === 'delivery') return 'not delivered'
  if (bus.status !== 'grounded') return ''
  if (bus.impoundUntilDay !== undefined && bus.impoundUntilDay > day) bits.push(`impounded ${bus.impoundUntilDay - day}d`)
  if (bus.transferReadyDay !== undefined && bus.transferReadyDay > day) bits.push(`RC transfer ${bus.transferReadyDay - day}d`)
  if (bus.fitnessFailed) bits.push('fitness failed')
  else if (bus.fitnessExpiryDay < day) bits.push('fitness expired')
  if (bus.insuranceExpiryDay < day) bits.push('insurance expired')
  if (bus.pucExpiryDay !== undefined && bus.pucExpiryDay < day) bits.push('PUC expired')
  if (bus.ownership === 'owned' && bus.roadTaxPayableDay !== undefined && day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays) {
    bits.push('road tax overdue')
  }
  if (bits.length === 0) bits.push('held until next morning')
  return bits.join(', ')
}

/* ------------------------------ new buses ------------------------------ */

export interface FinancePlan {
  loanProductId?: string
  months?: number
}

/**
 * Depreciation rate a purchase books today: the player's chosen rate, else the
 * standard rate for their method, always inside the selectable 5–30% band.
 */
export function purchaseDepRate(s: GameState): number {
  const method = s.company.depreciationDefault ?? 'SLM'
  const chosen = s.company.depreciationRatePct
  const fallback = method === 'WDV' ? BAL.depreciationStandardRate.WDV : BAL.depreciationStandardRate.SLM
  return clampDepRate(chosen ?? fallback)
}

export function clampDepRate(rate: number): number {
  if (!Number.isFinite(rate)) return BAL.depreciationStandardRate.SLM
  return Math.round(Math.max(BAL.depreciationRateMinPct, Math.min(BAL.depreciationRateMaxPct, rate)) * 2) / 2
}

export function effectiveNewPrice(s: GameState, modelId: string): Money {
  const model = BUS_MODELS[modelId]
  let price = model.priceNew
  if (model.electric && s.world.evSubsidyUntilDay >= s.day) price = Math.round(price * 0.8)
  return price
}

export function orderNewBus(s: GameState, modelId: string, plan: FinancePlan, groupId?: ID): string | null {
  const model = BUS_MODELS[modelId]
  if (!model) return 'Unknown model.'
  if (NO_NEW_ORDER_IDS.has(modelId)) return 'This model is no longer sold new — check the used market.'
  const price = effectiveNewPrice(s, modelId)
  const orderId = nextId(s.ids, 'ord')
  let loanId: ID | undefined
  if (plan.loanProductId) {
    const loan = createLoan(s, plan.loanProductId, price, plan.months ?? 48)
    if (!loan) return 'Financing declined - check credit score and lender requirements.'
    loanId = loan.id
  }
  if (s.company.cash < price && s.company.cash + (s.od.limit - s.od.drawn) < price) {
    return 'Not enough liquidity for the purchase (after any financing).'
  }
  capitalOut(s, 'bus_purchase', price, { note: `${modelTitle(model)} order` })
  s.busOrders.push({
    id: orderId, modelId, orderedDay: s.day, deliveryDay: s.day + model.leadTimeDays, price, loanId,
    depreciationMethod: s.company.depreciationDefault ?? 'SLM',
    depreciationRatePct: purchaseDepRate(s),
    groupId,
  })
  pushLog(s, 'finance', `Ordered new ${modelTitle(model)} for ${fmtCompact(price)}. Body building takes ~${model.leadTimeDays} days.`)
  return null
}

export function deliverOrdersPass(s: GameState): void {
  const due = s.busOrders.filter((o) => o.deliveryDay <= s.day)
  if (due.length === 0) return
  s.busOrders = s.busOrders.filter((o) => o.deliveryDay > s.day)
  for (const o of due) {
    const bus = addBus(s, {
      modelId: o.modelId, ownership: 'owned', ageYears: 0, odometer: 0,
      condition: newCondition(), price: o.price, loanId: o.loanId,
      depreciationMethod: o.depreciationMethod, depreciationRatePct: o.depreciationRatePct,
      groupId: o.groupId,
    })
    if (o.loanId && s.loans[o.loanId]) s.loans[o.loanId].busId = bus.id
    const model = BUS_MODELS[o.modelId]
    const insurance = Math.max(BAL.insuranceMin, Math.round(o.price * BAL.insurancePctOfValue))
    spend(s, 'insurance', insurance, { busId: bus.id, note: 'first-year comprehensive' })
    pushLog(s, 'good', `NEW BUS DELIVERED: ${modelTitle(model)} (${bus.reg} "${bus.nickname}"). Assign it to a schedule.`)
  }
}

/* ------------------------------ used buses ------------------------------ */

export function inspectListing(s: GameState, listingId: ID): string | null {
  const l = s.usedMarket.find((x) => x.id === listingId)
  if (!l) return 'Listing gone.'
  if (l.inspected) return 'Already inspected.'
  if (!canAfford(s, BAL.inspectionCost)) return 'Cannot afford the inspection.'
  spend(s, 'inspection', BAL.inspectionCost, { note: `pre-purchase inspection ${l.reg}` })
  l.inspected = true
  return null
}

export function buyUsed(s: GameState, listingId: ID, plan: FinancePlan, groupId?: ID): string | null {
  const l = s.usedMarket.find((x) => x.id === listingId)
  if (!l) return 'Listing gone.'
  let loanId: ID | undefined
  if (plan.loanProductId) {
    const loan = createLoan(s, plan.loanProductId, l.askPrice, plan.months ?? 36)
    if (!loan) return 'Financing declined - check credit score and lender requirements.'
    loanId = loan.id
  }
  if (s.company.cash + (s.od.limit - s.od.drawn) < l.askPrice) {
    return 'Not enough liquidity (after any financing).'
  }
  capitalOut(s, 'bus_purchase', l.askPrice, { note: `used ${l.reg}` })
  const bus = addBus(s, {
    modelId: l.modelId, ownership: 'owned', ageYears: l.ageYears, odometer: l.odometer,
    condition: l.condition, price: l.askPrice, reg: l.reg,
    accidentHistory: l.accidentHistory, loanId,
    gpsDeviceFitted: l.gpsDeviceFitted,
    groupId,
  })
  bus.transferReadyDay = s.day + BAL.docsGrounded.transferLagDays
  bus.status = 'grounded'
  if (loanId && s.loans[loanId]) s.loans[loanId].busId = bus.id
  const insurance = Math.max(BAL.insuranceMin, Math.round(l.askPrice * BAL.insurancePctOfValue))
  spend(s, 'insurance', insurance, { busId: bus.id, note: 'comprehensive insurance' })
  s.usedMarket = s.usedMarket.filter((x) => x.id !== listingId)
  const model = BUS_MODELS[l.modelId]
  pushLog(
    s,
    'good',
    `Bought used ${modelTitle(model)} ${l.reg} for ${fmtCompact(l.askPrice)}${l.inspected ? '' : ' WITHOUT inspection'}. RC transfer ~${BAL.docsGrounded.transferLagDays}d — grounded until then.`,
  )
  return null
}

/* ------------------------------ lease ------------------------------ */

export function startLease(s: GameState, offerId: ID, groupId?: ID): string | null {
  const o = s.leaseOffers.find((x) => x.id === offerId)
  if (!o) return 'Offer gone.'
  const deposit = o.monthlyRent * o.depositMonths
  if (!canAfford(s, deposit + o.monthlyRent)) return `Need ${fmtCompact(deposit + o.monthlyRent)} for deposit + first month.`
  capitalOut(s, 'deposit', deposit, { note: 'lease security deposit' })
  const rng = rngFor(s.seed, 'lease', o.id)
  addBus(s, {
    modelId: o.modelId, ownership: 'leased', ageYears: o.ageYears,
    odometer: o.odometer ?? o.ageYears * rInt(rng, 50_000, 90_000),
    condition: makeCondition(rng, o.ageYears, o.odometer ?? o.ageYears * 70_000),
    price: 0, leaseRent: o.monthlyRent, leaseDeposit: deposit, leaseEndDay: s.day + o.minMonths * 30,
    gpsDeviceFitted: o.gpsDeviceFitted,
    groupId,
  })
  s.leaseOffers = s.leaseOffers.filter((x) => x.id !== offerId)
  pushLog(s, 'good', `Dry lease signed: ${modelTitle(BUS_MODELS[o.modelId]!)} at ${fmtCompact(o.monthlyRent)}/month (min ${o.minMonths} months). You crew and fuel it; the owner keeps papers and pays service.`)
  return null
}

export function leaseBreakCost(bus: Bus, day: number): { penalty: Money; daysLeft: number; monthsLeft: number } {
  const rent = bus.leaseOfferRent ?? 0
  if (!bus.leaseEndDay || day >= bus.leaseEndDay) return { penalty: 0, daysLeft: 0, monthsLeft: 0 }
  const daysLeft = bus.leaseEndDay - day
  const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30))
  return { penalty: rent * monthsLeft, daysLeft, monthsLeft }
}

export function endLease(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'leased') return 'Not a leased bus.'
  const early = !!(bus.leaseEndDay && s.day < bus.leaseEndDay)
  const br = leaseBreakCost(bus, s.day)
  if (early) {
    if (!canAfford(s, br.penalty)) {
      return `Need ${fmtCompact(br.penalty)} to break the lock-in (${br.monthsLeft} mo rent, ${br.daysLeft}d left). Deposit is forfeited.`
    }
    spend(s, 'penalty', br.penalty, {
      busId,
      note: `early lease exit — ${br.monthsLeft} mo lock-in remaining`,
    })
  }
  clearCoverRefs(s, busId)
  cancelOpenTripsForBus(s, busId, 'lease returned')
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (sch) sch.busIds = sch.busIds.filter((b) => b !== busId)
  for (const st of Object.values(s.staff)) if (st.busId === busId) st.busId = undefined
  if (!early) {
    // Older saves never stored the deposit — fall back to the two-month norm.
    const deposit = bus.leaseDeposit ?? (bus.leaseOfferRent ?? 0) * 2
    capitalIn(s, 'deposit', deposit, { note: 'lease deposit refund' })
    pushLog(s, 'good', `Lease ended, ${bus.reg} returned. Deposit of ${fmtCompact(deposit)} refunded.`)
  } else {
    pushLog(
      s,
      'alert',
      `Lease on ${bus.reg} broken early: paid ${fmtCompact(br.penalty)} (${br.monthsLeft} mo remaining). Security deposit forfeited.`,
    )
  }
  delete s.buses[busId]
  return null
}

/* ------------------------------ attach ------------------------------ */

export function signAttach(s: GameState, offerId: ID, groupId?: ID): string | null {
  const need = BAL.attachMinBrandAwareness
  if (s.company.brandAwareness < need) {
    return `Attach needs brand awareness ≥ ${Math.round(need * 100)}% (now ${Math.round(s.company.brandAwareness * 100)}%). Grow trips and marketing first — buy or lease until then.`
  }
  const o = s.attachOffers.find((x) => x.id === offerId)
  if (!o) return 'Offer gone.'
  const rng = rngFor(s.seed, 'attach', o.id)
  const careless = o.qualityTier === 'rough' || (o.qualityTier === 'average' && rChance(rng, 0.4))
  const care = o.qualityTier === 'good' ? 0.85 : o.qualityTier === 'average' ? 0.55 : 0.25
  addBus(s, {
    modelId: o.modelId, ownership: 'attached', ageYears: o.ageYears,
    odometer: o.odometer ?? o.ageYears * rInt(rng, 60_000, 100_000),
    condition: makeCondition(rng, o.ageYears, o.odometer ?? o.ageYears * 80_000, careless),
    price: 0, reg: o.reg, attachShare: o.ownerShare, attachCare: care,
    gpsDeviceFitted: o.gpsDeviceFitted,
    groupId,
  })
  s.attachOffers = s.attachOffers.filter((x) => x.id !== offerId)
  pushLog(s, 'good', `Attached ${o.reg} under your brand. Owner keeps ${Math.round(o.ownerShare * 100)}% of tickets and runs the bus (fuel, crew, upkeep); you sell the seats and carry the brand risk.`)
  return null
}

export function releaseAttach(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'attached') return 'Not an attached bus.'
  clearCoverRefs(s, busId)
  cancelOpenTripsForBus(s, busId, 'attach agreement ended')
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (sch) sch.busIds = sch.busIds.filter((b) => b !== busId)
  for (const st of Object.values(s.staff)) if (st.busId === busId) st.busId = undefined
  delete s.buses[busId]
  pushLog(s, 'good', `Attach agreement with ${bus.reg} ended.`)
  return null
}

/* ------------------------------ sell ------------------------------ */

export function saleQuote(s: GameState, busId: ID): Money {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'owned') return 0
  const condFactor = 0.75 + (worstSubsystem(bus.condition) / 100) * 0.35
  return Math.round(assetCashValue(s, bus) * BAL.resaleHaircut * condFactor)
}

/** Foreclosure fee for a vehicle loan (same as Bank foreclose). */
export function loanForeclosureFee(loan: Loan): Money {
  const p = LOAN_PRODUCTS.find((x) => x.lender === loan.lender)
  return Math.round((loan.balance * (p?.foreclosureBps ?? 300)) / 10000)
}

/**
 * Sale vs loan settlement: proceeds go to clear principal + foreclosure fee;
 * only the net difference hits cash (surplus in / shortfall out).
 */
export function sellSettlement(s: GameState, busId: ID): {
  proceeds: Money
  loan?: Loan
  fee: Money
  due: Money
  net: Money
  shortfall: Money
  canAfford: boolean
} | null {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'owned') return null
  const proceeds = saleQuote(s, busId)
  const loan = bus.loanId && s.loans[bus.loanId]?.status === 'active' ? s.loans[bus.loanId] : undefined
  if (!loan) {
    return { proceeds, fee: 0, due: 0, net: proceeds, shortfall: 0, canAfford: true }
  }
  const fee = loanForeclosureFee(loan)
  const due = loan.balance + fee
  const net = proceeds - due
  const shortfall = Math.max(0, -net)
  return {
    proceeds,
    loan,
    fee,
    due,
    net,
    shortfall,
    canAfford: shortfall === 0 || canAfford(s, shortfall),
  }
}

export function sellBus(s: GameState, busId: ID): string | null {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'owned') return 'Not an owned bus.'
  const settle = sellSettlement(s, busId)
  if (!settle) return 'Not an owned bus.'
  if (!settle.canAfford) {
    return `Need ${fmtCompact(settle.shortfall)} more cash — sale ${fmtCompact(settle.proceeds)} vs loan+fee ${fmtCompact(settle.due)}.`
  }

  clearCoverRefs(s, busId)
  cancelOpenTripsForBus(s, busId, 'bus sold')
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (sch) sch.busIds = sch.busIds.filter((b) => b !== busId)
  for (const st of Object.values(s.staff)) if (st.busId === busId) st.busId = undefined

  capitalIn(s, 'asset_sale', settle.proceeds, { busId, note: `sold ${bus.reg}` })
  if (settle.loan) {
    capitalOut(s, 'loan_principal', settle.loan.balance, { busId, note: `foreclose ${settle.loan.lender} from sale` })
    if (settle.fee > 0) spend(s, 'penalty', settle.fee, { busId, note: 'foreclosure charges' })
    settle.loan.balance = 0
    settle.loan.status = 'closed'
    const remainingActive = Object.values(s.loans).filter((l) => l.status === 'active').length
    const bonus = remainingActive === 0 ? 20 : 8
    s.company.creditScore = Math.min(900, s.company.creditScore + bonus)
    pushLog(
      s,
      settle.net >= 0 ? 'good' : 'alert',
      settle.net >= 0
        ? `Sold ${bus.reg} for ${fmtCompact(settle.proceeds)}; cleared ${settle.loan.lender}${remainingActive === 0 ? ' (ALL LOANS CLEARED · credit score +' + bonus + ')' : ''} and kept ${fmtCompact(settle.net)}.`
        : `Sold ${bus.reg} for ${fmtCompact(settle.proceeds)}; paid ${fmtCompact(settle.shortfall)} from cash to clear ${settle.loan.lender} (${fmtCompact(settle.due)} due incl. fee).`,
    )
  } else {
    pushLog(s, 'finance', `Sold ${bus.reg} for ${fmtCompact(settle.proceeds)}.`)
  }

  delete s.buses[busId]
  return null
}

/** Fire sale in a cash crunch: worst haircut, instant. */
export function fireSaleBus(s: GameState, busId: ID): Money {
  const bus = s.buses[busId]
  if (!bus || bus.ownership !== 'owned') return 0
  const proceeds = Math.round(assetCashValue(s, bus) * BAL.fireSaleHaircut)
  clearCoverRefs(s, busId)
  cancelOpenTripsForBus(s, busId, 'distress sale')
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (sch) sch.busIds = sch.busIds.filter((b) => b !== busId)
  for (const st of Object.values(s.staff)) if (st.busId === busId) st.busId = undefined
  if (bus.loanId && s.loans[bus.loanId]?.status === 'active') {
    const loan = s.loans[bus.loanId]
    const applied = Math.min(proceeds, loan.balance)
    loan.balance -= applied
    capitalIn(s, 'asset_sale', proceeds - applied, { note: `fire sale ${bus.reg} (after loan settlement)` })
    if (loan.balance <= 0) loan.status = 'closed'
  } else {
    capitalIn(s, 'asset_sale', proceeds, { note: `fire sale ${bus.reg}` })
  }
  delete s.buses[busId]
  pushLog(s, 'alert', `FIRE SALE: ${bus.reg} sold under distress for ${fmtCompact(proceeds)}.`)
  return proceeds
}

/** UsedListing type re-export helper for UI narrowing. */
export type { UsedListing }
