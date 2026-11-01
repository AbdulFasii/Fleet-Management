/**
 * Buying a whole lot of buses off another operator (acquisition events, bank
 * auctions). Kept separate from fleet.ts so the event deck can create buses
 * without importing the marketplace.
 *
 * A lot is rolled once from its `dealKey` and never re-rolled, so a paid
 * inspection tells the truth about the buses you will actually receive.
 */
import { fmtCompact, type Money } from '../core/money'
import { rngFor, rInt, rPick, rChance } from '../core/rng'
import { nextId, makeRegistration } from '../core/ids'
import { toCivil } from '../core/calendar'
import { BUS_MODELS, modelTitle } from '../data/busModels'
import { BUS_NICKNAMES } from '../data/names'
import { BAL } from '../data/balance'
import type { Bus, Condition, GameState } from '../types'
import { canAfford, capitalOut, spend } from './finance'
import { createLoan, quoteLoan } from './banking'
import { pushLog } from './log'

export interface LotItem {
  modelId: string
  count: number
  age: number
}

/** Everything needed to reproduce a lot. Stored on the decision. */
export interface LotSpec {
  /** Stable RNG key — inspection and purchase must see the same buses. */
  dealKey: string
  /** @deprecated Legacy single-model field in v1. Use `items` for multi-model packages. */
  modelId?: string
  items: LotItem[]
  count: number
  age: number
  total: Money
  /** Odometer vs typical for the age: parked buses are low, hard-run ones high. */
  odoMult: number
  /** Condition points added to the age/odometer baseline. */
  conditionBias: number
  accidentChance: number
}

export interface LotBus {
  reg: string
  nickname: string
  modelId: string
  age: number
  price: Money
  odometer: number
  condition: Condition
  accidentHistory: boolean
}

const SUBSYSTEMS: [keyof Condition, string][] = [
  ['engine', 'engine'], ['gearbox', 'gearbox'], ['brakes', 'brakes'],
  ['suspension', 'suspension'], ['ac', 'AC'], ['body', 'body'], ['electrical', 'wiring'],
]

/** Deterministic from the seed and the deal key — same answer every call. */
export function rollLot(s: GameState, lot: LotSpec): LotBus[] {
  if (!lot.items?.length) throw new Error('LotSpec.items is required in v2+')
  const out: LotBus[] = []
  const itemsList: { modelId: string; age: number; price: Money }[] = []
  const each = Math.round(lot.total / lot.count)
  for (const it of lot.items) {
    for (let j = 0; j < it.count; j++) {
      itemsList.push({ modelId: it.modelId, age: it.age, price: each })
    }
  }

  for (let i = 0; i < lot.count; i++) {
    const rng = rngFor(s.seed, 'lot', lot.dealKey, i)
    const it = itemsList[i]!
    const odo = Math.round(it.age * rInt(rng, 62_000, 104_000) * lot.odoMult)
    const base = 100 - it.age * 4.5 - (odo / 100_000) * 5 + lot.conditionBias
    const roll = (bias = 0) => Math.max(12, Math.min(100, Math.round(base + bias + (rng() * 2 - 1) * 16)))
    out.push({
      reg: makeRegistration(rng),
      nickname: rPick(rng, BUS_NICKNAMES),
      modelId: it.modelId,
      age: it.age,
      price: it.price,
      odometer: odo,
      condition: {
        engine: roll(), gearbox: roll(), brakes: roll(-4), suspension: roll(-3),
        ac: roll(-7), body: roll(2), electrical: roll(-2),
      },
      accidentHistory: rChance(rng, lot.accidentChance),
    })
  }
  return out
}

export interface LotSurvey {
  avgCondition: number
  worst: number
  /** Which subsystem is the worst across the lot, for the inspection report. */
  worstName: string
  worstReg: string
  accidents: number
  avgOdo: number
}

export function surveyLot(buses: LotBus[]): LotSurvey {
  let sum = 0
  let n = 0
  let worst = 101
  let worstName = ''
  let worstReg = ''
  for (const b of buses) {
    for (const [key, label] of SUBSYSTEMS) {
      const v = b.condition[key]
      sum += v
      n++
      if (v < worst) {
        worst = v
        worstName = label
        worstReg = b.reg
      }
    }
  }
  return {
    avgCondition: n > 0 ? Math.round(sum / n) : 0,
    worst,
    worstName,
    worstReg,
    accidents: buses.filter((b) => b.accidentHistory).length,
    avgOdo: buses.length > 0 ? Math.round(buses.reduce((a, b) => a + b.odometer, 0) / buses.length) : 0,
  }
}

export interface LotFinance {
  productId: string
  months: number
}

