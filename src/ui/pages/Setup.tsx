import type { Scenario } from '../../engine/types'
import { useEffect, useRef, useState } from 'react'
import { fmtDate } from '../../engine/core/calendar'
import { useGame } from '../../store/gameStore'
import { listCloudSaves, type CloudSaveHeader } from '../../store/cloudGameSave'
import { DIFFICULTIES } from '../../engine/data/balance'
import { starterRoutes } from '../../engine/newGame'
import { routeName, ROUTES, haulBrief, haulTitle, routeViaLabel } from '../../engine/data/routes'
import { fmtCompact } from '../../engine/core/money'
import type { Difficulty } from '../../engine/types'

export function SetupScreen() {
  const g = useGame()
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

  return (
    <div className="setup-screen">
      <h1>Bus Operator Tycoon</h1>

      <div className="form-row">
        <label>Company name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
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
            ['standard', 'Standard', 'The full game. Reach ₹100 Cr net worth to win.'],
            ['sandbox', 'Sandbox', 'Extra ₹10 Cr, the game never ends, no victory. For trying things out.'],
            ['ironman', 'Ironman', 'No rescue loan, no loading another save over a running game, and a ₹150 Cr finish line.'],
          ] as const).map(([id, label, tip]) => (
            <button key={id} className={`small ${scenario === id ? 'primary' : ''}`} title={tip} onClick={() => setScenario(id)}>{label}</button>
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
        <button className="primary" style={{ padding: '8px 24px' }} onClick={() => startNew(name.trim() || 'Bharat Bus Co', diff, route, scenario)}>
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
