/**
 * Distressed-rival deals: another operator is winding up or downsizing and
 * selling a package of buses (6 to 24 coaches) at a discount with full details.
 */
import { BAL } from '../data/balance'
import { BUS_MODELS, MODEL_LIST, coachKind, coachSpec, modelTitle } from '../data/busModels'
import { SMALL_OPERATORS } from '../data/names'
import { toCivil } from '../core/calendar'
import { fmtCompact, type Money } from '../core/money'
import { rInt, rPick, type Rng } from '../core/rng'
import type { Decision, GameState } from '../types'
import { liquidity } from './finance'
import { availableLoanProducts, quoteLoan } from './banking'
import { marketWeight, usedPrice } from './fleet'
import { buyLot, rollLot, surveyLot, type LotFinance, type LotItem, type LotSpec } from './eventFleet'
import { pushDecision, pushLog } from './log'
import type { EventDef } from './events'

const D = BAL.distress

/* ============================== seller motives ============================= */

interface LotShape {
  discount: [number, number]
  /** Condition points added to the age/odometer baseline. */
  conditionBias: number
  accidentChance: number
  /** Odometer vs typical for the age. */
  odoMult: number
}

interface SellerMotive extends LotShape {
  id: string
  tell: string
  weight: number
}

const MOTIVES: SellerMotive[] = [
  {
    id: 'retiring',
    tell: 'The owner is retiring and his family is stepping away from the transport business. Fleet kept on disciplined routine service.',
    discount: [0.08, 0.14], conditionBias: 10, accidentChance: 0.05, odoMult: 0.88, weight: 20,
  },
  {
    id: 'upgrading',
    tell: 'They have new multi-axle luxury coaches arriving and need to clear parking depot space and book value immediately.',
    discount: [0.10, 0.16], conditionBias: 4, accidentChance: 0.10, odoMult: 1.00, weight: 25,
  },
  {
    id: 'family_split',
    tell: 'A partnership dissolution. The partners are dividing assets and liquidating this fleet block for swift settlement.',
    discount: [0.14, 0.22], conditionBias: -5, accidentChance: 0.16, odoMult: 1.12, weight: 22,
  },
  {
    id: 'financier',
    tell: 'Working capital strain and bank pressures require an urgent cash injection before the quarter closes.',
    discount: [0.18, 0.28], conditionBias: -9, accidentChance: 0.20, odoMult: 1.18, weight: 22,
  },
  {
    id: 'corridor_exit',
    tell: 'They are exiting interstate routes to focus solely on local charters, offloading their line-haul fleet.',
    discount: [0.15, 0.24], conditionBias: -3, accidentChance: 0.14, odoMult: 0.95, weight: 18,
  },
]

function pickMotive(rng: Rng): SellerMotive {
  const total = MOTIVES.reduce((a, m) => a + m.weight, 0)
  let roll = rng() * total
  for (const m of MOTIVES) {
    roll -= m.weight
    if (roll <= 0) return m
  }
  return MOTIVES[MOTIVES.length - 1]!
}

/** The lender that leaves the least cash on the table, if any will lend. */
function bestLender(s: GameState): { productId: string; lender: string; months: number } | null {
  const products = availableLoanProducts(s)
  if (products.length === 0) return null
  const best = [...products].sort((a, b) => b.maxLtv - a.maxLtv || a.baseRateBps - b.baseRateBps)[0]!
  return { productId: best.id, lender: best.lender, months: Math.min(best.maxMonths, 48) }
}

/**
 * Size a lot between 6 and 24 buses based on the player's liquidity + financing headroom.
 * Can be a single uniform layout (35%), a mix of 2 layouts (40%), or a mix of 3 layouts (25%).
 */