/**
 * Take delivery of the lot. With `finance`, one hire-purchase loan is raised
 * against the whole package and only the down payment leaves the bank.
 */
export function buyLot(s: GameState, lot: LotSpec, finance?: LotFinance): string | null {
  if (!lot.items?.length) throw new Error('LotSpec.items is required in v2+')
  const model = BUS_MODELS[lot.items[0]!.modelId] ?? (lot.modelId ? BUS_MODELS[lot.modelId] : undefined)
  if (!model) return 'That model is no longer on the road.'

  // Check liquidity against the real cash outlay before raising anything.
  const quote = finance ? quoteLoan(s, finance.productId, lot.total, finance.months) : null
  if (finance && !quote) return 'Financing declined - check your credit score and reputation.'
  const cashNeeded = quote ? lot.total - quote.principal + quote.processingFee : lot.total
  if (!canAfford(s, cashNeeded)) {
    return `Need ${fmtCompact(cashNeeded)} liquidity to close${finance ? ' after the loan' : ''}.`
  }

  let loanId: string | undefined
  if (finance) {
    const loan = createLoan(s, finance.productId, lot.total, finance.months)
    if (!loan) return 'Financing declined - check your credit score and reputation.'
    loanId = loan.id
  }

  capitalOut(s, 'bus_purchase', lot.total, { note: `fleet package x${lot.count}` })
  const year = toCivil(s.day).y
  const rolled = rollLot(s, lot)
  let first: string | undefined
  for (const r of rolled) {
    const rng = rngFor(s.seed, 'lotbus', lot.dealKey, r.reg)
    const m = BUS_MODELS[r.modelId] ?? model
    const bus: Bus = {
      id: nextId(s.ids, 'b'),
      reg: r.reg,
      nickname: r.nickname,
      modelId: r.modelId,
      ownership: 'owned',
      mfgYear: year - r.age,
      acquiredDay: s.day,
      acquiredPrice: r.price,
      bookValue: r.price,
      odometer: r.odometer,
      condition: r.condition,
      tyreKm: rInt(rng, 10_000, 70_000),
      tyresRetreaded: true,
      frontTyreKm: rInt(rng, 10_000, 70_000),
      rearTyreKm: rInt(rng, 10_000, 70_000),
      frontBrand: 'oem',
      rearBrand: 'retread',
      tyreCount: (model.cls === 'sleeper' || model.sleeper || model.layout?.kind === 'sleeper' || model.layout?.kind === 'hybrid' || model.cls === 'AC_HYBRID' || model.cls === 'AC_SLEEPER') ? 10 : 6,
      tyrePressure: 'ok',
      lastServiceOdo: r.odometer - rInt(rng, 5_000, 24_000),
      lastMajorServiceOdo: r.odometer - rInt(rng, 20_000, 80_000),
      lastOverhaulDay: s.day - rInt(rng, 30, 250),
      lastOverhaulOdo: r.odometer - rInt(rng, 30_000, 180_000),
      insuranceExpiryDay: s.day + 365,
      fitnessExpiryDay: s.day + 365,
      pucExpiryDay: s.day + BAL.pucValidityDays,
      gpsDeviceFitted: true,
      roadTaxPayableDay: s.day + 365,
      aitpPaidUntilDay: s.day,
      parkedCityId: s.company.homeCityId,
      status: 'active',
      duty: 'line',
      accidentHistory: r.accidentHistory,
      lifeRevenue: 0,
      lifeCost: 0,
      lifeTrips: 0,
      busCleanliness: 85,
      qualityScore: Math.min(5, 2 + m.comfort * 0.25),
    }
    s.buses[bus.id] = bus
    first ??= bus.id
    const insurance = Math.max(BAL.insuranceMin, Math.round(r.price * BAL.insurancePctOfValue))
    spend(s, 'insurance', insurance, { busId: bus.id, note: 'comprehensive insurance' })
  }
  // Hypothecate the loan to one of the buses so repossession has a target.
  if (loanId && first && s.loans[loanId]) s.loans[loanId].busId = first

  s.peakFleet = Math.max(s.peakFleet, Object.keys(s.buses).length)
  const summary = lot.items && lot.items.length > 1
    ? lot.items.map((it) => `${it.count}× ${BUS_MODELS[it.modelId]?.name ?? it.modelId}`).join(', ')
    : `${lot.count}× ${modelTitle(model)}`
  pushLog(
    s,
    'good',
    `Lot acquired: ${lot.count} coaches (${summary}) at ${fmtCompact(lot.total)}.`
    + ` Get them serviced, crewed and scheduled${finance ? ' — the EMI starts in 30 days' : ''}.`,
  )
  return null
}
