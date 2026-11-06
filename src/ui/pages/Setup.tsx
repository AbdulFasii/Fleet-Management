import type { Scenario } from '../../engine/types'
import { useEffect, useRef, useState } from 'react'
import { fmtDate } from '../../engine/core/calendar'
import { useGameActions } from '../../store/gameStore'
import { listCloudSaves, type CloudSaveHeader } from '../../store/cloudGameSave'
import { DIFFICULTIES } from '../../engine/data/balance'
import { starterRoutes } from '../../engine/newGame'
import { routeName, ROUTES, haulBrief, haulTitle, routeViaLabel } from '../../engine/data/routes'
import { fmtCompact } from '../../engine/core/money'
import type { Difficulty } from '../../engine/types'

const SCENARIO_DETAILS: Record<Scenario, { title: string; desc: string; highlights: string[] }> = {
  standard: {
    title: 'Standard Campaign',
    desc: 'The complete bus tycoon experience. Balance loan EMIs, diesel spikes, permits, and bus upkeep.',
    highlights: ['Win goal: ₹100 Cr net worth', 'Distress rescue loans permitted', 'Save/load anytime'],
  },
  sandbox: {
    title: 'Sandbox Free Play',
    desc: 'Risk-free playground to experiment with routes, luxury coach builders, and custom liveries without fear of failure.',
    highlights: ['+₹10.00 Cr extra starting promoter capital', 'Bankruptcy disabled (cannot lose)', 'Indefinite gameplay (no victory cutoff)'],
  },
  ironman: {
    title: 'Ironman Hardcore Mode',
    desc: 'High-stakes trial for seasoned operators. Every misstep is permanent with higher victory targets.',
    highlights: ['Win goal: ₹150 Cr net worth', 'Zero rescue loans — insolvency causes permanent bankruptcy', 'Save import locked during active game'],
  },
}

export function SetupScreen() {
  const g = useGameActions()
  const startNew = g.startNew
  const [name, setName] = useState('')
  const [diff, setDiff] = useState<Difficulty>('malik')
  const [scenario, setScenario] = useState<Scenario>('standard')
  const [route, setRoute] = useState(starterRoutes()[0])
  const [saveFiles, setSaveFiles] = useState<{ name: string; size: number; mtime: string }[]>([])
  const [cloudSaves, setCloudSaves] = useState<CloudSaveHeader[]>([])
  const [selectedCloudId, setSelectedCloudId] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/save-files')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.files)) setSaveFiles(d.files)
      })
      .catch(() => {})

    listCloudSaves()
      .then((list) => {
        setCloudSaves(list)
        if (list.length > 0) setSelectedCloudId(list[0].id)
      })
      .catch(() => {})
  }, [])

  const loadCloud = (id: string) => {
    g.loadCloudSaveById(id).then((res) => {
      if (res.ok) g.toast(`Loaded "${res.label}" from cloud.`, 'good')
      else g.toast(res.error || 'Failed to load cloud save.', 'bad')
    })
  }

  const importSave = (file: File) => {
    file.text()
      .then((text) => {
        const result = g.importSaveJson(text)
        if (!result.ok) {
          g.toast(result.error ?? 'Could not import that file.', 'bad')
        }
      })
      .catch(() => g.toast('Could not read the file from disk.', 'bad'))
  }

  const loadSaveFile = (fileName: string) => {
    fetch(`/api/load-save?file=${encodeURIComponent(fileName)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.content) {
          const res = g.importSaveJson(d.content)
          if (!res.ok) g.toast(res.error ?? 'Could not import save.', 'bad')
        } else {
          g.toast(d.error ?? 'Failed to read save file.', 'bad')
        }
      })
      .catch(() => g.toast('Network error loading save file.', 'bad'))
  }

  const isNameValid = name.trim().length > 0

  const handleRegister = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      g.toast('Please enter a company name to register.', 'warn')
      return
    }
    startNew(trimmed, diff, route, scenario)
  }

  return (
    <div className="setup-screen">
      <h1>Fleet Operator</h1>

      <div className="form-row">
        <label>Company name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isNameValid) {
              handleRegister()
            }
          }}
          placeholder="Enter company name..."
          style={{ width: 260 }}
          maxLength={28}
        />
      </div>

      <div className="diff-cards">
        {DIFFICULTIES.map((d) => (
          <div key={d.id} className={`diff-card ${diff === d.id ? 'sel' : ''}`} title={d.desc} onClick={() => setDiff(d.id)}>
            <h3>{d.label}</h3>
            <ul>
              <li>Seed capital {fmtCompact(d.seedCapital)}</li>
              <li>Credit score {d.startCredit}</li>
            </ul>
          </div>
        ))}
      </div>

      <div className="form-row">
        <label>Scenario</label>
        <div className="subtabs inline">
          {([
            ['standard', 'Standard'],
            ['sandbox', 'Sandbox'],
            ['ironman', 'Ironman'],
          ] as const).map(([id, label]) => (
            <button key={id} className={`small ${scenario === id ? 'primary' : ''}`} onClick={() => setScenario(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="callout" style={{ maxWidth: 560, marginTop: -4, marginBottom: 14, padding: '10px 14px', fontSize: '0.85rem' }}>
        <div style={{ fontWeight: 600, color: 'var(--accent, #f59e0b)', marginBottom: 3 }}>
          {SCENARIO_DETAILS[scenario].title}
        </div>
        <div className="dim small" style={{ marginBottom: 6, lineHeight: '1.4' }}>
          {SCENARIO_DETAILS[scenario].desc}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.78rem' }}>
          {SCENARIO_DETAILS[scenario].highlights.map((h, i) => (
            <span key={i} className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--accent, #f59e0b)' }}>◆</span> {h}
            </span>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label>Home route (permit pre-granted)</label>
        <select value={route} onChange={(e) => setRoute(e.target.value)}>
          {starterRoutes().map((r) => (
            <option key={r} value={r}>
              {routeName(r)} — {ROUTES[r].km} km, {ROUTES[r].hours}h
              {routeViaLabel(r) ? ` · ${routeViaLabel(r)}` : ''}
            </option>
          ))}
        </select>
      </div>
      <p className="small" style={{ maxWidth: 560 }} title={`${ROUTES[route].notes} ${haulBrief(ROUTES[route])}`}>
        <b className="accent">{haulTitle(ROUTES[route])}</b>
        {routeViaLabel(route) ? ` · ${routeViaLabel(route)}` : ''}
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button
          className="primary"
          style={{
            padding: '8px 24px',
            opacity: isNameValid ? 1 : 0.45,
            cursor: isNameValid ? 'pointer' : 'not-allowed',
          }}
          disabled={!isNameValid}
          title={isNameValid ? 'Register your company' : 'Enter a company name first'}
          onClick={handleRegister}
        >
          REGISTER THE COMPANY ▸
        </button>
        {cloudSaves.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <select
              value={selectedCloudId}
              onChange={(e) => setSelectedCloudId(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '6px 8px' }}
            >
              {cloudSaves.map((cs) => (
                <option key={cs.id} value={cs.id}>
                  ☁️ {cs.label} ({cs.company_name}, {fmtDate(cs.day)})
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedCloudId && loadCloud(selectedCloudId)}
              title="Load selected cloud save"
            >
              Resume Cloud Game
            </button>
          </div>
        )}
        {saveFiles.length > 0 && (
          <button onClick={() => loadSaveFile(saveFiles[0].name)}>
            Resume latest save ({saveFiles[0].name})
          </button>
        )}
        <button onClick={() => fileRef.current?.click()}>
          Import save file…
        </button>
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
    </div>
  )
}
