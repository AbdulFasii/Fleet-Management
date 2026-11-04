import { Fragment, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useGame } from '../store/gameStore'
import { fmtDate, festivalEffect, seasonInfo } from '../engine/core/calendar'
import { fmtCompact, toRupees } from '../engine/core/money'
import { netWorth, receivablesTotal, fleetOccupancy } from '../engine/sim/finance'
import { CASH_LOAN_SLABS } from '../engine/data/loanProducts'
import { cashLoanNetInflow, quoteCashLoan } from '../engine/sim/banking'
import { accountantOnDuty } from '../engine/sim/staffing'
import { officeStaffingStats } from '../engine/sim/span'
import { M, Modal, ratingTone } from './bits'
import { SetupScreen } from './pages/Setup'
import { Dashboard } from './pages/Dashboard'
import { FleetPage } from './pages/Fleet'
import { BusDetailPage } from './pages/BusDetail'
import { MarketPage } from './pages/Market'
import { RoutesPage } from './pages/Routes'
import { SchedulesPage } from './pages/Schedules'
import { TripBoardPage } from './pages/TripBoard'
import { StaffPage } from './pages/Staff'
import { WorkshopPage } from './pages/Workshop'
import { CargoPage } from './pages/Cargo'
import { ChartersPage } from './pages/Charters'
import { LoungesPage } from './pages/Lounges'
import { InboxPage } from './pages/Inbox'
import { MoneyPage } from './pages/Money'
import { AnalyticsPage } from './pages/Analytics'
import { SettingsPage } from './pages/Settings'
import { tabBadges } from '../engine/sim/advisor'
import { OBJECTIVES } from '../engine/sim/objectives'
import { ACHIEVEMENT_DEFS } from '../engine/sim/reputation'
import { TABS } from './navigation'

function occTone(o: number | null): string {
  if (o === null) return 'dim'
  if (o >= 0.55) return 'good'
  if (o < 0.4) return 'bad'
  return 'warn'
}

