import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { CancellationPolicy, Channel, DepreciationMethod, FuelPartner, ServiceTier, BusGroup, BodyDesign } from '../../engine/types'
import {
  BODY_QUALITY_TIERS,
  DEFAULT_BODY_BUILDERS,
  chassisNameOptions,
  chassisPlatformLabel,
  matchBodyQualityTier,
  bodyPackageLakhs,
  bodyPackagePriceRange,
} from '../../engine/data/bodyBuilders'
import { GROUP_PALETTE, isLightBadgeColor, brandStars, activeGroups, sortedGroups } from '../../engine/sim/groups'
import { KV, Panel, Modal, GroupBadge } from '../bits'
import { BrandPicActions, BrandPicPicker } from '../BrandPicPicker'
import { TABS, GLOBAL_SHORTCUTS } from '../navigation'

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
  size = 26,
}: {
  value: string
  onChange: (color: string) => void
  size?: number
}) {
  return (
    <div className="flex" style={{ gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
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
              borderRadius: 7,
              background: `linear-gradient(145deg, ${color}ee, ${color})`,
              border: selected
                ? '2px solid #fff'
                : light
                  ? '1px solid rgba(255,255,255,0.55)'
                  : '1px solid rgba(255,255,255,0.18)',
              boxShadow: selected
                ? `0 0 0 2px ${color}, 0 2px 8px rgba(0,0,0,0.45)`
                : light
                  ? 'inset 0 0 0 1px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.35)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.35)',
              cursor: 'pointer',
              padding: 0,
              transform: selected ? 'scale(1.08)' : undefined,
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
  const [activeTab, setActiveTab] = useState<'flow' | 'fleet' | 'commercial' | 'subsidiaries' | 'body_designs' | 'welfare' | 'system'>('flow')
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
    image: undefined,
    chassisNames: [],
    availableUsed: true,
    availableLeaseAttach: true,
  })

  const openEditDesign = (builderId: string, d: BodyDesign) => {
    setEditingDesign({ builderId, design: d, isNew: false })
    const baseSecondary = d.secondaryMarket !== false
    setDesignForm({
      id: d.id,
      name: d.name,
      leadDaysAdd: d.leadDaysAdd,
      comfortDelta: d.comfortDelta,
      maintDeltaPct: Math.round(d.maintDelta * 100),
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
    const newDesign: BodyDesign = {
      id: designForm.id || `bd_${Date.now()}`,
      name,
      bodyPrice,
      leadDaysAdd: Number(designForm.leadDaysAdd) || 0,
      comfortDelta: Math.round(Number(designForm.comfortDelta) * 10) / 10,
      maintDelta: Math.round((Number(designForm.maintDeltaPct) / 100) * 1000) / 1000,
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
      <div className="page-title">
        <span>Settings & Operations Configuration</span>
        <span className="sub">
          {s.company.name} · {diff.label} Difficulty · Day {s.day}
        </span>
        <span className="spacer" />
        <span className="flex" style={{ gap: 6 }}>
          {([
            ['flow', '🎮 Gameplay & Auto-Pause'],
            ['fleet', '🚌 Fleet Policies'],
            ['commercial', '🏷️ Commercial & Channels'],
            ['subsidiaries', '🏢 Subsidiaries & Brands'],
            ['body_designs', '🎨 Body Designs'],
            ['welfare', '👥 Welfare & Taxes'],
            ['system', '💾 Save Data & System'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={`small ${activeTab === id ? 'primary' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: GAMEPLAY & AUTO-PAUSE TRIGGERS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'flow' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <Panel
            title="Simulation Auto-Pause Triggers"
            info="Automatically stops the day advance when critical events happen so you never fast-forward into bankruptcy, breakdowns, or strikes."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={cfg.pauseOnLowCash !== false}
                    onChange={(e) => g.updatePlayerConfig({ pauseOnLowCash: e.target.checked })}
                  />
                  <div>
                    <b>Pause on Low Cash Emergency</b>
                    <div className="dim small">
                      Halts day advance if cash drops below the configured safe floor.
                    </div>
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
                  <div className="dim small">
                    Immediately interrupts time-skips so you can dispatch cover buses or order repairs.
                  </div>
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
                  <div className="dim small">
                    Stops the clock if fitness, PUC, or commercial tax expires and buses risk checkpost impound.
                  </div>
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
                  <div className="dim small">
                    Alerts you immediately before crew union action or mass resignations take place.
                  </div>
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
                  <div className="dim small">
                    Stops at the start of each month to review monthly P&L, balance sheet, and tax provisioning.
                  </div>
                </div>
              </label>

              <div className="dim small" style={{ marginTop: 4 }}>
                Inbox decisions never stop a week advance — distress sales, banking alerts and customer
                disputes keep queueing while the clock runs, and you answer them from the inbox whenever
                you are ready.
              </div>
            </div>
          </Panel>

          <Panel
            title="Financial Risk & Safety Guardrails"
            info="Establish financial safety floors to prevent over-leveraging and accidental capital depletion."
          >
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Emergency Cash Reserve Safety Buffer
              </label>
              <div className="dim small" style={{ marginBottom: 8 }}>
                Displays warning badges when your cash balance drops below this reserve floor before buying coaches or taking capex loans.
              </div>
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
                  <span className="pill small warn" style={{ marginLeft: 8 }}>⚠️ Cash below safety buffer</span>
                ) : (
                  <span className="pill small good" style={{ marginLeft: 8 }}>✓ Healthy reserve</span>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Overdraft Interest Protection</div>
              <div className="dim small">
                Overdraft credit line carries an annual interest rate of <b>{Math.round(BAL.overdraftAnnualRate * 100)}% p.a.</b>
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
          <Panel
            title="Coach Speed Governor Policy"
            info="Calibrate engine speed governors across your passenger and cargo fleet to balance fuel economy versus trip punctuality."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
              {([
                ['eco', '🌱 Eco-Cruise (70–75 km/h)', '+6% better diesel mileage · lower tyre wear · +10m trip duration'],
                ['normal', '⚖️ Standard Highway (80–85 km/h)', 'Factory baseline fuel consumption & timetable punctuality'],
                ['express', '⚡ Express Fast-Track (90–95 km/h)', '-8% fuel economy · fast arrivals · +0.2★ passenger rating on long routes'],
              ] as const).map(([val, label, tip]) => (
                <button
                  key={val}
                  className={`small ${speedGov === val ? 'primary' : ''}`}
                  style={{ textAlign: 'left', padding: '6px 10px', height: 'auto' }}
                  onClick={() => g.updatePlayerConfig({ speedGovernor: val })}
                >
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div className="dim small">{tip}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="Fleet Maintenance & Service Triggers"
            info="Operational rules for periodic vehicle servicing and tyre management."
          >
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Preventative Service Alert Threshold: <b>{prevServicePct}% condition</b>
              </label>
              <div className="dim small" style={{ marginBottom: 6 }}>
                Flags a coach and alerts your workshop manager when any subsystem health drops below this point.
              </div>
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
              <div className="dim small" style={{ marginBottom: 6 }}>
                Trigger tyre change when remaining tyre lifespan drops below:
              </div>
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

              <div className="dim small" style={{ marginBottom: 4 }}>Preferred replacement tyre brand for automated workshop bays:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  ['oem', 'OEM Premium (Michelin)'],
                  ['tier2', 'Tier-2 (Apollo / JK)'],
                  ['retread', 'Retread Casing'],
                ] as const).map(([bVal, bLabel]) => (
                  <button
                    key={bVal}
                    className={`small ${prefTyre === bVal ? 'primary' : ''}`}
                    onClick={() => g.updatePlayerConfig({ preferredTyreBrand: bVal })}
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
              Renews commercial fitness ({fmtCompact(BAL.fitnessRenewalCost)}), PUC ({fmtCompact(BAL.pucRenewalCost)}),
              and AITP/MV tax automatically within {BAL.docRenewLeadDays} days of expiry.
            </div>
          </Panel>

          <Panel
            title="Fleet Odometer Milestone Display"
            info="Highlight odometer readings at or above this mark wherever a coach's kilometres are shown."
          >
            <div className="form-row">
              <label>Odometer Highlight</label>
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
            <div className="dim small" style={{ marginTop: 6 }}>
              Coaches past this mark appear in <span className="warn">amber</span>; 25% past it in <span className="bad">red</span>.
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' ? '✓ CONTRACT ACTIVE' : 'NO CONTRACT'}
                  </span>
                </div>
                <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="flex" style={{ gap: 6 }}>
                    <span className="good">✓</span>
                    <span><b>2.5% Monthly Cashback Rebate:</b> Accrues on every roadside fuel expense and settles in cash on Day 1.</span>
                  </div>
                  <div className="flex" style={{ gap: 6 }}>
                    <span className="good">✓</span>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                      <div className="dim small">
                        Automatically surges fares when bus occupancy crosses 75% on peak days (Fri/Sun/Festivals).
                      </div>
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
                      <div className="dim small">
                        Discounts unsold berths within 24 hours of departure if occupancy is below 40%.
                      </div>
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
                      <div className="dim small">+30% OTA search visibility for +3% commission fee.</div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
              <div className="dim small">
                Separate fleet branding, passenger amenities, cabin fittings, ratings, and Primo standing. One shared balance sheet, payroll, and workshop.
              </div>
            </div>
            <button className="primary small" onClick={() => { setShowCreateModal(true); setNewBrandName(''); setNewBrandCode(''); setNewBrandColor(GROUP_PALETTE[0]); setNewBrandCargo(false); setNewBrandPic(undefined); setNewBrandParentId('') }}>
              + Create Subsidiary Brand
            </button>
          </div>

          {/* Active Brands */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeGroups(s).length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="dim" style={{ marginBottom: 10 }}>No active subsidiary brands configured. Fleet and schedules operate unassigned.</div>
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

                return (
                  <Panel
                    key={group.id}
                    title={
                      <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
                        <GroupBadge group={group} />
                        <span>{group.name}</span>
                        {isCargoBrand && <span className="pill warn small">Cargo</span>}
                        {parentGroup && (
                          <span className="dim small" style={{ fontWeight: 'normal' }}>
                            (Owned by {parentGroup.name})
                          </span>
                        )}
                      </div>
                    }
                    right={
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <BrandPicActions
                          value={group.brandingPic}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {/* Brand identity: brand detail | fleet detail | pic */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr minmax(120px, 180px)', gap: 16, alignItems: 'start' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                                size={24}
                              />
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
                                      <span className="good" style={{ fontWeight: 600 }}>
                                        ★ PRIMO CERTIFIED {group.primoSinceDay ? `(Day ${group.primoSinceDay}+)` : ''}
                                      </span>
                                    ) : group.primoOffered ? (
                                      <span className="warn" style={{ fontWeight: 600 }}>INVITATION OFFERED (Check Inbox)</span>
                                    ) : (
                                      <span className="dim">Standard Listing</span>
                                    ),
                                  ]]),
                                  ['Avg Fleet Stars', stars != null ? `${stars.toFixed(1)} / 5.0 Quality Rating` : '— (No active coaches)'],
                                ]}
                              />
                            </div>
                          </div>

                          <div>
                            <BrandPicPicker
                              showActions={false}
                              value={group.brandingPic}
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
                                  <div className="small" style={{ fontWeight: 600 }}>
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
                                  <div className="small" style={{ fontWeight: 600 }}>
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
                    <span className="small" style={{ fontWeight: 600 }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                          {grp.cargoBrand && <span className="pill warn small" style={{ marginLeft: 6 }}>Cargo</span>}
                          <span className="dim small"> (Closed Day {grp.retiredDay})</span>
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
      {activeTab === 'welfare' && (
        <div className="grid-2" style={{ gap: 12 }}>
          <Panel
            title="Operational Staff Welfare Policies"
            info="Improves driver retention, reduces fatigue and road accidents, and lowers sick leave."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                <span className="dim small">₹150/crew/day flat; replaces per-trip driver bata</span>
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
                <span className="dim small">₹250/staff/mo; lowers sick leave by 40% & accident downtime by 30%</span>
              </div>

              <div className="form-row">
                <label>Annual Festival Bonus</label>
                <label className="flex">
                  <input
                    type="checkbox"
                    checked={cfg.festivalBonus !== false}
                    onChange={(e) => g.setWelfareConfig({ festivalBonus: e.target.checked })}
                  />
                  <span className={cfg.festivalBonus !== false ? 'good' : 'dim'}>
                    {cfg.festivalBonus !== false ? 'Active' : 'Off'}
                  </span>
                </label>
                <span className="dim small">Annual 1-month festive bonus for crew (+15 morale; auto-paid if HR on duty)</span>
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
                <span className="dim small">Pays ₹250/trip mileage incentive to assigned drivers; delivers +8% fuel mileage and cuts tyre/brake wear by 15%!</span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Tax & Asset Depreciation Policy"
            info="Set your statutory tax and asset accounting policy. Locked in on bus acquisitions."
          >
            <div className="form-row" style={{ marginBottom: 8 }}>
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
                <div className="form-row" style={{ marginBottom: 8 }}>
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
                <div className="dim small" style={{ marginBottom: 8 }}>
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
                  <div className="dim small">Clears all active saves, deletes company records, and returns to setup to start Day 1 fresh.</div>
                </div>
                {!confirming ? (
                  <button className="small danger" onClick={() => setConfirming(true)}>
                    + Create New Game…
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    {saveLoading ? 'Scanning…' : '🔄 Refresh'}
                  </button>
                  <button
                    className="small"
                    onClick={openSaveDir}
                    title="Open gameSave folder in File Explorer"
                  >
                    📂 Open Folder
                  </button>
                </div>
              ) : undefined
            }
          >
            {saveFolderMode === 'hosted' ? (
              <div style={{ padding: '20px 16px' }}>
                <div className="dim small" style={{ marginBottom: 10 }}>
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
                <div className="bad small" style={{ marginBottom: 8 }}>
                  ⚠️ Directory service offline or not reachable ({saveError}).
                </div>
                <div className="dim small" style={{ marginBottom: 12 }}>
                  You can still save and load using the <b>Export Save File</b> and <b>Import Save File</b> buttons on the left.
                </div>
                <button className="small" onClick={loadSaveList}>Try Again</button>
              </div>
            ) : saveFiles.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <div className="dim small" style={{ marginBottom: 10 }}>
                  No <code>.json</code> save files found in <code>{saveDir || 'gameSave'}</code>.
                </div>
                <div className="dim small" style={{ marginBottom: 14 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel
            title="Chassis Coachwork & Body Builders"
            flat
            info="Custom body designs apply strictly to Ashok Leyland and BharatBenz passenger chassis. BharatBenz includes its OEM Factory builder, while Ashok Leyland uses specialist third-party builders. Player can adjust design packages, pricing, lead times, and upload coach images."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                                  style={{
                                    width: 100,
                                    height: 65,
                                    objectFit: 'cover',
                                    borderRadius: 4,
                                    border: '1px solid var(--border)',
                                    flexShrink: 0,
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
                                  Chassis:{' '}
                                  <b>
                                    {d.chassisNames && d.chassisNames.length > 0
                                      ? d.chassisNames.map(chassisPlatformLabel).join(' ')
                                      : 'All lengths'}
                                  </b>
                                </div>
                                <div className="small dim">
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <BadgeColorPellets value={newBrandColor} onChange={setNewBrandColor} size={28} />
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
              <BrandPicPicker value={newBrandPic} onChange={setNewBrandPic} onError={(msg) => g.toast(msg, 'bad')} />
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
                <span className="dim small">Hides amenities, fittings, tier & refund policy</span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              Retiring <b>{retireTarget.name}</b> will remove it from active pickers and scheduling.
              Historical ledger entries and trip reports remain intact.
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
            Are you sure you want to permanently delete this brand record?
            This will purge the brand and rewrite past coach history entries to Unassigned.
            This action cannot be undone.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <label style={{ paddingTop: 4 }}>Chassis lengths</label>
              <div style={{ flex: 1 }}>
                <div className="small dim" style={{ marginBottom: 6 }}>
                  Leave all unchecked to allow every chassis. Tick only the platforms this body fits.
                </div>
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
              <div style={{ flex: 1 }}>
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
                        title={`${tier.blurb} · comfort ${tier.comfortDelta >= 0 ? '+' : ''}${tier.comfortDelta} · upkeep ${tier.maintDeltaPct >= 0 ? '+' : ''}${tier.maintDeltaPct}% · +${tier.leadDaysAdd}d · body ${tier.bodyPriceAddLakhs >= 0 ? '+' : ''}${tier.bodyPriceAddLakhs}L`}
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
                <div className="small dim" style={{ marginTop: 6 }}>
                  {(() => {
                    const tier = BODY_QUALITY_TIERS.find(
                      (t) =>
                        t.id
                        === matchBodyQualityTier(
                          designForm.comfortDelta,
                          designForm.maintDeltaPct,
                          designForm.leadDaysAdd,
                        ),
                    )!
                    return (
                      <>
                        {tier.blurb} · comfort{' '}
                        <b className={tier.comfortDelta >= 0 ? 'good' : 'bad'}>
                          {tier.comfortDelta >= 0 ? '+' : ''}
                          {tier.comfortDelta}
                        </b>
                        {' · '}
                        upkeep{' '}
                        <b className={tier.maintDeltaPct <= 0 ? 'good' : 'bad'}>
                          {tier.maintDeltaPct >= 0 ? '+' : ''}
                          {tier.maintDeltaPct}%
                        </b>
                        {' · '}
                        body lead <b>+{tier.leadDaysAdd}d</b>
                        {' · '}
                        price{' '}
                        <b>
                          {tier.bodyPriceAddLakhs >= 0 ? '+' : ''}
                          {tier.bodyPriceAddLakhs}L
                        </b>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ paddingTop: 4 }}>Body package</label>
              <div style={{ flex: 1 }}>
                <div className="small dim" style={{ marginBottom: 6 }}>
                  Auto from builder brand × chassis length × coach grade (not editable).
                </div>
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
    </>
  )
}
