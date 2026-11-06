import { useDeferredValue } from 'react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { setAutoFreeze } from 'immer'

// Disable Immer auto-freeze so retained simulation drafts can be directly mutated across ticks
setAutoFreeze(false)
import type { BusDuty, CharterPricingStrategy, CorridorStance, DepreciationMethod, Difficulty, GameState, ID, RouteLayoutStats, ScheduleDefaults, SubsystemId, Schedule, ServiceTierId, TyreBrand, TyreAxle, SeasonId, CargoCargoType, CargoPricingType, PassengerAmenities, ServiceTier, FuelPartner, PlayerConfig, BusGroup, DeskPost, BodyDesign, LoungeTier, LoungeSeating, LoungeAmenityId, PassengerHandlingConfig, Scenario } from '../engine/types'
import { type Money, fmtCompact } from '../engine/core/money'
import { advanceDaySteps, needsAttention } from '../engine/tick'
import { newGame, SAVE_VERSION, initialBrandCode } from '../engine/newGame'
import { nextId } from '../engine/core/ids'
import * as groups from '../engine/sim/groups'
import * as fleet from '../engine/sim/fleet'
import * as brandActions from '../engine/sim/brandActions'
import * as banking from '../engine/sim/banking'
import * as staffing from '../engine/sim/staffing'
import * as schedules from '../engine/sim/schedules'
import * as loungeSim from '../engine/sim/lounge'
import * as maintenance from '../engine/sim/maintenance'
import * as channels from '../engine/sim/channels'
import * as cover from '../engine/sim/cover'
import * as insurance from '../engine/sim/insurance'
import * as cargoSim from '../engine/sim/cargo'
import * as depot from '../engine/sim/depot'
import * as crm from '../engine/sim/crm'
import * as tax from '../engine/sim/tax'
import * as festival from '../engine/sim/festival'
import * as charterSim from '../engine/sim/charter'
import { setCorridorStance as applyCorridorStance } from '../engine/sim/rivalIntelligence'
import { pushLog } from '../engine/sim/log'
import { retainDay } from '../engine/sim/retain'
import { BUS_MODELS, RETIRED_MODEL_MAP, canonicalizeLayoutKey, layoutKey, isCargoModel } from '../engine/data/busModels'
import { ROUTES, ROUTE_LIST, RIVALS, routeName } from '../engine/data/routes'
import { cityName } from '../engine/data/cities'
import { RIVALS_DATA, seedRouteShare } from '../engine/data/rivals'
import { BAL, getDirectionalOccupancyRange } from '../engine/data/balance'
import { emptyChannelSold, normalizeChannels } from '../engine/data/channels'
import { foldHybridLayouts } from '../engine/sim/finance'
import { applyDecision } from '../engine/sim/events'
import { generateTrips, pruneInvalidSeasonalTrips } from '../engine/sim/booking'
import { departureTimeFit, haulLayoutAppeal } from '../engine/sim/corridor'
import { roundFare, isReturnTrip, resolveTripFare } from '../engine/sim/pricing'
import { cloneDefaultBodyBuilders, DEFAULT_BODY_BUILDERS, getDesign, type CoachLayoutKind } from '../engine/data/bodyBuilders'
import {
  getSharedBodyBuildersSync,
  loadSharedBodyDesigns,
  saveSharedBodyDesigns,
  syncStateBodyBuildersWithShared,
} from './sharedBodyDesigns'
import { usedPrice } from '../engine/sim/fleet'
import { rngFor, rJitter } from '../engine/core/rng'
import { L } from '../engine/core/money'
import {
  clearSaveStores,
  decodeSaveString,
  encodeSaveString,
  toSaveDto,
  hasSaveBlob,
  hydratePackedState,
  readSave,
  writeSave,
} from './saveCodec'
import { encodeSaveDtoAsync } from './saveWorkerClient'
import { createSaveQueue } from './saveQueue'
import {
  getActiveCloudSaveId,
  getActiveCloudSaveRevision,
  setActiveCloudSaveId,
  appendCloudSave,
  createCloudSave,
  loadCloudSave,
} from './cloudGameSave'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'good' | 'bad' | 'warn'
}

export interface UiPrefs {
  fleetGroupId: 'all' | 'none' | ID
}

function loadUiPrefs(): UiPrefs {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('busraj_ui_prefs')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.fleetGroupId === 'string') {
          return { fleetGroupId: parsed.fleetGroupId }
        }
      }
    }
  } catch {}
  return { fleetGroupId: 'all' }
}

function saveUiPrefs(prefs: UiPrefs): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('busraj_ui_prefs', JSON.stringify(prefs))
    }
  } catch {}
}

export function sanitizeUiPrefs(prefs: UiPrefs, s: GameState | null): UiPrefs {
  if (prefs.fleetGroupId !== 'all' && prefs.fleetGroupId !== 'none') {
    if (!s?.groups || !s.groups[prefs.fleetGroupId] || s.groups[prefs.fleetGroupId].status === 'retired') {
      return { fleetGroupId: 'all' }
    }
  }
  return prefs
}

let toastSeq = 1
/** A multi-day skip is slicing its work across tasks; ignore further advances. */
let skipInFlight = false
/** Bumped by each advance; a runner that is no longer the latest must not touch shared flags. */
let advanceRun = 0

/** Main-thread budget per slice of a day or week advance, so the browser paints in between. */
const ADVANCE_SLICE_MS = 10

/**
 * Hand control back to the browser and continue soon after. A MessageChannel task does not get
 * the 4 ms clamp that nested setTimeout(0) calls get, and unlike requestAnimationFrame it keeps
 * running in a background tab.
 */
const yieldToBrowser: (fn: () => void) => void = (() => {
  if (typeof MessageChannel === 'undefined') return (fn: () => void) => { setTimeout(fn, 0) }
  const channel = new MessageChannel()
  const queue: (() => void)[] = []
  channel.port1.onmessage = () => { queue.shift()?.() }
  // Node (scripts, tests) would otherwise stay alive forever on an open port; browsers ignore this.
  ;(channel.port1 as { unref?: () => void }).unref?.()
  return (fn: () => void) => {
    queue.push(fn)
    channel.port2.postMessage(0)
  }
})()

/**
 * A new state object whose top-level containers are new too. The engine mutates in place, so
 * without this, screens that memoise on `s.trips`, `s.buses` and the like would keep showing the
 * pre-advance numbers. Copies are one level deep: cheap, and nothing below is duplicated.
 */
function withFreshContainers(s: GameState): GameState {
  const out = { ...s } as Record<string, unknown>
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value)) out[key] = value.slice()
    else if (value && typeof value === 'object') out[key] = { ...(value as object) }
  }
  return out as unknown as GameState
}

interface GameStore {
  state: GameState | null
  toasts: Toast[]
  busy: boolean
  /** Days done and asked for while a day or week advance runs; null when idle. */
  skipProgress: { done: number; total: number } | null
  skipStopReason: string | null
  uiPrefs: UiPrefs
  setFleetGroupFilter: (id: 'all' | 'none' | ID) => void

  createGroup: (input: {
    name: string
    code: string
    color?: string
    cargoBrand?: boolean
    brandingPic?: string
    parentGroupId?: ID
    kind?: 'fleet' | 'operator'
  }) => { id: ID } | { error: string }
  updateGroup: (id: ID, patch: Partial<Omit<BusGroup, 'id'>>) => string | null
  retireGroup: (id: ID, moveTo: ID | undefined) => string | null
  restoreGroup: (id: ID) => string | null
  deleteGroup: (id: ID) => string | null
  assignBusToGroup: (busId: ID, groupId: ID | undefined, opts?: { chargeRebrand?: boolean }) => string | null
  assignScheduleToGroup: (schId: ID, groupId: ID | undefined) => string | null
  launchBrandCampaign: (
    groupId: ID,
    input: { kind: 'launch'; tier: 'local' | 'regional' | 'statewide' } | { kind: 'route'; routeId: string },
  ) => string | null
  stopBrandCampaign: (groupId: ID, campaignId: ID) => string | null
  transferCoaches: (busIds: ID[], toGroupId: ID | undefined, rebrand: boolean) => string | null
  mergeBrands: (fromId: ID, intoId: ID) => string | null
  spinOffBrand: (input: brandActions.SpinOffInput) => { id: ID } | { error: string }
  sellBrand: (groupId: ID, opts: { includeCoaches: boolean; moveTo: ID | undefined }) => string | null

