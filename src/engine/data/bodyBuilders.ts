import type { Money, BusModel, GameState, Bus, BodyDesign, BodyBuilder } from '../types'
import { L } from '../core/money'
import { BUS_MODELS, NEW_MODEL_LIST, isCargoModel, modelTitle } from './busModels'

export type { BodyDesign, BodyBuilder }

/**
 * Default coach-body catalog.
 * `bodyPrice` is the absolute on-road body package (₹), added to AL/BB chassis priceNew.
 * Typical complete coach ≈ chassis (₹35–48L) + body (₹22–42L).
 * MG Group is BharatBenz-exclusive; others serve Ashok Leyland and BharatBenz.
 */
export const DEFAULT_BODY_BUILDERS: Record<string, BodyBuilder> = {
  prakesh: {
    id: 'prakesh',
    name: 'Prakesh',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'prakesh_std',
        name: 'Prakesh Standard',
        bodyPrice: L(24),
        leadDaysAdd: 14,
        comfortDelta: -0.2,
        maintDelta: 0.05,
        chassisNames: ['12M', '1017'],
        notes: 'Budget regional coach shell — sized for 12M / 1017 chassis.',
      },
      {
        id: 'prakesh_deluxe',
        name: 'Prakesh Deluxe',
        bodyPrice: L(28),
        leadDaysAdd: 16,
        comfortDelta: 0.1,
        maintDelta: 0.02,
        chassisNames: ['12M', '13.5M', '1017', '1624'],
        notes: 'Reinforced panelling for mid-length intercity chassis.',
      },
    ],
  },
  rec: {
    id: 'rec',
    name: 'REC',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'rec_tourer',
        name: 'REC Tourer',
        bodyPrice: L(29),
        leadDaysAdd: 16,
        comfortDelta: 0.15,
        maintDelta: 0,
        notes: 'Reliable corridor coachwork with balanced weight and service access.',
      },
      {
        id: 'rec_exec',
        name: 'REC Executive',
        bodyPrice: L(33),
        leadDaysAdd: 19,
        comfortDelta: 0.4,
        maintDelta: -0.02,
        notes: 'Executive finish with quieter cabin and upgraded berth packs.',
      },
    ],
  },
  mg_group: {
    id: 'mg_group',
    name: 'MG Group',
    makers: ['BharatBenz'],
    designs: [
      {
        id: 'mg_signature',
        name: 'MG Signature',
        bodyPrice: L(34),
        leadDaysAdd: 20,
        comfortDelta: 0.45,
        maintDelta: -0.03,
        chassisNames: ['1624', '1824hd'],
        notes: 'BharatBenz-exclusive MG coach body for 1624 / 1824hd.',
      },
      {
        id: 'mg_luxe',
        name: 'MG Luxe',
        bodyPrice: L(39),
        leadDaysAdd: 24,
        comfortDelta: 0.85,
        maintDelta: -0.05,
        chassisNames: ['1824hd'],
        notes: 'Exclusive BB luxury shell — 1824hd chassis only.',
      },
    ],
  },
  arvex: {
    id: 'arvex',
    name: 'ARVEX',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'arvex_glide',
        name: 'ARVEX Glide',
        bodyPrice: L(31),
        leadDaysAdd: 17,
        comfortDelta: 0.25,
        maintDelta: -0.01,
        notes: 'Smooth-line touring body with good highway aero and tidy underbelly bays.',
      },
      {
        id: 'arvex_elite',
        name: 'ARVEX Elite',
        bodyPrice: L(37),
        leadDaysAdd: 22,
        comfortDelta: 0.65,
        maintDelta: -0.04,
        chassisNames: ['13.5M', '15M', '1824hd'],
        notes: 'Elite long-haul package — long chassis only.',
      },
    ],
  },
}

export function cloneDefaultBodyBuilders(): Record<string, BodyBuilder> {
  return JSON.parse(JSON.stringify(DEFAULT_BODY_BUILDERS))
}

