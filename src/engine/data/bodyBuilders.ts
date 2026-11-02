import type { Money, BusModel, GameState, Bus, BodyDesign, BodyBuilder } from '../types'
import { L } from '../core/money'
import { BUS_MODELS, isCargoModel, modelTitle } from './busModels'

export type { BodyDesign, BodyBuilder }

export const DEFAULT_BODY_BUILDERS: Record<string, BodyBuilder> = {
  bb_factory: {
    id: 'bb_factory',
    name: 'BharatBenz Factory',
    makers: ['BharatBenz'],
    designs: [
      {
        id: 'bb_fac_std',
        name: 'Factory Standard',
        bodyPrice: 0,
        leadDaysAdd: 0,
        comfortDelta: 0,
        maintDelta: 0,
        notes: 'OEM factory fully built body with standard NVH insulation.',
      },
      {
        id: 'bb_fac_prem',
        name: 'Factory Premium',
        bodyPrice: L(3.5),
        leadDaysAdd: 5,
        comfortDelta: 0.6,
        maintDelta: -0.05,
        notes: 'Upgraded factory coach package with acoustic damping and executive panelling.',
      },
    ],
  },
  sri_murugan: {
    id: 'sri_murugan',
    name: 'Sri Murugan Body Works',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'sm_budget',
        name: 'Murugan Standard',
        bodyPrice: -L(2.5),
        leadDaysAdd: -4,
        comfortDelta: -0.4,
        maintDelta: 0.08,
        notes: 'Economy regional coachwork. Quick turnaround with utilitarian steel framing.',
      },
      {
        id: 'sm_deluxe',
        name: 'Murugan Deluxe',
        bodyPrice: -L(1),
        leadDaysAdd: -2,
        comfortDelta: -0.1,
        maintDelta: 0.04,
        notes: 'Balanced budget build with reinforced steel panelling.',
      },
    ],
  },
  jcbl: {
    id: 'jcbl',
    name: 'JCBL',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'jcbl_classic',
        name: 'JCBL Classic',
        bodyPrice: 0,
        leadDaysAdd: 0,
        comfortDelta: 0.2,
        maintDelta: 0,
        notes: 'Proven pan-India benchmark coachwork with durable composite panels.',
      },
      {
        id: 'jcbl_exec',
        name: 'JCBL Executive',
        bodyPrice: L(3),
        leadDaysAdd: 4,
        comfortDelta: 0.5,
        maintDelta: -0.03,
        notes: 'Luxury executive finish with refined passenger saloon and LED ambience.',
      },
    ],
  },
  veera: {
    id: 'veera',
    name: 'Veera Vahana',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'veera_samrat',
        name: 'Veera Samrat',
        bodyPrice: L(1.5),
        leadDaysAdd: 2,
        comfortDelta: 0.3,
        maintDelta: -0.02,
        notes: 'Aerodynamic composite front mask with contoured highway saloon.',
      },
      {
        id: 'veera_v7',
        name: 'Veera V7',
        bodyPrice: L(4.5),
        leadDaysAdd: 6,
        comfortDelta: 0.7,
        maintDelta: -0.05,
        notes: 'Prestige luxury touring bodywork with wide-view panoramic glazing.',
      },
    ],
  },
  acgl: {
    id: 'acgl',
    name: 'ACGL',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'acgl_tourer',
        name: 'ACGL Tourer',
        bodyPrice: -L(0.5),
        leadDaysAdd: -1,
        comfortDelta: 0.1,
        maintDelta: 0.02,
        notes: 'Rugged all-weather galvanised shell tailored for varied road conditions.',
      },
      {
        id: 'acgl_exec',
        name: 'ACGL Executive',
        bodyPrice: L(2),
        leadDaysAdd: 3,
        comfortDelta: 0.4,
        maintDelta: -0.02,
        notes: 'Refined long-distance touring coach package with low exterior vibration.',
      },
    ],
  },
  irizar: {
    id: 'irizar',
    name: 'Irizar TVS',
    makers: ['Ashok Leyland', 'BharatBenz'],
    designs: [
      {
        id: 'irizar_century',
        name: 'Irizar Century',
        bodyPrice: L(5),
        leadDaysAdd: 7,
        comfortDelta: 0.8,
        maintDelta: -0.06,
        notes: 'Prestige aerodynamic styling with superior NVH dampening and plush berths.',
      },
      {
        id: 'irizar_i6',
        name: 'Irizar i6',
        bodyPrice: L(8),
        leadDaysAdd: 10,
        comfortDelta: 1.1,
        maintDelta: -0.08,
        notes: 'Flagship luxury coach body delivering top-tier passenger ride comfort.',
      },
    ],
  },
}

export function cloneDefaultBodyBuilders(): Record<string, BodyBuilder> {
  return JSON.parse(JSON.stringify(DEFAULT_BODY_BUILDERS))
}

/** Check if this chassis model supports custom body designs (Ashok Leyland & BharatBenz passenger coaches). */
export function modelSupportsBodyDesigns(modelOrId: BusModel | string | undefined): boolean {
  const model = typeof modelOrId === 'string' ? BUS_MODELS[modelOrId] : modelOrId
  if (!model || model.isCargoOnly || isCargoModel(model)) return false
  return model.maker === 'Ashok Leyland' || model.maker === 'BharatBenz'
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

/** Compose new purchase price: base chassis + body package. */
export function composeNewPrice(model: BusModel, design?: BodyDesign): Money {
  return Math.max(0, model.priceNew + (design ? design.bodyPrice : 0))
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

/** Display title including coach body design (e.g. "Ashok Leyland 12M · JCBL Classic"). */
export function coachTitle(model: BusModel | undefined, designOrName?: BodyDesign | string): string {
  if (!model) return typeof designOrName === 'string' ? designOrName : designOrName?.name ?? 'Unknown Bus'
  const base = modelTitle(model)
  const dName = typeof designOrName === 'string' ? designOrName : designOrName?.name
  return dName ? `${base} · ${dName}` : base
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