  startNew: (name: string, difficulty: Difficulty, homeRouteId: string, scenario?: Scenario) => void
  loadSave: () => boolean
  /** Parse a JSON export and load it. Returns whether browser storage accepted a write. */
  importSaveJson: (text: string) => { ok: boolean; persisted: boolean; error?: string }
  hasSave: () => boolean
  save: () => boolean
  /**
   * Fold old history into the compact form and rewrite the save: drops seat
   * maps from finished trips, keeps three weeks of trip detail, 90 days of
   * route-days and a shorter ledger. Returns whether the write succeeded.
   */
  compactSave: () => boolean
  /** Compacted JSON string for download (does not mutate live state). */
  exportSaveJson: () => string | null
  abandon: () => void
  /** Clears all stored save data from browser storage and returns to company setup screen. */
  resetToNewGame: () => void
  loadCloudSaveById: (id: string) => Promise<{ ok: boolean; label?: string; error?: string }>
  saveToNewCloudSlot: (customLabel?: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  updateActiveCloudSlot: () => Promise<{ ok: boolean; compacted?: boolean; noop?: boolean; error?: string }>
  unlinkActiveCloudSlot: () => void
  getActiveCloudSlotId: () => string | null

  advance: (days: number, stopOnAttention?: boolean) => void

  /** run an engine intent; returns true on success, toasts the error otherwise */
  intent: (fn: (s: GameState) => string | null, successMsg?: string) => boolean
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void

  // convenience wrappers used across pages
  inspectListing: (id: ID) => void
  buyUsed: (id: ID, plan: fleet.FinancePlan, groupId?: ID) => void
  orderNewBus: (modelId: string, plan: fleet.FinancePlan, groupId?: ID, bodyDesignId?: string) => void
  startLease: (id: ID, groupId?: ID) => void
  endLease: (busId: ID) => boolean
  signAttach: (id: ID, groupId?: ID) => void
  releaseAttach: (busId: ID) => void
  sellBus: (busId: ID) => void
  forecloseLoan: (loanId: ID) => void
  takeCashLoan: (slabId: string) => void
  rescueWithLoan: (slabId: string) => void
  hire: (candId: ID) => void
  fire: (staffId: ID) => void
  assignStaff: (staffId: ID, busId: ID | undefined) => void
  trainStaff: (staffId: ID) => void
  raiseSalary: (staffId: ID, salary: number) => void
  applyForPermit: (routeId: string) => void
  applySeasonalPermit: (routeId: string, seasonId?: SeasonId) => void
  renewSeasonalPermit: (routeId: string) => void
  withdrawSeasonalPermit: (routeId: string) => void
  openCargoPermit: (routeId: string) => void
  renewCargoPermit: (routeId: string) => void
  closeCargoPermit: (routeId: string) => void
  discontinueRoute: (routeId: string) => void
  setCorridorStance: (routeId: string, stance: CorridorStance) => void
  createSchedule: (input: schedules.ScheduleInput, busId?: ID) => boolean
  updateSchedule: (schId: ID, patch: Partial<schedules.ScheduleInput> & { active?: boolean }) => void
  assignBus: (schId: ID, busId: ID) => void
  unassignBus: (schId: ID, busId: ID) => void
  deleteSchedule: (schId: ID) => void
  duplicateSchedule: (schId: ID, slot?: schedules.DuplicateSlot) => boolean
  makeFestivalFull: (schId: ID) => void
  appointScheduleManager: (staffId: ID | undefined) => void
  setScheduleAutoAcceptCharters: (auto: boolean) => void
  serviceBus: (busId: ID, tier?: ServiceTierId, opts?: { outside?: boolean }) => void
  repairSubsystem: (busId: ID, sub: SubsystemId) => void
  replaceTyres: (busId: ID, axleOrRetread?: TyreAxle | boolean, brand?: TyreBrand, opts?: { outside?: boolean }) => void
  setWorkshopTyreBrand: (brand: 'oem' | 'tier2') => void
  rebodyBus: (busId: ID, bodyDesignId?: string, desiredLayoutKind?: CoachLayoutKind) => void
  overhaulPowertrain: (busId: ID) => void
  retrofitLuxuryAmenities: (busId: ID) => void
  refurbishSeats: (busId: ID) => void
  addBodyDesign: (builderId: string, design: BodyDesign) => { ok: boolean; error?: string }
  updateBodyDesign: (builderId: string, designId: string, patch: Partial<BodyDesign>) => { ok: boolean; error?: string }
  removeBodyDesign: (builderId: string, designId: string) => { ok: boolean; error?: string }
  resetBodyDesignsToDefault: () => { ok: boolean }
  initSharedBodyDesigns: () => Promise<void>
  upgradeWorkshop: () => void
  openWorkshopLocation: (cityId: string, groupIds: ID[]) => void
  addWorkshopBayAtLocation: (locationId: ID) => void
  updateWorkshopLocationBrands: (locationId: ID, groupIds: ID[]) => void
  expandDepot: () => void
  leaseYard: (cityId: string) => void
  cancelYard: (cityId: string) => void
  payGarageClaim: (claimId: ID) => void
  settleInsuranceClaim: (claimId: ID) => void
  appointFleetManager: (staffId: ID | undefined) => void
  appointBayMechanic: (staffId: ID | undefined, bayIndex?: number) => void
  unappointBayMechanic: (staffId: ID) => void
  appointHr: (staffId: ID | undefined) => void
  appointOps: (staffId: ID | undefined) => void
  setOpsAutoStaff: (enabled: boolean) => void
  setHrAutoHire: (patch: staffing.HrAutoHirePatch) => void
  setHrAutoRaise: (enabled: boolean) => void
  setHrAutoFire: (patch: staffing.HrAutoFirePatch) => void
  appointSpareDriver: (staffId: ID) => void
  setBusDuty: (busId: ID, duty: BusDuty) => void
  buildAppTier: (tier: 1 | 2 | 3) => void
  setMarketingBudget: (monthly: number) => void
  /** Which vehicle kinds the used, lease and attach boards offer. */
  setMarketMix: (mix: { bus: boolean; charter: boolean; cargo: boolean }) => boolean
  decide: (decisionId: ID, optionId: string) => void
  markInboxRead: (id: ID) => void
  /** Dismiss the victory scorecard and keep playing. */
  acknowledgeVictory: () => void
  markAllInboxRead: () => void
  repriceTrip: (tripId: ID, fare: number) => void
  setOdoHighlightKm: (km: number) => void
  setAutoRenewDocs: (enabled: boolean) => void
  setCargoBaseRate: (rs: number) => void
  setCargoPricingType: (type: CargoPricingType) => void
  setCargoCargoType: (type: CargoCargoType) => void
  setCargoAcceptFragile: (accept: boolean) => void
  setCargoAutoSignContracts: (enabled: boolean) => void
  signCargoContract: (proposal: any) => void
  cancelCargoContract: (contractId: ID) => void
  acceptSpotCargoOffer: (offerId: ID) => void
  acceptAllSpotOffers: () => void
  setDedicatedCargoSubsidiary: (on: boolean) => void
  deepCleanBus: (busId: ID) => void
  payRoadTax: (busId: ID) => void
  renewPuc: (busId: ID) => void
  fitGps: (busId: ID) => void
  retestFitness: (busId: ID) => void
  takeMsmeLoan: (lenderId: string, amount: Money, months: number) => void
  setScheduleDefaults: (patch: Partial<ScheduleDefaults>) => void
  appointCargoManager: (staffId: ID | undefined) => void
  appointDocsManager: (staffId: ID | undefined) => void
  appointCrm: (staffId: ID | undefined) => void
  setCrmPolicy: (policy: 'ask' | 'refund' | 'dispute' | 'suggest_refund') => void
  resolveGrievance: (grievanceId: ID, action: 'refund' | 'dispute') => void
  appointAccountant: (staffId: ID | undefined) => void
  appointCharterManager: (staffId: ID | undefined) => void
  setCharterPricingStrategy: (strategy: CharterPricingStrategy) => void
  setCharterOperatingBase: (cityId: string) => void
  setCharterAutoAccept: (enabled: boolean) => void
  setCharterMinCondition: (minCondition: number) => void
  setCharterMinMargin: (pct: number) => void
  setCharterDeposit: (pct: number) => void
  acceptCharterInquiry: (inquiryId: ID, busId: ID) => void
  rejectCharterInquiry: (inquiryId: ID) => void
  autoAssignCharters: () => void
  appointDeskAssistant: (desk: DeskPost, staffId: ID) => void
  unappointDeskAssistant: (desk: DeskPost, staffId: ID) => void
  retrainDriver: (staffId: ID) => void
  upgradeLicence: (staffId: ID) => void
  runTripAnyway: (tripId: ID) => void
  updatePlayerConfig: (patch: Partial<PlayerConfig>) => void
  setWelfareConfig: (patch: Partial<Pick<PlayerConfig, 'mealAllowance' | 'healthCoverage' | 'festivalBonus' | 'driverDormitoryTier' | 'festivalBonusTier'>>) => void
  renewInsurance: (busId: ID) => void
  renewFitness: (busId: ID) => void
  setDepreciationDefault: (method: DepreciationMethod) => void
  setDepreciationRate: (ratePct: number | null) => void
  remitGst: () => void
  fileTds: () => void
  takeHpLoan: (productId: string, busId: ID, months: number) => void
  setServiceTier: (schId: ID, tier: ServiceTier, amenities?: PassengerAmenities) => void
  setDefaultAmenities: (amenities: PassengerAmenities) => void
  setDefaultServiceTier: (tier: ServiceTier) => void
  retrofitBus: (busId: ID, feature: string) => void
  setFuelContract: (partner: FuelPartner) => void
  installDepotFuelTank: () => void
  upgradeDepotFuelTank: () => void
  orderDepotFuelRefill: (litres?: number) => void
  toggleAutoRefillDepotTank: (enabled?: boolean) => void
  toggleEcoIncentive: (enabled?: boolean) => void
  triggerFlashDeal: (tripId: ID) => void
  triggerSurgeDeal: (tripId: ID) => void
  openPassengerLounge: (cityId: string, locationName: string, tier: LoungeTier, seating?: LoungeSeating, amenities?: LoungeAmenityId[]) => void
  refitPassengerLounge: (loungeId: string, seating: LoungeSeating, amenities: LoungeAmenityId[]) => void
  upgradePassengerLounge: (loungeId: string, newTier: LoungeTier) => void
  closePassengerLounge: (loungeId: string) => void
  updatePassengerConfig: (patch: Partial<PassengerHandlingConfig>) => void
}

const saveQueue = createSaveQueue({
  destination: getActiveCloudSaveId,
  destinationRevision: getActiveCloudSaveRevision,
  toDto: toSaveDto,
  encode: encodeSaveDtoAsync,
  write: writeSave,
  persistSync: (state) => persistState(state),
  append: appendCloudSave,
  busy: () => skipInFlight,
})

function dropPendingSave(): void {
  saveQueue.invalidate()
}

/** Includes a save whose worker is still encoding when the page is hidden. */
export function flushPendingSave(): boolean {
  return saveQueue.flushSync()
}

function persistSoon(s: GameState | null, opts?: { alreadyMutable?: boolean }): void {
  if (s) saveQueue.enqueue(s, opts?.alreadyMutable)
}

function persist(s: GameState | null, opts?: { alreadyMutable?: boolean }): boolean {
  return s ? saveQueue.saveNow(s, opts?.alreadyMutable) : false
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushPendingSave() })
  window.addEventListener('beforeunload', () => { flushPendingSave() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave()
  })
}

function persistState(s: GameState): boolean {
  // Hot path: encode straight off the live state. `encodeSaveString` only reads
  // (trips are packed into a DTO), so a full deep clone here just doubled the
  // working set of a long game on every click. Retention runs daily in the
  // engine, so the clone is only needed when we must shrink for a full store.
  const tryWrite = (state: GameState): boolean => {
    try {
      return writeSave(encodeSaveString(state), state.day)
    } catch {
      return false
    }
  }

  let ok = false
  if (tryWrite(s)) {
    ok = true
  } else {
    // Storage refused the payload: make a private copy to trim, never mutating
    // the live state the UI is rendering from.
    const draft = structuredClone(s) as GameState
    compactTrips(draft)
    draft.txns = draft.txns.slice(-400)
    if (tryWrite(draft)) {
      ok = true
    } else {
      shrinkForStorage(draft, 'medium')
      if (tryWrite(draft)) {
        ok = true
      } else {
        shrinkForStorage(draft, 'hard')
        ok = tryWrite(draft)
      }
    }
  }

  return ok
}


/** Aggressive shrink for full localStorage / smaller export files. */
function shrinkForStorage(s: GameState, level: 'medium' | 'hard'): GameState {
  compactTrips(s)
  const keepOpen = level === 'hard' ? 10 : BAL.bookingWindowDays
  const keepDone = level === 'hard' ? 7 : Math.min(BAL.completedTripKeepDays, 21)
  for (const [id, t] of Object.entries(s.trips ?? {})) {
    if (t.status === 'open') {
      if (t.day > s.day + keepOpen) {
        delete s.trips[id]
        continue
      }
      continue
    }
    if (t.day < s.day - keepDone) delete s.trips[id]
    else {
      if (t.seats?.length) t.seats = []
      delete t.seatSales
    }
  }
  s.openTripIds = (s.openTripIds ?? []).filter((id) => s.trips[id]?.status === 'open')
  s.txns = (s.txns ?? []).slice(level === 'hard' ? -200 : -500)
  s.monthly = (s.monthly ?? []).slice(level === 'hard' ? -24 : -48)
  if (s.routeHistory) {
    for (const [rid, days] of Object.entries(s.routeHistory)) {
      const keep = level === 'hard' ? 30 : 90
      s.routeHistory[rid] = (days ?? []).filter((d) => d.day >= s.day - keep)
    }
  }

  for (const sch of Object.values(s.schedules ?? {})) {
    if (sch.occRecent?.length > 30) sch.occRecent = sch.occRecent.slice(-30)
    if (sch.occRecentReturn && sch.occRecentReturn.length > 30) {
      sch.occRecentReturn = sch.occRecentReturn.slice(-30)
    }
  }
  return s
}

/** Backfill seatCount and drop seat maps on old finished trips (save size). */
function compactTrips(s: GameState): void {
  const keep = BAL.completedTripKeepDays
  for (const [id, t] of Object.entries(s.trips ?? {})) {
    if (!t.seatCount) t.seatCount = t.seats?.length || 0
    if (t.status === 'open') continue
    if (t.day < s.day - keep) {
      delete s.trips[id]
      continue
    }
    if (t.seats?.length) t.seats = []
    delete t.seatSales
  }
  s.openTripIds = (s.openTripIds ?? []).filter((id) => {
    const t = s.trips[id]
    return t !== undefined && (t.status === 'open' || t.day >= s.day - keep)
  })
  if (s.txns.length > BAL.txnMaxCount) s.txns = s.txns.slice(-BAL.txnMaxCount)
}