function sizeLot(
  s: GameState,
  rng: Rng,
  shape: LotShape,
  dealKey: string,
  ageBand: [number, number],
  counts: readonly number[],
): LotSpec | null {
  const budget = Math.round(liquidity(s) / D.minCashShare)
  const year = toCivil(s.day).y
  const discount = shape.discount[0] + rng() * (shape.discount[1] - shape.discount[0])
  const floor = Math.min(Math.round(budget * D.lotFloorShare), D.lotFloorCap)

  const availableModels = MODEL_LIST.filter((m) => !m.electric && year - ageBand[0] >= m.launchedYear)
  if (availableModels.length === 0) return null

  // Roll desired variety (1, 2, or 3 layouts):
  // ~35% single layout, ~40% mix of 2 layouts, ~25% mix of 3 layouts
  const varietyRoll = rng()
  const targetVariety = varietyRoll < 0.35 ? 1 : varietyRoll < 0.75 ? 2 : 3

  const candidates: { lot: LotSpec; weight: number }[] = []

  // Try creating candidate packages across available counts
  for (const totalCount of counts) {
    const numModels = Math.min(targetVariety, totalCount >= 9 ? 3 : totalCount >= 6 ? 2 : 1)

    // Sample distinct models for this count, preferring distinct layout kinds
    const shuffled = [...availableModels].sort(() => rng() - 0.5)
    const chosenModels: typeof availableModels = []
    const seenKinds = new Set<string>()
    for (const m of shuffled) {
      const kind = coachKind(m)
      if (chosenModels.length < numModels && (!seenKinds.has(kind) || chosenModels.length + (shuffled.length - chosenModels.length) <= numModels)) {
        chosenModels.push(m)
        seenKinds.add(kind)
      }
    }
    for (const m of shuffled) {
      if (chosenModels.length >= numModels) break
      if (!chosenModels.includes(m)) chosenModels.push(m)
    }
    if (chosenModels.length === 0) continue

    // Split totalCount among chosenModels
    const items: LotItem[] = []
    let remainingCount = totalCount
    for (let idx = 0; idx < chosenModels.length; idx++) {
      const m = chosenModels[idx]
      const isLast = idx === chosenModels.length - 1
      let itCount: number
      if (isLast) {
        itCount = remainingCount
      } else {
        const remainingModels = chosenModels.length - idx
        const minForOthers = (remainingModels - 1) * 2
        const maxForThis = remainingCount - minForOthers
        const portion = Math.max(2, Math.min(maxForThis, Math.round(remainingCount / remainingModels)))
        itCount = portion
      }
      remainingCount -= itCount
      const age = rInt(rng, ageBand[0], ageBand[1])
      items.push({ modelId: m.id, count: itCount, age })
    }

    // Calculate total lot cost with discount
    let lotTotal = 0
    let totalModelWeight = 0
    for (const it of items) {
      const m = BUS_MODELS[it.modelId]!
      const fairEach = usedPrice(it.modelId, it.age)
      const askEach = Math.round(fairEach * (1 - discount))
      lotTotal += askEach * it.count
      totalModelWeight += marketWeight(m)
    }

    if (lotTotal > budget || lotTotal < floor) continue

    const avgAge = Math.round(items.reduce((a, it) => a + it.age * it.count, 0) / totalCount)
    const weight = Math.round(totalModelWeight / items.length)

    candidates.push({
      weight,
      lot: {
        dealKey,
        modelId: items[0].modelId,
        items,
        count: totalCount,
        age: avgAge,
        total: lotTotal,
        odoMult: shape.odoMult,
        conditionBias: shape.conditionBias,
        accidentChance: shape.accidentChance,
      },
    })
  }

  // Fallback 1: Single-model packages if no mixed package fit the budget
  if (candidates.length === 0) {
    for (const model of availableModels) {
      const age = rInt(rng, ageBand[0], ageBand[1])
      const askEach = Math.round(usedPrice(model.id, age) * (1 - discount))
      for (const count of counts) {
        const total = askEach * count
        if (total > budget || total < floor) continue
        const weight = marketWeight(model)
        candidates.push({
          weight,
          lot: {
            dealKey,
            modelId: model.id,
            items: [{ modelId: model.id, count, age }],
            count,
            age,
            total,
            odoMult: shape.odoMult,
            conditionBias: shape.conditionBias,
            accidentChance: shape.accidentChance,
          },
        })
      }
    }
  }

  // Fallback 2: Smallest count (6 buses) for most affordable models
  if (candidates.length === 0) {
    const minCount = counts[counts.length - 1] ?? 6
    for (const model of availableModels) {
      const age = rInt(rng, ageBand[0], ageBand[1])
      const askEach = Math.round(usedPrice(model.id, age) * (1 - discount))
      const total = askEach * minCount
      if (total <= budget) {
        candidates.push({
          weight: marketWeight(model),
          lot: {
            dealKey,
            modelId: model.id,
            items: [{ modelId: model.id, count: minCount, age }],
            count: minCount,
            age,
            total,
            odoMult: shape.odoMult,
            conditionBias: shape.conditionBias,
            accidentChance: shape.accidentChance,
          },
        })
      }
    }
  }

  if (candidates.length === 0) return null
  let roll = rng() * candidates.reduce((a, c) => a + c.weight, 0)
  for (const c of candidates) {
    roll -= c.weight
    if (roll <= 0) return c.lot
  }
  return candidates[candidates.length - 1]!.lot
}

function fairTotal(lot: LotSpec): Money {
  if (lot.items && lot.items.length > 0) {
    return lot.items.reduce((acc, it) => acc + usedPrice(it.modelId, it.age) * it.count, 0)
  }
  return usedPrice(lot.modelId ?? lot.items[0]?.modelId ?? '', lot.age) * lot.count
}

function discountPct(lot: LotSpec): number {
  const fair = fairTotal(lot)
  return fair > 0 ? Math.round((1 - lot.total / fair) * 100) : 0
}