function StatusStrip() {
  const s = useGame((g) => g.state)!
  const advance = useGame((g) => g.advance)
  const busy = useGame((g) => g.busy)
  const nav = useNavigate()
  const fest = festivalEffect(s.day)
  const season = seasonInfo(s.day)
  const alerts = s.inbox.filter((m) => m.day === s.day && m.cat === 'alert').length
  const fleet = Object.values(s.buses)
  const up = fleet.filter((b) => b.status === 'active').length
  const kpi = s.kpis[s.kpis.length - 1]
  const occToday = fleetOccupancy(s, 1)
  const occ7 = fleetOccupancy(s, 7)
  const officeStats = officeStaffingStats(s)
  const fmtOcc = (o: number | null) => (o === null ? '—' : `${Math.round(o * 100)}%`)
  const saveGame = useGame((g) => g.save)
  const toast = useGame((g) => g.toast)
  const resetToNewGame = useGame((g) => g.resetToNewGame ?? g.abandon)
  const [showNewGameModal, setShowNewGameModal] = useState(false)

  const activeBuses = fleet.filter((b) => b.status === 'active')
  const hasExpiredOrMissingGps = activeBuses.some(
    (b) =>
      b.insuranceExpiryDay < s.day ||
      b.fitnessExpiryDay < s.day ||
      (b.pucExpiryDay !== undefined && b.pucExpiryDay < s.day) ||
      (b.roadTaxPayableDay !== undefined && b.roadTaxPayableDay < s.day) ||
      !b.gpsDeviceFitted,
  )
  const hasExpiringSoon = activeBuses.some(
    (b) =>
      b.insuranceExpiryDay - s.day <= 7 ||
      b.fitnessExpiryDay - s.day <= 7 ||
      (b.pucExpiryDay !== undefined && b.pucExpiryDay - s.day <= 7) ||
      (b.roadTaxPayableDay !== undefined && b.roadTaxPayableDay - s.day <= 7),
  )
  const complianceTone = hasExpiredOrMissingGps ? 'bad' : hasExpiringSoon ? 'warn' : 'good'
  const complianceDotColor = hasExpiredOrMissingGps ? 'var(--bad, #f87171)' : hasExpiringSoon ? 'var(--warn, #facc15)' : 'var(--good, #4ade80)'
  const complianceLabel = hasExpiredOrMissingGps ? 'Breach' : hasExpiringSoon ? 'Expiring' : 'Valid'

  const upcomingLoans = Object.values(s.loans)
    .filter((l) => l.balance > 0 && l.nextEmiDay >= s.day && l.nextEmiDay - s.day <= 7)
    .sort((a, b) => a.nextEmiDay - b.nextEmiDay)
  const nextLoan = upcomingLoans[0]
  const onSave = () => {
    if (saveGame()) toast(`Game saved · ${fmtDate(s.day)}`, 'good')
    else toast('Save failed — browser storage may be full. Export from Settings.', 'bad')
  }
  return (
    <div className="status-strip">
      <span className="brand">{s.company.name.toUpperCase()}</span>
      <div className="stat-item">
        <span className="lbl">Date</span>
        <span className="val">
          {fmtDate(s.day)}
          {fest.name && <span className="festival-tag"> ◆ {fest.name}</span>}
          {!fest.name && season.name && <span className="dim"> · {season.name}</span>}
        </span>
      </div>
      <div className="stat-item">
        <span className="lbl">Cash</span>
        <span className="val"><M v={s.company.cash} colored /></span>
      </div>
      <div className="stat-item">
        <span className="lbl">OD headroom</span>
        <span className="val">{fmtCompact(s.od.limit - s.od.drawn)}</span>
      </div>
      <div className="stat-item">
        <span className="lbl">Receivables</span>
        <span className="val">{fmtCompact(receivablesTotal(s))}</span>
      </div>
      <div className="stat-item">
        <span className="lbl">Net worth</span>
        <span className="val"><M v={netWorth(s)} colored /></span>
      </div>
      <div className="stat-item">
        <span className="lbl">Today P&L</span>
        <span className="val">{kpi && kpi.day === s.day ? <M v={kpi.profit} signed colored /> : <span className="dim">—</span>}</span>
      </div>
      <div className="stat-item" title="Fleet occupancy from completed trips (seat-km)">
        <span className="lbl">Occ today</span>
        <span className={`val ${occTone(occToday)}`}>{fmtOcc(occToday)}</span>
      </div>
      <div className="stat-item" title="Fleet occupancy over the last 7 days (seat-km)">
        <span className="lbl">Occ 7d</span>
        <span className={`val ${occTone(occ7)}`}>{fmtOcc(occ7)}</span>
      </div>
      <div className="stat-item">
        <span className="lbl">Fleet</span>
        <span className="val">{up}/{fleet.length} up</span>
      </div>
      <div
        className="stat-item linkish"
        onClick={() => nav('/staff?tab=desks')}
        title={`Head Office: ${officeStats.totalFilled}/${officeStats.totalRequired} managers assigned (${officeStats.headsFilled}/${officeStats.headsTotal} head desks manned).\nClick to open Staff → Head Office.`}
        style={{ cursor: 'pointer' }}
      >
        <span className="lbl">Office</span>
        <span className={`val ${officeStats.tone}`}>
          {officeStats.totalFilled}/{officeStats.totalRequired}
        </span>
      </div>
      {(() => {
        const r = s.company.rating
        const nextInfo =
          r < 3.5
            ? `DELISTED from RedBus! +${(3.5 - r).toFixed(2)}★ to reach Delist threshold, +${(3.8 - r).toFixed(2)}★ to Relist.`
            : r < 3.8
            ? `At-Risk status. +${(3.8 - r).toFixed(2)}★ to safe Relist tier (3.8★). -${(r - 3.5).toFixed(2)}★ to Delist (3.5★).`
            : r < 4.3
            ? `Standard tier: +${(4.3 - r).toFixed(2)}★ to Primo (4.3★). Safety margin: -${(r - 3.8).toFixed(2)}★ above Relist floor (3.8★).`
            : `PRIMO certified operator! Margin: +${(r - 4.1).toFixed(2)}★ above Primo minimum (4.1★).`

        const tooltip = `3.5 delist · 3.8 relist · 4.3 Primo\nRating: ${r.toFixed(2)}★ (Milestones: [3.5 Delist] [3.8 Relist] [4.3 Primo])\n${nextInfo}`

        return (
          <div className="stat-item" title={tooltip} style={{ minWidth: 125 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="lbl">Rating</span>
              <span className="val" style={{ fontSize: '0.85rem' }}>
                <b className={ratingTone(r)}>{r.toFixed(2)}★</b>
                {s.company.primo ? (
                  <span className="accent" style={{ marginLeft: 4 }}> PRIMO</span>
                ) : r < 3.5 ? (
                  <span className="bad small" style={{ marginLeft: 4 }}>DELIST</span>
                ) : r < 3.8 ? (
                  <span className="warn small" style={{ marginLeft: 4 }}>AT-RISK</span>
                ) : (
                  <span className="dim small" style={{ marginLeft: 4 }}>→4.3P</span>
                )}
              </span>
            </div>
            {/* Milestone progress bar (scale 3.0 to 5.0) */}
            <div
              style={{
                position: 'relative',
                width: 120,
                height: 5,
                background: 'var(--bg-card, #222)',
                borderRadius: 3,
                overflow: 'hidden',
                marginTop: 2,
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, ((r - 3.0) / 2.0) * 100))}%`,
                  height: '100%',
                  background:
                    r >= 4.3 ? 'var(--accent)' : r >= 3.8 ? 'var(--info)' : r >= 3.5 ? 'var(--warn)' : 'var(--bad)',
                }}
              />
              {/* Markers for 3.5 (25%), 3.8 (40%), 4.3 (65%) */}
              <div style={{ position: 'absolute', left: '25%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)' }} />
              <div style={{ position: 'absolute', left: '40%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)' }} />
              <div style={{ position: 'absolute', left: '65%', top: 0, bottom: 0, width: 1, background: 'var(--accent)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--dim)', marginTop: 1, width: 120 }}>
              <span title="3.5★ Delist floor">3.5 Delist</span>
              <span title="3.8★ Relist milestone">3.8 Relist</span>
              <span title="4.3★ Primo milestone" style={{ color: r >= 4.3 ? 'var(--accent)' : 'inherit' }}>4.3 Primo</span>
            </div>
          </div>
        )
      })()}
      <div
        className="stat-item linkish"
        onClick={() => nav('/fleet')}
        title={`Compliance: ${complianceLabel}. Green = all docs & AIS-140 GPS valid. Amber = expiring within 7d. Red = expired or missing GPS.\nClick to view Fleet.`}
        style={{ cursor: 'pointer' }}
      >
        <span className="lbl">Compliance</span>
        <span className={`val ${complianceTone}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: complianceDotColor }} />
          {complianceLabel}
        </span>
      </div>
      {nextLoan && (() => {
        const emiDays = nextLoan.nextEmiDay - s.day
        const emiText = emiDays === 0 ? `EMI today ${fmtCompact(nextLoan.emi)}` : `EMI in ${emiDays}d ${fmtCompact(nextLoan.emi)}`
        return (
          <div
            className="stat-item linkish"
            onClick={() => nav('/money')}
            title={`Loan EMI due: ${nextLoan.lender} · ₹${toRupees(nextLoan.emi).toLocaleString('en-IN')} on ${fmtDate(nextLoan.nextEmiDay)}.\nClick to view Money.`}
            style={{ cursor: 'pointer' }}
          >
            <span className="lbl">Loan EMI</span>
            <span className="val warn">{emiText}</span>
          </div>
        )
      })()}
      <div className="stat-item">
        <span className="lbl">Alerts</span>
        <span
          className={`val ${alerts > 0 ? 'bad' : 'dim'}`}
          style={{ cursor: 'pointer' }}
          title="Open the inbox"
          onClick={() => nav('/inbox')}
        >
          {alerts}
        </span>
      </div>
      <div className="time-controls">
        <button className="primary" onClick={() => advance(1)} disabled={busy} title="N">▸ Day</button>
        <button onClick={() => advance(7)} disabled={busy} title="W">▸▸ Week</button>
        {busy && <span className="dim" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>simulating…</span>}
        <button onClick={onSave} title="Save now (S)">Save</button>
        <button
          onClick={() => setShowNewGameModal(true)}
          title="Create New Game (empty all data and start fresh)"
          style={{ marginLeft: 4 }}
        >
          + New Game
        </button>
      </div>

      {showNewGameModal && (
        <Modal title="CREATE NEW GAME">
          <p style={{ marginTop: 0, fontSize: '0.95rem' }}>
            Start a <b>New Game</b> and reset all company progress?
          </p>
          <div className="callout warn" style={{ padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>
            ⚠️ <b>This will empty all existing game data:</b>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>Current company (<b>{s.company.name}</b>) and cash balance</li>
              <li>Fleet of <b>{fleet.length}</b> bus{fleet.length === 1 ? '' : 'es'} and all attached/leased vehicles</li>
              <li>All route permits, schedules, and staff payroll</li>
              <li>All transaction books, financial history, and saved data</li>
            </ul>
          </div>
          <p className="small dim" style={{ marginBottom: 14 }}>
            Tip: You can export a backup of your current company first from the <b>Settings</b> tab (Export Save File) if you want to save it to your disk.
          </p>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setShowNewGameModal(false)}>Cancel</button>
            <button
              className="danger"
              style={{ padding: '6px 16px' }}
              onClick={() => {
                setShowNewGameModal(false)
                resetToNewGame()
                toast('Save data emptied. Ready to register a new company.', 'good')
                nav('/')
              }}
            >
              Empty Data & Start New Game
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DecisionModal() {
  const s = useGame((g) => g.state)!
  const decide = useGame((g) => g.decide)
  const d = s.decisions[0]
  if (!d) return null
  const queued = s.decisions.length - 1
  const acct = accountantOnDuty(s)
  return (
    <Modal title={`DECISION — ${d.title}`}>
      <p style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{d.body}</p>
      {d.kind === 'cheque_bounce' && acct && (
        <p className="small dim" style={{ marginTop: -4 }}>
          Accounts Manager {acct.name} will clear this automatically on the next day tick.
        </p>
      )}
      <div className="flex flex-wrap" style={{ justifyContent: 'flex-end', alignItems: 'flex-end' }}>
        {queued > 0 && <span className="dim">{queued} more decision{queued > 1 ? 's' : ''} waiting</span>}
        <span className="spacer" />
        {d.options.map((o, idx) => {
          const optId = o.id ?? (o as any).key ?? String(idx)
          return (
            <div key={optId} style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 210 }}>
              <button className="primary" onClick={() => decide(d.id, optId)}>
                {o.label}
              </button>
              {o.detail && <span className="dim small">{o.detail}</span>}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function VictoryScreen() {
  const s = useGame((g) => g.state)!
  const ack = useGame((g) => g.acknowledgeVictory)
  const abandon = useGame((g) => g.abandon)
  const v = s.victory!
  return (
    <Modal
      title="A TRANSPORT EMPIRE"
      actions={<><button className="primary" onClick={ack}>Keep playing</button><button onClick={abandon}>Retire & start over</button></>}
    >
      <p>Your company reached ₹100 Cr net worth. The game carries on if you want to keep building.</p>
      <table className="data">
        <tbody>
          <tr><td>Days taken</td><td className="num">{v.score.daysSurvived}</td></tr>
          <tr><td>Net worth</td><td className="num"><M v={v.netWorth} /></td></tr>
          <tr><td>Peak fleet</td><td className="num">{v.score.peakFleet} buses</td></tr>
          <tr><td>Lifetime operating profit</td><td className="num"><M v={v.score.lifetimeProfit} colored /></td></tr>
          <tr><td>Rating</td><td className="num">{v.score.bestRating}★</td></tr>
          <tr><td>Routes served</td><td className="num">{v.score.routesServed}</td></tr>
          <tr><td>Goals reached</td><td className="num">{Object.keys(s.objectives ?? {}).length}/{OBJECTIVES.length}</td></tr>
          <tr><td>Achievements</td><td className="num">{Object.keys(s.achievements).length}/{ACHIEVEMENT_DEFS.length}</td></tr>
        </tbody>
      </table>
    </Modal>
  )
}

function GameOverScreen() {
  const s = useGame((g) => g.state)!
  const abandon = useGame((g) => g.abandon)
  const rescueWithLoan = useGame((g) => g.rescueWithLoan)
  const go = s.gameOver!
  const shortfall = Math.max(0, -s.company.cash)
  return (
    <Modal
      title="THE COMPANY IS FINISHED"
      actions={<button onClick={abandon}>Start over</button>}
    >
      <p>{go.reason}</p>
      <table className="data">
        <tbody>
          <tr><td>Days survived</td><td className="num">{go.score.daysSurvived}</td></tr>
          <tr><td>Peak fleet</td><td className="num">{go.score.peakFleet} buses</td></tr>
          <tr><td>Lifetime operating profit</td><td className="num"><M v={go.score.lifetimeProfit} colored /></td></tr>
          <tr><td>Final rating</td><td className="num">{go.score.bestRating}★</td></tr>
          <tr><td>Routes served</td><td className="num">{go.score.routesServed}</td></tr>
          <tr><td>Cash shortfall now</td><td className="num bad"><M v={shortfall} /></td></tr>
        </tbody>
      </table>
      <p className="small" style={{ marginTop: 12 }}>
        Borrow working capital and continue. Same slabs as the Bank tab. Distress rate is +4% and credit takes a hit. Pick a facility that covers the shortfall.
      </p>
      <table className="data">
        <thead>
          <tr><th>Facility</th><th className="num">Net cash</th><th className="num">EMI</th><th className="num">Tenure</th><th /></tr>
        </thead>
        <tbody>
          {CASH_LOAN_SLABS.map((slab) => {
            const q = quoteCashLoan(s, slab.id, { ignoreCredit: true, distress: true })
            const net = cashLoanNetInflow(slab.id) ?? 0
            const covers = net >= shortfall
            return (
              <tr key={slab.id}>
                <td>{slab.label}</td>
                <td className="num"><M v={net} /></td>
                <td className="num">{q ? <M v={q.emi} /> : '—'}</td>
                <td className="num">{slab.months}m</td>
                <td className="num">
                  <button
                    className="small primary"
                    disabled={!covers}
                    title={covers ? `Draw ${slab.label} and continue` : 'Does not cover the shortfall'}
                    onClick={() => rescueWithLoan(slab.id)}
                  >
                    {covers ? 'borrow & continue' : 'too small'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}

function Toasts() {
  const toasts = useGame((g) => g.toasts)
  const dismiss = useGame((g) => g.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>
      ))}
    </div>
  )
}

function Shell() {
  const s = useGame((g) => g.state)!
  const advance = useGame((g) => g.advance)
  const save = useGame((g) => g.save)
  const skipStop = useGame((g) => g.skipStopReason)
  const toast = useGame((g) => g.toast)
  const nav = useNavigate()
  const loc = useLocation()

  // Celebrate new goals and achievements as they land (not the ones already earned on load).
  const goalCount = Object.keys(s.objectives ?? {}).length + Object.keys(s.achievements ?? {}).length
  const [seenGoals, setSeenGoals] = useState(goalCount)
  useEffect(() => {
    if (goalCount > seenGoals) {
      const last = [...(s.inbox ?? [])].reverse().find((m) => m.text.startsWith('GOAL REACHED') || m.text.startsWith('ACHIEVEMENT'))
      if (last) toast(last.text, 'good')
    }
    if (goalCount !== seenGoals) setSeenGoals(goalCount)
  }, [goalCount, seenGoals, s.inbox, toast])

  useEffect(() => {
    if (skipStop) toast(`Skip paused: ${skipStop}`, 'bad')
  }, [skipStop, toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'n') { e.preventDefault(); advance(1); return }
      if (k === 'w') { e.preventDefault(); advance(7); return }
      if (k === 's') {
        e.preventDefault()
        const day = useGame.getState().state?.day
        if (save()) toast(day != null ? `Game saved · ${fmtDate(day)}` : 'Game saved', 'good')
        else toast('Save failed — browser storage may be full. Export from Settings.', 'bad')
        return
      }
      const tab = TABS.find((t) => t.key === k)
      if (tab) nav(tab.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, nav, save, toast])

  useEffect(() => {
    const flush = () => { save() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [save])

  const hints = useMemo(() => [
    ['N', 'next day'], ['W', 'skip week'], ['S', 'save'],
    ['1-8,0', 'tabs'], ['C', 'cargo'], ['A', 'analytics'], ['I', 'inbox'],
  ], [])

  const badges = s ? tabBadges(s) : {}

  return (
    <div className="app-shell">
      <StatusStrip />
      <div className="tab-bar">
        {TABS.map((t, i) => {
          const isInbox = t.path === '/inbox'
          const unread = isInbox ? (s?.inbox ?? []).filter((m) => !m.read).length : (badges[t.path] ?? 0)
          return (
            <Fragment key={t.path}>
            {i > 0 && TABS[i - 1]!.group !== t.group && <span className="tab-sep" />}
            <NavLink to={t.path} className={({ isActive }) => (isActive ? 'active' : '')} end={t.path === '/'}>
              {t.label}
              {unread > 0 && (
                <span
                  className="pill bad small"
                  style={{ marginLeft: 4, padding: '1px 5px', fontSize: '0.70rem', verticalAlign: 'middle' }}
                >
                  {unread}
                </span>
              )}
              <span className="key">{t.key}</span>
            </NavLink>
            </Fragment>
          )
        })}
      </div>
      <div className="app-main" key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/fleet/:busId" element={<BusDetailPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/trips" element={<TripBoardPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/cargo" element={<CargoPage />} />
          <Route path="/charters" element={<ChartersPage />} />
          <Route path="/lounges" element={<LoungesPage />} />
          <Route path="/workshop" element={<WorkshopPage />} />
          <Route path="/money" element={<MoneyPage />} />
          <Route path="/finance" element={<Navigate to="/money" replace />} />
          <Route path="/bank" element={<Navigate to="/money" replace />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
      <div className="key-hints">
        {hints.map(([k, label]) => (
          <span key={k}><kbd>{k}</kbd> {label}</span>
        ))}
        <span className="spacer" />
        <span className="dim">day {s.day - s.startDay + 1} · seed {s.seed.toString(36)}</span>
      </div>
      {s.decisions.length > 0 && !s.gameOver && <DecisionModal />}
      {s.gameOver && <GameOverScreen />}
      {s.victory && !s.victory.acknowledged && !s.gameOver && <VictoryScreen />}
      <Toasts />
    </div>
  )
}

// Load any existing save and sync shared body designs once, before first render.
useGame.getState().loadSave()
useGame.getState().initSharedBodyDesigns()

export default function App() {
  const hasState = useGame((g) => g.state !== null)
  useEffect(() => {
    useGame.getState().initSharedBodyDesigns()
  }, [])
  if (!hasState) return <><SetupScreen /><Toasts /></>
  return <Shell />
}
