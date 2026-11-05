import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { BAL, CANCELLATION_POLICY_RULES, DIFFICULTIES } from '../../engine/data/balance'
import { AMENITY_CATALOG, FITTING_CATALOG } from '../../engine/data/amenitiesCatalog'
import { APP_TIER_DESC, APP_TIER_NAMES } from '../../engine/sim/channels'
import { getScheduleDefaults } from '../../engine/sim/schedules'
import { monthlyDepreciationFor, depreciationLifeYears } from '../../engine/sim/finance'
import { docsManagerOnDuty } from '../../engine/sim/staffing'
import { stateFootprint } from '../../engine/sim/retain'
import { getLastSaveInfo } from '../../store/saveCodec'
import { CHANNELS, CHANNEL_META } from '../../engine/data/channels'
import { fmtCompact, toRupees, rs, L } from '../../engine/core/money'
import { fmtDate } from '../../engine/core/calendar'
import { cityName } from '../../engine/data/cities'
import { getLoungeTierDef } from '../../engine/data/loungeCatalog'
import { getLoungeSchedulesHandled } from '../../engine/sim/lounge'
import type { CancellationPolicy, Channel, DepreciationMethod, FuelPartner, ServiceTier, BusGroup, BodyDesign, DriverDormitoryTier, FestivalBonusTier } from '../../engine/types'
import {
  BODY_QUALITY_TIERS,
  DEFAULT_BODY_BUILDERS,
  chassisNameOptions,
  chassisPlatformLabel,
  matchBodyQualityTier,
  bodyPackageLakhs,
  bodyPackagePriceRange,
  COACH_LAYOUT_OPTIONS,
  type CoachLayoutKind,
} from '../../engine/data/bodyBuilders'
import { GROUP_PALETTE, isLightBadgeColor, brandStars, activeGroups, sortedGroups, getDescendantGroupIds } from '../../engine/sim/groups'
import { KV, Panel, Modal, GroupBadge, Hint, StatRow, Tabs, PageHeader } from '../bits'
import { BrandHierarchyTree } from '../BrandHierarchyTree'
import { BrandPicActions, BrandPicPicker } from '../BrandPicPicker'
import { BrandGalleryModal } from '../BrandGalleryModal'
import { LightboxModal } from '../LightboxModal'
import { CloudSavesPanel } from '../CloudSavesPanel'
import { TABS, GLOBAL_SHORTCUTS } from '../navigation'
import { getLastCloudSyncTime } from '../../store/sharedBodyDesigns'
import { isCloudImagesConfigured } from '../../lib/supabase'

const EXPORT_SERIES_KEY = 'busraj_export_series'

interface SaveFileInfo {
  name: string
  size: number
  mtime: string
}

function nextExportName(): string {
  let n = 1
  try {
    const raw = localStorage.getItem(EXPORT_SERIES_KEY)
    const parsed = raw ? Number(raw) : 0
    if (Number.isFinite(parsed) && parsed >= 0) n = Math.floor(parsed) + 1
  } catch { /* ignore */ }
  try { localStorage.setItem(EXPORT_SERIES_KEY, String(n)) } catch { /* ignore */ }
  return `gameSave_s${n}.json`
}

function BadgeColorPellets({
  value,
  onChange,
  size = 18,
}: {
  value: string
  onChange: (color: string) => void
  size?: number
}) {
  return (
    <div className="flex" style={{ gap: 5, alignItems: 'center', flexWrap: 'wrap', maxWidth: 460 }}>
      {GROUP_PALETTE.map((color) => {
        const selected = value.toLowerCase() === color.toLowerCase()
        const light = isLightBadgeColor(color)
        return (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            title={color}
            aria-label={`Badge color ${color}`}
            aria-pressed={selected}
            style={{
              width: size,
              height: size,
              borderRadius: Math.max(3, Math.round(size * 0.25)),
              background: `linear-gradient(145deg, ${color}ee, ${color})`,
              border: selected
                ? '2px solid #fff'
                : light
                  ? '1px solid rgba(255,255,255,0.65)'
                  : '1px solid rgba(255,255,255,0.18)',
              boxShadow: selected
                ? `0 0 0 2px ${color}, 0 2px 6px rgba(0,0,0,0.5)`
                : light
                  ? 'inset 0 0 0 1px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.35)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.35)',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transform: selected ? 'scale(1.18)' : undefined,
              transition: 'transform 120ms ease, box-shadow 120ms ease',
            }}
          />
        )
      })}
    </div>
  )
}