/** Preset coachwork grades for the design editor — sets comfort, upkeep, lead, and body price add-on. */
export const BODY_QUALITY_TIERS = [
  { id: 'budget', label: 'Budget', comfortDelta: -0.3, maintDeltaPct: 6, leadDaysAdd: 12, bodyPriceAddLakhs: -2, blurb: 'Basic shell · cheaper build, higher upkeep' },
  { id: 'standard', label: 'Standard', comfortDelta: 0.1, maintDeltaPct: 2, leadDaysAdd: 16, bodyPriceAddLakhs: 1, blurb: 'Typical corridor coachwork' },
  { id: 'comfort', label: 'Comfort', comfortDelta: 0.5, maintDeltaPct: -2, leadDaysAdd: 20, bodyPriceAddLakhs: 5, blurb: 'Better trim · clear upkeep saving' },
  { id: 'premium', label: 'Premium', comfortDelta: 0.9, maintDeltaPct: -6, leadDaysAdd: 24, bodyPriceAddLakhs: 10, blurb: 'Flagship finish · best passenger feel' },
] as const

export type BodyQualityTierId = (typeof BODY_QUALITY_TIERS)[number]['id']

/** Brand base body package (₹ Lakh) before chassis length & coach grade. */
export const BODY_BUILDER_BASE_LAKHS: Record<string, number> = {
  prakesh: 22,
  rec: 27,
  arvex: 29,
  mg_group: 32,
}
export const BODY_BUILDER_BASE_LAKHS_DEFAULT = 26

/** Extra ₹ Lakh for longer / heavier chassis platforms. */
export const CHASSIS_BODY_ADD_LAKHS: Record<string, number> = {
  '12M': 0,
  '1017': 0,
  '13.5M': 4,
  '1624': 4,
  '15M': 8,
  '1824hd': 7,
}

/** Nearest preset for an existing design's comfort / upkeep / lead pair. */
export function matchBodyQualityTier(
  comfortDelta: number,
  maintDeltaPct: number,
  leadDaysAdd = 16,
): BodyQualityTierId {
  let best: BodyQualityTierId = 'standard'
  let bestDist = Number.POSITIVE_INFINITY
  for (const t of BODY_QUALITY_TIERS) {
    const dist =
      Math.abs(t.comfortDelta - comfortDelta) * 2
      + Math.abs(t.maintDeltaPct - maintDeltaPct) * 0.05
      + Math.abs(t.leadDaysAdd - leadDaysAdd) * 0.04
    if (dist < bestDist) {
      bestDist = dist
      best = t.id
    }
  }
  return best
}

/** Grade inferred from a design's comfort / upkeep / lead deltas. */
export function designQualityTier(design: BodyDesign): BodyQualityTierId {
  return matchBodyQualityTier(design.comfortDelta, Math.round(design.maintDelta * 100), design.leadDaysAdd)
}

/**
 * Auto body package in ₹ Lakhs from builder brand × chassis length × coach grade.
 * Stored design.bodyPrice is a display fallback only — live pricing uses this.
 */
export function bodyPackageLakhs(
  builderId: string | undefined,
  chassisName: string,
  gradeId: BodyQualityTierId,
): number {
  const base = (builderId && BODY_BUILDER_BASE_LAKHS[builderId] != null)
    ? BODY_BUILDER_BASE_LAKHS[builderId]
    : BODY_BUILDER_BASE_LAKHS_DEFAULT
  const chassisAdd = CHASSIS_BODY_ADD_LAKHS[chassisName] ?? 3
  const gradeAdd = BODY_QUALITY_TIERS.find((t) => t.id === gradeId)?.bodyPriceAddLakhs ?? 0
  return Math.max(8, Math.round((base + chassisAdd + gradeAdd) * 2) / 2)
}

export function bodyPackagePrice(
  builderId: string | undefined,
  design: BodyDesign | undefined,
  chassisName: string,
): Money {
  if (!design) return 0
  return L(bodyPackageLakhs(builderId, chassisName, designQualityTier(design)))
}

/** Min/max body package across chassis platforms this design fits. */
export function bodyPackagePriceRange(
  builderId: string,
  design: BodyDesign,
  chassisPool?: string[],
): { min: Money; max: Money; minLakhs: number; maxLakhs: number } {
  const names =
    design.chassisNames && design.chassisNames.length > 0
      ? design.chassisNames
      : (chassisPool && chassisPool.length > 0 ? chassisPool : Object.keys(CHASSIS_BODY_ADD_LAKHS))
  const grade = designQualityTier(design)
  const lakhs = names.map((n) => bodyPackageLakhs(builderId, n, grade))
  const minLakhs = Math.min(...lakhs)
  const maxLakhs = Math.max(...lakhs)
  return { min: L(minLakhs), max: L(maxLakhs), minLakhs, maxLakhs }
}

