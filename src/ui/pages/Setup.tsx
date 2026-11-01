import { useEffect, useRef, useState } from 'react'
import { useGame } from '../../store/gameStore'
import { DIFFICULTIES } from '../../engine/data/balance'
import { starterRoutes } from '../../engine/newGame'
import { routeName, ROUTES, haulBrief, haulTitle, routeViaLabel } from '../../engine/data/routes'
import { fmtCompact } from '../../engine/core/money'
import type { Difficulty } from '../../engine/types'

export function SetupScreen() {
  const g = useGame()
  const startNew = g.startNew
  const [name, setName] = useState('Royal Travels')
  const [diff, setDiff] = useState<Difficulty>('malik')
  const [route, setRoute] = useState(starterRoutes()[0])
  const [saveFiles, setSaveFiles] = useState<{ name: string; size: number; mtime: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/save-files')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.files)) setSaveFiles(d.files)
      })
      .catch(() => {})
  }, [])

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
      <p className="tagline">
        Run a private intercity bus company in India. Buy diesel, dodge the RTO,
        out-price the rivals on RedBus, and don't miss an EMI.
      </p>

      <div className="form-row">
        <label>Company name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Deccan Queen Travels"
          style={{ width: 260 }}
          maxLength={28}
        />
      </div>

      <div className="diff-cards">
        {DIFFICULTIES.map((d) => (
          <div key={d.id} className={`diff-card ${diff === d.id ? 'sel' : ''}`} onClick={() => setDiff(d.id)}>
            <h3>{d.label}</h3>
            <ul>
              <li>Seed capital {fmtCompact(d.seedCapital)}</li>
              <li>Credit score {d.startCredit}</li>
              <li>{d.desc}</li>
            </ul>
          </div>
        ))}
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
      <p className="small dim" style={{ maxWidth: 560 }}>{ROUTES[route].notes}</p>
      <p className="small" style={{ maxWidth: 560 }}>
        <b className="accent">{haulTitle(ROUTES[route])}</b>
        {routeViaLabel(route) ? ` · ${routeViaLabel(route)}` : ''} — <span className="dim">{haulBrief(ROUTES[route])}</span>
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button className="primary" style={{ padding: '8px 24px' }} onClick={() => startNew(name.trim() || 'Bharat Bus Co', diff, route)}>
          REGISTER THE COMPANY ▸
        </button>
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