export function SettingsPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') as any
  const [activeTab, setActiveTab] = useState<'flow' | 'fleet' | 'commercial' | 'policies' | 'subsidiaries' | 'body_designs' | 'welfare' | 'lounges' | 'system'>(
    ['flow', 'fleet', 'commercial', 'policies', 'subsidiaries', 'body_designs', 'welfare', 'lounges', 'system'].includes(initialTab) ? initialTab : 'flow'
  )
  useEffect(() => {
    const tab = searchParams.get('tab') as any
    if (tab && ['flow', 'fleet', 'commercial', 'policies', 'subsidiaries', 'body_designs', 'welfare', 'lounges', 'system'].includes(tab) && tab !== activeTab) {
      setActiveTab(tab)
    }
  }, [searchParams])
  const [confirming, setConfirming] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [newBrandCode, setNewBrandCode] = useState('')
  const [newBrandColor, setNewBrandColor] = useState(GROUP_PALETTE[0])
  const [newBrandCargo, setNewBrandCargo] = useState(false)
  const [newBrandPic, setNewBrandPic] = useState<string | undefined>(undefined)
  const [newBrandParentId, setNewBrandParentId] = useState('')
  const [retireTarget, setRetireTarget] = useState<BusGroup | null>(null)
  const [retireDestination, setRetireDestination] = useState<string>('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [galleryBrand, setGalleryBrand] = useState<BusGroup | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const bodyBuilders = s.bodyBuilders ?? DEFAULT_BODY_BUILDERS
  const [editingDesign, setEditingDesign] = useState<{
    builderId: string
    design: BodyDesign
    isNew: boolean
  } | null>(null)
  const [designForm, setDesignForm] = useState<{
    id: string
    name: string
    leadDaysAdd: number
    comfortDelta: number
    maintDeltaPct: number
    layoutKinds: CoachLayoutKind[]
    image?: string
    chassisNames: string[]
    availableUsed: boolean
    availableLeaseAttach: boolean
  }>({
    id: '',
    name: '',
    leadDaysAdd: 0,
    comfortDelta: 0,
    maintDeltaPct: 0,
    layoutKinds: ['sleeper'],
    image: undefined,
    chassisNames: [],
    availableUsed: true,
    availableLeaseAttach: true,
  })

  const openEditDesign = (builderId: string, d: BodyDesign) => {
    setEditingDesign({ builderId, design: d, isNew: false })
    const baseSecondary = d.secondaryMarket !== false
    const lKinds: CoachLayoutKind[] = (d.layoutKinds && d.layoutKinds.length > 0)
      ? [...d.layoutKinds]
      : [d.layoutKind ?? (d.name.toLowerCase().includes('semi') ? 'semi' : d.name.toLowerCase().includes('hybrid') ? 'hybrid' : 'sleeper')]
    setDesignForm({
      id: d.id,
      name: d.name,
      leadDaysAdd: d.leadDaysAdd,
      comfortDelta: d.comfortDelta,
      maintDeltaPct: Math.round(d.maintDelta * 100),
      layoutKinds: lKinds,
      image: d.image,
      chassisNames: d.chassisNames ? [...d.chassisNames] : [],
      availableUsed: d.availableUsed !== undefined ? d.availableUsed : baseSecondary,
      availableLeaseAttach: d.availableLeaseAttach !== undefined ? d.availableLeaseAttach : baseSecondary,
    })
  }

  const openAddDesign = (builderId: string) => {
    const newId = `bd_${Date.now()}`
    const standard = BODY_QUALITY_TIERS.find((t) => t.id === 'standard')!
    const blank: BodyDesign = {
      id: newId,
      name: '',
      bodyPrice: 0,
      leadDaysAdd: standard.leadDaysAdd,
      comfortDelta: standard.comfortDelta,
      maintDelta: standard.maintDeltaPct / 100,
      layoutKind: 'sleeper',
      layoutKinds: ['sleeper'],
      availableUsed: true,
      availableLeaseAttach: true,
      secondaryMarket: true,
    }
    setEditingDesign({ builderId, design: blank, isNew: true })
    setDesignForm({
      id: newId,
      name: '',
      leadDaysAdd: standard.leadDaysAdd,
      comfortDelta: standard.comfortDelta,
      maintDeltaPct: standard.maintDeltaPct,
      layoutKinds: ['sleeper'],
      image: undefined,
      chassisNames: [],
      availableUsed: true,
      availableLeaseAttach: true,
    })
  }

  const saveDesignModal = () => {
    if (!editingDesign) return
    const name = designForm.name.trim()
    if (!name) {
      g.toast('Please enter a design name.', 'bad')
      return
    }
    const gradeId = matchBodyQualityTier(
      designForm.comfortDelta,
      designForm.maintDeltaPct,
      designForm.leadDaysAdd,
    )
    const refChassis = designForm.chassisNames[0]
      ?? chassisNameOptions(bodyBuilders[editingDesign.builderId]?.makers ?? ['Ashok Leyland'])[0]
      ?? '12M'
    // Stored for save compat; live order/rebody price uses builder × chassis × grade.
    const bodyPrice = L(bodyPackageLakhs(editingDesign.builderId, refChassis, gradeId))
    const chosenLayoutKinds = designForm.layoutKinds.length > 0 ? designForm.layoutKinds : (['sleeper'] as CoachLayoutKind[])
    const newDesign: BodyDesign = {
      id: designForm.id || `bd_${Date.now()}`,
      name,
      bodyPrice,
      leadDaysAdd: Number(designForm.leadDaysAdd) || 0,
      comfortDelta: Math.round(Number(designForm.comfortDelta) * 10) / 10,
      maintDelta: Math.round((Number(designForm.maintDeltaPct) / 100) * 1000) / 1000,
      layoutKind: chosenLayoutKinds[0],
      layoutKinds: [...chosenLayoutKinds],
      image: designForm.image,
      chassisNames: designForm.chassisNames.length > 0 ? [...designForm.chassisNames] : undefined,
      availableUsed: designForm.availableUsed,
      availableLeaseAttach: designForm.availableLeaseAttach,
      secondaryMarket: designForm.availableUsed || designForm.availableLeaseAttach,
    }

    if (editingDesign.isNew) {
      const res = g.addBodyDesign(editingDesign.builderId, newDesign)
      if (!res.ok) {
        g.toast(res.error ?? 'Could not add design.', 'bad')
        return
      }
      g.toast(`Added "${newDesign.name}"`, 'good')
    } else {
      const res = g.updateBodyDesign(editingDesign.builderId, editingDesign.design.id, newDesign)
      if (!res.ok) {
        g.toast(res.error ?? 'Could not update design.', 'bad')
        return
      }
      g.toast(`Updated "${newDesign.name}"`, 'good')
    }
    setEditingDesign(null)
  }

  const deleteDesign = (builderId: string, designId: string) => {
    const res = g.removeBodyDesign(builderId, designId)
    if (!res.ok) {
      g.toast(res.error ?? 'Could not remove design.', 'bad')
      return
    }
    g.toast('Body design removed.', 'good')
  }

  const [confirmResetDesigns, setConfirmResetDesigns] = useState(false)
  const handleResetDefaults = () => {
    g.resetBodyDesignsToDefault()
    setConfirmResetDesigns(false)
    g.toast('Reset coach designs to default catalog across all game saves.', 'good')
  }

  const [cloudSyncing] = useState(false)
  const [cloudSyncStatus] = useState<string>('')
  const [lastSyncTime] = useState<string | null>(() => getLastCloudSyncTime())
  /** Amenities + fittings cards inside a brand — hidden by default. */
  const [amenityCardOpen, setAmenityCardOpen] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)!

  const cfg = s.config ?? {
    odoHighlightKm: BAL.odoHighlightDefaultKm,
    autoRenewDocs: true,
  }

  // Depreciation
  const depMethod: DepreciationMethod = s.company.depreciationDefault ?? 'SLM'
  const depRate = depMethod === 'WDV'
    ? (s.company.depreciationRatePct ?? BAL.depreciationStandardRate.WDV)
    : (s.company.depreciationRatePct ?? BAL.depreciationStandardRate.SLM)
  const depSampleCost = rs(70_00_000)
  const monthlyFor = monthlyDepreciationFor(depSampleCost, depMethod, depRate)
  const lifeYears = depreciationLifeYears(depMethod, depRate)
  const odoMark = cfg.odoHighlightKm ?? BAL.odoHighlightDefaultKm

  const [saveFiles, setSaveFiles] = useState<SaveFileInfo[]>([])
  const [saveDir, setSaveDir] = useState<string>('')
  /** Local Vite plugin can read ~/Downloads/gameSave; static hosts (Surge) cannot. */
  const [saveFolderMode, setSaveFolderMode] = useState<'unknown' | 'local' | 'hosted'>('unknown')
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveInfo = getLastSaveInfo()
  const footprint = useMemo(() => stateFootprint(s), [s])

  const app = s.company.app
  const [mktDraft, setMktDraft] = useState(String(Math.round(toRupees(app.monthlyMarketing))))

  const loadSaveList = () => {
    setSaveLoading(true)
    setSaveError(null)
    fetch('/api/save-files')
      .then(async (r) => {
        const text = await r.text()
        const looksHtml = /^\s*</.test(text) || (r.headers.get('content-type') || '').includes('text/html')
        if (looksHtml) throw new Error('HOSTED')
        let d: any
        try {
          d = JSON.parse(text)
        } catch {
          throw new Error('HOSTED')
        }
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
        return d
      })
      .then((d) => {
        if (d.ok) {
          setSaveFolderMode('local')
          if (Array.isArray(d.files)) setSaveFiles(d.files)
          if (typeof d.saveDir === 'string') setSaveDir(d.saveDir)
          if (typeof d.nextSeriesNumber === 'number') {
            try {
              const current = Number(localStorage.getItem(EXPORT_SERIES_KEY) || '0')
              if (d.nextSeriesNumber > current) {
                localStorage.setItem(EXPORT_SERIES_KEY, String(d.nextSeriesNumber - 1))
              }
            } catch { /* ignore */ }
          }
        } else {
          setSaveFolderMode('local')
          setSaveError(d.error || 'Failed to list save files')
        }
      })
      .catch((err) => {
        const hosted = err?.message === 'HOSTED' || /Unexpected token|<!doctype|is not valid JSON/i.test(String(err?.message || ''))
        if (hosted) {
          setSaveFolderMode('hosted')
          setSaveFiles([])
          setSaveDir('')
          setSaveError(null)
        } else {
          setSaveFolderMode('hosted')
          setSaveFiles([])
          setSaveDir('')
          setSaveError(err?.message || 'Could not connect to gameSave folder service')
        }
      })
      .finally(() => {
        setSaveLoading(false)
      })
  }

  useEffect(() => {
    loadSaveList()
  }, [])

  useEffect(() => {
    if (activeTab === 'system') {
      loadSaveList()
    }
  }, [activeTab])

  const exportSave = async () => {
    const json = g.exportSaveJson()
    if (!json) {
      g.toast('Nothing to export.', 'bad')
      return
    }
    const name = nextExportName()

    try {
      const res = await fetch('/api/export-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name, content: json }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          if (typeof data.series === 'number') {
            try { localStorage.setItem(EXPORT_SERIES_KEY, String(data.series)) } catch { /* ignore */ }
          }
          g.toast(`Saved to gameSave/${data.filename}`, 'good')
          loadSaveList()
          return
        }
      }
    } catch {
      // Backend not reached, fall back
    }

    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (options: unknown) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker({
          suggestedName: name,
          types: [{
            description: 'JSON Game Save',
            accept: { 'application/json': ['.json'] },
          }],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        g.toast(`Saved ${handle.name}`, 'good')
        return
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') return
      }
    }

    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
    g.toast(`Downloaded ${name}`, 'good')
  }

  const openSaveDir = async () => {
    if (saveFolderMode === 'hosted') {
      g.toast('Folder open only works in local dev (npm run dev). On the live site use Export / Import Save File.', 'info')
      return
    }
    try {
      const res = await fetch('/api/open-save-dir', { method: 'POST' })
      const text = await res.text()
      if (/^\s*</.test(text) || (res.headers.get('content-type') || '').includes('text/html')) {
        setSaveFolderMode('hosted')
        g.toast('Folder open only works in local dev. On the live site use Export / Import Save File.', 'info')
        return
      }
      if (res.ok) {
        g.toast('Opened gameSave folder in Explorer', 'good')
        return
      }
    } catch { /* ignore */ }
    g.toast(saveDir ? `Save folder: ${saveDir}` : 'gameSave folder is not available in this build.', 'info')
  }

  const loadDirectSave = async (filename: string) => {
    try {
      const res = await fetch(`/api/load-save?file=${encodeURIComponent(filename)}`)
      const data = await res.json()
      if (!data.ok || !data.content) {
        g.toast(data.error || 'Could not load save file.', 'bad')
        return
      }
      const result = g.importSaveJson(data.content)
      if (!result.ok) {
        g.toast(result.error ?? 'Could not import that file.', 'bad')
        return
      }
      if (result.persisted) g.toast(`Loaded ${filename} from gameSave.`, 'good')
      else g.toast(`Loaded ${filename} in memory.`, 'info')
    } catch {
      g.toast('Could not read file from gameSave.', 'bad')
    }
  }

  const importSave = (file: File) => {
    file.text()
      .then((text) => {
        const result = g.importSaveJson(text)
        if (!result.ok) {
          g.toast(result.error ?? 'Could not import that file.', 'bad')
          return
        }
        if (result.persisted) g.toast('Save imported and stored in the browser.', 'good')
        else {
          g.toast(
            'Save loaded in memory, but browser storage is still full — export often; auto-save may fail until you free space.',
            'info',
          )
        }
      })
      .catch(() => g.toast('Could not read the file from disk.', 'bad'))
  }

  const commitMarketing = (raw: string | number) => {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''))
    if (!Number.isFinite(n) || n < 0) {
      setMktDraft(String(Math.round(toRupees(app.monthlyMarketing))))
      return
    }
    g.setMarketingBudget(rs(n))
    setMktDraft(String(Math.round(n)))
  }

  const lowCashLimit = cfg.lowCashThreshold ?? rs(100_000)
  const reserveLimit = cfg.emergencyReserveBuffer ?? rs(200_000)
  const speedGov = cfg.speedGovernor ?? 'normal'
  const prevServicePct = cfg.preventiveServiceThreshold ?? 75
  const tyreThresholdKm = cfg.tyreReplacementKmThreshold ?? 15_000
  const prefTyre = cfg.preferredTyreBrand ?? 'tier2'

  return (
    <>
      {/* Title & Navigation */}
      <PageHeader title="Settings" facts={<>{s.company.name} · {diff.label} · {fmtDate(s.day)}</>}>
        <Tabs inline tabs={[
            ['flow', 'Gameplay & Auto-Pause'],
            ['fleet', 'Fleet Policies'],
            ['commercial', 'Commercial & Channels'],
            ['policies', 'Policies'],
            ['subsidiaries', 'Subsidiaries & Brands'],
            ['body_designs', 'Body Designs'],
            ['welfare', 'Welfare & Taxes'],
            ['lounges', 'Passenger Handling & Lounges'],
            ['system', 'Save Data & System'],
          ] as const} value={activeTab} onChange={setActiveTab} />
      </PageHeader>

      {/* ========================================================================= */}
      {/* TAB 1: GAMEPLAY & AUTO-PAUSE TRIGGERS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'flow' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <Panel
            title="Simulation Auto-Pause Triggers"
            info="Automatically stops the day advance when critical events happen so you never fast-forward into bankruptcy, breakdowns, or strikes."
          >
            <div className="stack10">
              <div>
                <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={cfg.pauseOnLowCash !== false}
                    onChange={(e) => g.updatePlayerConfig({ pauseOnLowCash: e.target.checked })}
                  />
                  <div>
                    <b>Pause on Low Cash Emergency</b>
                    <Hint text={"Halts day advance if cash drops below the configured safe floor."} />
                  </div>
                </label>
                {cfg.pauseOnLowCash !== false && (
                  <div style={{ marginLeft: 26, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="dim small">Alert Floor:</span>
                    {[50_000, 100_000, 250_000, 500_000].map((amt) => (
                      <button
                        key={amt}
                        className={`small ${lowCashLimit === rs(amt) ? 'primary' : ''}`}
                        onClick={() => g.updatePlayerConfig({ lowCashThreshold: rs(amt) })}
                      >
                        {fmtCompact(rs(amt))}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cfg.pauseOnBreakdown !== false}
                  onChange={(e) => g.updatePlayerConfig({ pauseOnBreakdown: e.target.checked })}
                />
                <div>
                  <b>Pause on Vehicle Breakdown or Accident</b>
                  <Hint text={"Immediately interrupts time-skips so you can dispatch cover buses or order repairs."} />
                </div>
              </label>

              <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cfg.pauseOnDocExpiry !== false}
                  onChange={(e) => g.updatePlayerConfig({ pauseOnDocExpiry: e.target.checked })}
                />
                <div>
                  <b>Pause on Expired Compliance Papers (RTO Risk)</b>
                  <Hint text={"Stops the clock if fitness, PUC, or commercial tax expires and buses risk checkpost impound."} />
                </div>
              </label>

              <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cfg.pauseOnStrikeRisk !== false}
                  onChange={(e) => g.updatePlayerConfig({ pauseOnStrikeRisk: e.target.checked })}
                />
                <div>
                  <b>Pause on Staff Strike Danger (Morale &lt; 40%)</b>
                  <Hint text={"Alerts you immediately before crew union action or mass resignations take place."} />
                </div>
              </label>

              <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={!!cfg.pauseOnMonthEnd}
                  onChange={(e) => g.updatePlayerConfig({ pauseOnMonthEnd: e.target.checked })}
                />
                <div>
                  <b>Pause at Month-End Financial Close (Day 1)</b>
                  <Hint text={"Stops at the start of each month to review monthly P&L, balance sheet, and tax provisioning."} />
                </div>
              </label>

              <Hint text={"Inbox decisions never stop a week advance — distress sales, banking alerts and customer disputes keep queueing while the clock runs, and you answer them from the inbox whenever you are ready."} />
            </div>
          </Panel>

          <Panel
            title="Financial Risk & Safety Guardrails"
            info="Establish financial safety floors to prevent over-leveraging and accidental capital depletion."
          >
            <div className="mb12">
              <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Emergency Cash Reserve Safety Buffer
              </label>
              <Hint text={"Displays warning badges when your cash balance drops below this reserve floor before buying coaches or taking capex loans."} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[100_000, 200_000, 500_000, 1_000_000, 2_000_000].map((amt) => (
                  <button
                    key={amt}
                    className={`small ${reserveLimit === rs(amt) ? 'primary' : ''}`}
                    onClick={() => g.updatePlayerConfig({ emergencyReserveBuffer: rs(amt) })}
                  >
                    {fmtCompact(rs(amt))}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 8 }} className="small">
                Current safety buffer: <b>{fmtCompact(reserveLimit)}</b>
                {s.company.cash < reserveLimit ? (
                  <span className="pill small warn ml8">Cash below safety buffer</span>
                ) : (
                  <span className="pill small good ml8">Healthy reserve</span>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Overdraft Interest Protection</div>
              <div className="dim small">
                Overdraft credit line carries an annual interest rate of <b>{Math.round(BAL.odRateBps / 100)}% p.a.</b>
                {' '}Any incoming ticket settlements from RedBus (T+5) or Own App (T+1) automatically clear the overdraft balance before adding to cash.
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FLEET & OPERATIONS POLICIES                                        */}
      {/* ========================================================================= */}
      {activeTab === 'fleet' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Panel
              title="Coach Speed Governor Policy"
              info="Calibrate engine speed governors across your passenger and cargo fleet to balance fuel economy versus trip punctuality."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {([
                  ['eco', 'Eco-Cruise (70–75 km/h)', '+6% better diesel mileage · lower tyre wear · +10m trip duration'],
                  ['normal', 'Standard Highway (80–85 km/h)', 'Factory baseline fuel consumption & timetable punctuality'],
                  ['express', 'Express Fast-Track (90–95 km/h)', '-8% fuel economy · fast arrivals · +0.2★ passenger rating on long routes'],
                ] as const).map(([val, label, tip]) => (
                  <button
                    key={val}
                    className={`small ${speedGov === val ? 'primary' : ''}`}
                    style={{ textAlign: 'left', padding: '6px 10px', height: 'auto' }}
                    onClick={() => g.updatePlayerConfig({ speedGovernor: val })}
                  >
                    <div className="bold">{label}</div>
                    <div className="dim small">{tip}</div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title="Fleet Maintenance & Service Triggers"
              info="Operational rules for periodic vehicle servicing and tyre management."
            >
              <div className="mb12">
                <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Preventative Service Alert Threshold: <b>{prevServicePct}% condition</b>
                </label>
                <Hint text={"Flags a coach and alerts your workshop manager when any subsystem health drops below this point."} />
                <div style={{ display: 'flex', gap: 6 }}>
                  {[70, 75, 80, 85].map((pctVal) => (
                    <button
                      key={pctVal}
                      className={`small ${prevServicePct === pctVal ? 'primary' : ''}`}
                      onClick={() => g.updatePlayerConfig({ preventiveServiceThreshold: pctVal })}
                    >
                      {pctVal}%
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 12 }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Tyre Replacement Policy
                </label>
                <div className="muted">Change tyres when remaining life drops below:</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[10_000, 15_000, 20_000, 25_000].map((kmVal) => (
                    <button
                      key={kmVal}
                      className={`small ${tyreThresholdKm === kmVal ? 'primary' : ''}`}
                      onClick={() => g.updatePlayerConfig({ tyreReplacementKmThreshold: kmVal })}
                    >
                      {kmVal / 1000}k km
                    </button>
                  ))}
                </div>

                <div className="muted">Replacement tyre brand for automated bays:</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([
                    ['oem', 'OEM Premium (Michelin)'],
                    ['tier2', 'Tier-2 (Apollo / JK)'],
                    ['retread', 'Retread Casing'],
                  ] as const).map(([bVal, bLabel]) => (
                    <button
                      key={bVal}
                      className={`small ${prefTyre === bVal ? 'primary' : ''}`}
                      onClick={() => { g.updatePlayerConfig({ preferredTyreBrand: bVal }); g.setWorkshopTyreBrand(bVal === 'retread' ? 'tier2' : bVal) }}
                    >
                      {bLabel}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel
              title="Document Compliance Auto-Renewal"
              info="Automates payment for RTO documents so buses are never impounded or grounded."
            >
              <div className="form-row">
                <label>Fleet Paperwork Auto-Pay</label>
                <label className="flex">
                  <input
                    type="checkbox"
                    checked={cfg.autoRenewDocs !== false || !!docsManagerOnDuty(s)}
                    disabled={!!docsManagerOnDuty(s)}
                    onChange={(e) => g.setAutoRenewDocs(e.target.checked)}
                  />
                  <span className={cfg.autoRenewDocs !== false || !!docsManagerOnDuty(s) ? 'good' : 'warn'}>
                    {docsManagerOnDuty(s)
                      ? 'Locked On — Supervised by Document Manager desk'
                      : cfg.autoRenewDocs !== false
                      ? 'On — Auto-renews PUC, Fitness, Road Tax & Permits'
                      : 'Off — Papers lapse on due date'}
                  </span>
                </label>
              </div>
              <div className="dim small" style={{ marginTop: 6 }}>
                Renews commercial fitness ({fmtCompact(BAL.fitnessRenewalCost)}), PUC ({fmtCompact(BAL.pucCost)}),
                and AITP/MV tax automatically within {BAL.docRenewLeadDays} days of expiry.
              </div>
            </Panel>
          </div>

          <Panel
            title="Fleet Odometer Milestone Display"
            info="Highlight odometer readings at or above this mark wherever a coach's kilometres are shown. Each brand can have its own milestone threshold."
          >
            {activeGroups(s).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim, #888)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Brand Specific Limits
                </div>
                {activeGroups(s).map((grp) => {
                  const brandMark = grp.odoHighlightKm ?? odoMark
                  const isCustom = grp.odoHighlightKm != null
                  return (
                    <div
                      key={grp.id}
                      style={{
                        padding: '10px 12px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 6,
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                      }}
                    >
                      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
                          <GroupBadge group={grp} />
                          <b style={{ fontSize: '0.95rem' }}>{grp.name}</b>
                        </div>
                        <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
                          <b style={{ minWidth: 100, textAlign: 'right' }}>
                            {brandMark.toLocaleString('en-IN')} km
                          </b>
                          {isCustom ? (
                            <span className="accent small" style={{ fontSize: '0.75rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)' }}>
                              Custom
                            </span>
                          ) : (
                            <span className="dim small" style={{ fontSize: '0.75rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.05)' }}>
                              Default
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="form-row" style={{ marginBottom: 6 }}>
                        <label className="dim small" style={{ minWidth: 110 }}>Milestone Mark</label>
                        <input
                          type="range"
                          min={50_000}
                          max={2_000_000}
                          step={25_000}
                          value={brandMark}
                          onChange={(e) => g.updateGroup(grp.id, { odoHighlightKm: Number(e.target.value) })}
                          style={{ flex: 1, maxWidth: 280 }}
                        />
                      </div>

                      <div className="flex" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {[200_000, 300_000, 400_000, 500_000].map((km) => (
                          <button
                            key={km}
                            className={`small ${isCustom && brandMark === km ? 'primary' : ''}`}
                            onClick={() => g.updateGroup(grp.id, { odoHighlightKm: km })}
                          >
                            {km / 1_00_000}L km
                          </button>
                        ))}
                        {isCustom && (
                          <button
                            className="small"
                            style={{ marginLeft: 4, opacity: 0.8 }}
                            onClick={() => g.updateGroup(grp.id, { odoHighlightKm: undefined })}
                            title="Revert to company-wide default"
                          >
                            ↺ Revert to Default
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ marginTop: activeGroups(s).length > 0 ? 12 : 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim, #888)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                {activeGroups(s).length > 0 ? 'Company Default (Fallback & Unbranded)' : 'Company Milestone Limit'}
              </div>
              <div className="form-row">
                <label>Default Highlight</label>
                <input
                  type="range"
                  min={50_000}
                  max={2_000_000}
                  step={25_000}
                  value={odoMark}
                  onChange={(e) => g.setOdoHighlightKm(Number(e.target.value))}
                  style={{ flex: 1, maxWidth: 280 }}
                />
                <b style={{ minWidth: 100, textAlign: 'right' }}>{odoMark.toLocaleString('en-IN')} km</b>
              </div>
              <div className="flex" style={{ gap: 6 }}>
                {[200_000, 300_000, 400_000, 500_000].map((km) => (
                  <button
                    key={km}
                    className={`small ${odoMark === km ? 'primary' : ''}`}
                    onClick={() => g.setOdoHighlightKm(km)}
                  >
                    {km / 1_00_000}L km
                  </button>
                ))}
              </div>
            </div>

            <div className="dim small" style={{ marginTop: 12 }}>
              Coaches past their brand's milestone appear in <span className="warn">amber</span>; 25% past it in <span className="bad">red</span>.
            </div>
          </Panel>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: COMMERCIAL & CHANNELS                                              */}
      {/* ========================================================================= */}
      {activeTab === 'commercial' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <Panel
            title="Commercial OMC Fleet Fuel Contract"
            info="Tie up with an Oil Marketing Company (OMC) fleet card for monthly cashback rebates and guaranteed adulteration-free diesel."
          >
            <div className="stack10">
              <div className="form-row">
                <label>Active Fleet Card Partner</label>
                <select
                  value={s.company.fuelContract?.active ? s.company.fuelContract.partner : 'none'}
                  onChange={(e) => g.setFuelContract(e.target.value as FuelPartner)}
                >
                  <option value="none">None — Highway Pump Price (No Rebate, Exposed to Adulteration)</option>
                  <option value="indianoil">IndianOil (XtraPower Fleet Card · 2.5% Cashback Rebate)</option>
                  <option value="bpcl">BPCL (SmartFleet Card · 2.5% Cashback Rebate)</option>
                  <option value="hpcl">HPCL (DriveTrack Plus Card · 2.5% Cashback Rebate)</option>
                </select>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <b>Partner Benefits & Immunity</b>
                  <span className={s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' ? 'good small' : 'dim small'}>
                    {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' ? 'CONTRACT ACTIVE' : 'NO CONTRACT'}
                  </span>
                </div>
                <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="flex" style={{ gap: 6 }}>
                    <span className="good"></span>
                    <span><b>2.5% Monthly Cashback Rebate:</b> Accrues on every roadside fuel expense and settles in cash on Day 1.</span>
                  </div>
                  <div className="flex" style={{ gap: 6 }}>
                    <span className="good"></span>
                    <span><b>Adulterated Fuel Immunity:</b> Authorized network bunk guarantee eliminates 40% highway engine degradation risks!</span>
                  </div>
                </div>
              </div>

              <div className="flex" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span className="dim">Accrued Cashback this Month:</span>
                <b className="good">{fmtCompact(s.company.fuelCashbackAccrued ?? 0)}</b>
              </div>
            </div>
          </Panel>
          <Panel
            title="Sell-On Booking Channels (Fleet-Wide)"
            info="Configure your distribution network. Every service draws from this channel mix."
          >
            {(() => {
              const d = getScheduleDefaults(s)
              const toggle = (ch: Channel, on: boolean) =>
                g.setScheduleDefaults({ channels: { ...d.channels, [ch]: on } })
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CHANNELS.map((ch) => {
                    const meta = CHANNEL_META[ch]
                    const rate = ch === 'redbus'
                      ? `${(s.world.redbusCommissionBps / 100).toFixed(0)}%, T+${BAL.redbusSettleDays}`
                      : ch === 'ownapp'
                        ? `${(BAL.ownappPgBps / 100).toFixed(0)}% PG, T+${meta.settleDays}`
                        : ch === 'counter'
                          ? `${(BAL.counterCommissionBps / 100).toFixed(0)}%, cash agents`
                          : `${(meta.commissionBps / 100).toFixed(1)}%, T+${meta.settleDays}`
                    return (
                      <label key={ch} className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!d.channels[ch]}
                          onChange={(e) => toggle(ch, e.target.checked)}
                        />
                        <div>
                          <b>{meta.label}</b>
                          <span className="dim small"> · {rate}</span>
                          <div className="dim small">{meta.blurb}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )
            })()}
          </Panel>

          <Panel
            title="Dynamic Yield & Pricing Policy"
            info="Default yield rules applied across new scheduled services."
          >
            {(() => {
              const d = getScheduleDefaults(s)
              return (
                <div className="stack10">
                  <div className="form-row">
                    <label>Fare Mode</label>
                    <select
                      value={d.autoPrice ? 'auto' : 'manual'}
                      onChange={(e) => g.setScheduleDefaults({ autoPrice: e.target.value === 'auto' })}
                    >
                      <option value="auto">Auto Dynamic Yield (Adapts to corridor demand)</option>
                      <option value="manual">Manual Base Tariff</option>
                    </select>
                  </div>

                  <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={cfg.dynamicYieldSurge !== false}
                      onChange={(e) => g.updatePlayerConfig({ dynamicYieldSurge: e.target.checked })}
                    />
                    <div>
                      <b>Peak Day Yield Surge (+15%)</b>
                      <Hint text={"Automatically surges fares when bus occupancy crosses 75% on peak days (Fri/Sun/Festivals)."} />
                    </div>
                  </label>

                  <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!cfg.lastMinuteDiscount}
                      onChange={(e) => g.updatePlayerConfig({ lastMinuteDiscount: e.target.checked })}
                    />
                    <div>
                      <b>Last-Minute Seat Clearance (-15%)</b>
                      <Hint text={"Discounts unsold berths within 24 hours of departure if occupancy is below 40%."} />
                    </div>
                  </label>

                  <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={d.redDeal}
                      onChange={(e) => g.setScheduleDefaults({ redDeal: e.target.checked })}
                    />
                    <div>
                      <b>RedBus RedDeal Promotion</b>
                      <Hint text={"+30% OTA search visibility for +3% commission fee."} />
                    </div>
                  </label>
                </div>
              )
            })()}
          </Panel>

          <Panel
            title="Default Passenger Cancellation Policy"
            info="Company default for unassigned services and new brands. Each subsidiary can override this under Brand Groups."
          >
            {(() => {
              const d = getScheduleDefaults(s)
              const rule = CANCELLATION_POLICY_RULES[d.cancellation] ?? CANCELLATION_POLICY_RULES.standard
              return (
                <>
                  <div className="form-row" style={{ marginBottom: 8, flexWrap: 'nowrap' }}>
                    <label style={{ minWidth: 'auto', whiteSpace: 'nowrap' }}>Default Policy</label>
                    <select
                      style={{ flex: 1, minWidth: 0 }}
                      value={d.cancellation}
                      onChange={(e) => g.setScheduleDefaults({ cancellation: e.target.value as CancellationPolicy })}
                    >
                      <option value="flexible">{CANCELLATION_POLICY_RULES.flexible.label}</option>
                      <option value="standard">{CANCELLATION_POLICY_RULES.standard.label}</option>
                      <option value="strict">{CANCELLATION_POLICY_RULES.strict.label}</option>
                    </select>
                  </div>

                  <div style={{ padding: '6px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4 }}>
                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <b>{rule.label}</b>
                      <span className="small good">
                        {rule.demandMult > 1 ? `+${Math.round((rule.demandMult - 1) * 100)}% demand boost` : 'Standard demand'}
                      </span>
                    </div>
                    <table className="data small" style={{ width: '100%', margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Cancellation Timing</th>
                          <th className="num">Fee Retained</th>
                          <th className="num">Pax Refund</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>&gt; 24h before departure</td>
                          <td className="num good"><b>{Math.round(rule.tiers.over24h * 100)}%</b></td>
                          <td className="num dim">{100 - Math.round(rule.tiers.over24h * 100)}%</td>
                        </tr>
                        <tr>
                          <td>12h – 24h before departure</td>
                          <td className="num good"><b>{Math.round(rule.tiers.h12to24 * 100)}%</b></td>
                          <td className="num dim">{100 - Math.round(rule.tiers.h12to24 * 100)}%</td>
                        </tr>
                        <tr>
                          <td>4h – 12h before departure</td>
                          <td className="num good"><b>{Math.round(rule.tiers.h4to12 * 100)}%</b></td>
                          <td className="num dim">{100 - Math.round(rule.tiers.h4to12 * 100)}%</td>
                        </tr>
                        <tr>
                          <td>&lt; 4h before departure</td>
                          <td className="num good"><b>{Math.round(rule.tiers.under4h * 100)}%</b></td>
                          <td className="num dim">{100 - Math.round(rule.tiers.under4h * 100)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )
            })()}
          </Panel>

          <Panel
            title={`Own Mobile App — ${APP_TIER_NAMES[app.tier]}`}
            info="Direct direct-to-consumer digital channels save OTA commissions and settle T+1."
          >
            <KV rows={[
              ['App Tier', APP_TIER_NAMES[app.tier]],
              ['Total Downloads', Math.round(app.installs).toLocaleString('en-IN')],
              ['Monthly Active Users', <span className={app.mau >= BAL.appMauForParity ? 'good' : undefined}>{Math.round(app.mau).toLocaleString('en-IN')}</span>],
              ['Monthly Ad Spend', (
                <div className="row gap6">
                  <input
                    type="number"
                    value={mktDraft}
                    step={10000}
                    min={0}
                    disabled={app.tier === 0}
                    style={{ width: 100 }}
                    onChange={(e) => setMktDraft(e.target.value)}
                    onBlur={() => commitMarketing(mktDraft)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitMarketing(mktDraft) }}
                  />
                  <span className="dim small">₹/mo (CAC ~{fmtCompact(BAL.appCac)})</span>
                </div>
              )],
            ]} />
            {app.tier < 3 && (
              <div style={{ marginTop: 10 }}>
                <button className="primary small" onClick={() => g.buildAppTier((app.tier + 1) as 1 | 2 | 3)}>
                  Upgrade to {APP_TIER_NAMES[app.tier + 1]} ({fmtCompact(BAL.appBuildCost[app.tier + 1])})
                </button>
                <div className="dim small" style={{ marginTop: 4 }}>{APP_TIER_DESC[app.tier + 1]}</div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: SUBSIDIARIES & BRAND GROUPS                                          */}
      {/* ========================================================================= */}
      {activeTab === 'subsidiaries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Vehicle Brand Groups ("Subsidiaries")</div>
              <Hint text={"Separate fleet branding, passenger amenities, cabin fittings, ratings, and Primo standing. One shared balance sheet, payroll, and workshop."} />
            </div>
            <button className="primary small" onClick={() => { setShowCreateModal(true); setNewBrandName(''); setNewBrandCode(''); setNewBrandColor(GROUP_PALETTE[0]); setNewBrandCargo(false); setNewBrandPic(undefined); setNewBrandParentId('') }}>
              + Create Subsidiary Brand
            </button>
          </div>

          {/* Corporate Brand Hierarchy Tree Diagram */}
          <Panel
            title="Corporate Brand Hierarchy & Sub-brand Architecture"
            info="Visual tree diagram of parent brands and specialized subsidiary sub-brands. Click any brand to inspect its operations or add a sub-brand."
          >
            <BrandHierarchyTree
              s={s}
              onSelectBrand={(id) => {
                const el = document.getElementById(`brand-card-${id}`)
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              onAddSubBrand={(pId) => {
                setShowCreateModal(true)
                setNewBrandName('')
                setNewBrandCode('')
                setNewBrandColor(GROUP_PALETTE[Object.keys(s.groups ?? {}).length % GROUP_PALETTE.length])
                setNewBrandCargo(false)
                setNewBrandPic(undefined)
                setNewBrandParentId(pId ?? '')
              }}
            />
          </Panel>

          {/* Active Brands */}
          <div className="stack14">
            {activeGroups(s).length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <span className="empty" title="No active subsidiary brands configured. Fleet and schedules operate unassigned.">No brands configured.</span>
                <button className="primary small" onClick={() => setShowCreateModal(true)}>Create First Brand</button>
              </div>
            ) : (
              activeGroups(s).map((group) => {
                const busesInBrand = Object.values(s.buses).filter((b) => b.groupId === group.id)
                const schsInBrand = Object.values(s.schedules).filter((sch) => sch.groupId === group.id)
                const stars = brandStars(s, group.id)
                const isCargoBrand = Boolean(group.cargoBrand)
                const amenities = group.defaultAmenities ?? {}
                const fittings = group.defaultFittings ?? {}
                const isAmenityCardOpen = !!amenityCardOpen[group.id]
                const amenityTotal = AMENITY_CATALOG.reduce((sum, a) => sum + (amenities[a.id] ? a.cost : 0), 0)
                const amenityCount = AMENITY_CATALOG.filter((a) => amenities[a.id]).length
                const fittingCount = FITTING_CATALOG.filter((f) => fittings[f.id]).length
                const fittingSpend = FITTING_CATALOG.reduce((sum, f) => sum + (fittings[f.id] ? f.retrofitCost : 0), 0)
                const parentGroup = group.parentGroupId ? s.groups?.[group.parentGroupId] : undefined
                const descendants = getDescendantGroupIds(s.groups ?? {}, group.id)
                const eligibleParents = activeGroups(s).filter((b) => b.id !== group.id && !descendants.has(b.id))

                return (
                  <div key={group.id} id={`brand-card-${group.id}`}>
                    <Panel
                      title={
                        <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
                          <GroupBadge group={group} />
                          <span>{group.name}</span>
                          {isCargoBrand && <span className="pill warn small">Cargo</span>}
                          {parentGroup && (
                            <span className="dim small" style={{ fontWeight: 'normal' }}>
                              (Sub-brand of <b>{parentGroup.name}</b>)
                            </span>
                          )}
                        </div>
                      }
                      right={
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="small"
                            onClick={() => {
                              setShowCreateModal(true)
                              setNewBrandName('')
                              setNewBrandCode('')
                              setNewBrandColor(GROUP_PALETTE[Object.keys(s.groups ?? {}).length % GROUP_PALETTE.length])
                              setNewBrandCargo(false)
                              setNewBrandPic(undefined)
                              setNewBrandParentId(group.id)
                            }}
                            title={`Create a new sub-brand under ${group.name}`}
                          >
                            + Sub-brand
                          </button>
                          <button
                            type="button"
                            className="small"
                            onClick={() => setGalleryBrand(group)}
                            title="View and manage showcase fleet & livery gallery"
                          >
                            Gallery {group.gallery?.length ? `(${group.gallery.length})` : ''}
                          </button>
                          <BrandPicActions
                            value={group.brandingPic}
                            ownerKey={`group:${group.id}`}
                            kind="branding"
                            onChange={(pic) => {
                              const err = g.updateGroup(group.id, { brandingPic: pic })
                              if (err) g.toast(err, 'bad')
                              else g.toast(pic ? 'Branding pic updated.' : 'Branding pic removed.', 'good')
                            }}
                            onError={(msg) => g.toast(msg, 'bad')}
                          />
                          <button
                            className="danger small"
                            onClick={() => {
                              setRetireTarget(group)
                              setRetireDestination('')
                            }}
                          >
                            Close Brand...
                          </button>
                        </div>
                      }
                    >
                      <div className="stack14">
                          {/* Brand identity: brand detail | fleet detail | pic */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr minmax(120px, 180px)', gap: 16, alignItems: 'start' }}>
                            <div className="stack10">
                              <div className="dim small">Brand detail</div>
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
                                <label style={{ minWidth: 90, width: 90, whiteSpace: 'nowrap' }}>Brand Name</label>
                                <input
                                  type="text"
                                  style={{ width: '100%', maxWidth: 220 }}
                                  defaultValue={group.name}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim()
                                    if (val && val !== group.name) {
                                      const err = g.updateGroup(group.id, { name: val })
                                      if (err) g.toast(err, 'bad')
                                      else g.toast('Brand name updated.', 'good')
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  }}
                                />
                              </div>
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
                                <label style={{ minWidth: 90, width: 90, whiteSpace: 'nowrap' }}>Code</label>
                                <input
                                  type="text"
                                  maxLength={5}
                                  style={{ width: 88, textTransform: 'uppercase' }}
                                  defaultValue={group.code}
                                  title="Badge code (2-5 uppercase chars)"
                                  onBlur={(e) => {
                                    const val = e.target.value.trim().toUpperCase()
                                    if (val && val !== group.code) {
                                      const err = g.updateGroup(group.id, { code: val })
                                      if (err) {
                                        g.toast(err, 'bad')
                                        e.target.value = group.code
                                      } else {
                                        g.toast('Brand code updated.', 'good')
                                      }
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  }}
                                />
                              </div>
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                                <label style={{ minWidth: 90, width: 90, whiteSpace: 'nowrap', paddingTop: 4 }}>Badge Color</label>
                                <BadgeColorPellets
                                  value={group.color}
                                  onChange={(color) => g.updateGroup(group.id, { color })}
                                  size={18}
                                />
                              </div>

                              {/* Parent Brand Hierarchy Assignment */}
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
                                <label style={{ minWidth: 90, width: 90, whiteSpace: 'nowrap' }}>Parent Brand</label>
                                <select
                                  style={{ width: '100%', maxWidth: 220 }}
                                  value={group.parentGroupId ?? ''}
                                  onChange={(e) => {
                                    const newParent = e.target.value || undefined
                                    const err = g.updateGroup(group.id, { parentGroupId: newParent })
                                    if (err) g.toast(err, 'bad')
                                    else g.toast(newParent ? `Parent brand set to ${s.groups?.[newParent]?.name}.` : 'Set as top-level brand under company holding.', 'good')
                                  }}
                                >
                                  <option value="">{s.company.name || 'Company Holding'} (Direct)</option>
                                  {eligibleParents.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.code} — {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                          <div>
                            <div className="dim small" style={{ marginBottom: 6 }}>Fleet detail</div>
                            <div style={{ background: 'var(--bg3)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
                              <KV
                                rows={[
                                  ['Fleet size', `${busesInBrand.length} coaches · ${schsInBrand.length} active schedules`],
                                  [
                                    'Marketplace Rating',
                                    group.ratingCount >= BAL.groupRatingMinReviews ? (
                                      <span>
                                        <b className="good">★ {group.rating.toFixed(2)}</b>{' '}
                                        <span className="dim">({group.ratingCount} reviews · cancel {(group.cancelRate * 100).toFixed(1)}%)</span>
                                      </span>
                                    ) : (
                                      <span>
                                        <span className="dim">Inherits company ★ {s.company.rating.toFixed(2)}</span>{' '}
                                        <span className="small">({group.ratingCount}/{BAL.groupRatingMinReviews} reviews)</span>
                                      </span>
                                    ),
                                  ],
                                  ...(isCargoBrand ? [] : [[
                                    'Primo Status',
                                    group.primo ? (
                                      <span className="good bold">
                                        ★ PRIMO CERTIFIED {group.primoSinceDay ? `(since ${fmtDate(group.primoSinceDay)})` : ''}
                                      </span>
                                    ) : group.primoOffered ? (
                                      <span className="warn bold">INVITATION OFFERED (Check Inbox)</span>
                                    ) : (
                                      <span className="dim">Standard Listing</span>
                                    ),
                                  ] as [ReactNode, ReactNode]]),
                                  ['Avg Fleet Stars', stars != null ? `${stars.toFixed(1)} / 5.0 Quality Rating` : '— (No active coaches)'],
                                ]}
                              />
                            </div>
                          </div>

                          <div>
                            <BrandPicPicker
                              showActions={false}
                              value={group.brandingPic}
                              ownerKey={`group:${group.id}`}
                              kind="branding"
                              onChange={(pic) => {
                                const err = g.updateGroup(group.id, { brandingPic: pic })
                                if (err) g.toast(err, 'bad')
                                else g.toast(pic ? 'Branding pic updated.' : 'Branding pic removed.', 'good')
                              }}
                              onError={(msg) => g.toast(msg, 'bad')}
                            />
                          </div>
                        </div>


                        {/* Amenities & fittings — passenger brands only */}
                        {!isCargoBrand && (
                        <div style={{ background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                          <div
                            className="flex"
                            style={{
                              padding: '10px 12px',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 12,
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              className="small"
                              onClick={() => setAmenityCardOpen((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            >
                              <span>{isAmenityCardOpen ? '▾' : '▸'}</span>
                              <span>Amenities & Cabin Fittings</span>
                              <span className="dim">
                                ({amenityCount} amenities · {fmtCompact(amenityTotal)}/pax · {fittingCount} fittings · {fmtCompact(fittingSpend)} delivery)
                              </span>
                            </button>
                            <div className="flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
                                <label style={{ minWidth: 'auto', whiteSpace: 'nowrap' }}>Default Service Tier</label>
                                <select
                                  style={{ width: 130 }}
                                  value={group.defaultServiceTier ?? 'standard'}
                                  onChange={(e) => g.updateGroup(group.id, { defaultServiceTier: e.target.value as ServiceTier })}
                                >
                                  <option value="economy">Economy</option>
                                  <option value="standard">Standard</option>
                                  <option value="premium">Premium</option>
                                  <option value="gold">Deluxe (Luxury)</option>
                                </select>
                              </div>
                              <div className="form-row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
                                <label style={{ minWidth: 'auto', whiteSpace: 'nowrap' }}>Default Policy</label>
                                <select
                                  style={{ width: 300 }}
                                  value={group.defaultCancellation ?? getScheduleDefaults(s).cancellation}
                                  onChange={(e) => g.updateGroup(group.id, { defaultCancellation: e.target.value as CancellationPolicy })}
                                >
                                  <option value="flexible">{CANCELLATION_POLICY_RULES.flexible.label}</option>
                                  <option value="standard">{CANCELLATION_POLICY_RULES.standard.label}</option>
                                  <option value="strict">{CANCELLATION_POLICY_RULES.strict.label}</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {isAmenityCardOpen && (
                            <div className="grid-2" style={{ gap: 12, padding: '0 12px 12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg3)', padding: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
                                <div className="flex" style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-dim)' }}>
                                    DEFAULT PASSENGER AMENITIES (NEW SCHEDULES)
                                  </div>
                                  <div className="small bold">
                                    Selected <span className="good">{fmtCompact(amenityTotal)}/pax</span>
                                  </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
                                  {AMENITY_CATALOG.map((a) => (
                                    <label key={a.id} className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                                      <input
                                        type="checkbox"
                                        checked={!!amenities[a.id]}
                                        onChange={(e) => g.updateGroup(group.id, { defaultAmenities: { ...amenities, [a.id]: e.target.checked } })}
                                      />
                                      <div>
                                        <b>{a.title}</b>{' '}
                                        <span className="small good">
                                          (+{a.pssBonus} PSS{a.nightOnly ? ' night' : ''})
                                        </span>
                                        <div className="dim small">{a.blurb}</div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg3)', padding: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
                                <div className="flex" style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-dim)' }}>
                                    DEFAULT CABIN FITTINGS (NEW PURCHASES)
                                  </div>
                                  <div className="small bold">
                                    Selected <span className="good">{fmtCompact(fittingSpend)}</span>
                                    <span className="dim"> on delivery</span>
                                  </div>
                                </div>
                                {FITTING_CATALOG.map((f) => (
                                  <label key={f.id} className="flex" style={{ alignItems: 'center', gap: 8 }}>
                                    <input
                                      type="checkbox"
                                      checked={!!fittings[f.id]}
                                      onChange={(e) => g.updateGroup(group.id, { defaultFittings: { ...fittings, [f.id]: e.target.checked } })}
                                    />
                                    <div>
                                      <b>{f.title}</b>{' '}
                                      <span className="dim small">
                                        ({fmtCompact(f.retrofitCost)} on delivery
                                        {f.pssBonus > 0 ? ` · +${f.pssBonus} PSS` : ' · ops only'})
                                      </span>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Panel>
                </div>
              )
            })
            )}
          </div>

          {/* Fallback Unassigned amenity defaults */}
          <Panel
            title="Unassigned Fleet Default Amenities"
            info="Default amenity standards handed out on trips operated by coaches or schedules not assigned to any subsidiary brand."
          >
            {(() => {
              const cur = s.company.defaultAmenities ?? { waterBottle: false, snackHamper: false, sanitizedBedding: false }
              const update = (patch: Partial<typeof cur>) => g.setDefaultAmenities({ ...cur, ...patch })
              const amenityTotal = AMENITY_CATALOG.reduce((sum, a) => sum + (cur[a.id] ? a.cost : 0), 0)
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="flex" style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <span className="dim small">Per-pax consumables for unassigned trips</span>
                    <span className="small bold">
                      Selected <span className="good">{fmtCompact(amenityTotal)}/pax</span>
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                    {AMENITY_CATALOG.map((a) => (
                      <label key={a.id} className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!cur[a.id]}
                          onChange={(e) => update({ [a.id]: e.target.checked })}
                        />
                        <div>
                          <b>{a.title}</b>{' '}
                          <span className="small good">(+{a.pssBonus} PSS{a.nightOnly ? ' night' : ''})</span>
                          <div className="dim small">{a.blurb}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })()}
          </Panel>

          {/* Retired / Closed Brands Section */}
          {(() => {
            const retired = sortedGroups(Object.values(s.groups ?? {}).filter((grp) => grp.status === 'retired'))
            if (retired.length === 0) return null
            return (
              <Panel
                title="Closed / Retired Subsidiaries"
                info="Brands retired from active service. Historical financial ledgers and trip reports remain intact. Retired brands can be restored or permanently purged once holding no coaches."
              >
                <div className="stack10">
                  {retired.map((grp) => (
                    <div
                      key={grp.id}
                      className="flex"
                      style={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: 'var(--bg3)',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        opacity: 0.85,
                      }}
                    >
                      <div className="flex" style={{ alignItems: 'center', gap: 10 }}>
                        <GroupBadge group={grp} />
                        <div>
                          <b>{grp.name}</b>
                          {grp.cargoBrand && <span className="pill warn small ml6">Cargo</span>}
                          <span className="dim small"> (closed {fmtDate(grp.retiredDay ?? 0)})</span>
                          <div className="dim small">
                            Rating: ★ {grp.rating.toFixed(2)} ({grp.ratingCount} reviews)
                            {!grp.cargoBrand && <> · Primo: {grp.primo ? 'Yes' : 'No'}</>}
                          </div>
                        </div>
                      </div>
                      <div className="flex" style={{ gap: 8 }}>
                        <button
                          className="small primary"
                          onClick={() => {
                            const err = g.restoreGroup(grp.id)
                            if (err) g.toast(err, 'bad')
                            else g.toast(`Restored ${grp.name} to active service.`, 'good')
                          }}
                        >
                          Restore Brand
                        </button>
                        <button
                          className="small danger"
                          onClick={() => setDeleteConfirmId(grp.id)}
                        >
                          Delete Permanently
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: STAFF WELFARE & TAX ACCOUNTING                                     */}
      {/* ========================================================================= */}
      {/* ---------------- POLICIES ---------------- */}
      {activeTab === 'policies' && (() => {
        const pick = <T extends string,>(label: string, tip: string, value: T, options: readonly (readonly [T, string])[], onChange: (v: T) => void) => (
          <div className="form-row" title={tip}>
            <label>{label}</label>
            <Tabs inline tabs={options} value={value} onChange={onChange} />
          </div>
        )
        const num = (label: string, tip: string, value: number, min: number, max: number, step: number, unit: string, onChange: (v: number) => void) => (
          <div className="form-row" title={tip}>
            <label>{label}</label>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 180 }} />
            <b>{value}{unit}</b>
          </div>
        )
        return (
          <div className="grid-2">
            <Panel title="Fares">
              {num('Surge cap', 'The most a fare may rise above the base fare on ordinary days. Festival peaks follow their own rules.', cfg.surgeCapPct ?? 275, 100, 275, 5, '%', (v) => g.updatePlayerConfig({ surgeCapPct: v }))}
              {num('Last-minute fare', 'When the last-minute cut is on, near-empty trips on their final day sell at this share of the normal fare.', cfg.lastMinuteFloorPct ?? 85, 50, 100, 5, '%', (v) => g.updatePlayerConfig({ lastMinuteFloorPct: v }))}
            </Panel>
            <Panel title="Network">
              <label className="row gap" style={{ cursor: 'pointer' }} title="A new route starts at 60% of normal demand and reaches full demand after 90 days of service. A route nobody serves loses 0.5 points of maturity a day.">
                <input type="checkbox" checked={cfg.routeLifeCycle !== false} onChange={(e) => g.updatePlayerConfig({ routeLifeCycle: e.target.checked })} />
                <span>New routes ramp up over 90 days</span>
              </label>
            </Panel>
            <Panel title="Fleet">
              {pick('Cover for breakdowns', 'Who lends a spare coach when a bus breaks down. Needs a workshop manager.', cfg.autoCoverPolicy ?? 'same_brand',
                [['off', 'None'], ['same_brand', 'Same brand'], ['any', 'Any brand']] as const, (v) => g.updatePlayerConfig({ autoCoverPolicy: v }))}
              {pick('Insurance', 'Basic costs 30% less and pays claims 15 points lower. Comprehensive costs 30% more and pays 7 points higher.', cfg.insuranceTier ?? 'standard',
                [['basic', 'Basic'], ['standard', 'Standard'], ['comprehensive', 'Comprehensive']] as const, (v) => g.updatePlayerConfig({ insuranceTier: v }))}
            </Panel>
            <Panel title="People">
              {num('Training budget', 'Each ₹25,000 a month sends one crew member (lowest skill first) on a course: +1 skill and +2 morale.', Math.round((cfg.trainingBudgetPerMonth ?? 0) / 100 / 1000), 0, 200, 25, 'k/mo', (v) => g.updatePlayerConfig({ trainingBudgetPerMonth: rs(v * 1000) }))}
            </Panel>
            <Panel title="Cargo">
              {num('SLA tolerance', 'A freight run later than this, or one that breaks down, costs 10% of its freight and some reputation.', cfg.slaToleranceMin ?? 120, 30, 240, 15, ' min', (v) => g.updatePlayerConfig({ slaToleranceMin: v }))}
            </Panel>
          </div>
        )
      })()}

      {activeTab === 'welfare' && (
        <div className="stack14">
          {/* Driver Morale & Union Health Metric Bar */}
          {(() => {
            const drivers = Object.values(s.staff).filter((st) => st.role === 'driver' || (st.role as string) === 'co_driver')
            const avgMorale = drivers.length > 0 ? Math.round(drivers.reduce((a, d) => a + d.morale, 0) / drivers.length) : 100
            const strikeThreshold = (cfg.driverDormitoryTier === 'ac_canteen' ? 22 : cfg.driverDormitoryTier === 'basic' ? 30 : BAL.strikeMoraleThreshold)
            const isStrikeRisk = avgMorale < strikeThreshold + 10
            const onStrike = s.world.strikeUntilDay && s.world.strikeUntilDay >= s.day

            // Monthly welfare spend calculation
            const crewCount = drivers.length
            const mealPerMo = cfg.mealAllowance ? crewCount * 150 * 30 : 0
            const healthPerMo = cfg.healthCoverage ? Object.keys(s.staff).length * 250 : 0
            const dormDaily = cfg.driverDormitoryTier === 'ac_canteen' ? 25 : cfg.driverDormitoryTier === 'basic' ? 12 : 0
            const dormPerMo = dormDaily * crewCount * 30
            const totalWelfareMo = mealPerMo + healthPerMo + dormPerMo

            return (
              <StatRow
                items={[
                  { label: 'Driver morale', value: `${avgMorale}%`, tone: avgMorale >= 70 ? 'good' : avgMorale >= 50 ? 'warn' : 'bad', title: avgMorale >= 75 ? 'Excellent' : avgMorale >= 55 ? 'Satisfied' : avgMorale >= 35 ? 'Stressed' : 'Burnout' },
                  { label: 'Strike', value: onStrike ? `on strike ${s.world.strikeUntilDay - s.day + 1}d` : isStrikeRisk ? 'at risk' : 'calm', tone: onStrike || isStrikeRisk ? 'bad' : 'good', title: `Strike risk below ${strikeThreshold}% morale. ${cfg.driverDormitoryTier === 'ac_canteen' ? 'Executive bunks lower it to 22%.' : cfg.driverDormitoryTier === 'basic' ? 'Depot bunks lower it to 30%.' : 'No dorms: 35%.'}` },
                  { label: 'Drivers', value: crewCount, title: `${Object.keys(s.staff).length} employees in total` },
                  { label: 'Welfare/mo', value: fmtCompact(totalWelfareMo), title: `Dorms ${fmtCompact(dormPerMo)} · meals ${fmtCompact(mealPerMo)} · health ${fmtCompact(healthPerMo)}` },
                ]}
              />
            )
          })()}

          <div className="grid-2" style={{ gap: 12 }}>
            <Panel
              title="Depot Driver Dormitories & Crew Quarters"
              info="Long 8-hour highway shifts without bunk rest burn out drivers, collapse morale, and trigger union strikes. Providing high-standard dormitories accelerates fatigue recovery and buffers burnout."
            >
              <div className="stack10">
                {[
                  {
                    id: 'none' as DriverDormitoryTier,
                    title: 'No Company Dormitories (Roadside Rest)',
                    badge: 'Baseline · ₹0',
                    badgeTone: 'dim',
                    desc: 'Drivers sleep in bus passenger seats or roadside dhaba cots. High fatigue on continuous shifts (8+ hrs) triggers -3 daily morale burnout. Standard 35% strike threshold.',
                  },
                  {
                    id: 'basic' as DriverDormitoryTier,
                    title: 'Depot Driver Bunks & Terminal Rest Rooms',
                    badge: 'Standard · ₹12/day',
                    badgeTone: 'warn',
                    desc: 'Clean bunks, wall fans, lockers, and hot water showers at major terminal depots. +10 fatigue recovery overnight, +1 daily morale lift, buffers long-shift burnout to -1.',
                  },
                  {
                    id: 'ac_canteen' as DriverDormitoryTier,
                    title: 'Executive AC Sleeping Pods & Hot Canteen',
                    badge: 'Recommended · ₹25/day',
                    badgeTone: 'good',
                    desc: 'Soundproof AC dormitories, fresh laundered linen, clean shower suites, and subsidized hot meals. +25 fatigue recovery overnight, +2 daily morale lift, complete immunity to 8-hour continuous shift burnout, and cuts union strike threat risk by 60% (lowers threshold to 22%).',
                  },
                ].map((tier) => {
                  const selected = (cfg.driverDormitoryTier ?? 'none') === tier.id
                  return (
                    <div
                      key={tier.id}
                      onClick={() => g.setWelfareConfig({ driverDormitoryTier: tier.id })}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8,
                        border: selected ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                        background: selected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg3)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                          <input
                            type="radio"
                            name="dormTier"
                            checked={selected}
                            onChange={() => g.setWelfareConfig({ driverDormitoryTier: tier.id })}
                          />
                          <span>{tier.title}</span>
                        </label>
                        <span className={`pill small ${tier.badgeTone}`}>{tier.badge}</span>
                      </div>
                      <div className="dim small" style={{ marginLeft: 24 }}>
                        {tier.desc}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel
              title="Annual Festival Bonus Policy (Diwali, Pongal, Eid)"
              info="In Indian intercity passenger transport, festival bonuses (Diwali / Pongal / Eid) dictate driver loyalty and union peace. Select your company's standing festival policy."
            >
              <div className="stack10">
                {[
                  {
                    id: 'full' as FestivalBonusTier,
                    title: 'Full Festive Bonus (100% Monthly Salary)',
                    badge: 'Highest Morale · +20 Morale',
                    badgeTone: 'good',
                    desc: 'Auto-pays 1 month base salary 7 days before major festivals. Awards +20 morale and +10 driver loyalty. Guarantees zero festival strikes and high driver retention.',
                  },
                  {
                    id: 'half' as FestivalBonusTier,
                    title: 'Half-Month Bonus (50% Monthly Salary)',
                    badge: 'Balanced · +10 Morale',
                    badgeTone: 'good',
                    desc: 'Auto-pays 50% monthly salary. Awards +10 morale and +5 loyalty. Satisfies workforce expectations while keeping cash outflow controlled.',
                  },
                  {
                    id: 'gift' as FestivalBonusTier,
                    title: 'Festive Sweet Box & Allowance (₹2,500 Flat)',
                    badge: 'Frugal · +5 Morale',
                    badgeTone: 'warn',
                    desc: 'Distributes festive sweet boxes with ₹2,500 cash allowance per staff. Awards +5 morale and +2 loyalty. Ideal for lean periods.',
                  },
                  {
                    id: 'skip' as FestivalBonusTier,
                    title: 'Skip Festival Bonus (Save Cash)',
                    badge: 'High Risk · −15 Morale',
                    badgeTone: 'bad',
                    desc: 'Skips payouts to conserve treasury cash. Causes severe discontent: −15 morale, −5 loyalty, and immediately escalates union strike danger.',
                  },
                ].map((pol) => {
                  const selected = (cfg.festivalBonusTier ?? (cfg.festivalBonus === false ? 'skip' : 'full')) === pol.id
                  return (
                    <div
                      key={pol.id}
                      onClick={() => g.setWelfareConfig({ festivalBonusTier: pol.id, festivalBonus: pol.id !== 'skip' })}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8,
                        border: selected ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                        background: selected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg3)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                          <input
                            type="radio"
                            name="festTier"
                            checked={selected}
                            onChange={() => g.setWelfareConfig({ festivalBonusTier: pol.id, festivalBonus: pol.id !== 'skip' })}
                          />
                          <span>{pol.title}</span>
                        </label>
                        <span className={`pill small ${pol.badgeTone}`}>{pol.badge}</span>
                      </div>
                      <div className="dim small" style={{ marginLeft: 24 }}>
                        {pol.desc}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          </div>

          <div className="grid-2" style={{ gap: 12 }}>
            <Panel
              title="Operational Crew Allowances & Healthcare"
              info="Statutory benefits and route allowances for road safety and health."
            >
              <div className="stack10">
                <div className="form-row">
                  <label>Daily Crew Meal Allowance</label>
                  <label className="flex">
                    <input
                      type="checkbox"
                      checked={!!cfg.mealAllowance}
                      onChange={(e) => g.setWelfareConfig({ mealAllowance: e.target.checked })}
                    />
                    <span className={cfg.mealAllowance ? 'good' : 'dim'}>
                      {cfg.mealAllowance ? 'Active' : 'Off'}
                    </span>
                  </label>
                  <Hint text={"₹150/crew/day flat; replaces per-trip driver bata"} />
                </div>

                <div className="form-row">
                  <label>Crew Health Insurance</label>
                  <label className="flex">
                    <input
                      type="checkbox"
                      checked={!!cfg.healthCoverage}
                      onChange={(e) => g.setWelfareConfig({ healthCoverage: e.target.checked })}
                    />
                    <span className={cfg.healthCoverage ? 'good' : 'dim'}>
                      {cfg.healthCoverage ? 'Active' : 'Off'}
                    </span>
                  </label>
                  <Hint text={"₹250/staff/mo; lowers sick leave by 40% & accident downtime by 30%"} />
                </div>

                <div className="form-row">
                  <label>Driver Eco-Driving Mileage Bonus</label>
                  <label className="flex">
                    <input
                      type="checkbox"
                      checked={!!s.company.ecoIncentiveActive}
                      onChange={(e) => g.toggleEcoIncentive(e.target.checked)}
                    />
                    <span className={s.company.ecoIncentiveActive ? 'good' : 'dim'}>
                      {s.company.ecoIncentiveActive ? 'Active (₹250/trip)' : 'Off'}
                    </span>
                  </label>
                  <Hint text={"Pays ₹250/trip mileage incentive to assigned drivers; delivers +8% fuel mileage and cuts tyre/brake wear by 15%!"} />
                </div>
              </div>
            </Panel>

          <Panel
            title="Tax & Asset Depreciation Policy"
            info="Set your statutory tax and asset accounting policy. Locked in on bus acquisitions."
          >
            <div className="form-row mb8">
              <label>Depreciation Method</label>
              <select
                value={s.company.depreciationDefault ?? 'SLM'}
                onChange={(e) => g.setDepreciationDefault(e.target.value as DepreciationMethod)}
              >
                <option value="SLM">SLM — Straight Line (Steady annual write-off)</option>
                <option value="WDV">WDV — Written Down Value (Accelerated tax shield)</option>
                <option value="NONE">None — No depreciation</option>
              </select>
            </div>

            {depMethod !== 'NONE' && (
              <>
                <div className="form-row mb8">
                  <label>Annual Write-Off Rate</label>
                  <input
                    type="range"
                    min={BAL.depreciationRateMinPct}
                    max={BAL.depreciationRateMaxPct}
                    step={BAL.depreciationRateStepPct}
                    value={depRate}
                    onChange={(e) => g.setDepreciationRate(Number(e.target.value))}
                    style={{ flex: 1, maxWidth: 240 }}
                  />
                  <b style={{ minWidth: 46, textAlign: 'right' }}>{depRate.toFixed(1)}%</b>
                  <button
                    className="small"
                    disabled={s.company.depreciationRatePct === undefined}
                    onClick={() => g.setDepreciationRate(null)}
                    title="Follow statutory standard rate"
                  >
                    Standard
                  </button>
                </div>
                <div className="dim small mb8">
                  {depMethod === 'SLM'
                    ? `Writes off ${depRate.toFixed(1)}% yearly (~${fmtCompact(monthlyFor)}/mo on a ₹70L coach). Reaches 15% salvage value in ${lifeYears.toFixed(1)} years.`
                    : `Takes ${depRate.toFixed(1)}% of remaining book yearly (~${fmtCompact(monthlyFor)}/mo in yr 1). Reaches 15% salvage floor in ${lifeYears.toFixed(1)} years.`}
                </div>
              </>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div className="dim small">
                Corporate advance income tax is provided at <b>{Math.round(BAL.incomeTaxRate * 100)}%</b> of net taxable profit on month-end. Loss months incur zero tax liability.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    )}

      {/* ========================================================================= */}
      {/* TAB: PASSENGER HANDLING & LOUNGE POLICIES                                 */}
      {/* ========================================================================= */}
      {activeTab === 'lounges' && (
        <div className="stack14">
          {/* Top Lounge Network Status Bar */}
          {(() => {
            const lounges = s.company.lounges ?? []
            const totalPax = lounges.reduce((a, l) => a + l.yesterdayPax, 0)
            const totalRev = lounges.reduce((a, l) => a + l.yesterdaySnackRevenue, 0)
            const totalOpex = lounges.reduce((a, l) => a + l.yesterdayRentExpense + l.yesterdayElectricExpense + l.yesterdayStaffExpense, 0)
            const netProfit = totalRev - totalOpex

            return (
              <StatRow
                items={[
                  { label: 'Lounges', value: lounges.length, title: `${new Set(lounges.map((l) => l.cityId)).size} cities` },
                  { label: 'Pax/day', value: totalPax.toLocaleString('en-IN') },
                  { label: 'Sales/day', value: fmtCompact(totalRev), tone: 'good' },
                  { label: 'Net/day', value: `${netProfit >= 0 ? '+' : ''}${fmtCompact(netProfit)}`, tone: netProfit >= 0 ? 'good' : 'bad', title: `Opex ${fmtCompact(totalOpex)}/day (rent, power, staff)` },
                ]}
              />
            )
          })()}

          {/* Policy Panels */}
          <div className="grid-2" style={{ gap: 12 }}>
            <Panel
              title="Passenger Hospitality & Refreshment Policies"
              info="Set service standards across all company waiting lounges. Influences passenger satisfaction, lounge conversion, and recurring opex."
            >
              {(() => {
                const pCfg = s.config?.passengerConfig ?? {}
                return (
                  <div className="stack10">
                    <div className="form-row">
                      <label>Complimentary Welcome Tea & Filter Coffee</label>
                      <label className="flex">
                        <input
                          type="checkbox"
                          checked={!!pCfg.complimentaryTeaCoffee}
                          onChange={(e) => g.updatePassengerConfig({ complimentaryTeaCoffee: e.target.checked })}
                        />
                        <span className={pCfg.complimentaryTeaCoffee ? 'good' : 'dim'}>
                          {pCfg.complimentaryTeaCoffee ? 'Active (₹4/pax)' : 'Off (Paid only)'}
                        </span>
                      </label>
                      <Hint text={"Offers free hot filter coffee, tea & mineral water. Draws +12% more passengers into the lounge, increasing passenger review ratings!"} />
                    </div>

                    <div className="form-row">
                      <label>Free High-Speed Optical Wi-Fi</label>
                      <label className="flex">
                        <input
                          type="checkbox"
                          checked={!!pCfg.freeHighSpeedWifi}
                          onChange={(e) => g.updatePassengerConfig({ freeHighSpeedWifi: e.target.checked })}
                        />
                        <span className={pCfg.freeHighSpeedWifi ? 'good' : 'dim'}>
                          {pCfg.freeHighSpeedWifi ? 'Active (₹50/lounge/day)' : 'Off'}
                        </span>
                      </label>
                      <Hint text={"Provides unlimited optical fiber Wi-Fi and universal USB-C fast-charging ports for waiting travelers."} />
                    </div>

                    <div className="form-row">
                      <label>Lounge Admission Access Tier</label>
                      <select
                        value={pCfg.accessPolicy ?? 'all_passengers'}
                        onChange={(e) => g.updatePassengerConfig({ accessPolicy: e.target.value as any })}
                        style={{ minWidth: 200 }}
                      >
                        <option value="all_passengers">Open to All Scheduled Passengers</option>
                        <option value="ac_only">Exclusive to AC & Sleeper Ticket Holders</option>
                      </select>
                      <span className="dim small">
                        {pCfg.accessPolicy === 'ac_only'
                          ? 'Restricts lounge access to premium AC & Sleeper passengers to maintain quiet executive exclusivity.'
                          : 'Welcomes all passengers holding a confirmed ticket on your departures.'}
                      </span>
                    </div>
                  </div>
                )
              })()}
            </Panel>

            <Panel
              title="Passenger Safety, Security & Boarding Alerts"
              info="Safeguard passenger luggage, prevent gate confusion, and elevate operational safety."
            >
              {(() => {
                const pCfg = s.config?.passengerConfig ?? {}
                return (
                  <div className="stack10">
                    <div className="form-row">
                      <label>24/7 CCTV & Luggage Tag Tracking</label>
                      <label className="flex">
                        <input
                          type="checkbox"
                          checked={!!pCfg.cctvLuggageSecurity}
                          onChange={(e) => g.updatePassengerConfig({ cctvLuggageSecurity: e.target.checked })}
                        />
                        <span className={pCfg.cctvLuggageSecurity ? 'good' : 'dim'}>
                          {pCfg.cctvLuggageSecurity ? 'Active (₹40/lounge/day)' : 'Off'}
                        </span>
                      </label>
                      <Hint text={"Digital barcode luggage tagging and high-def CCTV monitoring. Eliminates baggage loss disputes and theft concerns."} />
                    </div>

                    <div className="form-row">
                      <label>Live Bus Tracking & WhatsApp Boarding Alerts</label>
                      <label className="flex">
                        <input
                          type="checkbox"
                          checked={!!pCfg.boardingAssistanceAlerts}
                          onChange={(e) => g.updatePassengerConfig({ boardingAssistanceAlerts: e.target.checked })}
                        />
                        <span className={pCfg.boardingAssistanceAlerts ? 'good' : 'dim'}>
                          {pCfg.boardingAssistanceAlerts ? 'Active (₹30/lounge/day)' : 'Off'}
                        </span>
                      </label>
                      <Hint text={"Sends live GPS bus ETA SMS & WhatsApp messages to waiting passengers, followed by staff-assisted boarding calls."} />
                    </div>
                  </div>
                )
              })()}
            </Panel>
          </div>

          {/* Active Lounges Summary & Link */}
          <Panel
            title="City Waiting Rooms & Schedules Handled"
            info="Detailed operational breakdown of passenger lounges operating across your route network."
            right={
              <Link to="/lounges" className="button small primary">
                Open / Manage Lounges Page →
              </Link>
            }
          >
            {(() => {
              const lounges = s.company.lounges ?? []
              if (lounges.length === 0) {
                return (
                  <span className="empty" title="No passenger lounges opened yet. Click the button above to establish your first lounge.">No lounges yet.</span>
                )
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lounges.map((l) => {
                    const tierDef = getLoungeTierDef(l.tier)
                    const schedules = getLoungeSchedulesHandled(s, l.cityId)
                    return (
                      <div
                        key={l.id}
                        style={{
                          padding: '10px 12px',
                          background: 'var(--bg3)',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div className="bold">
                            {l.locationName} <span className="dim">({cityName(l.cityId)})</span>
                          </div>
                          <div className="dim small mt2">
                            {tierDef.label} · {schedules.total} departures/arrivals handled · {l.yesterdayPax} pax/day
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div className="good small bold">
                              +{fmtCompact(l.yesterdaySnackRevenue)} snacks/day
                            </div>
                            <div className="dim small">
                              −{fmtCompact(l.yesterdayRentExpense + l.yesterdayElectricExpense + l.yesterdayStaffExpense)} fixed opex
                            </div>
                          </div>
                          <span
                            className={`pill small ${l.yesterdayNetProfit >= 0 ? 'good' : 'warn'}`}
                            style={{ minWidth: 70, textAlign: 'center' }}
                          >
                            {l.yesterdayNetProfit >= 0 ? '+' : ''}{fmtCompact(l.yesterdayNetProfit)}/d
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </Panel>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: SAVE DATA & SYSTEM                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'system' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <Panel title="Game Metadata & Storage Working Set">
            <KV rows={[
              ['Company Name', s.company.name],
              ['Difficulty', diff.label],
              ['Start Date', fmtDate(s.startDay)],
              ['Days Played', `${s.day - s.startDay} days`],
              ['World Seed', s.seed.toString(36)],
              [
                'Save Directory',
                saveFolderMode === 'local' && saveDir
                  ? saveDir
                  : saveFolderMode === 'hosted'
                    ? 'Browser only (live site — no local folder)'
                    : 'Checking…',
              ],
              ['Save File Size', saveInfo.bytes > 0 ? `${(saveInfo.bytes / 1024).toFixed(0)} KB` : 'In memory'],
              ['Database Footprint', `${footprint.trips} trips · ${footprint.txns} ledger rows · ${footprint.routeDays} route-days`],
            ]} />

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="primary small" onClick={() => {
                if (g.save()) g.toast(`Game saved · ${fmtDate(s.day)}`, 'good')
                else g.toast('Save failed — storage may be full. Export to file.', 'bad')
              }}>Save Now</button>

              <button className="small" onClick={() => {
                if (g.compactSave()) g.toast('Database compacted — old detail rolled up.', 'good')
                else g.toast('Could not compact save.', 'bad')
              }} title="Compresses completed trips and route-days">Compact Database</button>

              <button className="small" onClick={exportSave} title={saveFolderMode === 'local' ? 'Writes to gameSave folder' : 'Download a JSON save file'}>Export Save File</button>
              <button className="small" onClick={() => fileRef.current?.click()}>Import Save File</button>
              {saveFolderMode === 'local' && (
                <button className="small" onClick={openSaveDir}>Open gameSave Folder</button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importSave(f)
                  e.target.value = ''
                }}
              />
            </div>

            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <b className="bad">Create New Game (Empty All Data)</b>
                  <Hint text={"Clears all active saves, deletes company records, and returns to setup to start Day 1 fresh."} />
                </div>
                {!confirming ? (
                  <button className="small danger" onClick={() => setConfirming(true)}>
                    + Create New Game…
                  </button>
                ) : (
                  <div className="row gap">
                    <span className="bad small">Empty all data and start new game?</span>
                    <button
                      className="small danger"
                      onClick={() => {
                        g.resetToNewGame()
                        g.toast('Save data emptied. Ready to register a new company.', 'good')
                      }}
                    >
                      Yes, Empty Data & Start New Game
                    </button>
                    <button className="small" onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            title={
              saveFolderMode === 'hosted'
                ? 'Browser Saves (live site)'
                : `gameSave Folder Details & Saves (${saveFiles.length})`
            }
            flat
            right={
              saveFolderMode === 'local' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="small"
                    onClick={loadSaveList}
                    disabled={saveLoading}
                    title="Rescan gameSave directory"
                  >
                    {saveLoading ? 'Scanning…' : 'Refresh'}
                  </button>
                  <button
                    className="small"
                    onClick={openSaveDir}
                    title="Open gameSave folder in File Explorer"
                  >
                    Open Folder
                  </button>
                </div>
              ) : undefined
            }
          >
            {saveFolderMode === 'hosted' ? (
              <div style={{ padding: '20px 16px' }}>
                <div className="dim small mb10">
                  The live hosted build cannot open your PC’s <code>Downloads/gameSave</code> folder
                  (that only works with local <code>npm run dev</code>). Progress is kept in this browser;
                  use files to move saves between devices.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="small primary" onClick={exportSave}>Export Save File</button>
                  <button className="small" onClick={() => fileRef.current?.click()}>Import Save File</button>
                </div>
              </div>
            ) : (
            <>
            <div style={{ padding: '8px 10px', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <div>
                <span className="dim">Folder: </span>
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}><b>{saveDir || '…'}</b></span>
              </div>
              <div className="dim">
                {saveFiles.length > 0
                  ? `${saveFiles.length} file${saveFiles.length === 1 ? '' : 's'} · Total ${(saveFiles.reduce((acc, f) => acc + (f.size || 0), 0) / 1024).toFixed(0)} KB`
                  : saveLoading ? 'Scanning…' : '0 files found'}
              </div>
            </div>

            {saveLoading && saveFiles.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }} className="dim small">
                Scanning gameSave directory for saves…
              </div>
            ) : saveError && saveFiles.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div className="bad small mb8">
                  Directory service offline or not reachable ({saveError}).
                </div>
                <div className="dim small mb12">
                  You can still save and load using the <b>Export Save File</b> and <b>Import Save File</b> buttons on the left.
                </div>
                <button className="small" onClick={loadSaveList}>Try Again</button>
              </div>
            ) : saveFiles.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <div className="dim small mb10">
                  No <code>.json</code> save files found in <code>{saveDir || 'gameSave'}</code>.
                </div>
                <div className="dim small mb14">
                  Click <b>Export Save File</b> on the left to write your current game directly into this folder, or click <b>Refresh</b> once you place save files there.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button className="small primary" onClick={exportSave}>Export Save File Now</button>
                  <button className="small" onClick={loadSaveList}>Refresh List</button>
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="data small" style={{ width: '100%', margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th className="num">Size</th>
                      <th>Saved Date & Time</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {saveFiles.map((f) => {
                      const dateStr = f.mtime
                        ? new Date(f.mtime).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'
                      return (
                        <tr key={f.name}>
                          <td style={{ fontFamily: 'monospace' }}><b>{f.name}</b></td>
                          <td className="num">{Math.round(f.size / 1024)} KB</td>
                          <td className="dim">{dateStr}</td>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            <button
                              className="small"
                              onClick={() => {
                                if (confirm(`Load ${f.name}? Current session will be overwritten.`)) {
                                  loadDirectSave(f.name)
                                }
                              }}
                            >
                              Load
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>
            )}
          </Panel>

          <div style={{ gridColumn: '1 / -1' }}>
            <CloudSavesPanel />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <Panel title="Keyboard Shortcuts Reference" flat>
              <div style={{ padding: 10 }}>
                <div className="grid-2" style={{ gap: 10 }}>
                  <table className="data small" style={{ margin: 0 }}>
                    <thead>
                      <tr><th style={{ width: 40 }}>Key</th><th>Tab</th></tr>
                    </thead>
                    <tbody>
                      {TABS.map((t) => (
                        <tr key={t.key}>
                          <td><kbd>{t.key.toUpperCase()}</kbd></td>
                          <td><b>{t.name}</b> <span className="dim">({t.path})</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <table className="data small" style={{ margin: 0 }}>
                    <thead>
                      <tr><th style={{ width: 40 }}>Key</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {GLOBAL_SHORTCUTS.map((sc) => (
                        <tr key={sc.key}>
                          <td><kbd>{sc.key}</kbd></td>
                          <td>{sc.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: BODY DESIGNS                                                         */}
      {/* ========================================================================= */}
      {activeTab === 'body_designs' && (
        <div className="stack14">
          <Panel
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>Chassis Coachwork & Body Builders</span>
                <span
                  className="pill small"
                  style={{
                    background: 'rgba(34, 197, 94, 0.12)',
                    color: '#4ade80',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  Shared Across All Saves
                </span>
              </div>
            }
            flat
            info="Custom body designs and coach images are saved globally and automatically shared across all your game saves and new games. You configure them once, and they remain across all saves."
            right={
              <button
                className="small dim"
                onClick={() => setConfirmResetDesigns(true)}
                title="Reset designs and images back to default factory catalog"
              >
                Reset Defaults…
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Cloud Catalog Status bar */}
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg3)',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  fontSize: '0.82rem',
                }}
              >
                <div className="row gap wrap">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isCloudImagesConfigured() ? '#22c55e' : '#eab308',
                      display: 'inline-block',
                    }}
                  />
                  <span>
                    <b>Supabase Cloud Catalog:</b>{' '}
                    {isCloudImagesConfigured() ? 'Auto-synced with Supabase' : 'Offline / Local only'}
                  </span>
                  {lastSyncTime ? (
                    <span className="dim">
                      · Last synced: {new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(lastSyncTime).toLocaleDateString()})
                    </span>
                  ) : null}
                  {cloudSyncing && (
                    <span className="dim" style={{ fontStyle: 'italic', marginLeft: 6 }}>
                      ({cloudSyncStatus || 'Syncing…'})
                    </span>
                  )}
                </div>
              </div>

              {Object.values(bodyBuilders).map((builder) => {
                const count = builder.designs.length
                return (
                  <div
                    key={builder.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--panel-alt, #151a21)',
                      padding: 16,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>{builder.name}</span>
                        <div className="small dim mt4">
                          <span>Compatible makers: <b>{builder.makers.join(', ')}</b></span>
                          {' · '}
                          <span>Packages: <b>{count} design{count === 1 ? '' : 's'}</b></span>
                        </div>
                      </div>
                      <button
                        className="small primary"
                        onClick={() => openAddDesign(builder.id)}
                      >
                        + Add Design
                      </button>
                    </div>

                    {builder.designs.length === 0 ? (
                      <div className="small dim" style={{ padding: 12, background: 'var(--bg3)', borderRadius: 6, textAlign: 'center' }}>
                        No body designs registered for {builder.name}. Click "+ Add Design" to create one.
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                        {builder.designs.map((d) => (
                          <div
                            key={d.id}
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              background: 'var(--bg)',
                              padding: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 12 }}>
                              {d.image ? (
                                <img
                                  src={d.image}
                                  alt={d.name}
                                  onClick={() => setLightboxUrl(d.image || null)}
                                  title="Click to view full photo"
                                  style={{
                                    width: 100,
                                    height: 65,
                                    objectFit: 'cover',
                                    borderRadius: 4,
                                    border: '1px solid var(--border)',
                                    flexShrink: 0,
                                    cursor: 'pointer',
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 100,
                                    height: 65,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'var(--bg3)',
                                    borderRadius: 4,
                                    border: '1px solid var(--border)',
                                    color: 'var(--dim)',
                                    fontSize: '0.75rem',
                                    flexShrink: 0,
                                  }}
                                >
                                  No photo
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{d.name}</div>
                                <div className="small dim mt4">
                                  {(() => {
                                    const pool = chassisNameOptions(builder.makers)
                                    const range = bodyPackagePriceRange(builder.id, d, pool)
                                    return (
                                      <span>
                                        Body package:{' '}
                                        <b>
                                          {range.minLakhs === range.maxLakhs
                                            ? `+${fmtCompact(range.min)}`
                                            : `+${fmtCompact(range.min)}–${fmtCompact(range.max)}`}
                                        </b>
                                      </span>
                                    )
                                  })()}
                                </div>
                                <div className="small dim">
                                  <span>Lead time: <b>{d.leadDaysAdd >= 0 ? `+${d.leadDaysAdd}d` : `${d.leadDaysAdd}d`}</b></span>
                                </div>
                                <div className="small dim">
                                  <span>Comfort: <b className={d.comfortDelta >= 0 ? 'good' : 'bad'}>{d.comfortDelta >= 0 ? `+${d.comfortDelta}` : d.comfortDelta}</b></span>
                                  {' · '}
                                  <span>Upkeep: <b className={d.maintDelta <= 0 ? 'good' : 'bad'}>{d.maintDelta >= 0 ? `+${Math.round(d.maintDelta * 100)}%` : `${Math.round(d.maintDelta * 100)}%`}</b></span>
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                              <button className="small" onClick={() => openEditDesign(builder.id, d)}>
                                Edit
                              </button>
                              <button className="small bad" onClick={() => deleteDesign(builder.id, d.id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      )}

      {showCreateModal && (
        <Modal
          title="Create Subsidiary Brand"
          onClose={() => setShowCreateModal(false)}
          actions={
            <>
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!newBrandName.trim() || newBrandCode.trim().length < 2 || newBrandCode.trim().length > 5}
                onClick={() => {
                  const res = g.createGroup({
                    name: newBrandName.trim(),
                    code: newBrandCode.trim().toUpperCase(),
                    color: newBrandColor,
                    cargoBrand: newBrandCargo || undefined,
                    brandingPic: newBrandPic,
                    parentGroupId: newBrandParentId || undefined,
                  })
                  if ('error' in res) {
                    g.toast(res.error, 'bad')
                  } else {
                    g.toast(`Created brand ${newBrandName.trim()}.`, 'good')
                    setShowCreateModal(false)
                    setNewBrandName('')
                    setNewBrandCode('')
                    setNewBrandCargo(false)
                    setNewBrandPic(undefined)
                    setNewBrandParentId('')
                  }
                }}
              >
                Create Brand
              </button>
            </>
          }
        >
          <div className="stack12">
            <div className="form-row">
              <label>Brand Name</label>
              <input
                type="text"
                placeholder="e.g. Royal Express"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Badge Code (2-5 letters)</label>
              <input
                type="text"
                maxLength={5}
                placeholder="e.g. REX"
                style={{ textTransform: 'uppercase', width: 120 }}
                value={newBrandCode}
                onChange={(e) => setNewBrandCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="form-row">
              <label>Badge Color</label>
              <BadgeColorPellets value={newBrandColor} onChange={setNewBrandColor} size={18} />
            </div>
            {activeGroups(s).length > 0 && (
              <div className="form-row">
                <label>Parent company (optional)</label>
                <select
                  value={newBrandParentId}
                  onChange={(e) => setNewBrandParentId(e.target.value)}
                  style={{ minWidth: 200 }}
                >
                  <option value="">None — top-level brand</option>
                  {activeGroups(s).map((grp) => (
                    <option key={grp.id} value={grp.id}>
                      {grp.code} — {grp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-row">
              <label>Branding pic (optional)</label>
              <BrandPicPicker
                value={newBrandPic}
                ownerKey="group:new"
                kind="branding"
                onChange={setNewBrandPic}
                onError={(msg) => g.toast(msg, 'bad')}
              />
            </div>
            <div className="form-row">
              <label>Brand Type</label>
              <label className="flex" style={{ alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={newBrandCargo}
                  onChange={(e) => setNewBrandCargo(e.target.checked)}
                />
                <span>Cargo brand</span>
                <Hint text={"Hides amenities, fittings, tier & refund policy"} />
              </label>
            </div>
          </div>
        </Modal>
      )}

      {retireTarget && (
        <Modal
          title={`Close Subsidiary Brand: ${retireTarget.name} (${retireTarget.code})`}
          onClose={() => setRetireTarget(null)}
          actions={
            <>
              <button onClick={() => setRetireTarget(null)}>Cancel</button>
              <button
                className="danger"
                onClick={() => {
                  const err = g.retireGroup(retireTarget.id, retireDestination || undefined)
                  if (err) {
                    g.toast(err, 'bad')
                  } else {
                    g.toast(`Closed brand ${retireTarget.name}.`, 'good')
                    setRetireTarget(null)
                  }
                }}
              >
                Confirm Close
              </button>
            </>
          }
        >
          <div className="stack12">
            <p>
              Retire <b>{retireTarget.name}</b>? It leaves pickers and scheduling; ledger and trip history stay.
            </p>
            {(() => {
              const bCount = Object.values(s.buses).filter((b) => b.groupId === retireTarget.id).length
              const sCount = Object.values(s.schedules).filter((sch) => sch.groupId === retireTarget.id).length
              const otherBrands = activeGroups(s).filter((grp) => grp.id !== retireTarget.id)
              return (
                <>
                  <div style={{ background: 'var(--bg3)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                    <div><b>Coaches to reassign:</b> {bCount}</div>
                    <div><b>Schedules to reassign:</b> {sCount}</div>
                  </div>
                  <div className="form-row">
                    <label>Transfer fleet & schedules to:</label>
                    <select
                      value={retireDestination}
                      onChange={(e) => setRetireDestination(e.target.value)}
                    >
                      {otherBrands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                      <option value="">Unassigned</option>
                    </select>
                  </div>
                </>
              )
            })()}
          </div>
        </Modal>
      )}

      {deleteConfirmId && (
        <Modal
          title="Delete Brand Permanently"
          onClose={() => setDeleteConfirmId(null)}
          actions={
            <>
              <button onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button
                className="danger"
                onClick={() => {
                  const err = g.deleteGroup(deleteConfirmId)
                  if (err) {
                    g.toast(err, 'bad')
                  } else {
                    g.toast('Brand permanently purged.', 'good')
                    setDeleteConfirmId(null)
                  }
                }}
              >
                Purge Brand
              </button>
            </>
          }
        >
          <p>
            Delete this brand permanently? Past coach history moves to Unassigned. This cannot be undone.
          </p>
        </Modal>
      )}

      {editingDesign && (
        <Modal
          title={editingDesign.isNew ? 'Add Coach Body Design' : `Edit ${editingDesign.design.name}`}
          onClose={() => setEditingDesign(null)}
          actions={
            <>
              <button onClick={() => setEditingDesign(null)}>Cancel</button>
              <button className="primary" onClick={saveDesignModal}>
                {editingDesign.isNew ? 'Add Design' : 'Save Changes'}
              </button>
            </>
          }
        >
          <div className="stack12">
            <div className="form-row">
              <label>Design Name</label>
              <input
                value={designForm.name}
                onChange={(e) => setDesignForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. ARVEX Elite Sleeper"
                style={{ width: 280 }}
              />
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ paddingTop: 6 }}>Seating Layout</label>
              <div className="grow">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {COACH_LAYOUT_OPTIONS.map((opt) => {
                    const selected = designForm.layoutKinds.includes(opt.id)
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`small ${selected ? 'primary' : ''}`}
                        onClick={() => {
                          setDesignForm((f) => {
                            const exists = f.layoutKinds.includes(opt.id)
                            if (exists) {
                              if (f.layoutKinds.length <= 1) return f
                              return { ...f, layoutKinds: f.layoutKinds.filter((k) => k !== opt.id) }
                            }
                            return { ...f, layoutKinds: [...f.layoutKinds, opt.id] }
                          })
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ paddingTop: 4 }}>Chassis lengths</label>
              <div className="grow">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {chassisNameOptions(bodyBuilders[editingDesign.builderId]?.makers ?? ['Ashok Leyland', 'BharatBenz']).map((name) => {
                    const checked = designForm.chassisNames.includes(name)
                    return (
                      <label key={name} className="flex" style={{ alignItems: 'center', gap: 6, minWidth: 90 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setDesignForm((f) => ({
                              ...f,
                              chassisNames: e.target.checked
                                ? [...f.chassisNames, name]
                                : f.chassisNames.filter((n) => n !== name),
                            }))
                          }}
                        />
                        <span>{chassisPlatformLabel(name)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ paddingTop: 6 }}>Coach grade</label>
              <div className="grow">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {BODY_QUALITY_TIERS.map((tier) => {
                    const selected =
                      matchBodyQualityTier(
                        designForm.comfortDelta,
                        designForm.maintDeltaPct,
                        designForm.leadDaysAdd,
                      ) === tier.id
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        className={`small ${selected ? 'primary' : ''}`}
                        onClick={() =>
                          setDesignForm((f) => ({
                            ...f,
                            comfortDelta: tier.comfortDelta,
                            maintDeltaPct: tier.maintDeltaPct,
                            leadDaysAdd: tier.leadDaysAdd,
                          }))
                        }
                      >
                        {tier.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ paddingTop: 4 }}>Body package</label>
              <div className="grow">
                {(() => {
                  const builderId = editingDesign.builderId
                  const makers = bodyBuilders[builderId]?.makers ?? ['Ashok Leyland', 'BharatBenz']
                  const pool = chassisNameOptions(makers)
                  const names = designForm.chassisNames.length > 0 ? designForm.chassisNames : pool
                  const gradeId = matchBodyQualityTier(
                    designForm.comfortDelta,
                    designForm.maintDeltaPct,
                    designForm.leadDaysAdd,
                  )
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {names.map((name) => {
                        const lakhs = bodyPackageLakhs(builderId, name, gradeId)
                        return (
                          <span
                            key={name}
                            className="pill small"
                            style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                          >
                            {chassisPlatformLabel(name)}: <b>+{fmtCompact(L(lakhs))}</b>
                          </span>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label>Design Image</label>
              <div style={{ flex: 1, maxWidth: 360 }}>
                <BrandPicPicker
                  value={designForm.image}
                  ownerKey={`design:${designForm.id || 'new'}`}
                  kind="body_design"
                  onChange={(img) => setDesignForm((f) => ({ ...f, image: img }))}
                  onError={(err) => g.toast(err, 'bad')}
                />
              </div>
            </div>

            <div className="form-row">
              <label>Secondary market</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={designForm.availableUsed}
                    onChange={(e) => setDesignForm((f) => ({ ...f, availableUsed: e.target.checked }))}
                  />
                  <span>Used</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={designForm.availableLeaseAttach}
                    onChange={(e) => setDesignForm((f) => ({ ...f, availableLeaseAttach: e.target.checked }))}
                  />
                  <span>Lease & attached</span>
                </label>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {confirmResetDesigns && (
        <Modal
          title="Reset Body Designs to Defaults?"
          onClose={() => setConfirmResetDesigns(false)}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="danger" onClick={handleResetDefaults}>
                Yes, Reset All Designs
              </button>
              <button onClick={() => setConfirmResetDesigns(false)}>
                Cancel
              </button>
            </div>
          }
        >
          <div className="stack10">
            <p>
              Reset coach builders and designs to the default catalog. Custom designs and photos are removed from all saves.
            </p>
          </div>
        </Modal>
      )}

      <BrandGalleryModal
        group={galleryBrand}
        isOpen={Boolean(galleryBrand)}
        onClose={() => setGalleryBrand(null)}
        onUpdateGroup={(id, patch) => g.updateGroup(id, patch)}
        onToast={(msg, kind) => g.toast(msg, kind)}
      />

      {lightboxUrl && (
        <LightboxModal
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </>
  )
}