function mergeByLayoutKeys(byLayout: Record<string, RouteLayoutStats> | undefined): void {
  if (!byLayout) return
  for (const key of Object.keys(byLayout)) {
    const canon = canonicalizeLayoutKey(key)
    if (canon === key) continue
    const src = byLayout[key]!
    delete byLayout[key]
    const dst = (byLayout[canon] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
    dst.revenue += src.revenue
    dst.cost += src.cost
    dst.trips += src.trips
    dst.paxKm += src.paxKm
    dst.seatKm += src.seatKm
  }
  foldHybridLayouts(byLayout)
}

function migrateLegacyRouteIds(s: GameState): void {
  // Migrate legacy and inverted route IDs to canonical IDs in ROUTE_LIST
  const routeRenames: [string, string][] = [
    ['blr-maa', 'maa-blr'],
    ['mdu-maa', 'maa-mdu'],
    ['mdu-maa-ecr', 'maa-mdu-ecr'],
    ['mdu-blr', 'blr-mdu'],
    ['cbe-mdu', 'mdu-cbe'],
  ]
  for (const [oldId, newId] of routeRenames) {
    if (s.permits && s.permits[oldId]) {
      if (!s.permits[newId] || s.permits[newId].status !== 'active') {
        s.permits[newId] = {
          ...s.permits[oldId],
          routeId: newId,
        }
      }
      delete s.permits[oldId]
    }
    for (const sch of Object.values(s.schedules ?? {})) {
      if (sch.routeId === oldId) {
        sch.routeId = newId
      }
    }
    for (const t of Object.values(s.trips ?? {})) {
      if (t.routeId === oldId) {
        t.routeId = newId
      }
    }
    if (s.world) {
      if (s.world.share?.[oldId]) {
        if (!s.world.share[newId]) s.world.share[newId] = s.world.share[oldId]
        delete s.world.share[oldId]
      }
      if (s.world.shareHistory?.[oldId]) {
        if (!s.world.shareHistory[newId]) s.world.shareHistory[newId] = s.world.shareHistory[oldId]
        delete s.world.shareHistory[oldId]
      }
      if (s.world.fareIndex?.[oldId]) {
        if (s.world.fareIndex[newId] === undefined) s.world.fareIndex[newId] = s.world.fareIndex[oldId]
        delete s.world.fareIndex[oldId]
      }
      if (s.world.priceWars?.[oldId]) {
        if (!s.world.priceWars[newId]) s.world.priceWars[newId] = s.world.priceWars[oldId]
        delete s.world.priceWars[oldId]
      }
      if (s.world.closures?.[oldId]) {
        if (!s.world.closures[newId]) s.world.closures[newId] = s.world.closures[oldId]
        delete s.world.closures[oldId]
      }
      if (s.world.demandShock?.[oldId]) {
        if (!s.world.demandShock[newId]) s.world.demandShock[newId] = s.world.demandShock[oldId]
        delete s.world.demandShock[oldId]
      }
    }
    if (s.routeStats?.[oldId]) {
      if (!s.routeStats[newId]) s.routeStats[newId] = s.routeStats[oldId]
      delete s.routeStats[oldId]
    }
    if (s.routeHistory?.[oldId]) {
      if (!s.routeHistory[newId]) s.routeHistory[newId] = s.routeHistory[oldId]
      delete s.routeHistory[oldId]
    }
  }
}

function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as GameState
  if (typeof s.version !== 'number' || s.version > SAVE_VERSION) return null

  migrateLegacyRouteIds(s)
  // The fuel hedge feature was removed; a contract stored in an old save is simply dropped.
  if (s.company) delete (s.company as { fuelHedge?: unknown }).fuelHedge

  if (!s.groups || Object.keys(s.groups).length === 0) {
    const initCode = initialBrandCode(s.company?.name ?? 'Main')
    const grpId = nextId(s.ids, 'grp')
    const primaryBrand: BusGroup = {
      id: grpId,
      name: s.company?.name ?? 'Main Brand',
      code: initCode,
      color: groups.GROUP_PALETTE[0],
      foundedDay: s.day,
      status: 'active',
      rating: s.company?.rating ?? 3.4,
      ratingCount: s.company?.ratingCount ?? 0,
      cancelRate: s.company?.cancelRate ?? 0,
      primo: !!s.company?.primo,
      primoOffered: !!s.company?.primoOffered,
      primoSinceDay: s.company?.primoSinceDay,
      defaultAmenities: s.company?.defaultAmenities ? { ...s.company.defaultAmenities } : undefined,
      defaultServiceTier: s.company?.defaultServiceTier,
    }
    s.groups = { [grpId]: primaryBrand }

    for (const sch of Object.values(s.schedules ?? {})) {
      if ((sch as any).amenities && !primaryBrand.defaultAmenities) {
        primaryBrand.defaultAmenities = { ...(sch as any).amenities }
      }
      delete (sch as any).amenities
      sch.groupId = grpId
    }

    for (const b of Object.values(s.buses ?? {})) {
      b.groupId = grpId
    }
  } else {
    for (const g of Object.values(s.groups)) {
      if (!g.status) g.status = 'active'
      // Brief logo field → brandingPic (bus livery photo, not a badge icon)
      const legacy = g as BusGroup & { logo?: string }
      if (!g.brandingPic && legacy.logo) {
        g.brandingPic = legacy.logo
      }
      delete legacy.logo
    }
    for (const sch of Object.values(s.schedules ?? {})) {
      delete (sch as any).amenities
    }
  }

  const primaryBrandId = Object.values(s.groups).find((g) => g.kind !== 'operator')?.id

  for (const b of Object.values(s.buses ?? {})) {
    if (!b.duty) b.duty = 'line'
    if (b.groupId === undefined && primaryBrandId) b.groupId = primaryBrandId
    if (b.busCleanliness === undefined) b.busCleanliness = 85
    if (b.roadTaxPayableDay === undefined) b.roadTaxPayableDay = s.day + 365
    if (b.lastMajorServiceOdo === undefined) b.lastMajorServiceOdo = b.lastServiceOdo
    if (b.lastOverhaulDay === undefined) b.lastOverhaulDay = b.acquiredDay
    if (b.lastOverhaulOdo === undefined) b.lastOverhaulOdo = b.lastServiceOdo
    if (b.gpsDeviceFitted === undefined) b.gpsDeviceFitted = true
    if (b.pucExpiryDay === undefined) b.pucExpiryDay = s.day + 180
    if (b.fitnessFailed === undefined) b.fitnessFailed = false
    const m = BUS_MODELS[b.modelId]
    const isSleeper = m?.sleeper || m?.layout?.kind === 'sleeper' || m?.layout?.kind === 'hybrid' || m?.cls === 'AC_HYBRID' || m?.cls === 'AC_SLEEPER'
    if (b.tyreCount === undefined) b.tyreCount = isSleeper ? 10 : 6
    if (b.frontTyreKm === undefined) b.frontTyreKm = b.tyreKm ?? 0
    if (b.rearTyreKm === undefined) b.rearTyreKm = b.tyreKm ?? 0
    if (b.frontBrand === undefined) b.frontBrand = 'oem'
    if (b.rearBrand === undefined) b.rearBrand = b.tyresRetreaded ? 'retread' : 'oem'
    if ((b as { tyrePressure?: unknown }).tyrePressure !== undefined) delete (b as { tyrePressure?: unknown }).tyrePressure
    // Drop overnight short-haul "in transit" flags from the first pass of this feature.
    if (b.inTransitUntilDay !== undefined && b.inTransitUntilDay <= s.day + 1) {
      if (b.inTransitToCityId) b.parkedCityId = b.inTransitToCityId
      b.inTransitUntilDay = undefined
      b.inTransitToCityId = undefined
      b.inTransitFromCityId = undefined
    }
    if (b.parkedCityId === undefined) b.parkedCityId = s.company?.homeCityId ?? 'maa'
    if (b.ownership === 'owned' && !b.depreciationMethod) b.depreciationMethod = 'SLM'
    if (b.cargoVolumeCbm === undefined) {
      const seats = m?.seats ?? 36
      b.cargoVolumeCbm = m?.cargoVolumeCbm ?? (seats < 30 ? 4 : seats < 45 ? 8 : 12)
    } else if (m?.cargoVolumeCbm && isCargoModel(m.id) && b.cargoVolumeCbm < m.cargoVolumeCbm) {
      b.cargoVolumeCbm = m.cargoVolumeCbm
    }
    delete (b as any).reefer
    if ((b.status as string) === 'charter') {
      b.status = 'active'
      delete (b as { charterKind?: unknown }).charterKind
      delete (b as { charterUntilDay?: unknown }).charterUntilDay
    }
    if (RETIRED_MODEL_MAP[b.modelId]) b.modelId = RETIRED_MODEL_MAP[b.modelId]
  }
  for (const o of s.busOrders ?? []) {
    if (RETIRED_MODEL_MAP[o.modelId]) o.modelId = RETIRED_MODEL_MAP[o.modelId]
  }
  s.usedMarket = (s.usedMarket ?? []).filter((l) => Boolean(BUS_MODELS[l.modelId]))
  for (const l of s.usedMarket) {
    const fair = usedPrice(l.modelId, l.ageYears, l.bodyDesignId, s)
    if (fair > 0 && (l.askPrice < fair * 0.85 || l.askPrice > fair * 1.15)) {
      const rng = rngFor(s.seed, 'reanchor-used', l.id)
      l.askPrice = Math.round(rJitter(rng, fair, 0.05) * (l.accidentHistory ? 0.95 : 1))
    }
  }
  s.leaseOffers = (s.leaseOffers ?? []).filter((o) => Boolean(BUS_MODELS[o.modelId]))
  s.attachOffers = (s.attachOffers ?? []).filter((o) => Boolean(BUS_MODELS[o.modelId]))
  delete (s as { charterJobs?: unknown }).charterJobs
  delete (s as { charterRefreshDay?: unknown }).charterRefreshDay
  for (const l of Object.values(s.loans ?? {})) {
    if (!l.kind) l.kind = 'vehicle'
  }
  if (!s.bodyBuilders || Object.keys(s.bodyBuilders).length === 0) {
    s.bodyBuilders = cloneDefaultBodyBuilders()
  }
  for (const b of Object.values(s.buses ?? {})) {
    if (b.bodyDesignId && !b.bodyDesignName) {
      b.bodyDesignName = getDesign(s, b.bodyDesignId)?.name
    }
  }
  if (!s.workshop) s.workshop = { level: 0, bays: 0, mechanicIds: [], locations: [] }
  if (!s.workshop.mechanicIds) s.workshop.mechanicIds = []
  if (!s.workshop.locations || s.workshop.locations.length === 0) {
    if (s.workshop.bays > 0 || s.workshop.level > 0) {
      s.workshop.locations = [
        {
          id: 'loc_hq',
          cityId: s.company.homeCityId,
          groupIds: [],
          bayCount: s.workshop.bays || 1,
        },
      ]
    } else {
      s.workshop.locations = []
    }
  }
  if (s.workshop.locations.length > 0) {
    s.workshop.bays = s.workshop.locations.reduce((sum, l) => sum + l.bayCount, 0)
  }
  if (!s.yards) s.yards = []
  if (!s.company.lenderRelations) s.company.lenderRelations = {}
  if (!s.company.serviceSpendByTier) s.company.serviceSpendByTier = { a: 0, b: 0, overhaul: 0 }
  if (!s.company.serviceCountByTier) s.company.serviceCountByTier = { a: 0, b: 0, overhaul: 0 }
  if (!s.company.workshopTyreBrand) s.company.workshopTyreBrand = 'oem'
  // Idle buses are the cover pool — drop legacy "designate as spare" duty
  for (const b of Object.values(s.buses ?? {})) {
    if (b.duty === 'spare') b.duty = 'line'
    // Auto-link any takeover coach that was acquired without schedule assignment
    if ((b.nickname?.includes('Takover') || b.nickname?.includes('Takeover')) && !b.scheduleId) {
      const unassignedSch = Object.values(s.schedules ?? {}).find((sc) => sc.busIds.length === 0 && s.permits[sc.routeId]?.status === 'active')
      if (unassignedSch) {
        unassignedSch.busIds.push(b.id)
        b.scheduleId = unassignedSch.id
        b.status = 'active'
        b.duty = 'line'
        for (const st of Object.values(s.staff ?? {})) {
          if (st.name?.includes('Rival Ex-') && !st.busId) {
            st.busId = b.id
            if (st.role === 'driver' || st.role === 'co_driver') st.duty = 'line'
          }
        }
      }
    }
  }
  for (const st of Object.values(s.staff ?? {})) {
    if (st.role === 'driver' && !st.duty) st.duty = st.busId ? 'line' : 'spare'
  }
  // Ensure bidirectional parked cities and fix open trips for 2-bus paired services
  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.paired || (sch.busIds?.length ?? 0) < 2) continue
    const route = ROUTES[sch.routeId]
    if (!route) continue
    const b0 = s.buses[sch.busIds[0]]
    const b1 = s.buses[sch.busIds[1]]
    if (b0 && !b0.parkedCityId) b0.parkedCityId = route.from
    if (b1) {
      if (!b1.parkedCityId || b1.parkedCityId === route.from) {
        b1.parkedCityId = route.to
      }
      for (const t of Object.values(s.trips ?? {})) {
        if (t.busId === b1.id && t.scheduleId === sch.id && t.status === 'open') {
          if (t.depHour === sch.depHour && (t.depMin ?? 0) === (sch.depMin ?? 0) && t.direction === 'AB') {
            delete s.trips[t.id]
            t.direction = 'BA'
            t.id = `tr_${sch.id}_${b1.id}_${t.day}_BA`
            s.trips[t.id] = t
          } else if (sch.returnDepHour !== undefined && t.depHour === sch.returnDepHour && (t.depMin ?? 0) === (sch.returnDepMin ?? 0) && t.direction === 'BA') {
            delete s.trips[t.id]
            t.direction = 'AB'
            t.id = `tr_${sch.id}_${b1.id}_${t.day}_AB`
            s.trips[t.id] = t
          }
        }
      }
    }
  }
  s.openTripIds = Object.values(s.trips ?? {}).filter((t) => t.status === 'open').map((t) => t.id)
  // Unpack seat sales before regenerating boards — packed saves omit `trip.seats`
  // and releaseStale/clearTripBookings must not crash on undefined.
  hydratePackedState(s)
  pruneInvalidSeasonalTrips(s)
  try {
    generateTrips(s)
  } catch (err) {
    console.error('migrate: generateTrips failed', err)
  }
  staffing.migrateStaffRoles(s)
  if (!s.company.deskAssistants) s.company.deskAssistants = {}
  if (s.version < 2) {
    for (const st of Object.values(s.staff ?? {})) {
      if (st.role === 'driver') st.salary = Math.round(st.salary / 2)
    }
    for (const c of s.hiringPool ?? []) {
      if (c.role === 'driver') c.salary = Math.round(c.salary / 2)
    }
    s.migrationImmunityUntilDay = s.day + 7
    s.pendingMigrationNotice = 'Game Updated: Driver salary scales have been rebalanced. Review your payroll in the Staff tab.'
    s.pendingMigrationInboxEntry = true
  }
  if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
  if (typeof s.config.odoHighlightKm !== 'number' || !Number.isFinite(s.config.odoHighlightKm)) {
    s.config.odoHighlightKm = BAL.odoHighlightDefaultKm
  }
  if (s.config.autoRenewDocs === undefined) s.config.autoRenewDocs = true
  if (typeof s.config.cargoBaseRateRs !== 'number' || !Number.isFinite(s.config.cargoBaseRateRs)) {
    s.config.cargoBaseRateRs = BAL.cargoBaseRateDefaultRs
  }
  s.config.odoHighlightKm = Math.round(Math.max(50_000, Math.min(2_000_000, s.config.odoHighlightKm)))
  s.config.cargoBaseRateRs = Math.round(Math.max(0.5, Math.min(15, s.config.cargoBaseRateRs)) * 10) / 10
  if (s.company.cargoManagerId && !s.staff[s.company.cargoManagerId]) {
    s.company.cargoManagerId = undefined
  }
  if (!s.company.hrAutoHire) {
    s.company.hrAutoHire = { enabled: false, byRole: { driver: [4, 5, 6, 7, 8, 9, 10] } }
  } else {
    staffing.ensureHrAutoHire(s)
  }
  if (!s.company.hrAutoFire) {
    s.company.hrAutoFire = staffing.defaultHrAutoFire()
  } else {
    staffing.ensureHrAutoFire(s)
  }
  if (s.company.opsAutoStaff === undefined) s.company.opsAutoStaff = true
  if (s.company.hrAutoRaise === undefined) s.company.hrAutoRaise = false
  if (s.company.cmvrOffenceCount === undefined) s.company.cmvrOffenceCount = 0
  if (s.company.cmvrSuspendUntilDay === undefined) s.company.cmvrSuspendUntilDay = -1
  if (!s.company.grievances) s.company.grievances = []
  if (s.company.grievanceCount === undefined) s.company.grievanceCount = 0
  if (!s.company.crmPolicy) s.company.crmPolicy = 'ask'
  if (s.company.crmRefundTotal === undefined) s.company.crmRefundTotal = 0
  if (s.company.crmRefundCount === undefined) s.company.crmRefundCount = 0
  if (s.company.grievanceWarnedDay === undefined) s.company.grievanceWarnedDay = -1
  if (s.company.depreciationDefault === undefined) s.company.depreciationDefault = 'SLM'
  if (s.company.gstInputCredit === undefined) s.company.gstInputCredit = 0
  if (s.company.tdsPayable === undefined) s.company.tdsPayable = 0
  // Income tax is provided and paid monthly; these carry the running FY figures.
  if (s.company.taxProvision === undefined) s.company.taxProvision = 0
  if (s.company.advanceTaxPaid === undefined) s.company.advanceTaxPaid = 0
  if (s.company.fyProfit === undefined) s.company.fyProfit = 0
  if (!s.world.rivals) s.world.rivals = { ...RIVALS_DATA }
  if (!s.world.share) {
    s.world.share = Object.fromEntries(
      ROUTE_LIST.map((r) => [
        r.id,
        seedRouteShare(
          r.id,
          r.competition,
          RIVALS[r.id],
          s.permits[r.id]?.status === 'active' ? Math.round((1 - r.competition) * 40) : 0,
        ),
      ]),
    )
  } else {
    // Reset player share to 0 on routes where player holds no active permit
    for (const r of ROUTE_LIST) {
      const permit = s.permits[r.id]
      if (permit?.status !== 'active') {
        const curShare = s.world.share[r.id]
        if (curShare && curShare.player > 0) {
          curShare.player = 0
          const remaining = 100
          const rEntries = Object.entries(curShare.byRival)
          const shareEach = Math.floor(remaining / Math.max(1, rEntries.length))
          let rem = remaining - shareEach * rEntries.length
          for (const [rid] of rEntries) {
            const extra = rem > 0 ? 1 : 0
            if (rem > 0) rem--
            curShare.byRival[rid] = shareEach + extra
          }
        }
      }
    }
  }
  if (!s.world.shareHistory) s.world.shareHistory = {}
  for (const st of Object.values(s.staff ?? {})) {
    if (st.cmvrHoursToday === undefined) st.cmvrHoursToday = 0
    if (st.role === 'driver' || st.role === 'co_driver') {
      if (!st.licenceClass || (st.licenceClass as string) === 'HMV') {
        st.licenceClass = 'HMV_PSV'
      }
      if (!st.drivingStyle || (st.drivingStyle as string) === 'normal') {
        st.drivingStyle = 'cautious'
      }
    }
    if (st.role === 'mechanic' && !st.mechanicTrade) {
      st.mechanicTrade = 'general'
    }
  }
  for (const c of s.hiringPool ?? []) {
    if (c.role === 'driver' || c.role === 'co_driver') {
      if (!c.licenceClass || (c.licenceClass as string) === 'HMV') {
        c.licenceClass = 'HMV_PSV'
      }
      if (!c.drivingStyle || (c.drivingStyle as string) === 'normal') {
        c.drivingStyle = 'cautious'
      }
    }
    if (c.role === 'mechanic' && !c.mechanicTrade) {
      c.mechanicTrade = 'general'
    }
  }
  if (s.company?.hrAutoHire) {
    if (s.company.hrAutoHire.drivingStyle) {
      s.company.hrAutoHire.drivingStyle = s.company.hrAutoHire.drivingStyle.filter((x: string) => x !== 'normal') as any
    }
    if (s.company.hrAutoHire.licenceClass) {
      s.company.hrAutoHire.licenceClass = s.company.hrAutoHire.licenceClass.filter((x: string) => x !== 'HMV') as any
    }
  }
  if (s.company?.cargoCargoType && (s.company.cargoCargoType as string) === 'pharma_dairy') {
    s.company.cargoCargoType = 'mixed'
  }
  // Purge any legacy competitor dissolve / rival route exit buyout decisions
  s.decisions = (s.decisions ?? []).filter((d) => d.kind !== 'rival_route_exit')
  if (s.config) {
    if (s.config.mealAllowance === undefined) s.config.mealAllowance = false
    if (s.config.healthCoverage === undefined) s.config.healthCoverage = false
    if (s.config.festivalBonus === undefined) s.config.festivalBonus = true
  }
  for (const sch of Object.values(s.schedules ?? {})) {
    if (sch.festivalOnly) {
      if (!sch.outboundDuty) sch.outboundDuty = 'festival'
      if (!sch.returnDuty) sch.returnDuty = 'festival'
    } else {
      if (!sch.outboundDuty) sch.outboundDuty = 'daily'
      if (!sch.returnDuty) sch.returnDuty = 'daily'
    }
    sch.festivalOnly = sch.paired ? (sch.outboundDuty === 'festival' && sch.returnDuty === 'festival') : (sch.outboundDuty === 'festival')
  }
  if (s.version < 3) {
    fleet.refreshMarkets(s)
  }
  for (const st of Object.values(s.routeStats ?? {})) {
    if (!st.byLayout) st.byLayout = {}
  }
  if (s.version < 4) {
    // Seed layout occupancy from trips still in memory; apportion route P&L by seat-km share.
    for (const [rid, rst] of Object.entries(s.routeStats ?? {})) {
      const hasLayTrips = Object.values(rst.byLayout).some((l) => l.trips > 0)
      if (hasLayTrips) continue
      const route = ROUTES[rid]
      if (!route) continue
      for (const t of Object.values(s.trips ?? {})) {
        if (t.status !== 'completed' || t.routeId !== rid) continue
        const bus = s.buses[t.busId]
        if (!bus) continue
        const key = layoutKey(bus.modelId)
        const lay = (rst.byLayout[key] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
        const cap = t.seatCount || t.seats.length
        lay.trips++
        lay.seatKm += cap * route.km
        lay.paxKm += t.sold * route.km
      }
      let seatTotal = 0
      for (const lay of Object.values(rst.byLayout)) seatTotal += lay.seatKm
      if (seatTotal <= 0) continue
      for (const lay of Object.values(rst.byLayout)) {
        const share = lay.seatKm / seatTotal
        lay.revenue = Math.round(rst.revenue * share)
        lay.cost = Math.round(rst.cost * share)
      }
    }
  }
  // Legacy distress lot decisions migration (BF-08): ensure items[] is populated
  for (const d of s.decisions ?? []) {
    if (d.kind === 'distress_lot' && d.data?.lot) {
      const lot = d.data.lot as { modelId?: string; items?: { modelId: string; count: number; age: number }[]; count: number; age: number }
      if ((!lot.items || lot.items.length === 0) && lot.modelId) {
        lot.items = [{ modelId: lot.modelId, count: lot.count, age: lot.age }]
      }
    }
  }

  for (const sch of Object.values(s.schedules ?? {})) {
    if (!sch.occRecent) sch.occRecent = []
    if (sch.paired && !sch.occRecentReturn) sch.occRecentReturn = []
    // Old festivalUntilDay mounts → festival-only services
    if (!sch.festivalOnly && (sch.festivalUntilDay ?? 0) >= s.day) {
      sch.festivalOnly = true
      sch.festivalUntilDay = undefined
    }
    delete sch.slotLockedUntilDay
  }
  // Fleet-wide sell-on: normalize flags (RedBus / AbhiBus / app / counter) and sync.
  if (s.config?.scheduleDefaults?.channels) {
    s.config.scheduleDefaults.channels = normalizeChannels(s.config.scheduleDefaults.channels)
  }
  schedules.syncScheduleChannels(s)
  for (const t of Object.values(s.trips ?? {})) {
    t.channelSold = { ...emptyChannelSold(), ...t.channelSold }
  }
  if (s.version < 5) {
    for (const t of Object.values(s.trips ?? {})) {
      if (t.status !== 'completed') continue
      const cap = t.seatCount || t.seats.length
      if (cap <= 0) continue
      schedules.recordScheduleOcc(s, t.scheduleId, t.day, t.sold, cap, t.direction, t.depHour, t.depMin)
    }
  }
  if (!s.routeHistory) s.routeHistory = {}
  if (s.version < 6) {
    // Seed recent history from txns (rev/cost) and completed trips (trips/occ).
    for (const t of s.txns ?? []) {
      if (!t.routeId) continue
      const day = t.day
      const list = (s.routeHistory[t.routeId] ??= [])
      let row = list.find((r) => r.day === day)
      if (!row) {
        row = { day, revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0, byLayout: {} }
        list.push(row)
      }
      if (t.kind === 'income') row.revenue += t.amount
      else if (t.kind === 'expense') row.cost += t.amount
      if (t.busId && s.buses[t.busId]) {
        const key = layoutKey(s.buses[t.busId]!.modelId)
        const lay = (row.byLayout[key] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
        if (t.kind === 'income') lay.revenue += t.amount
        else if (t.kind === 'expense') lay.cost += t.amount
      }
    }
    for (const t of Object.values(s.trips ?? {})) {
      if (t.status !== 'completed') continue
      const route = ROUTES[t.routeId]
      const bus = s.buses[t.busId]
      if (!route || !bus) continue
      const cap = t.seatCount || t.seats.length
      const list = (s.routeHistory[t.routeId] ??= [])
      let row = list.find((r) => r.day === t.day)
      if (!row) {
        row = { day: t.day, revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0, byLayout: {} }
        list.push(row)
      }
      row.trips++
      row.seatKm += cap * route.km
      row.paxKm += t.sold * route.km
      const key = layoutKey(bus.modelId)
      const lay = (row.byLayout[key] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
      lay.trips++
      lay.seatKm += cap * route.km
      lay.paxKm += t.sold * route.km
    }
    for (const list of Object.values(s.routeHistory)) {
      list.sort((a, b) => a.day - b.day)
    }
  }
  if (s.version < 7) {
    for (const st of Object.values(s.routeStats ?? {})) mergeByLayoutKeys(st.byLayout)
    for (const list of Object.values(s.routeHistory ?? {})) {
      for (const day of list) mergeByLayoutKeys(day.byLayout)
    }
  }
  if (s.version < 8) {
    if (s.depotSlots == null) s.depotSlots = BAL.depot.baseSlots
    if (!s.insuranceClaims) s.insuranceClaims = []
    if (!s.festivalSpecials) s.festivalSpecials = []
  }
  if (s.version < 9) {
    if (!s.company.homeCityId) {
      const firstPermitRouteId = Object.keys(s.permits ?? {})[0]
      s.company.homeCityId = firstPermitRouteId && ROUTES[firstPermitRouteId]
        ? ROUTES[firstPermitRouteId].from
        : 'maa'
    }
    if (!s.company.crmPolicy) s.company.crmPolicy = 'ask'
  if (s.company.crmRefundTotal === undefined) s.company.crmRefundTotal = 0
  if (s.company.crmRefundCount === undefined) s.company.crmRefundCount = 0
    if (s.company.grievanceCount === undefined) s.company.grievanceCount = 0
    if (s.company.gstInputCredit === undefined) s.company.gstInputCredit = 0
    if (s.company.tdsPayable === undefined) s.company.tdsPayable = 0
    if (s.company.tdsFiledThroughDay === undefined) s.company.tdsFiledThroughDay = 0
    if (s.company.cmvrOffenceCount === undefined) s.company.cmvrOffenceCount = 0
    if (s.company.cmvrSuspendUntilDay === undefined) s.company.cmvrSuspendUntilDay = -1
    if (!s.company.depreciationDefault) s.company.depreciationDefault = 'SLM'
    if (s.company.safeTripStreak === undefined) s.company.safeTripStreak = 0
    if (s.company.cargoLifeRevenue === undefined) s.company.cargoLifeRevenue = 0
    if (s.config) {
      if (s.config.mealAllowance === undefined) s.config.mealAllowance = false
      if (s.config.healthCoverage === undefined) s.config.healthCoverage = false
      if (s.config.festivalBonus === undefined) s.config.festivalBonus = true
    }
    for (const m of s.inbox ?? []) {
      if (m.read === undefined) m.read = true
    }
  }
  for (const st of Object.values(s.routeStats ?? {})) mergeByLayoutKeys(st.byLayout)
  for (const list of Object.values(s.routeHistory ?? {})) {
    for (const day of list) mergeByLayoutKeys(day.byLayout)
  }
  if ((s.hiringPool ?? []).filter((c) => c.role === 'driver').length > 6) {
    staffing.refreshHiringPool(s)
  }
  if (!s.seasonalStats) {
    s.seasonalStats = {
      lifetime: { trips: 0, revenue: 0, expenses: 0, profit: 0, pax: 0, seatKm: 0, paxKm: 0 },
      history: [],
    }
  }
  if (s.version < 10) {
    // Re-evaluate schedule load factor history to reflect realistic haul-clock appeal
    const hasCompleted = Object.values(s.trips ?? {}).some((t) => t.status === 'completed')
    if (hasCompleted) {
      for (const sch of Object.values(s.schedules ?? {})) {
        sch.occRecent = []
        if (sch.paired) sch.occRecentReturn = []
      }
      for (const t of Object.values(s.trips ?? {})) {
        if (t.status !== 'completed') continue
        const cap = t.seatCount || t.seats.length
        if (cap <= 0) continue
        schedules.recordScheduleOcc(s, t.scheduleId, t.day, t.sold, cap, t.direction, t.depHour, t.depMin)
      }
    } else {
      for (const sch of Object.values(s.schedules ?? {})) {
        const route = ROUTES[sch.routeId]
        if (!route) continue
        const outFit = departureTimeFit(route, sch.depHour, sch.depMin)
        if (outFit.isOffPeak && sch.occRecent?.length) {
          for (const row of sch.occRecent) {
            row.sold = Math.max(1, Math.round(row.sold * Math.max(0.28, Math.min(0.95, outFit.appeal / 1.05))))
          }
        }
        if (sch.paired && sch.returnDepHour !== undefined) {
          const retFit = departureTimeFit(route, sch.returnDepHour, sch.returnDepMin)
          if (retFit.isOffPeak && sch.occRecentReturn?.length) {
            for (const row of sch.occRecentReturn) {
              row.sold = Math.max(1, Math.round(row.sold * Math.max(0.28, Math.min(0.95, retFit.appeal / 1.05))))
            }
          }
        }
      }
    }
  }

  if (s.version < 11) {
    // Re-evaluate schedule load factor history to reflect realistic layout duration preference
    // (e.g. 13h long haul semi-sleeper dropped from 90% down to ~28-34%)
    for (const sch of Object.values(s.schedules ?? {})) {
      const route = ROUTES[sch.routeId]
      const bus = s.buses[sch.busIds?.[0] ?? '']
      const model = bus ? BUS_MODELS[bus.modelId] : undefined
      if (!route || !model) continue
      const layoutMult = haulLayoutAppeal(model.cls, route.hours)
      if (layoutMult < 0.75) {
        const scaleDown = Math.pow(layoutMult, 1.25)
        if (sch.occRecent?.length) {
          for (const row of sch.occRecent) {
            row.sold = Math.max(1, Math.min(row.sold, Math.round(row.sold * scaleDown)))
          }
        }
        if (sch.occRecentReturn?.length) {
          for (const row of sch.occRecentReturn) {
            row.sold = Math.max(1, Math.min(row.sold, Math.round(row.sold * scaleDown)))
          }
        }
      }
    }
  }

  if (s.version < 12) {
    // Re-evaluate schedule load factor history & completed trips to reflect realistic day-type occupancy ranges
    // (normal weekdays vs weekends vs festivals)
    for (const sch of Object.values(s.schedules ?? {})) {
      const route = ROUTES[sch.routeId]
      const bus = s.buses[sch.busIds?.[0] ?? '']
      const model = bus ? BUS_MODELS[bus.modelId] : undefined
      if (!route || !model) continue
      const qScore = bus.qualityScore ?? 3.5

      const rescaleBucket = (rows: { day: number; sold: number; seats: number }[], dir: 'AB' | 'BA') => {
        for (const row of rows) {
          const cap = row.seats || 30
          if (cap <= 0) continue
          const [minLf, maxLf] = getDirectionalOccupancyRange(model.cls, qScore, route, dir, row.day)
          const curSold = row.sold
          const curLf = curSold / cap
          if (curLf > maxLf) {
            row.sold = Math.max(1, Math.min(cap, Math.round(cap * (minLf + (maxLf - minLf) * 0.55))))
          } else if (curLf < minLf) {
            row.sold = Math.max(1, Math.min(cap, Math.round(cap * minLf)))
          }
        }
      }

      if (sch.occRecent?.length) rescaleBucket(sch.occRecent, 'AB')
      if (sch.occRecentReturn?.length && sch.returnDepHour !== undefined) {
        rescaleBucket(sch.occRecentReturn, 'BA')
      }
    }

    for (const t of Object.values(s.trips ?? {})) {
      if (t.status !== 'completed') continue
      const cap = t.seatCount || t.seats?.length || 30
      if (cap <= 0) continue
      const route = ROUTES[t.routeId]
      const bus = s.buses[t.busId]
      const model = bus ? BUS_MODELS[bus.modelId] : undefined
      if (!route || !model) continue
      const qScore = bus.qualityScore ?? 3.5
      const [minLf, maxLf] = getDirectionalOccupancyRange(model.cls, qScore, route, t.direction, t.day)
      const curLf = t.sold / cap
      if (curLf > maxLf) {
        t.sold = Math.max(1, Math.min(cap, Math.round(cap * (minLf + (maxLf - minLf) * 0.55))))
      } else if (curLf < minLf) {
        t.sold = Math.max(1, Math.min(cap, Math.round(cap * minLf)))
      }
    }
  }

  // Migrate legacy route IDs
  migrateLegacyRouteIds(s)

  if (s.version < 13) {
    cargoSim.migrateCargoContracts(s)
    cargoSim.backfillCargoLaneHistory(s)
  }
  if (s.version < 14) cargoSim.migrateCargoLoadingBreakdown(s)
  if (s.version < 15 && Math.abs((s.config?.cargoBaseRateRs ?? 0) - 2) < 1e-6) {
    // The parcel desk was priced below the corridor market. Saves still on the old
    // ₹2.00 default move with the new one; a rate the player chose is left alone.
    s.config.cargoBaseRateRs = BAL.cargoBaseRateDefaultRs
    s.pendingMigrationNotice =
      `Game Updated: Cargo demand is deeper and the default parcel rate is now ₹${BAL.cargoBaseRateDefaultRs.toFixed(2)}/kg per 100 km. Check the Cargo tab.`
    s.pendingMigrationInboxEntry = true
  }
  if (s.version < 17) cargoSim.migrateSpotRates(s)
  if (s.version < 18) cargoSim.migrateCargoPermits(s)
  if (s.version < 19) {
    // One vehicle, one service. Older saves could list the same truck on two
    // schedules so it ran both directions at the same clock time.
    const fixed = schedules.sanitizeScheduleAssignments(s)
    if (fixed > 0) {
      s.pendingMigrationNotice =
        'Game Updated: a vehicle was listed on more than one departure at the same time — the extra duty has been released and its un-run trips cancelled. Re-assign a second vehicle if you want both directions running.'
      s.pendingMigrationInboxEntry = true
    }
  }
  if (s.version < 20) {
    // Ladies seats are held for ladies on every service — the per-schedule
    // toggle and its violation bookkeeping are gone.
    for (const sch of Object.values(s.schedules ?? {})) {
      delete (sch as { strictLadiesPolicy?: unknown }).strictLadiesPolicy
    }
    for (const b of Object.values(s.buses ?? {})) {
      delete (b as { ladiesComplaints?: unknown }).ladiesComplaints
    }
  }

  const fromVersion = s.version
  compactTrips(s)
  // Seat maps already hydrated earlier (before generateTrips); keep a second
  // pass in case compactTrips introduced packed rows.
  hydratePackedState(s)
  if (fromVersion < 22) {
    // Two board defects were fixed here: a paired service whose return cleared
    // midnight only sold one direction, and swapping a coach left its stale or
    // cancelled leg blocking the replacement's bookings.
    const changed = schedules.repairTripBoards(s)
    if (changed > 0) {
      s.pendingMigrationNotice =
        'Game Updated: trip boards have been rebuilt. Every schedule now offers the departures its current coaches can actually run — including coaches swapped in since the last save.'
      s.pendingMigrationInboxEntry = true
    }
  }
  if (fromVersion < 23) {
    // Freight services are one-way: drop any 2nd trip an older save had paired
    // onto a cargo run, then rebuild the board so the phantom return closes.
    const unpicked = schedules.unpairCargoSchedules(s)
    if (unpicked > 0) {
      schedules.repairTripBoards(s)
      s.pendingMigrationNotice =
        'Game Updated: cargo services are one-way now — the 2nd trip has been removed from your freight schedules and any return departures closed.'
      s.pendingMigrationInboxEntry = true
    }
  }
  if (fromVersion < 24) {
    // Cargo boards carry a single truck each — older saves listed two, which read
    // as the same freight option offered twice.
    if (s.company.dedicatedCargoSubsidiary) fleet.syncCargoListings(s)
  }

  // Re-quote any pending festival charter decisions with corrected profitable tariffs
  for (const d of s.decisions ?? []) {
    if (d.kind === 'festival_charter') {
      const busId = d.data?.busId as ID | undefined
      const routeId = (d.data?.routeId as string | undefined) || ROUTE_LIST[0]?.id
      const bus = busId ? s.buses?.[busId] : undefined
      const route = routeId ? ROUTES[routeId] : undefined
      if (bus && route) {
        const q = festival.calculateCharterQuote(s, bus, route)
        d.data = { ...d.data, ...q }
        d.title = `Festival Group Charter Request (${bus.reg})`
        const coachKindStr = q.coachType === 'semi' ? 'Semi-sleeper' : q.coachType === 'hybrid' ? 'Hybrid' : 'Sleeper'
        d.body = `A private tour group in our depot city (${cityName(route.from)}) wants to hire ${bus.reg} (${bus.modelId}, ${q.seats} seats) for a return charter to ${cityName(route.to)} (${routeName(route.id)}, ${q.roundTripKm} km roundtrip).\n\nContract Value: ${fmtCompact(q.fee)} · Est. Operating Costs (Diesel, Tolls, Bata): ${fmtCompact(q.totalExpenses)} · Net Profit: +${fmtCompact(q.profit)} (Rate: ₹${q.ratePerKm}/km). (${coachKindStr} coach). An appointed Schedules & Festivals Manager auto-accepts these charters.`
        d.options = [
          { id: 'accept', key: 'accept', label: `Accept charter (+${fmtCompact(q.profit)} net)` },
          { id: 'refuse', key: 'refuse', label: 'Refuse charter' },
        ]
      }
    }
  }

  // Backfill realistic operating expenses for existing charter records that have expenses === 0
  if (s.seasonalStats?.history) {
    for (const r of s.seasonalStats.history) {
      if (r.kind === 'charter' && r.expenses === 0 && r.revenue > 0) {
        const route = ROUTES[r.routeId]
        const roundTripKm = (route ? route.km : 400) * 2
        const bus = s.buses?.[r.busId]
        const model = bus ? BUS_MODELS[bus.modelId] : undefined
        const mileage = model?.mileage || 3.5
        const dieselPaise = s.world?.dieselPaise || 9000
        const fuelCost = model?.electric ? 0 : Math.round((roundTripKm / mileage) * dieselPaise)
        const tollCost = Math.round(roundTripKm * (route?.tollPerKm || 0))
        const bata = 250_000 // rs(2500)
        const otherCosts = Math.round(fuelCost * 0.05) + 60_000 // rs(600)
        const estExp = Math.min(Math.round(r.revenue * 0.52), fuelCost + tollCost + bata + otherCosts)
        r.expenses = estExp
        r.fuelCost = fuelCost
        r.tollCost = tollCost
        r.bata = bata
        r.otherCosts = otherCosts
        r.profit = Math.max(500_000, r.revenue - estExp)
      }
    }
    s.seasonalStats.lifetime.expenses = s.seasonalStats.history.reduce((sum, r) => sum + r.expenses, 0)
    s.seasonalStats.lifetime.profit = s.seasonalStats.history.reduce((sum, r) => sum + r.profit, 0)
  }

  if (s.version < 26) {
    // AL/BB priceNew is now chassis on-road; seed body packages use absolute bodyPrice.
    // Refresh known seed designs still on the old relative (± few lakh) scale.
    if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
    for (const [builderId, defBuilder] of Object.entries(DEFAULT_BODY_BUILDERS)) {
      const live = s.bodyBuilders[builderId]
      if (!live) {
        s.bodyBuilders[builderId] = JSON.parse(JSON.stringify(defBuilder))
        continue
      }
      for (const defDesign of defBuilder.designs) {
        const d = live.designs.find((x) => x.id === defDesign.id)
        if (!d) {
          live.designs.push(JSON.parse(JSON.stringify(defDesign)))
          continue
        }
        if (Math.abs(d.bodyPrice) < L(15)) {
          d.bodyPrice = defDesign.bodyPrice
          d.leadDaysAdd = defDesign.leadDaysAdd
        }
      }
    }
  }

  if (s.version < 27) {
    // Body-builder roster: Prakesh, REC, MG Group (BB-only), ARVEX.
    s.bodyBuilders = cloneDefaultBodyBuilders()
  }

  if (s.version < 28) {
    // Chassis-length fit rules on seed body designs (12M / 13.5M / 15M / 1624…).
    if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
    for (const [builderId, defBuilder] of Object.entries(DEFAULT_BODY_BUILDERS)) {
      if (!s.bodyBuilders[builderId]) {
        s.bodyBuilders[builderId] = JSON.parse(JSON.stringify(defBuilder))
        continue
      }
      for (const defDesign of defBuilder.designs) {
        const live = s.bodyBuilders[builderId].designs.find((d) => d.id === defDesign.id)
        if (!live) {
          s.bodyBuilders[builderId].designs.push(JSON.parse(JSON.stringify(defDesign)))
        } else if (defDesign.chassisNames) {
          live.chassisNames = [...defDesign.chassisNames]
        } else {
          delete live.chassisNames
        }
      }
    }
  }

  if (s.version < 29) {
    // Drop Veera from the body-builder roster.
    s.bodyBuilders = cloneDefaultBodyBuilders()
  }

  if (s.version < 30) {
    // Drop Maruthi from the body-builder roster; keep other custom designs.
    if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
    else {
      delete s.bodyBuilders.maruthi
      for (const [id, def] of Object.entries(DEFAULT_BODY_BUILDERS)) {
        if (!s.bodyBuilders[id]) s.bodyBuilders[id] = JSON.parse(JSON.stringify(def))
      }
    }
  }

  if (s.version < 31) {
    if (s.bodyBuilders) {
      for (const b of Object.values(s.bodyBuilders)) {
        for (const d of b.designs) {
          if (d.secondaryMarket === undefined) d.secondaryMarket = true
        }
      }
    }
  }

  if (s.version < 32) {
    if (s.bodyBuilders) {
      for (const b of Object.values(s.bodyBuilders)) {
        for (const d of b.designs) {
          if (d.availableUsed === undefined) d.availableUsed = d.secondaryMarket !== false
          if (d.availableLeaseAttach === undefined) d.availableLeaseAttach = d.secondaryMarket !== false
        }
      }
    }
  }

  if (s.version < 33) {
    if (s.usedMarket) {
      for (const l of s.usedMarket) {
        const fair = usedPrice(l.modelId, l.ageYears, l.bodyDesignId, s)
        if (fair > 0 && (l.askPrice < fair * 0.85 || l.askPrice > fair * 1.15)) {
          const rng = rngFor(s.seed, 'reanchor-used', l.id)
          l.askPrice = Math.round(rJitter(rng, fair, 0.05) * (l.accidentHistory ? 0.95 : 1))
        }
      }
    }
  }

  charterSim.sanitizeCharterData(s)

  // Rescale existing lounge snack numbers down to 2% if inflated by previous formula
  if (s.company?.lounges) {
    for (const l of s.company.lounges) {
      if (l.yesterdaySnackRevenue > 2_000_000) { // > ₹20,000 / day
        l.yesterdaySnackRevenue = Math.round(l.yesterdaySnackRevenue * 0.02)
        const totalOpex = (l.yesterdayRentExpense ?? 0) + (l.yesterdayElectricExpense ?? 0) + (l.yesterdayStaffExpense ?? 0)
        l.yesterdayNetProfit = l.yesterdaySnackRevenue - totalOpex
      }
      if (l.lifetimeRevenue > 5_000_000) { // > ₹50,000
        l.lifetimeRevenue = Math.round(l.lifetimeRevenue * 0.02)
      }
    }
  }
  s.version = SAVE_VERSION
  return s
}

export const useGame = create<GameStore>()(
  immer((set, get) => ({
    state: null,
    toasts: [],
    busy: false,
    skipProgress: null,
    skipStopReason: null,
    uiPrefs: loadUiPrefs(),

    startNew: (name, difficulty, homeRouteId, scenario = 'standard') => {
      setActiveCloudSaveId(null)
      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
      const shared = getSharedBodyBuildersSync()
      const trimmed = name?.trim()
      if (!trimmed) return
      const s = newGame(trimmed, difficulty, homeRouteId, seed, shared ?? undefined, scenario)
      const { bodyBuilders } = syncStateBodyBuildersWithShared(s.bodyBuilders)
      s.bodyBuilders = bodyBuilders
      const validPrefs = sanitizeUiPrefs(get().uiPrefs, s)
      dropPendingSave()
      set({ state: s, skipStopReason: null, uiPrefs: validPrefs })
      persist(s)
    },

    hasSave: () => hasSaveBlob(),

    loadSave: () => {
      try {
        const raw = readSave()
        if (!raw) return false
        const s = migrate(decodeSaveString(raw))
        if (!s) return false
        const { bodyBuilders, changed } = syncStateBodyBuildersWithShared(s.bodyBuilders)
        s.bodyBuilders = bodyBuilders
        if (changed) {
          saveSharedBodyDesigns(bodyBuilders).catch(() => {})
        }
        schedules.pruneRetiredRoutes(s)
        // A save written before the data budget existed can carry years of
        // ledger rows and resolved claims; trim it as soon as it is loaded.
        retainDay(s)
        const notice = s.pendingMigrationNotice
        if (notice) {
          s.pendingMigrationNotice = undefined
          setTimeout(() => get().toast(notice, 'warn'), 300)
        }
        const validPrefs = sanitizeUiPrefs(get().uiPrefs, s)
        dropPendingSave()
        set({ state: s, skipStopReason: null, uiPrefs: validPrefs })
        return true
      } catch (err) {
        console.error('loadSave failed', err)
        return false
      }
    },

    importSaveJson: (text) => {
      const live = get().state
      if (live?.scenario === 'ironman' && !live.gameOver) {
        return { ok: false, persisted: false, error: 'Ironman: you cannot load another save over a running game.' }
      }
      try {
        skipInFlight = false
        const parsed = decodeSaveString(text)
        const s = migrate(parsed)
        if (!s) return { ok: false, persisted: false, error: 'That file is not a valid save.' }
        const { bodyBuilders, changed } = syncStateBodyBuildersWithShared(s.bodyBuilders)
        s.bodyBuilders = bodyBuilders
        if (changed) {
          saveSharedBodyDesigns(bodyBuilders).catch(() => {})
        }
        schedules.pruneRetiredRoutes(s)
        retainDay(s)
        const notice = s.pendingMigrationNotice
        if (notice) {
          s.pendingMigrationNotice = undefined
          setTimeout(() => get().toast(notice, 'warn'), 300)
        }
        const validPrefs = sanitizeUiPrefs(get().uiPrefs, s)
        dropPendingSave()
        set({ state: s, skipStopReason: null, uiPrefs: validPrefs })
        // Free the old save slot before writing — storage was often already full
        clearSaveStores()
        setActiveCloudSaveId(null)
        const persisted = persist(s)
        return { ok: true, persisted }
      } catch (e) {
        const msg = e instanceof SyntaxError
          ? 'File is not valid JSON.'
          : 'Could not import that file.'
        return { ok: false, persisted: false, error: msg }
      }
    },

    exportSaveJson: () => {
      const live = get().state
      if (!live) return null
      const clone = shrinkForStorage(structuredClone(live) as GameState, 'medium')
      return encodeSaveString(clone)
    },

    save: () => persist(get().state),

    compactSave: () => {
      const live = get().state
      if (!live) return false
      // Copy first: `shrinkForStorage` mutates, and the UI is still rendering
      // the live object. This is an explicit player action, so the extra copy
      // is fine — it exists to make every *automatic* save cheap.
      const compact = shrinkForStorage(structuredClone(live) as GameState, 'medium')
      set({ state: compact, skipStopReason: null })
      return persist(compact, { alreadyMutable: true })
    },

    abandon: () => {
      dropPendingSave()
      clearSaveStores()
      setActiveCloudSaveId(null)
      set({ state: null, skipStopReason: null })
    },

    resetToNewGame: () => {
      skipInFlight = false
      dropPendingSave()
      clearSaveStores()
      setActiveCloudSaveId(null)
      set({ state: null, skipStopReason: null })
    },

    loadCloudSaveById: async (id: string) => {
      try {
        skipInFlight = false
        const res = await loadCloudSave(id)
        if (!res.ok || !res.dto) {
          return { ok: false, error: res.error ?? 'Could not load cloud save.' }
        }
        const s = migrate(res.dto)
        if (!s) return { ok: false, error: 'That cloud save has an invalid state format.' }
        const { bodyBuilders, changed } = syncStateBodyBuildersWithShared(s.bodyBuilders)
        s.bodyBuilders = bodyBuilders
        if (changed) {
          saveSharedBodyDesigns(bodyBuilders).catch(() => {})
        }
        schedules.pruneRetiredRoutes(s)
        retainDay(s)
        const notice = s.pendingMigrationNotice
        if (notice) {
          s.pendingMigrationNotice = undefined
          setTimeout(() => get().toast(notice, 'warn'), 300)
        }
        const validPrefs = sanitizeUiPrefs(get().uiPrefs, s)
        dropPendingSave()
        set({ state: s, skipStopReason: null, uiPrefs: validPrefs })
        clearSaveStores()
        setActiveCloudSaveId(id)
        persist(s)
        return { ok: true, label: res.label }
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Failed to load cloud save.' }
      }
    },

    saveToNewCloudSlot: async (customLabel?: string) => {
      const live = get().state
      if (!live) return { ok: false, error: 'No active game state to save.' }
      const res = await createCloudSave(live, customLabel)
      return res
    },

    updateActiveCloudSlot: async () => {
      const live = get().state
      const activeId = getActiveCloudSaveId()
      if (!live) return { ok: false, error: 'No active game to save.' }
      if (!activeId) return { ok: false, error: 'No cloud save slot is currently connected.' }
      const res = await appendCloudSave(activeId, live)
      return res
    },

    unlinkActiveCloudSlot: () => {
      saveQueue.cancelCloud()
      setActiveCloudSaveId(null)
    },

    getActiveCloudSlotId: () => getActiveCloudSaveId(),

    advance: (days, stopOnAttention = false) => {
      const prev = get().state
      if (!prev || prev.gameOver) return
      if (skipInFlight) return
      // The engine advances the live state in place, a slice at a time, yielding to the browser
      // between slices so the page keeps painting. Player actions wait until it is done (see
      // `intent`), and screens only re-read the state at day boundaries, when it is consistent.
      const draft = prev
      const startCash = prev.company.cash
      const startRating = prev.company.rating
      const startDay = prev.day
      let stop: string | null = null
      let advanced = 0
      let steps: Generator<void, void, void> | null = null
      // The state object the store holds while this runs (replaced only by a reset or import).
      const live: GameState = prev
      const run = ++advanceRun
      skipInFlight = true
      set({ busy: true, skipProgress: { done: 0, total: days } })

      const commit = (): void => {
        // After a reset, a newer advance may already own the flags: leave them alone.
        if (run !== advanceRun) return
        skipInFlight = false
        // A save import / reset while the advance was yielding: leave the new game alone.
        if (get().state !== live) {
          set({ busy: false, skipProgress: null })
          return
        }
        if (advanced > 0) {
          const nextState = withFreshContainers(draft)
          set({ state: nextState, skipStopReason: stop, busy: false, skipProgress: null })
          persistSoon(nextState, { alreadyMutable: true })
          if (days > 1 && advanced >= 2) {
            // One-line recap of what a multi-day skip did, so nothing passes unseen.
            const cashDelta = nextState.company.cash - startCash
            const ratingDelta = nextState.company.rating - startRating
            const alerts = (nextState.inbox ?? []).filter((m) => m.day > startDay && m.cat === 'alert').length
            get().toast(
              `${advanced} days: cash ${cashDelta >= 0 ? '+' : '-'}${fmtCompact(Math.abs(cashDelta))} · rating ${nextState.company.rating.toFixed(2)}★ (${ratingDelta >= 0 ? '+' : ''}${ratingDelta.toFixed(2)}) · ${alerts} alert${alerts === 1 ? '' : 's'}`,
              cashDelta >= 0 && alerts === 0 ? 'good' : cashDelta < 0 ? 'bad' : 'warn',
            )
          }
          return
        }
        set({ busy: false, skipProgress: null, skipStopReason: stop })
      }

      const runSlice = (): void => {
        if (run !== advanceRun) return
        if (get().state !== live) {
          commit()
          return
        }
        const sliceStart = performance.now()
        try {
          while (advanced < days && !stop) {
            if (!steps) steps = advanceDaySteps(draft)
            if (!steps.next().done) {
              if (performance.now() - sliceStart > ADVANCE_SLICE_MS) break
              continue
            }
            // A whole day is done: the state is consistent again.
            steps = null
            advanced++
            if (draft.gameOver) {
              stop = 'Game Over'
              break
            }
            if (stopOnAttention && advanced < days) {
              const attn = needsAttention(draft)
              if (attn) {
                stop = attn
                break
              }
            }
            if (days > 1 && advanced < days) {
              // Only the small progress readout updates mid-week. Re-rendering every page after
              // each day cost more than the day itself; the pages update once at the end.
              set({ skipProgress: { done: advanced, total: days } })
            }
            if (performance.now() - sliceStart > ADVANCE_SLICE_MS) break
          }
        } catch (err: any) {
          console.error('advanceDay error:', err)
          stop = `Error: ${err?.message || err}`
          get().toast(`Simulation paused: ${err?.message || err}`, 'bad')
          // Whole days before the failure are kept; the failed day is not counted in the recap.
          steps = null
          commit()
          return
        }
        if ((advanced < days || steps) && !stop) {
          yieldToBrowser(runSlice)
          return
        }
        commit()
      }
      runSlice()
    },

    toast: (text, kind = 'info') => {
      const id = toastSeq++
      set((st) => {
        st.toasts.push({ id, text, kind })
        if (st.toasts.length > 4) st.toasts.shift()
      })
      setTimeout(() => get().dismissToast(id), 5000)
    },

    dismissToast: (id) => set((st) => {
      st.toasts = st.toasts.filter((t) => t.id !== id)
    }),

    intent: (fn, successMsg) => {
      // The engine is part-way through a day or week; acting now would land mid-day.
      if (skipInFlight) {
        get().toast('Wait for the simulation to finish.', 'warn')
        return false
      }
      let err: string | null = null
      set((st) => {
        if (!st.state) return
        err = fn(st.state as GameState)
        // A vehicle may only serve one service — repair any legacy double duty
        // before the action's outcome is persisted.
        if (err === null) schedules.sanitizeScheduleAssignments(st.state as GameState)
        // compactTrips must run inside the draft — get().state is frozen after set() exits
        if (err === null) compactTrips(st.state as GameState)
      })
      if (err) {
        get().toast(err, 'bad')
        return false
      }
      if (successMsg) get().toast(successMsg, 'good')
      persist(get().state)
      return true
    },


    inspectListing: (id) => get().intent((s) => fleet.inspectListing(s, id)),
    buyUsed: (id, plan, groupId) => get().intent((s) => fleet.buyUsed(s, id, plan, groupId)),
    orderNewBus: (modelId, plan, groupId, bodyDesignId) => get().intent((s) => fleet.orderNewBus(s, modelId, plan, groupId, bodyDesignId)),
    startLease: (id, groupId) => get().intent((s) => fleet.startLease(s, id, groupId)),
    endLease: (busId) => get().intent((s) => fleet.endLease(s, busId)),
    signAttach: (id, groupId) => get().intent((s) => fleet.signAttach(s, id, groupId)),
    releaseAttach: (busId) => get().intent((s) => fleet.releaseAttach(s, busId)),

    setFleetGroupFilter: (id) => {
      set((st) => {
        st.uiPrefs.fleetGroupId = id
      })
      saveUiPrefs({ fleetGroupId: id })
    },
    createGroup: (input) => {
      let res: { id: ID } | { error: string } = { error: 'No state' }
      get().intent((s) => {
        res = groups.createGroup(s, input)
        return 'error' in res ? res.error : null
      }, 'Brand created.')
      return res
    },
    updateGroup: (id, patch) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.updateGroup(s, id, patch)
        if (!err && patch.defaultCancellation !== undefined) {
          for (const sch of Object.values(s.schedules ?? {})) {
            if (sch.groupId === id) sch.cancellation = patch.defaultCancellation
          }
        }
        return err
      }, 'Brand updated.')
      return err
    },
    launchBrandCampaign: (groupId, input) => {
      let err: string | null = null
      get().intent((s) => {
        err = brandActions.launchCampaign(s, groupId, input)
        return err
      }, 'Campaign launched.')
      return err
    },
    stopBrandCampaign: (groupId, campaignId) => {
      let err: string | null = null
      get().intent((s) => {
        err = brandActions.stopCampaign(s, groupId, campaignId)
        return err
      }, 'Campaign stopped.')
      return err
    },
    transferCoaches: (busIds, toGroupId, rebrand) => {
      let err: string | null = null
      get().intent((s) => {
        err = brandActions.transferCoaches(s, busIds, toGroupId, rebrand)
        return err
      }, 'Coaches moved.')
      return err
    },
    mergeBrands: (fromId, intoId) => {
      let err: string | null = null
      get().intent((s) => {
        err = brandActions.mergeBrands(s, fromId, intoId)
        return err
      }, 'Brands merged.')
      if (!err && get().uiPrefs.fleetGroupId === fromId) get().setFleetGroupFilter('all')
      return err
    },
    spinOffBrand: (input) => {
      let res: { id: ID } | { error: string } = { error: 'No state' }
      get().intent((s) => {
        res = brandActions.spinOffBrand(s, input)
        return 'error' in res ? res.error : null
      }, 'New brand created.')
      return res
    },
    sellBrand: (groupId, opts) => {
      let err: string | null = null
      get().intent((s) => {
        err = brandActions.sellBrand(s, groupId, opts)
        return err
      }, 'Brand sold.')
      if (!err && get().uiPrefs.fleetGroupId === groupId) get().setFleetGroupFilter('all')
      return err
    },
    retireGroup: (id, moveTo) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.retireGroup(s, id, moveTo)
        return err
      }, 'Brand closed.')
      if (!err && get().uiPrefs.fleetGroupId === id) {
        get().setFleetGroupFilter('all')
      }
      return err
    },
    restoreGroup: (id) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.restoreGroup(s, id)
        return err
      }, 'Brand restored.')
      return err
    },
    deleteGroup: (id) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.deleteGroup(s, id)
        return err
      }, 'Brand deleted permanently.')
      if (!err && get().uiPrefs.fleetGroupId === id) {
        get().setFleetGroupFilter('all')
      }
      return err
    },
    assignBusToGroup: (busId, groupId, opts) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.assignBusToGroup(s, busId, groupId, opts)
        return err
      }, 'Coach transferred.')
      return err
    },
    assignScheduleToGroup: (schId, groupId) => {
      let err: string | null = null
      get().intent((s) => {
        err = groups.assignScheduleToGroup(s, schId, groupId)
        return err
      })
      return err
    },
    sellBus: (busId) => get().intent((s) => fleet.sellBus(s, busId)),
    forecloseLoan: (loanId) => get().intent((s) => banking.forecloseLoan(s, loanId)),
    takeCashLoan: (slabId) => get().intent((s) => banking.takeCashLoan(s, slabId)),
    rescueWithLoan: (slabId) => get().intent((s) => (s.scenario === 'ironman' ? 'Ironman: there is no rescue.' : banking.takeCashLoan(s, slabId, { rescue: true })), 'Working capital drawn — keep operating.'),
    hire: (candId) => get().intent((s) => staffing.hire(s, candId)),
    fire: (staffId) => get().intent((s) => staffing.fire(s, staffId)),
    assignStaff: (staffId, busId) => get().intent((s) => staffing.assignStaff(s, staffId, busId)),
    trainStaff: (staffId) => get().intent((s) => staffing.trainStaff(s, staffId)),
    raiseSalary: (staffId, salary) => get().intent((s) => staffing.raiseSalary(s, staffId, salary)),
    applyForPermit: (routeId) => get().intent((s) => schedules.applyForPermit(s, routeId)),
    applySeasonalPermit: (routeId, seasonId) => get().intent((s) => schedules.applySeasonalPermit(s, routeId, seasonId)),
    renewSeasonalPermit: (routeId) => get().intent((s) => schedules.renewSeasonalPermit(s, routeId)),
    withdrawSeasonalPermit: (routeId) => get().intent((s) => schedules.withdrawSeasonalPermit(s, routeId)),
    openCargoPermit: (routeId) => get().intent((s) => cargoSim.openCargoPermit(s, routeId)),
    renewCargoPermit: (routeId) => get().intent((s) => cargoSim.renewCargoPermit(s, routeId)),
    closeCargoPermit: (routeId) => get().intent((s) => cargoSim.closeCargoPermit(s, routeId)),
    discontinueRoute: (routeId) => get().intent((s) => schedules.discontinueRoute(s, routeId)),
    setCorridorStance: (routeId, stance) => get().intent((s) => {
      applyCorridorStance(s, routeId, stance)
      return null
    }),
    createSchedule: (input, busId) => get().intent((s) => schedules.launchSchedule(s, input, busId)),
    updateSchedule: (schId, patch) => get().intent((s) => schedules.updateSchedule(s, schId, patch)),
    assignBus: (schId, busId) => get().intent((s) => schedules.assignBus(s, schId, busId)),
    unassignBus: (schId, busId) => get().intent((s) => schedules.unassignBus(s, schId, busId)),
    deleteSchedule: (schId) => get().intent((s) => schedules.deleteSchedule(s, schId)),
    duplicateSchedule: (schId, slot = 'hour') => get().intent((s) => schedules.duplicateSchedule(s, schId, slot)),
    makeFestivalFull: (schId) => get().intent((s) => schedules.makeFestivalFull(s, schId)),
    appointScheduleManager: (staffId) => get().intent((s) => staffing.appointScheduleManager(s, staffId)),
    setScheduleAutoAcceptCharters: (auto) => get().intent((s) => {
      s.company.scheduleAutoAcceptCharters = auto
      return null
    }),
    serviceBus: (busId, tier, opts) => get().intent((s) => maintenance.serviceBus(s, busId, tier, opts)),
    repairSubsystem: (busId, sub) => get().intent((s) => maintenance.repairSubsystem(s, busId, sub)),
    replaceTyres: (busId, axleOrRetread, brand, opts) => get().intent((s) => maintenance.replaceTyres(s, busId, axleOrRetread, brand, opts)),
    setWorkshopTyreBrand: (brand) => get().intent((s) => { maintenance.setWorkshopTyreBrand(s, brand); return null }),
    rebodyBus: (busId, bodyDesignId, desiredLayoutKind) => get().intent((s) => maintenance.rebodyBus(s, busId, bodyDesignId, desiredLayoutKind)),
    overhaulPowertrain: (busId) => get().intent((s) => maintenance.overhaulPowertrain(s, busId)),
    retrofitLuxuryAmenities: (busId) => get().intent((s) => maintenance.retrofitLuxuryAmenities(s, busId)),
    refurbishSeats: (busId) => get().intent((s) => maintenance.refurbishSeats(s, busId)),
    addBodyDesign: (builderId, design) => {
      let err: string | undefined
      get().intent((s) => {
        if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
        const builder = s.bodyBuilders[builderId]
        if (!builder) {
          err = 'Unknown body builder.'
          return err
        }
        if (builder.designs.some((d) => d.id === design.id)) {
          err = 'Design ID already exists.'
          return err
        }
        builder.designs.push(design)
        pushLog(s, 'info', `Added body design "${design.name}" under ${builder.name}.`)
        return null
      })
      if (err) return { ok: false, error: err }
      const live = get().state
      if (live?.bodyBuilders) {
        saveSharedBodyDesigns(live.bodyBuilders).catch(() => {})
      }
      return { ok: true }
    },
    updateBodyDesign: (builderId, designId, patch) => {
      let err: string | undefined
      get().intent((s) => {
        if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
        const builder = s.bodyBuilders[builderId]
        if (!builder) {
          err = 'Unknown body builder.'
          return err
        }
        const idx = builder.designs.findIndex((d) => d.id === designId)
        if (idx < 0) {
          err = 'Design not found.'
          return err
        }
        builder.designs[idx] = { ...builder.designs[idx], ...patch }
        pushLog(s, 'info', `Updated body design "${builder.designs[idx].name}".`)
        return null
      })
      if (err) return { ok: false, error: err }
      const live = get().state
      if (live?.bodyBuilders) {
        saveSharedBodyDesigns(live.bodyBuilders).catch(() => {})
      }
      return { ok: true }
    },
    removeBodyDesign: (builderId, designId) => {
      let err: string | undefined
      get().intent((s) => {
        if (!s.bodyBuilders) s.bodyBuilders = cloneDefaultBodyBuilders()
        const builder = s.bodyBuilders[builderId]
        if (!builder) {
          err = 'Unknown body builder.'
          return err
        }
        if (s.busOrders && s.busOrders.some((o) => o.bodyDesignId === designId)) {
          err = 'Cannot delete design: a pending new bus order is currently using it.'
          return err
        }
        const d = builder.designs.find((x) => x.id === designId)
        builder.designs = builder.designs.filter((x) => x.id !== designId)
        pushLog(s, 'info', `Removed body design "${d?.name ?? designId}".`)
        return null
      })
      if (err) return { ok: false, error: err }
      const live = get().state
      if (live?.bodyBuilders) {
        saveSharedBodyDesigns(live.bodyBuilders).catch(() => {})
      }
      return { ok: true }
    },
    resetBodyDesignsToDefault: () => {
      get().intent((s) => {
        s.bodyBuilders = cloneDefaultBodyBuilders()
        pushLog(s, 'info', 'Reset coach body designs to default catalog.')
        return null
      })
      const live = get().state
      if (live?.bodyBuilders) {
        saveSharedBodyDesigns(live.bodyBuilders).catch(() => {})
      }
      return { ok: true }
    },
    initSharedBodyDesigns: async () => {
      try {
        await loadSharedBodyDesigns()
        const current = get().state
        if (current) {
          const { bodyBuilders, changed } = syncStateBodyBuildersWithShared(current.bodyBuilders)
          if (changed || JSON.stringify(current.bodyBuilders) !== JSON.stringify(bodyBuilders)) {
            set({
              state: {
                ...current,
                bodyBuilders,
              },
            })
            saveSharedBodyDesigns(bodyBuilders).catch(() => {})
          }
        }
      } catch {
        // Shared designs background init
      }
    },
    upgradeWorkshop: () => get().intent((s) => maintenance.upgradeWorkshop(s)),
    openWorkshopLocation: (cityId, groupIds) => get().intent((s) => maintenance.openWorkshopLocation(s, cityId, groupIds)),
    addWorkshopBayAtLocation: (locationId) => get().intent((s) => maintenance.addBayAtLocation(s, locationId)),
    updateWorkshopLocationBrands: (locationId, groupIds) => get().intent((s) => maintenance.updateWorkshopLocationBrands(s, locationId, groupIds)),
    expandDepot: () => get().intent((s) => maintenance.expandDepot(s)),
    leaseYard: (cityId) => get().intent((s) => depot.leaseYard(s, cityId)),
    cancelYard: (cityId) => get().intent((s) => depot.cancelYard(s, cityId)),
    payGarageClaim: (claimId) => get().intent((s) => insurance.payGarageNow(s, claimId)),
    settleInsuranceClaim: (claimId) => get().intent((s) => insurance.settleClaim(s, claimId)),
    appointFleetManager: (staffId) => get().intent((s) => staffing.appointFleetManager(s, staffId)),
    appointBayMechanic: (staffId, bayIndex) => get().intent((s) => staffing.appointBayMechanic(s, staffId, bayIndex)),
    unappointBayMechanic: (staffId) => get().intent((s) => staffing.unappointBayMechanic(s, staffId)),
    appointHr: (staffId) => get().intent((s) => staffing.appointHr(s, staffId)),
    appointOps: (staffId) => get().intent((s) => staffing.appointOps(s, staffId)),
    setOpsAutoStaff: (enabled) => get().intent((s) => staffing.setOpsAutoStaff(s, enabled)),
    setHrAutoHire: (patch) => get().intent((s) => staffing.setHrAutoHire(s, patch)),
    setHrAutoRaise: (enabled) => get().intent((s) => staffing.setHrAutoRaise(s, enabled)),
    setHrAutoFire: (patch) => get().intent((s) => staffing.setHrAutoFire(s, patch)),
    appointSpareDriver: (staffId) => get().intent((s) => staffing.appointSpareDriver(s, staffId)),
    setBusDuty: (busId, duty) => get().intent((s) => cover.setBusDuty(s, busId, duty)),
    buildAppTier: (tier) => get().intent((s) => channels.buildAppTier(s, tier)),
    setMarketMix: (mix) => get().intent((s) => fleet.setMarketMix(s, mix)),
    setMarketingBudget: (monthly) => get().intent((s) => {
      channels.setMarketingBudget(s, monthly)
      return null
    }),
    decide: (decisionId, optionId) => get().intent((s) => applyDecision(s, decisionId, optionId)),
    acknowledgeVictory: () => get().intent((s) => {
      if (s.victory) s.victory.acknowledged = true
      return null
    }),
    markInboxRead: (id) => get().intent((s) => {
      const m = (s.inbox ?? []).find((item) => item.id === id)
      if (m) m.read = true
      return null
    }),
    markAllInboxRead: () => get().intent((s) => {
      for (const m of s.inbox ?? []) {
        m.read = true
      }
      return null
    }),
    repriceTrip: (tripId, fare) => get().intent((s) => {
      const t = s.trips[tripId]
      if (!t || t.status !== 'open') return 'Trip is not open.'
      t.fare = roundFare(fare)
      t.fareLocked = true
      const sch = s.schedules[t.scheduleId]
      if (sch) {
        if (isReturnTrip(t, sch)) {
          if (sch.returnAutoPrice ?? sch.autoPrice) sch.returnAutoPrice = false
        } else {
          if (sch.autoPrice) sch.autoPrice = false
        }
      }
      return null
    }),
    setOdoHighlightKm: (km) => get().intent((s) => {
      const n = Math.round(Number(km))
      if (!Number.isFinite(n) || n <= 0) return 'Enter a kilometre mark.'
      // Snap to the 25k marks the Settings slider offers.
      const snapped = Math.round(n / 25_000) * 25_000
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config.odoHighlightKm = Math.max(50_000, Math.min(2_000_000, snapped))
      return null
    }),
    setAutoRenewDocs: (enabled) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config.autoRenewDocs = enabled
      return null
    }),
    setCargoBaseRate: (rate) => get().intent((s) => {
      const n = Number(rate)
      if (!Number.isFinite(n) || n <= 0) return 'Enter a cargo rate.'
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config.cargoBaseRateRs = Math.round(Math.max(0.5, Math.min(15, n)) * 10) / 10
      return null
    }),
    setCargoPricingType: (type) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config.cargoPricingType = type
      return null
    }),
    setCargoCargoType: (type) => get().intent((s) => {
      s.company.cargoCargoType = type
      return null
    }),
    setCargoAcceptFragile: (accept) => get().intent((s) => {
      s.company.cargoAcceptFragile = accept
      return null
    }),
    setCargoAutoSignContracts: (enabled) => get().intent((s) => {
      s.company.cargoAutoSignContracts = enabled
      return null
    }),
    signCargoContract: (proposal) => get().intent((s) => cargoSim.signCargoContract(s, proposal)),
    cancelCargoContract: (contractId) => get().intent((s) => cargoSim.cancelCargoContract(s, contractId)),
    acceptSpotCargoOffer: (offerId) => get().intent((s) => cargoSim.acceptSpotCargoOffer(s, offerId)),
    acceptAllSpotOffers: () => get().intent((s) => cargoSim.acceptAllSpotCargoOffers(s)),
    setDedicatedCargoSubsidiary: (on) => get().intent((s) => {
      const mgr = staffing.cargoManagerOnDuty(s) ?? (s.company.cargoManagerId ? s.staff[s.company.cargoManagerId] : undefined)
      if (!mgr) return 'Cannot modify cargo subsidiary without an active Cargo Manager on duty.'
      s.company.dedicatedCargoSubsidiary = on
      fleet.syncCargoListings(s)
      if (on) {
        pushLog(s, 'good', `Dedicated Cargo Service Subsidiary launched by Cargo Manager ${mgr.name}. Bulk contracts & dedicated freight operations unlocked.`)
        return null
      }
      const ended = cargoSim.suspendCargoContracts(s)
      pushLog(s, 'info', ended > 0
        ? `Dedicated Cargo Service Subsidiary turned off. ${ended} freight contract${ended === 1 ? '' : 's'} ended; the desk now waits for spot parcels only.`
        : 'Dedicated Cargo Service Subsidiary turned off. Contracts are closed; the desk waits for spot parcels only.')
      return null
    }, on ? 'Dedicated Cargo Service Subsidiary activated!' : 'Dedicated Cargo Service Subsidiary turned off.'),
    deepCleanBus: (busId) => get().intent((s) => maintenance.deepCleanBus(s, busId)),
    payRoadTax: (busId) => get().intent((s) => maintenance.payAnnualRoadTax(s, busId)),
    renewPuc: (busId) => get().intent((s) => maintenance.renewPuc(s, busId)),
    fitGps: (busId) => get().intent((s) => maintenance.fitGps(s, busId)),
    retestFitness: (busId) => get().intent((s) => maintenance.retestFitness(s, busId)),
    takeMsmeLoan: (lenderId, amount, months) => get().intent((s) => banking.takeMsmeLoan(s, lenderId, amount, months)),
    setScheduleDefaults: (patch) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      const cur = schedules.getScheduleDefaults(s)
      s.config.scheduleDefaults = {
        ...cur,
        ...patch,
        channels: { ...cur.channels, ...patch.channels },
      }
      // Company default only pushes onto unassigned services; brand schedules keep their own policy.
      if (patch.cancellation !== undefined) {
        for (const sch of Object.values(s.schedules ?? {})) {
          if (!sch.groupId) sch.cancellation = patch.cancellation
        }
      }
      // Sell-on is fleet-wide — keep every service in sync with Config.
      schedules.syncScheduleChannels(s)
      return null
    }),
    appointCargoManager: (staffId) => get().intent((s) => {
      const err = staffing.appointCargoManager(s, staffId)
      // The new manager takes the desk over at once: any spot offer still
      // waiting on the player is queued by them instead of being asked about.
      if (!err) {
        const mgr = staffing.cargoManagerOnDuty(s)
        if (mgr) cargoSim.cargoAutoQueuePendingOffers(s, mgr.name)
      }
      return err
    }),
    appointDocsManager: (staffId) => get().intent((s) => staffing.appointDocsManager(s, staffId)),
    appointCrm: (staffId) => get().intent((s) => staffing.appointCrm(s, staffId)),
    setCrmPolicy: (policy) => get().intent((s) => {
      const r = staffing.setCrmPolicy(s, policy)
      if (policy !== 'ask') crm.dailyCrmPass(s)
      return r
    }),
    resolveGrievance: (grievanceId, action) => get().intent((s) => crm.resolveGrievance(s, grievanceId, action)),
    appointAccountant: (staffId) => get().intent((s) => staffing.appointAccountant(s, staffId)),
    appointCharterManager: (staffId) => get().intent((s) => {
      const err = staffing.appointCharterManager(s, staffId)
      if (err) return err
      if (staffId) {
        charterSim.autoAssignBestCharters(s)
      }
      return null
    }),
    setCharterPricingStrategy: (strategy) => get().intent((s) => {
      const cfg = charterSim.getCharterConfig(s)
      cfg.pricingStrategy = strategy
      return null
    }),
    setCharterOperatingBase: (cityId) => get().intent((s) => {
      const cfg = charterSim.getCharterConfig(s)
      cfg.operatingBaseCityId = cityId
      return null
    }),
    setCharterAutoAccept: (enabled) => get().intent((s) => {
      const cfg = charterSim.getCharterConfig(s)
      cfg.autoAccept = enabled
      return null
    }),
    setCharterMinCondition: (minCondition) => get().intent((s) => {
      const cfg = charterSim.getCharterConfig(s)
      cfg.minConditionScore = minCondition
      return null
    }),
    setCharterMinMargin: (pct) => get().intent((s) => {
      charterSim.getCharterConfig(s).minMarginPct = pct
      return null
    }),
    setCharterDeposit: (pct) => get().intent((s) => {
      charterSim.getCharterConfig(s).depositPct = pct
      return null
    }),
    acceptCharterInquiry: (inquiryId, busId) => get().intent((s) => charterSim.acceptCharterInquiry(s, inquiryId, busId)),
    rejectCharterInquiry: (inquiryId) => get().intent((s) => charterSim.rejectCharterInquiry(s, inquiryId)),
    autoAssignCharters: () => get().intent((s) => {
      const res = charterSim.autoAssignChartersWithDetails(s)
      if (res.assigned > 0) {
        get().toast(`Assigned ${res.assigned} charter inquiry${res.assigned > 1 ? 's' : ''} to best matching vehicles.`, 'good')
        return null
      }
      if (res.bidsLost > 0) {
        get().toast(`Processed ${res.bidsLost} charter inquiry${res.bidsLost > 1 ? 's' : ''}, but competitor bids won at current price rates.`, 'warn')
        return null
      }
      return res.reason || 'No eligible available charter coaches currently match open inquiries.'
    }),
    appointDeskAssistant: (desk, staffId) => get().intent((s) => staffing.appointDeskAssistant(s, desk, staffId)),
    unappointDeskAssistant: (desk, staffId) => get().intent((s) => staffing.unappointDeskAssistant(s, desk, staffId)),
    retrainDriver: (staffId) => get().intent((s) => staffing.retrainDriver(s, staffId)),
    upgradeLicence: (staffId) => get().intent((s) => staffing.upgradeLicence(s, staffId)),
    runTripAnyway: (tripId) => get().intent((s) => {
      const t = s.trips[tripId]
      if (!t) return 'Trip not found.'
      t.cmvrRunAnyway = true
      return null
    }),
    updatePlayerConfig: (patch) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config = { ...s.config, ...patch }
      return null
    }),
    setWelfareConfig: (patch) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config = { ...s.config, ...patch }
      return null
    }),
    renewInsurance: (busId) => get().intent((s) => maintenance.renewBusInsurance(s, busId)),
    renewFitness: (busId) => get().intent((s) => maintenance.renewFitness(s, busId)),
    setDepreciationDefault: (method) => get().intent((s) => {
      s.company.depreciationDefault = method
      return null
    }),
    setDepreciationRate: (ratePct) => get().intent((s) => {
      // null = follow the standard rate for whichever method is selected.
      if (ratePct === null) {
        delete s.company.depreciationRatePct
        return null
      }
      const n = Number(ratePct)
      if (!Number.isFinite(n)) return 'Enter a depreciation rate between 5% and 30%.'
      s.company.depreciationRatePct = fleet.clampDepRate(n)
      return null
    }),
    remitGst: () => get().intent((s) => tax.remitGst(s)),
    fileTds: () => get().intent((s) => tax.fileTds(s)),
    takeHpLoan: (productId, busId, months) => get().intent((s) => banking.takeHpLoan(s, productId, busId, months)),
    setServiceTier: (schId, tier, amenities) => get().intent((s) => {
      const sch = s.schedules[schId]
      if (!sch) return 'Schedule not found.'
      const patch: { serviceTier: typeof tier; amenities?: typeof amenities } = { serviceTier: tier }
      if (amenities) patch.amenities = amenities
      // Route through updateSchedule so auto fares reprice with the brand tier.
      const err = schedules.updateSchedule(s, schId, patch)
      if (err) return err
      if (amenities) sch.amenities = { ...sch.amenities, ...amenities }
      return null
    }),
    setDefaultAmenities: (amenities) => get().intent((s) => {
      s.company.defaultAmenities = { ...s.company.defaultAmenities, ...amenities }
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm }
      s.config.defaultAmenities = { ...s.company.defaultAmenities }
      return null
    }),
    setDefaultServiceTier: (tier) => get().intent((s) => {
      s.company.defaultServiceTier = tier
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm }
      s.config.defaultServiceTier = tier
      return null
    }),
    retrofitBus: (busId, feature) => get().intent((s) => maintenance.retrofitBus(s, busId, feature)),
    setFuelContract: (partner) => get().intent((s) => depot.setFuelContract(s, partner)),
    installDepotFuelTank: () => get().intent((s) => depot.installDepotFuelTank(s)),
    upgradeDepotFuelTank: () => get().intent((s) => depot.upgradeDepotFuelTank(s), 'Depot fuel tank upgraded.'),
    orderDepotFuelRefill: (litres) => get().intent((s) => depot.orderDepotFuelRefill(s, litres)),
    toggleAutoRefillDepotTank: (enabled) => get().intent((s) => depot.toggleAutoRefillDepotTank(s, enabled)),
    toggleEcoIncentive: (enabled) => get().intent((s) => {
      const active = enabled !== undefined ? enabled : !s.company.ecoIncentiveActive
      s.company.ecoIncentiveActive = active
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm }
      s.config.ecoIncentiveActive = active
      pushLog(s, 'info', `Driver eco-driving mileage incentive ${active ? 'ACTIVATED (₹250/trip bonus)' : 'DEACTIVATED'}.`)
      return null
    }),
    triggerFlashDeal: (tripId) => get().intent((s) => {
      const t = s.trips[tripId]
      if (!t) return 'Trip not found.'
      if (t.status !== 'open') return 'Flash sales can only be triggered on open trips.'
      t.flashDeal = !t.flashDeal
      if (t.flashDeal) t.surgeDeal = false
      const sch = s.schedules[t.scheduleId]
      const b = s.buses[t.busId]
      if (sch && b) {
        t.fare = resolveTripFare(s, t, sch, b, t.day - s.day)
      }
      return null
    }),
    triggerSurgeDeal: (tripId) => get().intent((s) => {
      const t = s.trips[tripId]
      if (!t) return 'Trip not found.'
      if (t.status !== 'open') return 'Surge pricing can only be applied to open trips.'
      t.surgeDeal = !t.surgeDeal
      if (t.surgeDeal) t.flashDeal = false
      const sch = s.schedules[t.scheduleId]
      const b = s.buses[t.busId]
      if (sch && b) {
        t.fare = resolveTripFare(s, t, sch, b, t.day - s.day)
      }
      return null
    }),
    openPassengerLounge: (cityId, locationName, tier, seating, amenities) => get().intent((s) => loungeSim.openLounge(s, cityId, locationName, tier, seating, amenities)),
    refitPassengerLounge: (loungeId, seating, amenities) => get().intent((s) => loungeSim.refitLounge(s, loungeId, seating, amenities)),
    upgradePassengerLounge: (loungeId, newTier) => get().intent((s) => loungeSim.upgradeLounge(s, loungeId, newTier)),
    closePassengerLounge: (loungeId) => get().intent((s) => loungeSim.closeLounge(s, loungeId)),
    updatePassengerConfig: (patch) => get().intent((s) => {
      if (!s.config) s.config = { odoHighlightKm: BAL.odoHighlightDefaultKm, autoRenewDocs: true, cargoBaseRateRs: BAL.cargoBaseRateDefaultRs }
      s.config.passengerConfig = { ...s.config.passengerConfig, ...patch }
      return null
    }),
  })),
)

/** Narrow selector helpers */
export function useGameState(): GameState | null {
  return useGame((g) => g.state)
}

/**
 * The game state for a page body. React renders the new value as low-priority, interruptible
 * work: the header (date, cash) updates at once and a heavy page catches up in small slices
 * instead of freezing the tab for one long render after each day.
 */
export function useDeferredGameState(): GameState | null {
  return useDeferredValue(useGame((g) => g.state))
}

/**
 * Store actions without subscribing to the store. A component that only calls actions should use
 * this instead of `useGame()`, which re-renders on every store change (each day of a week skip,
 * every toast). Do not read data through it: values read here are not reactive.
 */
export function useGameActions(): GameStore {
  return useGame.getState()
}

export type { Schedule }