/** Check if this chassis model supports custom body designs (Ashok Leyland & BharatBenz passenger coaches). */
export function modelSupportsBodyDesigns(modelOrId: BusModel | string | undefined): boolean {
  const model = typeof modelOrId === 'string' ? BUS_MODELS[modelOrId] : modelOrId
  if (!model || model.isCargoOnly || isCargoModel(model)) return false
  return model.maker === 'Ashok Leyland' || model.maker === 'BharatBenz'
}

/** True when the design fits this chassis platform name (empty list = all lengths). */
export function designFitsChassis(design: BodyDesign, chassisName: string): boolean {
  if (!design.chassisNames || design.chassisNames.length === 0) return true
  return design.chassisNames.includes(chassisName)
}

/** Chassis platform names sold new for the given makers (e.g. 12M, 1824hd). */
export function chassisNameOptions(makers: readonly string[]): string[] {
  const set = new Set<string>()
  for (const m of NEW_MODEL_LIST) {
    if (!makers.includes(m.maker)) continue
    if (!modelSupportsBodyDesigns(m)) continue
    set.add(m.name)
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Find all body designs available for a specific chassis maker. */
export function designsForMaker(
  s: GameState | undefined,
  maker: string,
): { builder: BodyBuilder; design: BodyDesign }[] {
  const builders = s?.bodyBuilders && Object.keys(s.bodyBuilders).length > 0
    ? s.bodyBuilders
    : DEFAULT_BODY_BUILDERS

  const results: { builder: BodyBuilder; design: BodyDesign }[] = []
  for (const b of Object.values(builders)) {
    if (b.makers.includes(maker as any)) {
      for (const d of b.designs) {
        results.push({ builder: b, design: d })
      }
    }
  }
  return results
}

/** Designs that fit a concrete chassis model (maker + length/platform name). */
export function designsForModel(
  s: GameState | undefined,
  model: BusModel,
): { builder: BodyBuilder; design: BodyDesign }[] {
  return designsForMaker(s, model.maker).filter(({ design }) => designFitsChassis(design, model.name))
}

/** Look up a design by ID across all builders in current game state or defaults. */
export function getDesign(s: GameState | undefined, id: string | undefined): BodyDesign | undefined {
  if (!id) return undefined
  const builders = s?.bodyBuilders && Object.keys(s.bodyBuilders).length > 0
    ? s.bodyBuilders
    : DEFAULT_BODY_BUILDERS

  for (const b of Object.values(builders)) {
    const d = b.designs.find((x) => x.id === id)
    if (d) return d
  }
  return undefined
}

/** Look up the builder that owns a specific design ID. */
export function getBuilderForDesign(s: GameState | undefined, designId: string | undefined): BodyBuilder | undefined {
  if (!designId) return undefined
  const builders = s?.bodyBuilders && Object.keys(s.bodyBuilders).length > 0
    ? s.bodyBuilders
    : DEFAULT_BODY_BUILDERS

  for (const b of Object.values(builders)) {
    if (b.designs.some((x) => x.id === designId)) return b
  }
  return undefined
}

/** Compose new purchase price: base chassis + auto body package (builder × length × grade). */
export function composeNewPrice(
  model: BusModel,
  design?: BodyDesign,
  builderId?: string,
): Money {
  return Math.max(0, model.priceNew + bodyPackagePrice(builderId, design, model.name))
}

/** Compose delivery lead time: base chassis build + body fabrication days. */
export function composeLeadTime(model: BusModel, design?: BodyDesign): number {
  return Math.max(1, model.leadTimeDays + (design ? design.leadDaysAdd : 0))
}

/** Effective comfort score: model base comfort + design comfort delta. */
export function effectiveComfort(model: BusModel, design?: BodyDesign): number {
  return Math.max(1, Math.min(10, model.comfort + (design ? design.comfortDelta : 0)))
}

/** Effective maintenance cost index: model index + design maintenance delta. */
export function effectiveMaintCostIndex(model: BusModel, design?: BodyDesign): number {
  return Math.max(0.5, Math.round((model.maintCostIndex + (design ? design.maintDelta : 0)) * 100) / 100)
}

/** Short OEM tag for fleet lists: BharatBenz → BB, Ashok Leyland → AL. */
export function makerAbbr(maker: string): string {
  switch (maker) {
    case 'Ashok Leyland':
      return 'AL'
    case 'BharatBenz':
      return 'BB'
    case 'Volvo':
      return 'VOL'
    case 'Scania':
      return 'SCA'
    case 'Olectra':
      return 'OLC'
    case 'Mahindra':
      return 'MAH'
    case 'Eicher':
      return 'EIC'
    default:
      return maker.slice(0, 3).toUpperCase()
  }
}

/** Compact chassis code, e.g. BB1824hd / AL12M / VOL9600slx. */
export function shortChassisCode(model: BusModel): string {
  return `${makerAbbr(model.maker)}${model.name.replace(/\s+/g, '')}`
}

/** Short body-builder label for fleet lists. */
export function shortBuilderName(builderName: string): string {
  const known: Record<string, string> = {
    Prakesh: 'Prakesh',
    REC: 'REC',
    'MG Group': 'MG',
    ARVEX: 'ARVEX',
  }
  if (known[builderName]) return known[builderName]
  return builderName.split(/\s+/)[0] || builderName
}

/** Display title including coach body design (e.g. "Ashok Leyland 12M · JCBL Classic"). */
export function coachTitle(model: BusModel | undefined, designOrName?: BodyDesign | string): string {
  if (!model) return typeof designOrName === 'string' ? designOrName : designOrName?.name ?? 'Unknown Bus'
  const base = modelTitle(model)
  const dName = typeof designOrName === 'string' ? designOrName : designOrName?.name
  return dName ? `${base} · ${dName}` : base
}

/**
 * Fleet MODEL column:
 * - AL / BB: "Prakesh·Prakesh Standard·AL12M" (builder·design·chassis)
 * - Volvo / Olectra: full maker + name ("Volvo 9600slx", "Olectra eBuzz K9")
 * - Others: full "Scania Metrolink"
 */
export function fleetModelLabel(
  model: BusModel | undefined,
  opts?: {
    bodyBuilderId?: string
    bodyDesignId?: string
    bodyDesignName?: string
    bodyBuilders?: GameState['bodyBuilders']
  },
): string {
  if (!model) return '—'
  const maker = model.maker
  if (maker === 'Volvo' || maker === 'Olectra') {
    return modelTitle(model)
  }
  if (maker === 'Ashok Leyland' || maker === 'BharatBenz') {
    const chassis = shortChassisCode(model)
    const builders = opts?.bodyBuilders
    const stateHint = builders ? ({ bodyBuilders: builders } as GameState) : undefined
    let builderName: string | undefined
    if (opts?.bodyBuilderId && builders?.[opts.bodyBuilderId]) {
      builderName = builders[opts.bodyBuilderId].name
    } else if (opts?.bodyDesignId) {
      builderName = getBuilderForDesign(stateHint, opts.bodyDesignId)?.name
    }
    const designName =
      opts?.bodyDesignName
      ?? (opts?.bodyDesignId ? getDesign(stateHint, opts.bodyDesignId)?.name : undefined)
    if (builderName && designName) {
      return `${shortBuilderName(builderName)}·${designName}·${chassis}`
    }
    if (builderName) return `${shortBuilderName(builderName)}·${chassis}`
    if (designName) return `${designName}·${chassis}`
    return chassis
  }
  return modelTitle(model)
}

/** Effective live comfort of a bus in fleet, taking into account model, body design, and seat refurb. */
export function busComfort(s: GameState | undefined, bus: Bus): number {
  const model = BUS_MODELS[bus.modelId]
  if (!model) return 7
  const design = s ? getDesign(s, bus.bodyDesignId) : undefined
  const baseComfort = effectiveComfort(model, design)
  return Math.max(1, Math.min(10, baseComfort + (bus.comfortBonus ?? 0)))
}

/** Effective maintenance index for a bus, taking into account model and body design. */
export function busMaintCostIndex(s: GameState | undefined, bus: Bus): number {
  const model = BUS_MODELS[bus.modelId]
  if (!model) return 1
  const design = s ? getDesign(s, bus.bodyDesignId) : undefined
  return effectiveMaintCostIndex(model, design)
}