/** Cash and hire-purchase options for lot decisions. */
function lotOptions(s: GameState, lot: LotSpec): Decision['options'] {
  const opts: Decision['options'] = []
  if (liquidity(s) >= lot.total) {
    opts.push({
      id: 'cash',
      label: `Pay cash (${fmtCompact(lot.total)})`,
      detail: `Leaves ${fmtCompact(liquidity(s) - lot.total)} liquidity`,
    })
  }
  const lender = bestLender(s)
  const quote = lender ? quoteLoan(s, lender.productId, lot.total, lender.months) : null
  if (lender && quote) {
    const down = lot.total - quote.principal + quote.processingFee
    if (liquidity(s) >= down) {
      opts.push({
        id: 'finance',
        label: `Finance it (${fmtCompact(down)} down)`,
        detail: `${lender.lender} · ${fmtCompact(quote.emi)}/month for ${quote.months} months`,
      })
    }
  }
  return opts
}

/* =============================== the deck ================================= */

export const DISTRESS_EVENTS: EventDef[] = [
  {
    id: 'distress_lot',
    weight: 6,
    // Sprint 9: multi-bus distress lot stopped; replaced by rival_route_exit
    canFire: () => false,
    fire: (s, rng) => {
      const motive = pickMotive(rng)
      const dealKey = `lot${s.day}`
      const lot = sizeLot(s, rng, motive, dealKey, [3, 8], D.lotCounts)
      if (!lot) return

      const seller = rPick(rng, SMALL_OPERATORS)
      const opts = lotOptions(s, lot)
      if (opts.length === 0) return

      // Pre-roll buses and survey so all details are visible upfront
      const rolled = rollLot(s, lot)
      const survey = surveyLot(rolled)
      const each = Math.round(lot.total / lot.count)
      const discount = discountPct(lot)

      const busLines = rolled.map((b, idx) => {
        const m = BUS_MODELS[b.modelId]
        const specStr = m ? `${modelTitle(m)} (${coachSpec(m)})` : 'Coach'
        const condAvg = Math.round(
          (b.condition.engine + b.condition.gearbox + b.condition.brakes + b.condition.suspension + b.condition.ac + b.condition.body + b.condition.electrical) / 7,
        )
        const odoK = Math.round(b.odometer / 1000)
        const status = b.accidentHistory ? '⚠️ Minor incident' : '✓ Clean'
        return `  ${String(idx + 1).padStart(2, ' ')}. ${b.reg} (${b.nickname}) — ${specStr} — ${odoK}k km · Cond ${condAvg}% · ${status}`
      })

      const packageDesc = (() => {
        if (lot.items && lot.items.length > 1) {
          const parts = lot.items.map((it) => {
            const m = BUS_MODELS[it.modelId]
            return `${it.count}× ${m ? modelTitle(m) : it.modelId} (${m ? coachSpec(m) : ''})`
          })
          return `PACKAGE: ${lot.count} buses (${lot.age} yrs avg) — ${parts.join(', ')} offered at ${fmtCompact(lot.total)} (${fmtCompact(each)} avg/bus, ${discount}% under market).`
        }
        const m = BUS_MODELS[lot.modelId ?? lot.items[0]?.modelId ?? '']
        return `PACKAGE: ${lot.count}× ${m ? modelTitle(m) : lot.modelId} (${m ? coachSpec(m) + ', ' : ''}${lot.age} yrs old) offered at ${fmtCompact(lot.total)} (${fmtCompact(each)}/bus, ${discount}% under market).`
      })()

      const body =
        `${packageDesc}\n\n` +
        `MOTIVE: ${motive.tell}\n\n` +
        `FLEET OVERVIEW:\n` +
        `• Average Condition: ${survey.avgCondition}% (lowest: ${survey.worstName} on ${survey.worstReg} at ${survey.worst}%)\n` +
        `• Average Odometer: ${Math.round(survey.avgOdo / 1000)}k km\n` +
        `• Accident History: ${survey.accidents} of ${lot.count} coaches\n\n` +
        `COACH ROSTER:\n` +
        busLines.join('\n')

      pushDecision(s, {
        kind: 'distress_lot',
        title: `${seller} fleet sale (${lot.count} buses)`,
        body,
        options: [
          ...opts,
          { id: 'pass', label: 'Walk away' },
        ],
        data: { lot, seller },
      })
    },
  },
]

/* ============================== resolution =============================== */

function closeLot(s: GameState, lot: LotSpec, optionId: string): string | null {
  if (optionId !== 'finance') return buyLot(s, lot)
  const lender = bestLender(s)
  if (!lender) return 'No lender will touch this deal today.'
  const fin: LotFinance = { productId: lender.productId, months: lender.months }
  return buyLot(s, lot, fin)
}

/**
 * Handle distress lot purchasing decisions.
 */
export function applyDistressDecision(
  s: GameState,
  d: Decision,
  optionId: string,
): { handled: boolean; error?: string } {
  if (d.kind !== 'distress_lot') return { handled: false }

  const lot = d.data?.lot as LotSpec
  const seller = (d.data?.seller as string) ?? 'The seller'

  if (optionId === 'pass') {
    pushLog(s, 'info', `Passed on ${seller}'s fleet lot.`)
    return { handled: true }
  }

  const err = closeLot(s, lot, optionId)
  return err ? { handled: false, error: err } : { handled: true }
}